import pg from "pg";
const { Client } = pg;

async function main() {
  const url = (process.env.SUPABASE_DATABASE_URL ?? "").replace(
    "pooler.supabase.com:6543",
    "pooler.supabase.com:5432"
  );
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Check columns of company_verifications
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_schema = 'sport_center' AND table_name = 'company_verifications'
     ORDER BY ordinal_position LIMIT 20`
  );
  console.log("company_verifications columns:", cols.rows.map((r: any) => r.column_name).join(", "));

  // Get company id=60
  const comp = await client.query(
    `SELECT * FROM sport_center.company_verifications WHERE id = 60 LIMIT 1`
  );
  console.log("\nCompany 60:", JSON.stringify(comp.rows[0]));

  // Count pending bookings to update
  const bkgs = await client.query(
    `SELECT id, order_number, status, payer_type, total_price, booking_date
     FROM sport_center.sport_bookings
     WHERE customer_email = 'Ardhi@gmail.com'
       AND payer_type = 'personal'
       AND status = 'pending_payment'
     ORDER BY id DESC`
  );
  console.log(`\nPending personal bookings to update (${bkgs.rows.length} total):`);
  for (const r of bkgs.rows) {
    console.log(`  [${r.id}] ${r.order_number} | ${r.booking_date} | Rp ${Number(r.total_price).toLocaleString()}`);
  }

  await client.end();
}
main().catch(e => { console.error("❌", e.message); process.exit(1); });
