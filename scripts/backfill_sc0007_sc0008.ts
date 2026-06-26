import pg from "pg";
const { Client } = pg;

const url = process.env.SUPABASE_DATABASE_URL_DEV;
if (!url) { console.error("SUPABASE_DATABASE_URL_DEV not set"); process.exit(1); }

const client = new Client({ connectionString: url });
await client.connect();

const COMPANY_ID = 1;

// Data booking dari task requirement
const bookings = [
  { bookingId: 14, orderNumber: "SC-0007", subtotal: 200000, ppnAmount: 19820 },
  { bookingId: 15, orderNumber: "SC-0008", subtotal: 100000, ppnAmount:  9910 },
];

async function nextPublicEntryNumber(year: number): Promise<string> {
  const result = await client.query(`
    SELECT COALESCE(MAX(
      NULLIF(REGEXP_REPLACE(entry_number, '^SC-CSH/[0-9]+/', ''), '')::integer
    ), 0) + 1 AS seq
    FROM public.accounting_entries
    WHERE entry_number LIKE $1
      AND source = 'sport_center_booking'
  `, [`SC-CSH/${year}/%`]);
  const seq = Number(result.rows[0]?.seq ?? 1);
  return `SC-CSH/${year}/${String(seq).padStart(4, "0")}`;
}

try {
  // 1. Resolve public IDs
  const journal = await client.query(`SELECT id FROM public.accounting_journals WHERE code = 'CSH-CST' LIMIT 1`);
  const kas     = await client.query(`SELECT id FROM public.chart_of_accounts WHERE code = '1-1010-CST' AND is_active = true LIMIT 1`);
  const pend    = await client.query(`SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST' AND is_active = true LIMIT 1`);
  const ppnCoa  = await client.query(`SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST' AND is_active = true LIMIT 1`);
  const tax     = await client.query(`SELECT id FROM public.accounting_taxes WHERE name ILIKE '%PPN Keluaran%' AND company_id = $1 ORDER BY id LIMIT 1`, [COMPANY_ID]);

  const journalId     = Number(journal.rows[0]?.id);
  const coaKas        = Number(kas.rows[0]?.id);
  const coaPendapatan = Number(pend.rows[0]?.id);
  const coaPpnKeluaran= Number(ppnCoa.rows[0]?.id);
  const taxIdPpn      = Number(tax.rows[0]?.id ?? 1);

  if (!journalId || !coaKas || !coaPendapatan || !coaPpnKeluaran) {
    throw new Error(`Public COA/journal lookup gagal. journalId=${journalId} coaKas=${coaKas} coaPendapatan=${coaPendapatan} coaPpnKeluaran=${coaPpnKeluaran}`);
  }
  console.log(`IDs resolved: journalId=${journalId} coaKas=${coaKas} coaPendapatan=${coaPendapatan} coaPpnKeluaran=${coaPpnKeluaran} taxIdPpn=${taxIdPpn}`);

  // 2. Cek apakah entry sudah ada (idempotency guard)
  const existing = await client.query(`
    SELECT ref FROM public.accounting_entries
    WHERE source = 'sport_center_booking' AND ref = ANY($1::text[])
  `, [bookings.map(b => b.orderNumber)]);
  const existingRefs = new Set(existing.rows.map((r: any) => r.ref));
  console.log("Entry yang sudah ada:", [...existingRefs]);

  for (const b of bookings) {
    if (existingRefs.has(b.orderNumber)) {
      console.log(`SKIP ${b.orderNumber} — entry sudah ada`);
      continue;
    }

    // Get booking data from sport_center
    const bookingRow = await client.query(`
      SELECT booking_date, facility_id FROM sport_center.sport_bookings WHERE id = $1 LIMIT 1
    `, [b.bookingId]);
    if (!bookingRow.rows.length) {
      console.error(`Booking id=${b.bookingId} tidak ditemukan!`);
      continue;
    }
    const { booking_date, facility_id } = bookingRow.rows[0] as any;
    const journalDate = String(booking_date).slice(0, 10);
    const year        = new Date(journalDate).getFullYear();
    const period      = journalDate.slice(0, 7);

    const grandTotal  = b.subtotal;                 // PPN inklusif
    const netRevenue  = b.subtotal - b.ppnAmount;

    const entryNumber = await nextPublicEntryNumber(year);
    console.log(`\nBackfill ${b.orderNumber} (id=${b.bookingId}): date=${journalDate} entryNumber=${entryNumber} grandTotal=${grandTotal} ppn=${b.ppnAmount} net=${netRevenue}`);

    // 3. Insert accounting entry (draft)
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
    console.log(`  Entry id=${entryId} created`);

    // 4. GL lines
    await client.query(`
      INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1, $2, $3, $4, 0),
        ($1, $5, $6, 0, $7),
        ($1, $8, $9, 0, $10)
    `, [
      entryId,
      coaKas,         `Penerimaan booking ${b.orderNumber}`, grandTotal,
      coaPendapatan,  `Pendapatan booking ${b.orderNumber}`, netRevenue,
      coaPpnKeluaran, `PPN Keluaran booking ${b.orderNumber}`, b.ppnAmount,
    ]);
    console.log(`  GL lines inserted`);

    // 5. Post entry
    await client.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);
    console.log(`  Entry posted`);

    // 6. transaction_taxes
    await client.query(`
      INSERT INTO public.transaction_taxes
        (company_id, transaction_type, transaction_id, transaction_ref,
         tax_id, tax_name, tax_rate, cut_type,
         base_amount, tax_amount, account_id,
         period, status, direction, created_at, updated_at)
      VALUES ($1,'sport_center_booking',$2,$3,$4,'PPN Keluaran 11%',11,'self_borne',$5,$6,$7,$8,'posted','out',NOW(),NOW())
    `, [COMPANY_ID, b.bookingId, b.orderNumber, taxIdPpn, b.subtotal, b.ppnAmount, coaPpnKeluaran, period]);
    console.log(`  transaction_taxes inserted`);

    // 7. gl_tax_lines
    await client.query(`
      INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period,
         entity_type, entity_id, is_reported, created_at)
      VALUES ($1,$2,'PPN_OUT',11,$3,$4,'out',$5,'booking',$6,false,NOW())
    `, [COMPANY_ID, entryId, b.subtotal, b.ppnAmount, period, b.orderNumber]);
    console.log(`  gl_tax_lines inserted`);
  }

  // 8. Verifikasi akhir
  console.log("\n=== VERIFIKASI ===");
  const verify = await client.query(`
    SELECT ae.ref, ae.entry_number, ae.status, ae.total_debit,
           json_agg(json_build_object('account_id',ael.account_id,'debit',ael.debit,'credit',ael.credit) ORDER BY ael.id) AS lines
    FROM public.accounting_entries ae
    JOIN public.accounting_entry_lines ael ON ael.entry_id = ae.id
    WHERE ae.source = 'sport_center_booking' AND ae.ref = ANY($1::text[])
    GROUP BY ae.ref, ae.entry_number, ae.status, ae.total_debit
    ORDER BY ae.ref
  `, [bookings.map(b => b.orderNumber)]);
  verify.rows.forEach((r: any) => console.log(JSON.stringify(r, null, 2)));

} finally {
  await client.end();
}
