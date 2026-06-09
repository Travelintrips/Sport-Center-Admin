import pg from "pg";
const { Client } = pg;

const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV || process.env.SUPABASE_DATABASE_URL;
if (!rawUrl) throw new Error("No DATABASE_URL");
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SQL = `
ALTER TABLE sport_center.users
  ADD COLUMN IF NOT EXISTS customer_code TEXT UNIQUE;

ALTER TABLE sport_center.users
  ADD COLUMN IF NOT EXISTS registration_source TEXT DEFAULT 'web';

CREATE INDEX IF NOT EXISTS users_customer_code_idx ON sport_center.users(customer_code);
CREATE INDEX IF NOT EXISTS users_phone_idx ON sport_center.users(phone);
`;

async function main() {
  await client.connect();
  console.log("Connected. Running customer code migration...");
  await client.query(SQL);
  console.log("Migration complete.");
  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
