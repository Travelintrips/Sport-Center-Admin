/**
 * fix-ppn-journals.ts
 *
 * Koreksi historis: semua jurnal lama yang salah akibat bug double-count PPN.
 *
 * Bug: kode lama pakai booking.totalPrice (harga inklusif PPN) sebagai subtotal,
 *      lalu menambahkan ppnAmount lagi → bank didebit lebih tinggi dari yang diterima.
 *
 * Tiga kategori yang diperbaiki:
 *   A. Booking journals (payment_confirmed) — debit_amount kelebihan ppn
 *   B. Invoice journals (invoice_payment_confirmed) — sama
 *   C. Membership journals (membership_payment_confirmed) — tidak ada split DPP/PPN sama sekali
 *
 * Jalankan:
 *   Dry-run (tidak ubah DB): pnpm --filter @workspace/scripts tsx src/fix-ppn-journals.ts
 *   Apply:                   pnpm --filter @workspace/scripts tsx src/fix-ppn-journals.ts --apply
 *   Prod:                    pnpm --filter @workspace/scripts tsx src/fix-ppn-journals.ts --apply --prod
 */

import pg from "pg";

const { Client } = pg;

const APPLY  = process.argv.includes("--apply");
const IS_PROD = process.argv.includes("--prod");
const LABEL  = IS_PROD ? "PROD" : "DEV";

// ─── Connection ───────────────────────────────────────────────────────────────

const rawUrl = IS_PROD
  ? process.env.SUPABASE_DATABASE_URL
  : process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL;

if (!rawUrl) {
  console.error(`ERROR: ${IS_PROD ? "SUPABASE_DATABASE_URL" : "SUPABASE_DATABASE_URL_DEV"} not set`);
  process.exit(1);
}

