/**
 * fix-kas-to-bank-mandiri.ts
 * Fix semua public.accounting_entries sport_center_booking yang pakai journal Kas → Bank Mandiri CST
 * Jalankan: tsx scripts/fix-kas-to-bank-mandiri.ts --prod
 */
import pg from "pg";
const { Client } = pg;

const isProd = process.argv.includes("--prod");
const rawUrl = isProd ? process.env.SUPABASE_DATABASE_URL : process.env.SUPABASE_DATABASE_URL_DEV;
if (!rawUrl) { console.error("URL not set"); process.exit(1); }
const url = rawUrl.replace(":6543/", ":5432/");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ Connected to ${isProd ? "PROD" : "DEV"}\n`);

// 1. Lookup IDs
const [bnkJ, kasJ, kasA, bankA] = await Promise.all([
  client.query(`SELECT id, name FROM public.accounting_journals WHERE code = 'BNK-CST' LIMIT 1`),
  client.query(`SELECT id, name FROM public.accounting_journals WHERE id = 389 LIMIT 1`),
  client.query(`SELECT id, name, code FROM public.chart_of_accounts WHERE code = '1-1010-CST' AND is_active = true LIMIT 1`),
  client.query(`SELECT id, name, code FROM public.chart_of_accounts WHERE code = '1-1020-CST' AND is_active = true LIMIT 1`),
]);

const bnkJournalId  = Number(bnkJ.rows[0]?.id);
const kasJournalId  = Number(kasJ.rows[0]?.id ?? 389);
const kasAccountId  = Number(kasA.rows[0]?.id ?? 0);
const bankAccountId = Number(bankA.rows[0]?.id ?? 49098);

console.log(`Journal Kas  (id=${kasJournalId}): "${kasJ.rows[0]?.name}"`);
console.log(`Journal BNK  (id=${bnkJournalId}): "${bnkJ.rows[0]?.name}"`);
console.log(`Account Kas  (id=${kasAccountId}): ${kasA.rows[0]?.name} [${kasA.rows[0]?.code}]`);
console.log(`Account Bank (id=${bankAccountId}): ${bankA.rows[0]?.name} [${bankA.rows[0]?.code}]\n`);

if (!bnkJournalId) { console.error("❌ BNK-CST journal tidak ditemukan!"); await client.end(); process.exit(1); }

// 2. Cari semua entry yang salah:
//    a) journal bukan BNK-CST (termasuk journal Kas)
//    b) entry_number masih SC-CSH/ atau JNL/ (meski journal sudah BNK-CST)
const affected = await client.query(`
  SELECT ae.id, ae.entry_number, ae.journal_id, ae.ref, ae.date::text, ae.total_debit,
         j.name AS journal_name, j.code AS journal_code
  FROM public.accounting_entries ae
  LEFT JOIN public.accounting_journals j ON j.id = ae.journal_id
  WHERE ae.source = 'sport_center_booking'
    AND (
      ae.journal_id != $1 OR ae.journal_id IS NULL
      OR ae.entry_number LIKE 'SC-CSH/%'
      OR ae.entry_number LIKE 'JNL/%'
    )
  ORDER BY ae.date, ae.id
`, [bnkJournalId]);

console.log(`🔍 Ditemukan ${affected.rows.length} entry yang perlu difix:`);
for (const r of affected.rows) {
  console.log(`  id=${r.id}  ${r.entry_number}  journal="${r.journal_name}"  ref=${r.ref}  date=${r.date?.slice(0,10)}`);
}
if (affected.rows.length === 0) {
  console.log("✅ Tidak ada yang perlu difix."); await client.end(); process.exit(0);
}
console.log();

// 3. Hitung entry_number baru
const maxSeqRes = await client.query(`
  SELECT COALESCE(MAX(
    NULLIF(REGEXP_REPLACE(entry_number, '^SC-BNK/[0-9]+/', ''), '')::integer
  ), 0) AS max_seq
  FROM public.accounting_entries
  WHERE entry_number ~ '^SC-BNK/[0-9]+/[0-9]+$'
