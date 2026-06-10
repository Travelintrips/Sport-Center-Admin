import pg from "pg";
const { Client } = pg;

const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV || process.env.SUPABASE_DATABASE_URL;
if (!rawUrl) throw new Error("No DATABASE_URL");
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SQL = `
ALTER TABLE sport_center.settings
  ADD COLUMN IF NOT EXISTS fonnte_token text,
  ADD COLUMN IF NOT EXISTS fonnte_admin_wa text,
  ADD COLUMN IF NOT EXISTS admin_wa_phones text,
  ADD COLUMN IF NOT EXISTS app_url text;
`;

async function main() {
  await client.connect();
  console.log("Connected. Running WA settings migration...");
  try {
    await client.query(SQL);
    console.log("✅ WA settings columns added successfully!");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