const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log(`\n╔══════════════════════════════════════════════════════════╗`);
console.log(`║  Fix PPN Journals — ${LABEL.padEnd(4)} ${APPLY ? "APPLY" : "DRY-RUN (add --apply)"}`.padEnd(61) + `║`);
console.log(`╚══════════════════════════════════════════════════════════╝\n`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function exec(sql: string, params: any[] = []) {
  if (!APPLY) return { rows: [], rowCount: 0 };
  const r = await client.query(sql, params);
  return r;
}

async function query(sql: string, params: any[] = []) {
  return client.query(sql, params);
}

// ─── PUBLIC schema COA IDs ───────────────────────────────────────────────────

const [kasRow, pendRow, ppnRow] = await Promise.all([
  query(`SELECT id FROM public.chart_of_accounts WHERE code = '1-1020-CST' LIMIT 1`),
  query(`SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST' LIMIT 1`),
  query(`SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST' LIMIT 1`),
]);
const coaKas         = kasRow.rows[0]?.id as number | undefined;
const coaPendapatan  = pendRow.rows[0]?.id as number | undefined;
const coaPpnKeluaran = ppnRow.rows[0]?.id as number | undefined;

console.log(`Public COA IDs — Kas:${coaKas}  Pendapatan:${coaPendapatan}  PPN:${coaPpnKeluaran}\n`);

// =============================================================================
// A. BOOKING JOURNALS (payment_confirmed) — double-count PPN fix
// =============================================================================
console.log("═══ A. Booking journals — debit kelebihan PPN ════════════════");

const bookingWrong = await query(`
  SELECT
    aj.id,
    aj.order_number,
    aj.debit_amount::numeric        AS debit,
    aj.credit_revenue_amount::numeric AS rev,
    aj.credit_ppn_amount::numeric   AS ppn,
    COALESCE(b.grand_total, b.total_price)::numeric AS correct_debit
  FROM sport_center.accounting_journals aj
  JOIN sport_center.sport_bookings b ON b.order_number = aj.order_number
  WHERE aj.journal_type = 'payment_confirmed'
    AND aj.credit_ppn_amount::numeric > 0
    AND aj.is_reversal = false
    AND aj.debit_amount::numeric > COALESCE(b.grand_total, b.total_price)::numeric
  ORDER BY aj.id
`);

console.log(`  Ditemukan: ${bookingWrong.rows.length} jurnal booking salah`);
for (const r of bookingWrong.rows) {
  const newDebit = r.correct_debit;
  const newRev   = (Number(r.correct_debit) - Number(r.ppn)).toFixed(2);
  console.log(`  [${r.id}] ${r.order_number}: debit ${r.debit}→${newDebit}  rev ${r.rev}→${newRev}  ppn ${r.ppn}`);

  // 1. Update accounting_journals header
  await exec(`
    UPDATE sport_center.accounting_journals
    SET debit_amount = $1, credit_revenue_amount = $2
    WHERE id = $3
  `, [String(newDebit), newRev, r.id]);

  // 2. Update journal_lines — debit (bank) line
  await exec(`
    UPDATE sport_center.accounting_journal_lines
    SET amount = $1
    WHERE journal_id = $2 AND line_type = 'debit'
  `, [String(newDebit), r.id]);

  // 3. Update journal_lines — credit revenue line
  await exec(`
    UPDATE sport_center.accounting_journal_lines
    SET amount = $1
    WHERE journal_id = $2 AND line_type = 'credit' AND account_code = '4-1001'
  `, [newRev, r.id]);
}

// =============================================================================
// B. INVOICE JOURNALS (invoice_payment_confirmed) — double-count PPN fix
// =============================================================================
console.log("\n═══ B. Invoice journals — debit kelebihan PPN ════════════════");

const invoiceWrong = await query(`
  SELECT
    aj.id,
    aj.order_number,
    aj.debit_amount::numeric          AS debit,
    aj.credit_revenue_amount::numeric AS rev,
    aj.credit_ppn_amount::numeric     AS ppn,
    ci.grand_total::numeric           AS correct_debit
  FROM sport_center.accounting_journals aj
  JOIN sport_center.company_invoices ci ON ci.invoice_number = aj.order_number
  WHERE aj.journal_type = 'invoice_payment_confirmed'
    AND aj.credit_ppn_amount::numeric > 0
    AND aj.is_reversal = false
    AND aj.debit_amount::numeric > ci.grand_total::numeric
  ORDER BY aj.id
`);

console.log(`  Ditemukan: ${invoiceWrong.rows.length} jurnal invoice salah`);
for (const r of invoiceWrong.rows) {
  const newDebit = Number(r.correct_debit).toFixed(2);
  const newRev   = (Number(r.correct_debit) - Number(r.ppn)).toFixed(2);
  console.log(`  [${r.id}] ${r.order_number}: debit ${r.debit}→${newDebit}  rev ${r.rev}→${newRev}  ppn ${r.ppn}`);

  await exec(`
    UPDATE sport_center.accounting_journals
    SET debit_amount = $1, credit_revenue_amount = $2
    WHERE id = $3
  `, [newDebit, newRev, r.id]);

  await exec(`
    UPDATE sport_center.accounting_journal_lines
    SET amount = $1
    WHERE journal_id = $2 AND line_type = 'debit'
  `, [newDebit, r.id]);

  await exec(`
    UPDATE sport_center.accounting_journal_lines
    SET amount = $1
    WHERE journal_id = $2 AND line_type = 'credit' AND account_code = '4-1001'
  `, [newRev, r.id]);
}

// =============================================================================
// C. MEMBERSHIP JOURNALS — belum ada split DPP/PPN
// =============================================================================
console.log("\n═══ C. Membership journals — tambah split DPP/PPN ═══════════");

const membershipNoSplit = await query(`
  SELECT
    id,
    order_number,
    debit_amount::numeric AS debit
  FROM sport_center.accounting_journals
  WHERE journal_type = 'membership_payment_confirmed'
    AND credit_ppn_amount::numeric = 0
    AND is_reversal = false
  ORDER BY id
`);

console.log(`  Ditemukan: ${membershipNoSplit.rows.length} jurnal membership tanpa split PPN`);
for (const r of membershipNoSplit.rows) {
  const totalPrice = Number(r.debit);
  const dpp        = Math.round(totalPrice / 1.11);
  const ppn        = totalPrice - dpp;
  console.log(`  [${r.id}] ${r.order_number}: total=${totalPrice}  DPP=${dpp}  PPN=${ppn}`);

  // Update header
  await exec(`
    UPDATE sport_center.accounting_journals
    SET credit_revenue_amount = $1,
        credit_ppn_account    = 'PPN Keluaran',
        credit_ppn_amount     = $2
    WHERE id = $3
  `, [String(dpp), String(ppn), r.id]);

  // Update revenue credit line
  await exec(`
    UPDATE sport_center.accounting_journal_lines
    SET amount = $1
    WHERE journal_id = $2 AND line_type = 'credit' AND account_code = '4-1001'
  `, [String(dpp), r.id]);

  // Insert PPN credit line if not exists
  const existing = await query(`
    SELECT id FROM sport_center.accounting_journal_lines
    WHERE journal_id = $1 AND line_type = 'credit' AND account_code = '2-1101'
  `, [r.id]);
  if (existing.rows.length === 0) {
    await exec(`
      INSERT INTO sport_center.accounting_journal_lines
        (journal_id, line_type, account_code, account_name, amount, description)
      VALUES ($1, 'credit', '2-1101', 'PPN Keluaran', $2, $3)
    `, [r.id, String(ppn), `PPN 11% member gym ${r.order_number}`]);
  }
}

// =============================================================================
// D. PUBLIC schema — accounting_entries & accounting_entry_lines
// =============================================================================
console.log("\n═══ D. Public accounting_entries — booking ═══════════════════");

if (!coaKas || !coaPendapatan || !coaPpnKeluaran) {
  console.log("  ⚠  Salah satu COA ID tidak ditemukan di public.chart_of_accounts — lewati bagian D.");
} else {
  // D1. Booking entries
  const pubBookingWrong = await query(`
    SELECT
      ae.id          AS entry_id,
      ae.ref         AS order_number,
      ae.total_debit::numeric AS total_debit,
      COALESCE(b.grand_total, b.total_price)::numeric AS correct_debit,
      (SELECT credit::numeric FROM public.accounting_entry_lines
       WHERE entry_id = ae.id AND account_id = $1 AND credit > 0 LIMIT 1) AS ppn_amount
    FROM public.accounting_entries ae
    JOIN sport_center.sport_bookings b ON b.order_number = ae.ref
    WHERE ae.source::text = 'sport_center_booking'
      AND ae.status::text = 'posted'
      AND ae.total_debit::numeric > COALESCE(b.grand_total, b.total_price)::numeric
    ORDER BY ae.id
  `, [coaPpnKeluaran]);

  console.log(`  Ditemukan: ${pubBookingWrong.rows.length} public booking entries salah`);
  for (const r of pubBookingWrong.rows) {
    const newTotal   = Number(r.correct_debit).toFixed(2);
    const ppn        = Number(r.ppn_amount ?? 0);
    const newRevenue = (Number(r.correct_debit) - ppn).toFixed(2);
    // Buat adjustment entry: Credit Kas + Debit Pendapatan (koreksi double-count)
    // Karena posted entries immutable → tidak bisa update original
    const adjBkgResult = await exec(`
      INSERT INTO public.accounting_entries
        (entry_number, journal_id, date, ref, description, status, source,
         source_id, total_debit, total_credit, company_id, facility_id,
         correlation_id, governance_flags)
      SELECT
        'ADJ-PPN-' || ae.ref,
        ae.journal_id, ae.date, ae.ref,
        'Koreksi double-count PPN booking ' || ae.ref,
        'draft', 'manual', ae.source_id,
        $1, $1, ae.company_id, ae.facility_id,
        'adj_ppn_bkg_' || ae.ref, '{}'
      FROM public.accounting_entries ae WHERE ae.id = $2
      ON CONFLICT (correlation_id) DO NOTHING
      RETURNING id
    `, [String(ppn), r.entry_id]);
    const adjBkgId = APPLY ? adjBkgResult.rows[0]?.id : `(dry-${r.entry_id})`;
    if (adjBkgId) {
      await exec(`
        INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
          ($1, $2, $3, $4, 0),
          ($1, $5, $6, 0, $4)
      `, [adjBkgId, coaPendapatan, `Koreksi double-count PPN ${r.order_number}`, String(ppn), coaKas, `Koreksi double-count PPN ${r.order_number}`]);
      await exec(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [adjBkgId]);
      console.log(`    → Adjustment entry ${adjBkgId} dibuat`);
    }
  }

  // D2. Invoice entries
  console.log("\n═══ D2. Public accounting_entries — invoice ══════════════════");
  const pubInvoiceWrong = await query(`
    SELECT
      ae.id          AS entry_id,
      ae.ref         AS invoice_number,
      ae.total_debit::numeric AS total_debit,
      ci.grand_total::numeric AS correct_debit,
      (SELECT credit::numeric FROM public.accounting_entry_lines
       WHERE entry_id = ae.id AND account_id = $1 AND credit > 0 LIMIT 1) AS ppn_amount
    FROM public.accounting_entries ae
    JOIN sport_center.company_invoices ci ON ci.invoice_number = ae.ref
    WHERE ae.source::text = 'sport_center_invoice'
      AND ae.status::text = 'posted'
      AND ae.total_debit::numeric > ci.grand_total::numeric
    ORDER BY ae.id
  `, [coaPpnKeluaran]);

  console.log(`  Ditemukan: ${pubInvoiceWrong.rows.length} public invoice entries salah`);
  for (const r of pubInvoiceWrong.rows) {
    const ppn = Number(r.ppn_amount ?? 0);
    console.log(`  [${r.entry_id}] ${r.invoice_number}: koreksi double-count PPN ${ppn}`);

    const adjInvResult = await exec(`
      INSERT INTO public.accounting_entries
        (entry_number, journal_id, date, ref, description, status, source,
         source_id, total_debit, total_credit, company_id, facility_id,
         correlation_id, governance_flags)
      SELECT
        'ADJ-PPN-' || ae.ref,
        ae.journal_id, ae.date, ae.ref,
        'Koreksi double-count PPN invoice ' || ae.ref,
        'draft', 'manual', ae.source_id,
        $1, $1, ae.company_id, ae.facility_id,
        'adj_ppn_inv_' || ae.ref, '{}'
      FROM public.accounting_entries ae WHERE ae.id = $2
      ON CONFLICT (correlation_id) DO NOTHING
      RETURNING id
    `, [String(ppn), r.entry_id]);
    const adjInvId = APPLY ? adjInvResult.rows[0]?.id : `(dry-${r.entry_id})`;
    if (adjInvId) {
      await exec(`
        INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
          ($1, $2, $3, $4, 0),
          ($1, $5, $6, 0, $4)
      `, [adjInvId, coaPendapatan, `Koreksi PPN ${r.invoice_number}`, String(ppn), coaKas, `Koreksi PPN ${r.invoice_number}`]);
      await exec(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [adjInvId]);
      console.log(`    → Adjustment entry ${adjInvId} dibuat`);
    }
  }

  // D3. Membership entries — tambah split DPP/PPN via adjustment entry
  // Public schema immutable untuk posted entries → buat reklasifikasi entry baru
  console.log("\n═══ D3. Public accounting_entries — membership (adjustment) ══");
  const pubMemberNoSplit = await query(`
    SELECT
      ae.id AS entry_id,
      ae.ref,
      ae.total_debit::numeric AS total_debit,
      (SELECT id FROM public.accounting_entry_lines
       WHERE entry_id = ae.id AND account_id = $1 AND credit > 0 LIMIT 1) AS ppn_line_id,
      -- cek apakah sudah ada adjustment entry untuk ref ini
      (SELECT id FROM public.accounting_entries
       WHERE ref = ae.ref AND source::text = 'manual'
         AND description LIKE '%Reklasifikasi PPN%' LIMIT 1) AS adj_entry_id
    FROM public.accounting_entries ae
    WHERE ae.source::text = 'sport_center_membership'
      AND ae.status::text = 'posted'
    ORDER BY ae.id
  `, [coaPpnKeluaran]);

  // Hanya yang belum ada PPN line DAN belum ada adjustment entry
  const memberNeedFix = pubMemberNoSplit.rows.filter(r => !r.ppn_line_id && !r.adj_entry_id);
  console.log(`  Ditemukan: ${memberNeedFix.length} public membership entries perlu adjustment`);

  // Dapatkan journal_id untuk adjustment/penyesuaian entries (GEN-CST = Memorial/Penyesuaian)
  const manualJournalRes = await query(
    `SELECT id FROM public.accounting_journals WHERE code IN ('GEN-CST','GJ','JU','MEMO') OR name ILIKE '%memorial%' OR name ILIKE '%penyesuaian%' OR name ILIKE '%general%' ORDER BY id LIMIT 1`
  );
  const manualJournalId = manualJournalRes.rows[0]?.id;
  console.log(`  Adjustment journal ID: ${manualJournalId}`);

  for (const r of memberNeedFix) {
    const totalPrice = Number(r.total_debit);
    const dpp        = Math.round(totalPrice / 1.11);
    const ppn        = totalPrice - dpp;
    console.log(`  [${r.entry_id}] ${r.ref}: Debit Pendapatan ${ppn}  Kredit PPN ${ppn}  (reklasifikasi)`);

    // Buat adjustment entry: Debit Pendapatan → Kredit PPN Keluaran
    // Insert sebagai 'draft' dulu agar trigger immutability tidak blokir INSERT lines
    const adjResult = await exec(`
      INSERT INTO public.accounting_entries
        (entry_number, journal_id, date, ref, description, status, source,
         source_id, total_debit, total_credit, company_id, facility_id,
         correlation_id, governance_flags)
      SELECT
        'ADJ-PPN-' || ae.ref,
        $1,
        ae.date,
        ae.ref,
        'Reklasifikasi PPN ' || ae.ref || ' (koreksi split DPP/PPN membership)',
        'draft',
        'manual',
        ae.source_id,
        $2,
        $2,
        ae.company_id,
        ae.facility_id,
        'adj_ppn_' || ae.ref,
        '{}'
      FROM public.accounting_entries ae
      WHERE ae.id = $3
      ON CONFLICT (correlation_id) DO NOTHING
      RETURNING id
    `, [manualJournalId, String(ppn), r.entry_id]);

    const adjEntryId = APPLY ? adjResult.rows[0]?.id : `(dry-run-${r.entry_id})`;

    if (adjEntryId) {
      await exec(`
        INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
          ($1, $2, $3, $4, 0),
          ($1, $5, $6, 0, $4)
      `, [adjEntryId, coaPendapatan, `Reklasifikasi PPN ${r.ref} — Debit Pendapatan`, String(ppn), coaPpnKeluaran, `Reklasifikasi PPN ${r.ref} — Kredit PPN Keluaran`]);
      // Post setelah lines berhasil diinsert
      await exec(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [adjEntryId]);
    }
  }
}

// =============================================================================
// SUMMARY
// =============================================================================
await client.end();

const totalFixed =
  bookingWrong.rows.length +
  invoiceWrong.rows.length +
  membershipNoSplit.rows.length;

console.log(`\n${"═".repeat(62)}`);
if (APPLY) {
  console.log(`✅  Selesai! ${totalFixed} jurnal internal + entri public diperbaiki.`);
} else {
  console.log(`📋  Dry-run selesai. ${totalFixed} jurnal internal ditemukan yang perlu diperbaiki.`);
  console.log(`    Jalankan ulang dengan --apply untuk mengeksekusi perubahan.`);
}