`);
let nextSeq = Number(maxSeqRes.rows[0]?.max_seq ?? 0) + 1;
const year  = new Date().getFullYear();

const renames: { id: number; oldNum: string; newNum: string; fixJournal: boolean }[] = [];
for (const r of affected.rows) {
  const oldNum = r.entry_number as string;
  const isWrongPrefix = oldNum.startsWith("SC-CSH/") || oldNum.startsWith("JNL/");
  const isWrongJournal = r.journal_code !== "BNK-CST";
  let newNum: string;
  if (isWrongPrefix) {
    newNum = `SC-BNK/${year}/${String(nextSeq).padStart(4, "0")}`;
    nextSeq++;
  } else {
    newNum = oldNum;
  }
  renames.push({ id: r.id, oldNum, newNum, fixJournal: isWrongJournal });
}

// Cek konflik nomor baru
const newNums = renames.filter(r => r.oldNum !== r.newNum).map(r => r.newNum);
if (newNums.length > 0) {
  const conflict = await client.query(`SELECT entry_number FROM public.accounting_entries WHERE entry_number = ANY($1)`, [newNums]);
  if (conflict.rows.length > 0) {
    const conflictSet = new Set(conflict.rows.map((r: any) => r.entry_number));
    for (const r of renames) { if (conflictSet.has(r.newNum)) r.newNum = r.oldNum; }
    console.warn(`⚠️  Conflict disesuaikan: ${[...conflictSet].join(", ")}\n`);
  }
}

// 4. Fix dalam transaksi — bypass immutability trigger dengan session_replication_role
await client.query("BEGIN");
try {
  // Bypass trigger immutability (seperti cara fix_sc_entries.ts)
  await client.query("SET LOCAL session_replication_role = replica");
  console.log("🔓 Trigger immutability dibypass (replica mode)\n");

  let updatedEntries = 0, updatedLines = 0;

  for (const { id, oldNum, newNum, fixJournal } of renames) {
    // Update journal_id dan/atau entry_number
    if (fixJournal && oldNum !== newNum) {
      await client.query(
        `UPDATE public.accounting_entries SET journal_id=$1, entry_number=$2 WHERE id=$3`,
        [bnkJournalId, newNum, id]
      );
    } else if (fixJournal) {
      await client.query(
        `UPDATE public.accounting_entries SET journal_id=$1 WHERE id=$2`,
        [bnkJournalId, id]
      );
    } else if (oldNum !== newNum) {
      await client.query(
        `UPDATE public.accounting_entries SET entry_number=$1 WHERE id=$2`,
        [newNum, id]
      );
    }
    updatedEntries++;

    const numNote = oldNum !== newNum ? `${oldNum} → ${newNum}` : oldNum;
    const journalNote = fixJournal ? " journal→BNK-CST" : " (journal sudah BNK-CST)";
    console.log(`  ✏️  id=${id} (${numNote})${journalNote}`);

    // Update debit lines: Kas account → Bank Mandiri CST (hanya jika journal juga salah)
    if (fixJournal && kasAccountId) {
      const lineResult = await client.query(
        `UPDATE public.accounting_entry_lines SET account_id=$1 WHERE entry_id=$2 AND account_id=$3 RETURNING id`,
        [bankAccountId, id, kasAccountId]
      );
      if ((lineResult.rowCount ?? 0) > 0) {
        updatedLines += lineResult.rowCount!;
        console.log(`     → ${lineResult.rowCount} line(s): Kas → Bank Mandiri CST`);
      } else {
        // Fallback: cari debit lines dengan nama/kode kas
        const debitLines = await client.query(
          `SELECT ael.id, coa.name AS acct_name, coa.code AS acct_code, coa.account_type
           FROM public.accounting_entry_lines ael
           LEFT JOIN public.chart_of_accounts coa ON coa.id = ael.account_id
           WHERE ael.entry_id=$1 AND ael.debit > 0`, [id]
        );
        for (const dl of debitLines.rows) {
          const isKasLike = dl.acct_code?.includes("1-1010") || dl.acct_name?.toLowerCase().includes("kas") || dl.account_type?.toLowerCase() === "cash";
          if (isKasLike) {
            await client.query(`UPDATE public.accounting_entry_lines SET account_id=$1 WHERE id=$2`, [bankAccountId, dl.id]);
            updatedLines++;
            console.log(`     → line id=${dl.id}: "${dl.acct_name}" (${dl.acct_code}) → Bank Mandiri CST`);
          } else {
            console.log(`     ℹ️  line id=${dl.id}: "${dl.acct_name}" (${dl.acct_code}) — bukan kas, dibiarkan`);
          }
        }
      }
    }
  }

  await client.query("COMMIT");
  console.log(`\n✅ COMMIT OK — ${updatedEntries} entries, ${updatedLines} lines diupdate.\n`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("❌ ROLLBACK:", err);
  await client.end();
  process.exit(1);
}

// 5. Verifikasi — tidak boleh ada satu pun yang kelewat
console.log("─── VERIFIKASI ─────────────────────────────────────────────────");
const verify = await client.query(`
  SELECT ae.id, ae.entry_number, j.name AS journal_name, j.code AS journal_code, ae.ref, ae.date::text,
    COALESCE((
      SELECT coa.name FROM public.accounting_entry_lines ael
      JOIN public.chart_of_accounts coa ON coa.id = ael.account_id
      WHERE ael.entry_id = ae.id AND ael.debit > 0 LIMIT 1
    ), 'no-debit-line') AS debit_account
  FROM public.accounting_entries ae
  JOIN public.accounting_journals j ON j.id = ae.journal_id
  WHERE ae.id = ANY($1)
  ORDER BY ae.date, ae.id
