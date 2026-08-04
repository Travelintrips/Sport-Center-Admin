import pg from "pg";
const { Client } = pg;

async function main() {
  const url = (process.env.SUPABASE_DATABASE_URL ?? "").replace(
    "pooler.supabase.com:6543",
    "pooler.supabase.com:5432"
  );
  if (!url) { console.error("SUPABASE_DATABASE_URL not set"); process.exit(1); }
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("✅ Connected to production DB");

  // First, get columns of sport_bookings
  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'sport_center' AND table_name = 'sport_bookings'
    ORDER BY ordinal_position
  `);
  console.log("Columns:", cols.rows.map((r: any) => r.column_name).join(", "));

  // Query Ardhi's bookings
  const res = await client.query(`
    SELECT id, order_number, status, payer_type, booker_name, customer_name,
           customer_email, total_price, grand_total, created_at::date as date, 
           company_customer_id, source
    FROM sport_center.sport_bookings
    WHERE LOWER(customer_name) LIKE '%ardhi%'
       OR LOWER(booker_name) LIKE '%ardhi%'
       OR LOWER(customer_email) LIKE '%ardhi%'
    ORDER BY created_at DESC
    LIMIT 30
  `);
  console.log(`\nFound ${res.rows.length} bookings for Ardhi:`);
  for (const r of res.rows) {
    console.log(`  [${r.id}] ${r.order_number} | ${r.date} | ${r.status} | payer_type: ${r.payer_type} | company_customer_id: ${r.company_customer_id} | ${r.customer_name} / ${r.customer_email}`);
  }
  await client.end();
}
main().catch(e => { console.error("❌", e.message); process.exit(1); });
