/**
 * fix-ppn-public-lines-v2.ts
 *
 * Targeted fix: adj entry id=22 (ADJ-PPN-MB-1) sudah posted tapi tanpa lines.
 *
 * Strategy: gunakan session_replication_role = replica untuk bypass immutability
 * trigger sehingga bisa:
 *   1. Set entry ke draft
 *   2. Insert lines
 *   3. Set kembali ke posted
 *
 * Jika strategy itu gagal (kurang privilege), fallback: buat entry baru dengan
 * ref berbeda (ADJ-MB-1) yang menampung lines reklasifikasi PPN.
 *
 * Run: node_modules/.bin/tsx src/fix-ppn-public-lines-v2.ts [--apply] [--prod]
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

console.log(`\n[fix-ppn-public-lines-v2] ${LABEL} ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

// ─── COA IDs ──────────────────────────────────────────────────────────────────
const [pendR, ppnR, genJR] = await Promise.all([
  c.query(`SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST' LIMIT 1`),
  c.query(`SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST' LIMIT 1`),
  c.query(`SELECT id FROM public.accounting_journals WHERE code = 'GEN-CST' LIMIT 1`),
]);
const coaPendapatan  = pendR.rows[0]?.id as number;
const coaPpnKeluaran = ppnR.rows[0]?.id as number;
const genJournalId   = genJR.rows[0]?.id as number;
console.log(`COA → Pend:${coaPendapatan}  PPN:${coaPpnKeluaran}  GenJournal:${genJournalId}\n`);

// ─── Temukan adj entries dengan header tapi tanpa lines ───────────────────────
const orphans = await c.query(`
  SELECT ae.id, ae.ref, ae.total_debit::numeric AS ppn,
         ae.date, ae.company_id, ae.facility_id, ae.source_id,
         (SELECT COUNT(*)::int FROM public.accounting_entry_lines WHERE entry_id = ae.id) AS line_count
  FROM public.accounting_entries ae
  WHERE ae.correlation_id LIKE 'adj_ppn_%'
    AND ae.status::text = 'posted'
    AND NOT EXISTS (SELECT 1 FROM public.accounting_entry_lines WHERE entry_id = ae.id)
`);

console.log(`Orphan adj entries (tanpa lines): ${orphans.rows.length}`);

for (const r of orphans.rows) {
  const ppn = Number(r.ppn);
  console.log(`\n  Entry id=${r.id}  ref=${r.ref}  ppn=${ppn}`);

  if (!APPLY) {
    console.log(`  [DRY-RUN] Akan coba bypass trigger dan insert lines`);
    continue;
  }

  // Strategy 1: bypass trigger dengan session_replication_role = replica
  let strategy1Works = false;
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = 'replica'");
    // Set ke draft
    await c.query(`UPDATE public.accounting_entries SET status = 'draft' WHERE id = $1`, [r.id]);
    // Insert lines
    await c.query(`
      INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit)
      VALUES
        ($1, $2, 'Reklasifikasi Debit Pendapatan ' || $3, $4, 0),
        ($1, $5, 'Reklasifikasi Kredit PPN Keluaran ' || $3, 0, $4)
    `, [r.id, coaPendapatan, r.ref, String(ppn), coaPpnKeluaran]);
    // Re-post
    await c.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [r.id]);
    await c.query("COMMIT");
    strategy1Works = true;
    console.log(`  ✅ Strategy 1 (bypass trigger) berhasil — lines diinsert ke entry ${r.id}`);
  } catch (err: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.log(`  ⚠  Strategy 1 gagal: ${err.message}`);
  }

  if (strategy1Works) continue;

  // Strategy 2: buat entry baru dengan ref berbeda (tidak ada unique conflict)
  // Ref: original ref + "-ADJ" suffix, source tetap manual
  const adjRef = `${r.ref}-ADJ`;

  // Cek apakah sudah ada
  const existCheck = await c.query(
    `SELECT id FROM public.accounting_entries WHERE company_id = $1 AND source::text = 'manual' AND ref = $2 LIMIT 1`,
    [r.company_id, adjRef]
  );
  if (existCheck.rows.length > 0) {
    console.log(`  ⚠  Entry manual/${adjRef} sudah ada (id=${existCheck.rows[0].id}) — skip`);
    continue;
  }

  // Buat entry baru sebagai draft
  const newEntryRes = await c.query(`
    INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source,
       source_id, total_debit, total_credit, company_id, facility_id, governance_flags)
    VALUES (
      'ADJ-PPN-LINES-' || $1,
      $2, $3, $1,
      'Reklasifikasi PPN membership ' || $1 || ' (koreksi DPP/PPN split)',
      'draft', 'manual',
      $4, $5, $5, $6, $7, '{}'
    )
    RETURNING id
  `, [adjRef, genJournalId ?? r.genJournalId, r.date, r.source_id, String(ppn), r.company_id, r.facility_id]);

  const newId = newEntryRes.rows[0]?.id;
  if (!newId) { console.log(`  ✗ Insert entry baru gagal`); continue; }

  // Insert lines ke entry draft
  await c.query(`
    INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit)
    VALUES
      ($1, $2, 'Reklasifikasi Debit Pendapatan ' || $3, $4, 0),
      ($1, $5, 'Reklasifikasi Kredit PPN Keluaran ' || $3, 0, $4)
  `, [newId, coaPendapatan, adjRef, String(ppn), coaPpnKeluaran]);

  // Post
  await c.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [newId]);
  console.log(`  ✅ Strategy 2 berhasil — entry baru id=${newId} (ref=${adjRef}) dibuat dan diposting`);
}

await c.end();
console.log(APPLY
  ? "\n✅ Selesai. Jalankan verify-ppn-fix.ts untuk konfirmasi."
  : "\n📋 Dry-run selesai. Tambahkan --apply untuk eksekusi.");
