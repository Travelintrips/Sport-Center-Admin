import pg from "pg";

const { Client } = pg;

const rawUrl =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!rawUrl) throw new Error("No DATABASE_URL found");

// Use session pooler (port 5432) for DDL
const url = rawUrl.replace(
  /pooler\.supabase\.com:6543/,
  "pooler.supabase.com:5432"
);

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
-- wa_booking_sessions: session state for conversational WA booking flow
CREATE TABLE IF NOT EXISTS sport_center.wa_booking_sessions (
  id              serial PRIMARY KEY,
  phone           text NOT NULL,
  customer_id     integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  current_step    text NOT NULL DEFAULT 'ask_facility',
  facility_id     integer,
  booking_date    text,
  start_time      text,
  duration_minutes integer,
  customer_name   text,
  status          text NOT NULL DEFAULT 'active',
  raw_messages    jsonb NOT NULL DEFAULT '[]',
  expired_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_booking_sessions_phone
  ON sport_center.wa_booking_sessions(phone);

CREATE INDEX IF NOT EXISTS idx_wa_booking_sessions_status_expired
  ON sport_center.wa_booking_sessions(status, expired_at);
`;

async function run() {
  await client.connect();
  console.log("Connected. Running migration...");
  await client.query(SQL);
  console.log("✅ wa_booking_sessions table created (or already exists).");
  await client.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
