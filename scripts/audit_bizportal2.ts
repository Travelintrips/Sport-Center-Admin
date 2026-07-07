import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL_DEV,
  ssl: { rejectUnauthorized: false },
  max: 3,
  options: "-c search_path=sport_center,public",
});

const rp = (n: unknown) => "Rp " + Number(n || 0).toLocaleString("id-ID");

async function main() {
  console.log("\n========================================");
  console.log("  AUDIT LENGKAP SC → BIZPORTAL (PRODUCTION)");
  console.log("========================================\n");

  // 1. Semua status booking SC
  const { rows: byStatus } = await pool.query(`
    SELECT status, COUNT(*) as cnt,
           SUM(COALESCE(grand_total, total_price))::numeric as total
    FROM sport_center.sport_bookings
    GROUP BY status ORDER BY cnt DESC
  `).catch(() => ({ rows: [] as any[] }));

  console.log("📊 sport_bookings per status:");
  byStatus.forEach((r) => console.log(`   ${String(r.status).padEnd(25)} ${String(r.cnt).padStart(4)} booking | ${rp(r.total)}`));

  // 2. sport_payments (tabel milik BizPortal dgn nomor SCPAY-xxx)
  const { rows: spSummary } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status IN ('paid','confirmed','lunas')) as lunas_count,
      SUM(amount) FILTER (WHERE status IN ('paid','confirmed','lunas'))::numeric as lunas_total,
      MIN(created_at) as oldest,
      MAX(created_at) as newest
    FROM sport_center.sport_payments
  `).catch(() => ({ rows: [{ total: 'N/A' }] as any[] }));

  const { rows: spCols } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'sport_center' AND table_name = 'sport_payments'
    ORDER BY ordinal_position
  `).catch(() => ({ rows: [] as any[] }));

  console.log("\n💳 sport_payments (SCPAY-xxx di BizPortal):");
  if (spSummary[0].total === 'N/A') {
    console.log("   ⚠️  Tabel tidak ditemukan");
  } else {
    console.log(`   Total semua          : ${spSummary[0].total} transaksi`);
    console.log(`   Status lunas         : ${spSummary[0].lunas_count} transaksi | ${rp(spSummary[0].lunas_total)}`);
    console.log(`   Kolom               : ${spCols.map((c) => c.column_name).join(", ")}`);
  }

  // 3. Status di sport_payments
  const { rows: spByStatus } = await pool.query(`
    SELECT status, COUNT(*) as cnt, SUM(amount)::numeric as total
    FROM sport_center.sport_payments
    GROUP BY status ORDER BY cnt DESC
  `).catch(() => ({ rows: [] as any[] }));
  if (spByStatus.length > 0) {
    console.log("   Per status:");
    spByStatus.forEach((r) => console.log(`     ${String(r.status).padEnd(20)} ${String(r.cnt).padStart(4)} | ${rp(r.total)}`));
  }

  // 4. Cek sport_payments linked ke booking SC
  const { rows: spLinked } = await pool.query(`
    SELECT
      sp.booking_code,
      sp.amount::numeric,
      sp.status,
      sp.payment_date,
      sp.created_at,
      b.order_number as sc_order,
      b.status as sc_status
    FROM sport_center.sport_payments sp
    LEFT JOIN sport_center.sport_bookings b ON b.order_number = sp.booking_code
    ORDER BY sp.created_at DESC
    LIMIT 10
  `).catch(() => ({ rows: [] as any[] }));

  console.log("\n🔗 Sample sport_payments (10 terbaru):");
  if (spLinked.length === 0) {
    console.log("   (kosong atau kolom berbeda)");
  } else {
    spLinked.forEach((r) =>
      console.log(`   ${r.booking_code || '?'} | ${rp(r.amount)} | status_biz:${r.status} | sc_status:${r.sc_status || 'tidak ada'}`)
    );
  }

  // 5. Booking SC lunas tapi tidak ada di sport_payments
  const { rows: scLunas } = await pool.query(`
    SELECT b.order_number, b.customer_name, b.status, b.booking_date,
           COALESCE(b.grand_total, b.total_price)::numeric as amount
    FROM sport_center.sport_bookings b
    WHERE (b.payer_type IS DISTINCT FROM 'company' AND b.status IN ('confirmed','completed'))
       OR (b.payer_type = 'company' AND b.billing_status = 'paid')
    ORDER BY b.created_at DESC
  `).catch(() => ({ rows: [] as any[] }));

  const { rows: spAllCodes } = await pool.query(`
    SELECT DISTINCT booking_code FROM sport_center.sport_payments
  `).catch(() => ({ rows: [] as any[] }));

  const spCodeSet = new Set(spAllCodes.map((r) => r.booking_code));
  const missingFromSp = scLunas.filter((b) => !spCodeSet.has(b.order_number));

  console.log("\n🔍 AUDIT: Booking lunas SC vs sport_payments BizPortal");
  console.log(`   SC lunas: ${scLunas.length} booking`);
  console.log(`   sport_payments unique booking_code: ${spCodeSet.size}`);
  if (missingFromSp.length === 0) {
    console.log(`   ✅ Semua booking lunas SC sudah ada di sport_payments`);
  } else {
    console.log(`   ❌ ${missingFromSp.length} booking SC belum ada di sport_payments:`);
    missingFromSp.slice(0, 20).forEach((b) =>
      console.log(`      - ${b.order_number} | ${b.customer_name} | ${b.booking_date} | ${rp(b.amount)} | ${b.status}`)
    );
    if (missingFromSp.length > 20) console.log(`      ... dan ${missingFromSp.length - 20} lainnya`);
    const missingTotal = missingFromSp.reduce((s, b) => s + Number(b.amount), 0);
    console.log(`   Total nominal belum masuk: ${rp(missingTotal)}`);
  }

  // 6. sport_bookings_sync vs booking SC lunas
  const { rows: syncRows } = await pool.query(`
    SELECT booking_code, payment_status FROM sport_center.sport_bookings_sync
  `).catch(() => ({ rows: [] as any[] }));
  const syncSet = new Set(syncRows.map((r) => r.booking_code));
  const missingFromSync = scLunas.filter((b) => !syncSet.has(b.order_number));
  console.log(`\n   sport_bookings_sync: ${syncRows.length} total`);
  if (missingFromSync.length === 0) {
    console.log(`   ✅ Semua booking lunas ada di sport_bookings_sync`);
  } else {
    console.log(`   ⚠️  ${missingFromSync.length} booking belum/tidak ada di sport_bookings_sync`);
  }

  // 7. bank_mutations summary
  const { rows: bmAll } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE mutation_key LIKE 'SC-%' AND mutation_key NOT LIKE 'SC-INV-%' AND mutation_key NOT LIKE 'SC-MB-%') as booking_count,
      COUNT(*) FILTER (WHERE mutation_key LIKE 'SC-INV-%') as inv_count,
      COUNT(*) FILTER (WHERE mutation_key LIKE 'SC-MB-%') as mb_count,
      SUM(amount) FILTER (WHERE mutation_key LIKE 'SC-%' AND mutation_key NOT LIKE 'SC-INV-%' AND mutation_key NOT LIKE 'SC-MB-%')::numeric as booking_total,
      SUM(amount) FILTER (WHERE mutation_key LIKE 'SC-INV-%')::numeric as inv_total,
      SUM(amount) FILTER (WHERE mutation_key LIKE 'SC-MB-%')::numeric as mb_total
    FROM sport_center.bank_mutations
  `).catch(() => ({ rows: [{}] as any[] }));

  const bm = bmAll[0];
  console.log("\n🏦 bank_mutations (untuk rekonsiliasi bank):");
  console.log(`   Booking  (SC-xxx)     : ${bm.booking_count || 0} | ${rp(bm.booking_total)}`);
  console.log(`   Invoice  (SC-INV-xxx) : ${bm.inv_count || 0} | ${rp(bm.inv_total)}`);
  console.log(`   Membership(SC-MB-xxx) : ${bm.mb_count || 0} | ${rp(bm.mb_total)}`);

  console.log("\n========================================\n");
}

main().catch(console.error).finally(() => pool.end());