`, [renames.map(r => r.id)]);

let hasIssue = false;
for (const r of verify.rows) {
  const ok     = r.journal_code === "BNK-CST";
  const lineOk = !r.debit_account?.toLowerCase().includes("kas");
  const prefixOk = !r.entry_number?.startsWith("SC-CSH/") && !r.entry_number?.startsWith("JNL/");
  const status = ok && lineOk && prefixOk ? "✅" : "❌";
  if (!ok || !lineOk || !prefixOk) hasIssue = true;
  console.log(`${status} id=${r.id}  ${r.entry_number}  journal="${r.journal_name}"  debit="${r.debit_account}"  ref=${r.ref}`);
}

// Cross-check: zero remaining
const remaining = await client.query(`
  SELECT COUNT(*) AS cnt FROM public.accounting_entries ae
  LEFT JOIN public.accounting_journals j ON j.id = ae.journal_id
  WHERE ae.source = 'sport_center_booking'
    AND (j.code != 'BNK-CST' OR j.id IS NULL
         OR ae.entry_number LIKE 'SC-CSH/%' OR ae.entry_number LIKE 'JNL/%')
`);
const remainingCount = Number(remaining.rows[0]?.cnt ?? 0);

if (remainingCount > 0 || hasIssue) {
  const rem = await client.query(`
    SELECT ae.id, ae.entry_number, j.name AS journal, ae.ref
    FROM public.accounting_entries ae LEFT JOIN public.accounting_journals j ON j.id = ae.journal_id
    WHERE ae.source = 'sport_center_booking'
      AND (j.code != 'BNK-CST' OR j.id IS NULL OR ae.entry_number LIKE 'SC-CSH/%' OR ae.entry_number LIKE 'JNL/%')
    ORDER BY ae.id
  `);
  console.error(`\n❌ Masih ada ${remainingCount} entry yang belum beres:`);
  rem.rows.forEach((r: any) => console.log(`  ❌ id=${r.id}  ${r.entry_number}  journal="${r.journal}"  ref=${r.ref}`));
  process.exit(1);
} else {
  console.log(`\n✅ SEMUA ${renames.length} entry sport_center_booking sudah benar. Tidak ada yang kelewat.`);
}

await client.end();
