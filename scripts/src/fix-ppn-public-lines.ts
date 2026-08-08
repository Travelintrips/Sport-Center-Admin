/**
 * fix-ppn-public-lines.ts
 *
 * Targeted fix: adjustment entry ADJ-PPN-MB-1 (id=22) sudah ada di public schema
 * tapi tanpa lines karena trigger immutability.
 *
 * Solusi: buat supplemental entry (draft→lines→posted) dengan correlation_id baru.
 * Sekaligus fix juga semua adj entries dengan header tapi tanpa lines.
 *
 * Run: node_modules/.bin/tsx src/fix-ppn-public-lines.ts [--apply] [--prod]
 */

import pg from "pg";
const { Client } = pg;

const APPLY   = process.argv.includes("--apply");
const IS_PROD = process.argv.includes("--prod");
const LABEL   = IS_PROD ? "PROD" : "DEV";

const rawUrl = IS_PROD
  ? process.env.SUPABASE_DATABASE_URL
  : process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL;

if (!rawUrl) { console.error("ERROR: DB URL not set"); process.exit(1); }

const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log(`\n[fix-ppn-public-lines] ${LABEL} ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

// ─── COA IDs ──────────────────────────────────────────────────────────────────
const [kasR, pendR, ppnR, genJR] = await Promise.all([
  c.query(`SELECT id FROM public.chart_of_accounts WHERE code = '1-1020-CST' LIMIT 1`),
  c.query(`SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST' LIMIT 1`),
  c.query(`SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST' LIMIT 1`),
  c.query(`SELECT id FROM public.accounting_journals WHERE code = 'GEN-CST' LIMIT 1`),
]);
const coaKas         = kasR.rows[0]?.id;
const coaPendapatan  = pendR.rows[0]?.id;
const coaPpnKeluaran = ppnR.rows[0]?.id;
const genJournalId   = genJR.rows[0]?.id;
console.log(`COA → Kas:${coaKas}  Pend:${coaPendapatan}  PPN:${coaPpnKeluaran}  GenJournal:${genJournalId}\n`);

// ─── Temukan adj entries yang sudah ada tapi tanpa lines ─────────────────────
const orphans = await c.query(`
  SELECT
    ae.id, ae.ref, ae.total_debit::numeric AS amount,
    ae.journal_id, ae.date, ae.company_id, ae.facility_id, ae.source_id,
    ae.description,
    (SELECT COUNT(*) FROM public.accounting_entry_lines WHERE entry_id = ae.id) AS line_count
  FROM public.accounting_entries ae
  WHERE ae.correlation_id LIKE 'adj_ppn_%'
    AND ae.status::text = 'posted'
`);

const needLines = orphans.rows.filter(r => Number(r.line_count) === 0);
console.log(`Adj entries tanpa lines: ${needLines.length}`);

for (const r of needLines) {
  const ppn = Number(r.amount);
  // Membership reklasifikasi: Debit Pendapatan, Credit PPN Keluaran
  // Booking/Invoice koreksi: Debit Pendapatan, Credit Kas
  const isBooking = r.description.toLowerCase().includes("booking") || r.description.toLowerCase().includes("invoice");
  const creditAccountId = isBooking ? coaKas : coaPpnKeluaran;
  const creditLabel     = isBooking ? "Koreksi bank" : "Kredit PPN Keluaran";

  console.log(`  [${r.id}] ref=${r.ref}  amount=${ppn}  type=${isBooking ? "booking" : "membership"}`);
  console.log(`    → Buat supplemental entry: Debit Pend ${ppn}  Credit ${isBooking ? "Kas" : "PPN"} ${ppn}`);

  if (!APPLY) continue;

  // Cek apakah supplemental entry sudah ada
  const existCheck = await c.query(
    `SELECT id FROM public.accounting_entries WHERE correlation_id = $1 LIMIT 1`,
    [`adj_ppn_sup_${r.ref}`]
  );
  if (existCheck.rows.length > 0) {
    console.log(`    ⚠  adj_ppn_sup_${r.ref} sudah ada (id=${existCheck.rows[0].id}) — skip`);
    continue;
  }

  // Buat supplemental entry sebagai draft
  const suppRes = await c.query(`
    INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source,
       source_id, total_debit, total_credit, company_id, facility_id,
       correlation_id, governance_flags)
    VALUES (
      'ADJ-PPN-SUP-' || $1,
      $2, $3, $1,
      'Suplemen koreksi PPN ' || $1 || ' (lines untuk adj entry #${r.id})',
      'draft', 'manual',
      $4, $5, $5, $6, $7,
      'adj_ppn_sup_' || $1,
      '{}'
    )
    RETURNING id
  `, [r.ref, genJournalId ?? r.journal_id, r.date, r.source_id, String(ppn), r.company_id, r.facility_id]);

  const suppId = suppRes.rows[0]?.id;
  if (!suppId) {
    console.log(`    ⚠  Insert failed — skip`);
    continue;
  }

  // Insert lines ke entry draft
  await c.query(`
    INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit)
    VALUES
      ($1, $2, 'Koreksi Debit Pendapatan ' || $3, $4, 0),
      ($1, $5, $6             || $3, 0,  $4)
  `, [suppId, coaPendapatan, r.ref, String(ppn), creditAccountId, creditLabel + " "]);

  // Post entry
  await c.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [suppId]);
  console.log(`    ✅ Supplemental entry id=${suppId} dibuat dan diposting`);
}

await c.end();
console.log(APPLY ? "\n✅ Selesai." : "\n📋 Dry-run selesai. Tambahkan --apply untuk eksekusi.");
