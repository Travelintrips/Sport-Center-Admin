import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.SUPABASE_DATABASE_URL });
  await client.connect();
  await client.query(
    "ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS invoice_pdf_url text"
  );
  console.log("✅ Kolom invoice_pdf_url berhasil ditambahkan ke sport_bookings");
  await client.end();
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
