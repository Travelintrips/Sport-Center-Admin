import pg from "pg";
const { Client } = pg;

// Try prod URL first, then dev
const isProd = process.argv.includes("--prod");
const rawUrl = isProd
  ? (process.env.SUPABASE_DATABASE_URL ?? "")
  : (process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL ?? "");
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

if (!url) { console.error("No DB URL found"); process.exit(1); }

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log("Connected to:", isProd ? "PROD" : "DEV");

  // Check if booking exists first
  const check = await client.query(
    `SELECT id, order_number, status, customer_name, booking_date FROM sport_center.sport_bookings WHERE order_number = 'SC-0326'`
  );
  console.log("Booking found:", check.rows);

  if (check.rows.length > 0) {
    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await client.query(
      `UPDATE sport_center.sport_bookings
       SET status = 'pending_payment',
           payment_deadline = $1,
           updated_at = NOW()
       WHERE order_number = 'SC-0326'
       RETURNING id, order_number, status, payment_deadline, customer_name`,
      [deadline]
    );
    console.log("Updated:", JSON.stringify(res.rows[0], null, 2));
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
