import pg from "pg";
const { Client } = pg;

const connStr = (process.env.SUPABASE_DATABASE_URL ?? "").replace(":6543/", ":5432/");
const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

await client.connect();

await client.query(`
  ALTER TABLE sport_center.bookings
    ADD COLUMN IF NOT EXISTS ppn_rate NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS ppn_amount NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS grand_total NUMERIC(12,2);
`);

await client.query(`
  CREATE TABLE IF NOT EXISTS sport_center.tax_settings (
    id SERIAL PRIMARY KEY,
    tax_code TEXT NOT NULL UNIQUE,
    tax_name TEXT NOT NULL,
    tax_rate NUMERIC(5,2) NOT NULL,
    tax_type TEXT NOT NULL DEFAULT 'output_vat',
    applies_to TEXT NOT NULL DEFAULT 'sport_center_booking',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

await client.query(`
  CREATE TABLE IF NOT EXISTS sport_center.tax_transactions (
    id SERIAL PRIMARY KEY,
    reference_type TEXT NOT NULL,
    reference_id INTEGER NOT NULL,
    reference_number TEXT NOT NULL,
    tax_code TEXT NOT NULL,
    tax_rate NUMERIC(5,2) NOT NULL,
    dpp NUMERIC(14,2) NOT NULL,
    tax_amount NUMERIC(14,2) NOT NULL,
    transaction_date TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

await client.query(`
  INSERT INTO sport_center.tax_settings (tax_code, tax_name, tax_rate, tax_type, applies_to, is_active)
  VALUES ('PPN_OUT_11', 'PPN Keluaran 11%', 11.00, 'output_vat', 'sport_center_booking', true)
  ON CONFLICT (tax_code) DO NOTHING;
`);

console.log("✅ Migration selesai: ppn_rate, ppn_amount, grand_total ditambahkan ke bookings");
console.log("✅ Tabel tax_settings dan tax_transactions dibuat");
console.log("✅ Seed PPN_OUT_11 (11%) berhasil");

await client.end();
