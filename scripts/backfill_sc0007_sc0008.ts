/**
 * backfill_sc0007_sc0008.ts
 * Backfill public accounting entries yang hilang untuk SC-0007 dan SC-0008.
 * Menggunakan journal BNK-CST (Bank Mandiri) sesuai kebijakan akuntansi saat ini.
 *
 * Jalankan: tsx scripts/backfill_sc0007_sc0008.ts
 *
 * Idempotent: cek entry + kelengkapan lines (3 lines) + tax records sebelum insert.
 * Transaksional: setiap booking di-wrap BEGIN/COMMIT agar tidak ada partial state.
 */
import pg from "pg";
const { Client } = pg;

const url = process.env.SUPABASE_DATABASE_URL_DEV;
if (!url) { console.error("SUPABASE_DATABASE_URL_DEV not set"); process.exit(1); }

const client = new Client({ connectionString: url });
await client.connect();

const COMPANY_ID = 1;

// Data booking — jumlah inklusif PPN 11%
const bookings = [
  { bookingId: 14, orderNumber: "SC-0007", subtotal: 200000, ppnAmount: 19820 },
  { bookingId: 15, orderNumber: "SC-0008", subtotal: 100000, ppnAmount:  9910 },
];

async function nextPublicEntryNumber(year: number): Promise<string> {
  const result = await client.query(`
    SELECT COALESCE(MAX(
      NULLIF(REGEXP_REPLACE(entry_number, '^SC-BNK/[0-9]+/', ''), '')::integer
    ), 0) + 1 AS seq
    FROM public.accounting_entries
    WHERE entry_number ~ $1
  `, [`^SC-BNK/${year}/`]);
  const seq = Number(result.rows[0]?.seq ?? 1);
  return `SC-BNK/${year}/${String(seq).padStart(4, "0")}`;
}

// 1. Resolve IDs sekali di awal (sequential — pg client tidak support concurrent queries)
const journalRes  = await client.query(`SELECT id FROM public.accounting_journals WHERE code = 'BNK-CST' LIMIT 1`);
const bankRes     = await client.query(`SELECT id FROM public.chart_of_accounts WHERE code = '1-1020-CST' AND is_active = true LIMIT 1`);
const pendRes     = await client.query(`SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST' AND is_active = true LIMIT 1`);
const ppnCoaRes   = await client.query(`SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST' AND is_active = true LIMIT 1`);
const taxRes      = await client.query(`SELECT id FROM public.accounting_taxes WHERE name ILIKE '%PPN Keluaran%' AND company_id = $1 ORDER BY id LIMIT 1`, [COMPANY_ID]);

const journalId      = Number(journalRes.rows[0]?.id);
const coaBank        = Number(bankRes.rows[0]?.id);
const coaPendapatan  = Number(pendRes.rows[0]?.id);
const coaPpnKeluaran = Number(ppnCoaRes.rows[0]?.id);
const taxIdPpn       = Number(taxRes.rows[0]?.id ?? 1);

if (!journalId || !coaBank || !coaPendapatan || !coaPpnKeluaran) {
  console.error(`❌ Lookup gagal — pastikan BNK-CST journal dan COA 1-1020-CST, 4-1017-CST, 2-1020-CST ada.`);
  console.error(`  journalId=${journalId} coaBank=${coaBank} coaPendapatan=${coaPendapatan} coaPpnKeluaran=${coaPpnKeluaran}`);
  await client.end();
  process.exit(1);
}
console.log(`IDs resolved: journal=${journalId} bank=${coaBank} pendapatan=${coaPendapatan} ppn=${coaPpnKeluaran} tax=${taxIdPpn}\n`);

