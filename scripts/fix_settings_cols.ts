import pg from "pg";
const { Client } = pg;

const rawUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  "";
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  const stmts = [
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS fonnte_token text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS fonnte_customer_token text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS fonnte_admin_wa text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS admin_wa_phones text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS app_url text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS payment_domain text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS payment_deadline_hours text DEFAULT '24'`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS qris_image_url text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS logo_url text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS bank_name text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS bank_account text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS bank_account_name text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS open_hour text`,
    `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS close_hour text`,
    // seed tax settings
    `CREATE TABLE IF NOT EXISTS sport_center.tax_settings (
      id serial PRIMARY KEY,
      tax_code text NOT NULL UNIQUE,
      tax_name text NOT NULL,
      tax_rate numeric(5,2) NOT NULL,
      tax_type text NOT NULL,
      applies_to text,
      is_active boolean NOT NULL DEFAULT true,
      effective_from date,
      effective_to date,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `INSERT INTO sport_center.tax_settings (tax_code, tax_name, tax_rate, tax_type, applies_to, is_active)
     VALUES ('PPN_OUT_11', 'PPN Keluaran 11%', 11, 'ppn_keluaran', 'booking', true)
     ON CONFLICT (tax_code) DO NOTHING`,
  ];
  let ok = 0, skip = 0;
  for (const s of stmts) {
    try { await client.query(s); ok++; } catch (_) { skip++; }
  }
  console.log(`ok: ${ok}, skip: ${skip}`);
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
