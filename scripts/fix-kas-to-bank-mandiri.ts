/**
 * fix-kas-to-bank-mandiri.ts
 *
 * Memperbaiki semua public.accounting_entries (source = sport_center_booking)
 * yang salah menggunakan journal Kas, dan menggantinya ke Bank Mandiri CST.
 *
 * Yang difix:
 *  1. accounting_entries.journal_id  → BNK-CST journal
 *  2. accounting_entries.entry_number → ganti prefix SC-CSH/ & JNL/ → SC-BNK/
 *  3. accounting_entry_lines.account_id → ganti Kas account → Bank Mandiri CST account
 *
 * Jalankan: tsx scripts/fix-kas-to-bank-mandiri.ts [--prod]
 */

import pg from "pg";
const { Client } = pg;

const isProd = process.argv.includes("--prod");
const rawUrl = isProd
  ? process.env.SUPABASE_DATABASE_URL
  : process.env.SUPABASE_DATABASE_URL_DEV;

if (!rawUrl) {
  console.error(`${isProd ? "SUPABASE_DATABASE_URL" : "SUPABASE_DATABASE_URL_DEV"} not set`);
  process.exit(1);
}

// Session pooler (port 5432) for DDL/transaction support
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

await client.connect();
console.log(`\n✅ Connected to ${isProd ? "PROD" : "DEV"} Supabase\n`);

