import pg from "pg";
const { Client } = pg;

const connStr = (process.env.SUPABASE_DATABASE_URL ?? "").replace(":6543/", ":5432/");
const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

await client.connect();

// Add effective_date column to tax_settings (backward-compat: nullable, no default)
await client.query(`
  ALTER TABLE sport_center.tax_settings
    ADD COLUMN IF NOT EXISTS effective_date TEXT;
`);

// Add status/transactionType columns to tax_transactions if missing (from previous migrations)
await client.query(`
  ALTER TABLE sport_center.tax_transactions
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted',
    ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'original',
    ADD COLUMN IF NOT EXISTS reversal_of_id INTEGER;
`);

console.log("✅ Migration selesai: effective_date ditambahkan ke tax_settings");
console.log("✅ Kolom status/transaction_type/reversal_of_id dipastikan ada di tax_transactions");
console.log("✅ Data lama TIDAK diubah — backward compatibility terjaga");

await client.end();
