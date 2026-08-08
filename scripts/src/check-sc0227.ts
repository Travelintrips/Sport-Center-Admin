import pg from "pg";
const { Client } = pg;
const url = (process.env.SUPABASE_DATABASE_URL ?? "").replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  // Payments untuk semua booking grup GRP-17156
  const { rows: payments } = await client.query(`
    SELECT p.id, p.booking_id, b.order_number, p.amount, p.status, p.payment_method, p.confirmed_at
    FROM sport_center.sport_payments p
    JOIN sport_center.sport_bookings b ON b.id = p.booking_id
    WHERE b.group_ref = 'GRP-17156'
    ORDER BY b.order_number, p.id
  `);
  console.log("=== Payments grup GRP-17156 ===");
  console.log(JSON.stringify(payments, null, 2));

  // BizPortal sync records untuk semua booking grup
  const { rows: sync } = await client.query(`
    SELECT booking_code, total_price, grand_total, status, payment_status, updated_at
    FROM sport_center.sport_bookings_sync
    WHERE booking_code IN ('SC-0227','SC-0228','SC-0229','SC-0230')
    ORDER BY booking_code
  `);
  console.log("\n=== BizPortal sync records ===");
  console.log(JSON.stringify(sync, null, 2));

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
