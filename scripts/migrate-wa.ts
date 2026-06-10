import pg from "pg";
const { Client } = pg;

const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV || process.env.SUPABASE_DATABASE_URL;
if (!rawUrl) throw new Error("No DATABASE_URL");
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SQL = `
ALTER TABLE sport_center.bookings
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web';

CREATE TABLE IF NOT EXISTS sport_center.wa_action_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  booking_id INTEGER NOT NULL REFERENCES sport_center.bookings(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_action_tokens_token_idx ON sport_center.wa_action_tokens(token);
CREATE INDEX IF NOT EXISTS wa_action_tokens_booking_id_idx ON sport_center.wa_action_tokens(booking_id);
`;

async function main() {
  await client.connect();
  console.log("Connected. Running WA migration...");
  try {
    await client.query(SQL);
    console.log("✅ WA migration completed!");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