try {
  // ─── 1. Lookup IDs yang dibutuhkan ────────────────────────────────────────
  const [bnkJournal, kasJournal, kasAccount, bankAccount] = await Promise.all([
    client.query(`SELECT id, name FROM public.accounting_journals WHERE code = 'BNK-CST' LIMIT 1`),
    client.query(`SELECT id, name FROM public.accounting_journals WHERE id = 389 LIMIT 1`),
    client.query(`SELECT id, name, code FROM public.chart_of_accounts WHERE code = '1-1010-CST' AND is_active = true LIMIT 1`),
    client.query(`SELECT id, name, code FROM public.chart_of_accounts WHERE code = '1-1020-CST' AND is_active = true LIMIT 1`),
  ]);

  const bnkJournalId  = bnkJournal.rows[0]?.id;
  const bnkJournalName = bnkJournal.rows[0]?.name ?? "Bank Mandiri CST";
  const kasJournalId  = kasJournal.rows[0]?.id ?? 389;
  const kasJournalName = kasJournal.rows[0]?.name ?? "Kas";
  const kasAccountId  = kasAccount.rows[0]?.id;
  const bankAccountId = bankAccount.rows[0]?.id ?? 49098; // fallback hardcoded

  if (!bnkJournalId) {
    console.error("❌ BNK-CST journal tidak ditemukan di public.accounting_journals. Batalkan.");
    process.exit(1);
  }

  console.log(`Journal Kas  (id=${kasJournalId}): "${kasJournalName}"`);
  console.log(`Journal BNK  (id=${bnkJournalId}): "${bnkJournalName}"`);
  console.log(`Account Kas  (id=${kasAccountId ?? "NOT FOUND"}): ${kasAccount.rows[0]?.name ?? "-"} [${kasAccount.rows[0]?.code ?? "1-1010-CST"}]`);
  console.log(`Account Bank (id=${bankAccountId}): ${bankAccount.rows[0]?.name ?? "Bank Mandiri CST"} [${bankAccount.rows[0]?.code ?? "1-1020-CST"}]`);
  console.log();

  // ─── 2. Temukan semua entries yang perlu difix ─────────────────────────────
  // Kriteria: source = sport_center_booking DAN (salah journal ATAU prefix SC-CSH/ atau JNL/)
  const affected = await client.query(`
    SELECT
      ae.id,
      ae.entry_number,
      ae.journal_id,
      ae.ref,
      ae.date,
      ae.total_debit,
      j.name AS journal_name
    FROM public.accounting_entries ae
    LEFT JOIN public.accounting_journals j ON j.id = ae.journal_id
    WHERE ae.source = 'sport_center_booking'
      AND (
        ae.journal_id = $1
        OR ae.entry_number LIKE 'SC-CSH/%'
        OR ae.entry_number LIKE 'JNL/%'
      )
    ORDER BY ae.date, ae.id
  `, [kasJournalId]);

  if (affected.rows.length === 0) {
    console.log("✅ Tidak ada entry yang perlu difix. Selesai.");
    await client.end();
    process.exit(0);
  }

  console.log(`🔍 Ditemukan ${affected.rows.length} entry yang perlu difix:\n`);
  for (const r of affected.rows) {
    console.log(`  id=${r.id}  ${r.entry_number}  journal="${r.journal_name ?? r.journal_id}"  ref=${r.ref}  date=${r.date}  debit=${r.total_debit}`);
  }
  console.log();

  // ─── 3. Cek entry_number conflicts sebelum rename ─────────────────────────
  // Kita rename SC-CSH/YYYY/NNNN → SC-BNK/YYYY/CSH-NNNN
  // dan JNL/YYYY/NNNNNN → SC-BNK/YYYY/JNL-NNNNNN
  // Ini menghindari duplikat dengan SC-BNK yang sudah ada
  const renames: Array<{ id: number; oldNum: string; newNum: string }> = [];
  for (const r of affected.rows) {
    const oldNum: string = r.entry_number;
    let newNum: string;
    if (oldNum.startsWith("SC-CSH/")) {
      // SC-CSH/2026/0033 → SC-BNK/2026/CSH-0033
      newNum = oldNum.replace(/^SC-CSH\//, "SC-BNK/").replace(/\/(\d+)$/, "/CSH-$1");
    } else if (oldNum.startsWith("JNL/")) {
      // JNL/2026/000081 → SC-BNK/2026/JNL-000081
      newNum = oldNum.replace(/^JNL\/(\d+)\/(.+)$/, "SC-BNK/$1/JNL-$2");
    } else {
      // Sudah pakai prefix lain, hanya update journal_id
      newNum = oldNum;
    }
    renames.push({ id: r.id, oldNum, newNum });
  }

  // Periksa apakah newNum sudah ada
  const newNums = renames.filter(r => r.oldNum !== r.newNum).map(r => r.newNum);
  if (newNums.length > 0) {
    const conflict = await client.query(
      `SELECT entry_number FROM public.accounting_entries WHERE entry_number = ANY($1)`,
      [newNums]
    );
    if (conflict.rows.length > 0) {
      console.warn(`⚠️  Conflict entry_number ditemukan: ${conflict.rows.map((r: any) => r.entry_number).join(", ")}`);
      console.warn("   Entry yang conflict tidak akan diganti nomornya, hanya journal & account-nya.\n");
    }
    const conflictSet = new Set(conflict.rows.map((r: any) => r.entry_number));
    for (const r of renames) {
      if (conflictSet.has(r.newNum)) r.newNum = r.oldNum; // batalkan rename
    }
  }

  // ─── 4. Fix dalam satu transaksi ──────────────────────────────────────────
  await client.query("BEGIN");

  try {
    let updatedEntries = 0;
    let updatedLines = 0;

    for (const { id, oldNum, newNum } of renames) {
      // 4a. Update journal_id dan entry_number
      await client.query(
        `UPDATE public.accounting_entries
         SET journal_id = $1,
             entry_number = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [bnkJournalId, newNum, id]
      );
      updatedEntries++;

      if (oldNum !== newNum) {
        console.log(`  ✏️  entry_number: ${oldNum} → ${newNum}`);
      }
      console.log(`  ✏️  entry id=${id} (${newNum}): journal_id ${kasJournalId} → ${bnkJournalId}`);

      // 4b. Update account_id di entry_lines: Kas → Bank Mandiri CST
      if (kasAccountId) {
        const lineResult = await client.query(
          `UPDATE public.accounting_entry_lines
           SET account_id = $1,
               updated_at = NOW()
           WHERE entry_id = $2
             AND account_id = $3
           RETURNING id`,
          [bankAccountId, id, kasAccountId]
        );
        if (lineResult.rowCount && lineResult.rowCount > 0) {
          updatedLines += lineResult.rowCount;
          console.log(`     → ${lineResult.rowCount} line(s): account Kas → Bank Mandiri CST`);
        } else {
          // Fallback: cari berdasarkan debit > 0 (baris debit = penerimaan = harus Bank)
          // Ini menangani kasus account_id pakai ID berbeda tapi masih Kas
          const debitLines = await client.query(
            `SELECT id, account_id FROM public.accounting_entry_lines
             WHERE entry_id = $1 AND debit > 0`,
            [id]
          );
          for (const dl of debitLines.rows) {
            // Ambil nama akun untuk verifikasi
            const acctInfo = await client.query(
              `SELECT name, code, account_type FROM public.chart_of_accounts WHERE id = $1`,
              [dl.account_id]
            );
            const acct = acctInfo.rows[0];
            const isKasLike =
              acct &&
              (acct.code?.includes("1-1010") ||
               acct.name?.toLowerCase().includes("kas") ||
               acct.account_type?.toLowerCase() === "cash");
            if (isKasLike) {
              await client.query(
                `UPDATE public.accounting_entry_lines
                 SET account_id = $1, updated_at = NOW()
                 WHERE id = $2`,
                [bankAccountId, dl.id]
              );
              updatedLines++;
              console.log(`     → line id=${dl.id}: account "${acct.name}" (${acct.code}) → Bank Mandiri CST`);
            } else if (acct) {
              console.log(`     ℹ️  line id=${dl.id} debit: "${acct.name}" (${acct.code}) — dibiarkan`);
            }
          }
        }
      } else {
        // Tidak ada 1-1010-CST, pakai pendekatan debit line
        console.warn(`  ⚠️  1-1010-CST tidak ditemukan, skip account_line fix untuk entry ${id}`);
      }
    }

    await client.query("COMMIT");
    console.log(`\n✅ COMMIT berhasil.`);
    console.log(`   - ${updatedEntries} accounting_entries diupdate`);
    console.log(`   - ${updatedLines} accounting_entry_lines diupdate\n`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ ERROR — ROLLBACK:", err);
    process.exit(1);
  }

  // ─── 5. Verifikasi akhir ───────────────────────────────────────────────────
  console.log("─── VERIFIKASI ──────────────────────────────────────────────");
  const verify = await client.query(`
    SELECT
      ae.id,
      ae.entry_number,
      j.name  AS journal_name,
      j.code  AS journal_code,
      ae.ref,
      ae.date::text,
      ae.total_debit,
      COALESCE(
        (SELECT coa.name
         FROM public.accounting_entry_lines ael
         JOIN public.chart_of_accounts coa ON coa.id = ael.account_id
         WHERE ael.entry_id = ae.id AND ael.debit > 0
         LIMIT 1),
        'no-debit-line'
      ) AS debit_account
    FROM public.accounting_entries ae
    JOIN public.accounting_journals j ON j.id = ae.journal_id
    WHERE ae.id = ANY($1)
    ORDER BY ae.date, ae.id
  `, [renames.map(r => r.id)]);

  let hasIssue = false;
  for (const r of verify.rows) {
    const ok = r.journal_code === "BNK-CST";
    const lineOk = !r.debit_account?.toLowerCase().includes("kas");
    const status = ok && lineOk ? "✅" : "❌";
    if (!ok || !lineOk) hasIssue = true;
    console.log(
      `${status} id=${r.id}  ${r.entry_number}  journal="${r.journal_name}"  debit_account="${r.debit_account}"  ref=${r.ref}`
    );
  }

  if (hasIssue) {
    console.error("\n❌ Ada entry yang masih belum benar setelah fix! Cek manual.");
    process.exit(1);
  } else {
    console.log(`\n✅ Semua ${verify.rows.length} entry sudah benar — journal Bank Mandiri CST, debit bukan Kas.`);
  }

  // Pastikan tidak ada yang kelewat
  const remaining = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM public.accounting_entries ae
    JOIN public.accounting_journals j ON j.id = ae.journal_id
    WHERE ae.source = 'sport_center_booking'
      AND (
        j.code != 'BNK-CST'
        OR ae.entry_number LIKE 'SC-CSH/%'
        OR ae.entry_number LIKE 'JNL/%'
      )
  `);
  const remainingCount = Number(remaining.rows[0]?.cnt ?? 0);
  if (remainingCount > 0) {
    console.error(`\n❌ Masih ada ${remainingCount} entry sport_center_booking yang salah! Investigasi manual.`);
    const rem = await client.query(`
      SELECT ae.id, ae.entry_number, j.name AS journal, ae.ref
      FROM public.accounting_entries ae
      JOIN public.accounting_journals j ON j.id = ae.journal_id
      WHERE ae.source = 'sport_center_booking'
        AND (j.code != 'BNK-CST' OR ae.entry_number LIKE 'SC-CSH/%' OR ae.entry_number LIKE 'JNL/%')
      ORDER BY ae.id
    `);
    rem.rows.forEach((r: any) => console.log(`  ❌ id=${r.id}  ${r.entry_number}  journal="${r.journal}"  ref=${r.ref}`));
  } else {
    console.log("✅ Tidak ada sisa entry yang salah. Semua bersih.");
  }

} finally {
  await client.end();
}
