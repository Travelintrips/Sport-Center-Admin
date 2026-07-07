/**
 * Audit: Cek semua pembayaran Sport Center apakah sudah masuk ke BizPortal
 * Run: scripts/node_modules/.bin/tsx scripts/audit_bizportal.ts
 */
import pg from "pg";
const { Pool } = pg;

const PROD_URL =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

if (!PROD_URL) {
  console.error("❌ Tidak ada SUPABASE_DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: PROD_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  options: "-c search_path=sport_center,public",
});

function rp(n: any) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

async function run() {
  console.log("\n========================================");
  console.log("  AUDIT PEMBAYARAN SPORT CENTER → BIZPORTAL");
  console.log("  DB:", PROD_URL!.split("@")[1]?.split("/")[0]);
  console.log("========================================\n");

  // 1. Semua booking lunas di Sport Center
  const { rows: scBookings } = await pool.query(`
    SELECT
      b.order_number, b.customer_name, b.status,
      b.payer_type, b.billing_status, b.booking_date,
      COALESCE(b.grand_total, b.total_price)::numeric AS amount,
      b.created_at
    FROM sport_center.sport_bookings b
    WHERE
      (b.payer_type IS DISTINCT FROM 'company' AND b.status IN ('confirmed','completed'))
      OR (b.payer_type = 'company' AND b.billing_status = 'paid')
    ORDER BY b.created_at DESC
  `);

  // 2. bank_mutations — booking (SC-xxx)
  const { rows: mutBookings } = await pool.query(`
    SELECT mutation_key, provider_order_id, amount::numeric, status, transaction_date
    FROM sport_center.bank_mutations
    WHERE mutation_key LIKE 'SC-%'
      AND mutation_key NOT LIKE 'SC-INV-%'
      AND mutation_key NOT LIKE 'SC-MB-%'
  `);

  // 3. bank_mutations — invoice perusahaan (SC-INV-xxx)
  const { rows: mutInvoices } = await pool.query(`
    SELECT mutation_key, provider_order_id, amount::numeric, status, transaction_date
    FROM sport_center.bank_mutations
    WHERE mutation_key LIKE 'SC-INV-%'
  `);

  // 4. bank_mutations — membership (SC-MB-xxx)
  const { rows: mutMemberships } = await pool.query(`
    SELECT mutation_key, amount::numeric, status, transaction_date
    FROM sport_center.bank_mutations
    WHERE mutation_key LIKE 'SC-MB-%'
  `);

  // 5. sport_bookings_sync
  const { rows: synced } = await pool.query(`
    SELECT booking_code, status, payment_status,
           COALESCE(grand_total, total_price)::numeric AS amount
    FROM sport_center.sport_bookings_sync
    ORDER BY updated_at DESC
  `);

  // 6. Invoice perusahaan yang sudah lunas di SC
  const { rows: scInvoices } = await pool.query(`
    SELECT invoice_number, total_amount::numeric, grand_total::numeric, status, paid_at
    FROM sport_center.company_invoices
    WHERE status = 'paid'
    ORDER BY paid_at DESC
  `).catch(() => ({ rows: [] }));

  // 7. Membership yang sudah aktif/expired di SC
  const { rows: scMemberships } = await pool.query(`
    SELECT id, name, total_price::numeric, status, start_date
    FROM sport_center.sport_memberships
    WHERE status IN ('active','expired')
    ORDER BY created_at DESC
  `).catch(() => ({ rows: [] }));

  // ── Analisis Booking ──────────────────────────────────────
  const mutKeySet = new Set(mutBookings.map((m: any) => `SC-${m.provider_order_id || ""}`) );
  // Build set dari mutation_key langsung
  const mutKeySetDirect = new Set(mutBookings.map((m: any) => m.mutation_key));

  const syncedSet = new Set(synced.map((s: any) => s.booking_code));

  const missingFromBankMut: any[] = [];
  const missingFromSync: any[] = [];

  for (const b of scBookings) {
    const expectedKey = `SC-${b.order_number}`;
    if (!mutKeySetDirect.has(expectedKey)) {
      missingFromBankMut.push(b);
    }
    if (!syncedSet.has(b.order_number)) {
      missingFromSync.push(b);
    }
  }

  // ── Invoice ──────────────────────────────────────────────
  const invMutSet = new Set(mutInvoices.map((m: any) => m.mutation_key));
  const missingInvoices = scInvoices.filter(
    (inv: any) => !invMutSet.has(`SC-INV-${inv.invoice_number}`)
  );

  // ── Membership ────────────────────────────────────────────
  const mbMutSet = new Set(mutMemberships.map((m: any) => m.mutation_key));
  const missingMemberships = scMemberships.filter(
    (mb: any) => !mbMutSet.has(`SC-MB-${mb.id}`)
  );

  // ── Cetak Hasil ──────────────────────────────────────────
  const totalScAmount = scBookings.reduce((s: number, b: any) => s + Number(b.amount), 0);
  const totalMutAmount = mutBookings.reduce((s: number, m: any) => s + Number(m.amount), 0);
  const totalInvAmount = mutInvoices.reduce((s: number, m: any) => s + Number(m.amount), 0);
  const totalMbAmount = mutMemberships.reduce((s: number, m: any) => s + Number(m.amount), 0);

  console.log("📦 SPORT CENTER — Booking Lunas");
  console.log(`   Personal (confirmed/completed) : ${scBookings.filter((b: any) => b.payer_type !== 'company').length} booking | ${rp(scBookings.filter((b:any)=>b.payer_type!=='company').reduce((s:number,b:any)=>s+Number(b.amount),0))}`);
  console.log(`   Perusahaan (invoice paid)       : ${scBookings.filter((b: any) => b.payer_type === 'company').length} booking | ${rp(scBookings.filter((b:any)=>b.payer_type==='company').reduce((s:number,b:any)=>s+Number(b.amount),0))}`);
  console.log(`   Invoice Lunas                   : ${scInvoices.length} invoice`);
  console.log(`   Membership Aktif/Expired        : ${scMemberships.length} member`);

  console.log("\n💳 BIZPORTAL bank_mutations");
  console.log(`   Booking  (SC-xxx)    : ${mutBookings.length} entri | ${rp(totalMutAmount)}`);
  console.log(`   Invoice  (SC-INV-xxx): ${mutInvoices.length} entri | ${rp(totalInvAmount)}`);
  console.log(`   Membership(SC-MB-xxx): ${mutMemberships.length} entri | ${rp(totalMbAmount)}`);
  console.log(`   sport_bookings_sync  : ${synced.length} entri total`);

  console.log("\n🔍 HASIL AUDIT");
  console.log("─".repeat(50));

  // Booking
  if (missingFromBankMut.length === 0) {
    console.log(`✅ Semua ${scBookings.length} booking lunas sudah ada di bank_mutations`);
  } else {
    console.log(`❌ ${missingFromBankMut.length} booking BELUM masuk ke bank_mutations BizPortal:`);
    for (const b of missingFromBankMut.slice(0, 20)) {
      console.log(`   - ${b.order_number} | ${b.customer_name} | ${b.booking_date} | ${rp(b.amount)} | status: ${b.status}`);
    }
    if (missingFromBankMut.length > 20) {
      console.log(`   ... dan ${missingFromBankMut.length - 20} lainnya`);
    }
    const missingTotal = missingFromBankMut.reduce((s: number, b: any) => s + Number(b.amount), 0);
    console.log(`   Total nominal missing: ${rp(missingTotal)}`);
  }

  // Sync status
  if (missingFromSync.length === 0) {
    console.log(`✅ Semua booking sudah ada di sport_bookings_sync`);
  } else {
    console.log(`⚠️  ${missingFromSync.length} booking belum/tidak ada di sport_bookings_sync`);
    for (const b of missingFromSync.slice(0, 10)) {
      console.log(`   - ${b.order_number} | ${b.customer_name} | ${b.status}`);
    }
  }

  // Invoice
  if (missingInvoices.length === 0) {
    console.log(`✅ Semua ${scInvoices.length} invoice lunas sudah ada di bank_mutations`);
  } else {
    console.log(`❌ ${missingInvoices.length} invoice BELUM masuk ke bank_mutations:`);
    for (const inv of missingInvoices.slice(0, 10)) {
      console.log(`   - ${inv.invoice_number} | ${rp(inv.grand_total || inv.total_amount)}`);
    }
  }

  // Membership
  if (missingMemberships.length === 0) {
    console.log(`✅ Semua ${scMemberships.length} membership sudah ada di bank_mutations`);
  } else {
    console.log(`❌ ${missingMemberships.length} membership BELUM masuk ke bank_mutations:`);
    for (const mb of missingMemberships.slice(0, 10)) {
      console.log(`   - MB-${mb.id} | ${mb.name} | ${rp(mb.total_price)} | ${mb.status}`);
    }
  }

  // Selisih nominal
  console.log("\n💰 SELISIH NOMINAL");
  const selisih = totalScAmount - totalMutAmount;
  console.log(`   SC booking lunas : ${rp(totalScAmount)}`);
  console.log(`   BizPortal SC-xxx : ${rp(totalMutAmount)}`);
  console.log(`   Selisih          : ${rp(Math.abs(selisih))} ${selisih > 0 ? "(SC > BizPortal — ada yang belum sync)" : selisih < 0 ? "(BizPortal > SC — ada duplikat?)" : "(✅ sama persis)"}`);

  console.log("\n========================================\n");
}

run()
  .catch(console.error)
  .finally(() => pool.end());