for (const b of bookings) {
  console.log(`─── Memproses ${b.orderNumber} (bookingId=${b.bookingId}) ─────────────────────`);

  // 2. Idempotency: cek apakah entry SUDAH LENGKAP (entry + 3 lines + tax)
  const existCheck = await client.query(`
    SELECT ae.id,
           (SELECT COUNT(*) FROM public.accounting_entry_lines ael WHERE ael.entry_id = ae.id) AS line_count,
           (SELECT COUNT(*) FROM public.transaction_taxes tt
             WHERE tt.transaction_type = 'sport_center_booking' AND tt.transaction_id = $2) AS tax_count
    FROM public.accounting_entries ae
    WHERE ae.source = 'sport_center_booking' AND ae.ref = $1
    LIMIT 1
  `, [b.orderNumber, b.bookingId]);

  if (existCheck.rows.length > 0) {
    const { id, line_count, tax_count } = existCheck.rows[0] as any;
    const lc = Number(line_count);
    const tc = Number(tax_count);
    if (lc >= 3 && tc >= 1) {
      console.log(`SKIP ${b.orderNumber} — entry id=${id} sudah lengkap (${lc} lines, ${tc} tax records).`);
      continue;
    }
    console.warn(`⚠️  ${b.orderNumber} entry id=${id} ada tapi tidak lengkap (${lc} lines, ${tc} tax). Lanjutkan backfill...`);
    // Hapus entry yang tidak lengkap agar bisa di-insert ulang
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`DELETE FROM public.accounting_entry_lines WHERE entry_id = $1`, [id]);
      await client.query(`DELETE FROM public.transaction_taxes WHERE transaction_type = 'sport_center_booking' AND transaction_id = $1`, [b.bookingId]);
      await client.query(`DELETE FROM public.gl_tax_lines WHERE entity_type = 'booking' AND entity_id = $1`, [b.orderNumber]);
      await client.query(`DELETE FROM public.accounting_entries WHERE id = $1`, [id]);
      await client.query("COMMIT");
      console.log(`  Partial entry id=${id} dihapus.`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`❌ Gagal hapus partial entry: ${err}`);
      continue;
    }
  }

  // 3. Ambil data booking dari sport_center
  const bookingRow = await client.query(`
    SELECT booking_date, facility_id FROM sport_center.sport_bookings WHERE id = $1 LIMIT 1
  `, [b.bookingId]);

  if (!bookingRow.rows.length) {
    console.error(`❌ Booking id=${b.bookingId} tidak ditemukan di sport_center.sport_bookings — skip.`);
    continue;
  }
  const { booking_date, facility_id } = bookingRow.rows[0] as any;
  const journalDate = String(booking_date).slice(0, 10);
  const year        = new Date(journalDate).getFullYear();
  const period      = journalDate.slice(0, 7);
  const grandTotal  = b.subtotal;
  const netRevenue  = b.subtotal - b.ppnAmount;

  const entryNumber = await nextPublicEntryNumber(year);
  console.log(`  date=${journalDate} entryNumber=${entryNumber} grandTotal=${grandTotal} ppn=${b.ppnAmount} net=${netRevenue}`);

  // 4. Insert dalam satu transaksi per booking
  await client.query("BEGIN");
  try {
    // 4a. Entry (draft terlebih dahulu — trigger memblokir INSERT ke lines jika posted)
    const entryRes = await client.query(`
      INSERT INTO public.accounting_entries
        (entry_number, journal_id, date, ref, description, status, source, source_id,
         total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
      VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_booking',$6,$7,$7,$8,$9,$10,'{}')
      RETURNING id
    `, [
      entryNumber,
      journalId,
      journalDate,
      b.orderNumber,
      `Pembayaran Booking Sport Center (${b.orderNumber})`,
      b.bookingId,
      grandTotal,
      COMPANY_ID,
      facility_id ?? null,
      `sc_booking_${b.orderNumber}`,
    ]);
    const entryId = Number(entryRes.rows[0].id);
    console.log(`  Entry id=${entryId} created (draft)`);

    // 4b. GL lines (3 lines: debit bank, credit pendapatan, credit PPN)
    await client.query(`
      INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1, $2, $3, $4, 0),
        ($1, $5, $6, 0, $7),
        ($1, $8, $9, 0, $10)
    `, [
      entryId,
      coaBank,         `Penerimaan booking ${b.orderNumber}`, grandTotal,
      coaPendapatan,   `Pendapatan booking ${b.orderNumber}`, netRevenue,
      coaPpnKeluaran,  `PPN Keluaran booking ${b.orderNumber}`, b.ppnAmount,
    ]);
    console.log(`  3 GL lines inserted`);

    // 4c. Post entry
    await client.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);
    console.log(`  Entry posted`);

    // 4d. transaction_taxes
    await client.query(`
      INSERT INTO public.transaction_taxes
        (company_id, transaction_type, transaction_id, transaction_ref,
         tax_id, tax_name, tax_rate, cut_type,
         base_amount, tax_amount, account_id,
         period, status, direction, created_at, updated_at)
      VALUES ($1,'sport_center_booking',$2,$3,$4,'PPN Keluaran 11%',11,'self_borne',$5,$6,$7,$8,'posted','out',NOW(),NOW())
    `, [COMPANY_ID, b.bookingId, b.orderNumber, taxIdPpn, b.subtotal, b.ppnAmount, coaPpnKeluaran, period]);
    console.log(`  transaction_taxes inserted`);

    // 4e. gl_tax_lines
    await client.query(`
      INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period,
         entity_type, entity_id, is_reported, created_at)
      VALUES ($1,$2,'PPN_OUT',11,$3,$4,'out',$5,'booking',$6,false,NOW())
    `, [COMPANY_ID, entryId, b.subtotal, b.ppnAmount, period, b.orderNumber]);
    console.log(`  gl_tax_lines inserted`);

    await client.query("COMMIT");
    console.log(`  ✅ COMMIT — ${b.orderNumber} selesai.\n`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`  ❌ ROLLBACK ${b.orderNumber}:`, err);
  }
}

// 5. Verifikasi akhir
console.log("═══ VERIFIKASI AKHIR ════════════════════════════════════════════");
const verify = await client.query(`
  SELECT ae.ref, ae.entry_number, j.code AS journal, ae.status, ae.total_debit,
         COUNT(ael.id) AS line_count,
         json_agg(json_build_object('acct', coa.code, 'debit', ael.debit, 'credit', ael.credit) ORDER BY ael.id) AS lines
  FROM public.accounting_entries ae
  JOIN public.accounting_journals j ON j.id = ae.journal_id
  JOIN public.accounting_entry_lines ael ON ael.entry_id = ae.id
  LEFT JOIN public.chart_of_accounts coa ON coa.id = ael.account_id
  WHERE ae.source = 'sport_center_booking' AND ae.ref = ANY($1::text[])
  GROUP BY ae.ref, ae.entry_number, j.code, ae.status, ae.total_debit
  ORDER BY ae.ref
`, [bookings.map(b => b.orderNumber)]);

if (verify.rows.length === 0) {
  console.log("⚠️  Tidak ada entry untuk SC-0007/SC-0008 — bookings mungkin tidak ada di DB ini.");
} else {
  for (const r of verify.rows as any[]) {
    const lc = Number(r.line_count);
    const ok = r.journal === "BNK-CST" && r.status === "posted" && lc === 3;
    console.log(`${ok ? "✅" : "❌"} ${r.ref}  ${r.entry_number}  journal=${r.journal}  status=${r.status}  lines=${lc}`);
    if (!ok) console.log("    lines:", JSON.stringify(r.lines));
  }
}

await client.end();
