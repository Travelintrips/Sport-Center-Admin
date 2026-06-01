import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Client } = require("/home/runner/workspace/lib/db/node_modules/pg");

const connectionString = process.env.SUPABASE_DATABASE_URL_DEV || process.env.SUPABASE_DATABASE_URL;
if (!connectionString) {
  console.error("No database connection string found. Set SUPABASE_DATABASE_URL_DEV or SUPABASE_DATABASE_URL");
  process.exit(1);
}

// Use session pooler port 5432 for DDL
const url = new URL(connectionString);
url.port = "5432";

const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

const SQL = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'sport_center' AND t.typname = 'user_role' AND e.enumlabel = 'tenant'
  ) THEN
    ALTER TYPE sport_center.user_role ADD VALUE 'tenant';
  END IF;
END$$;

ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS tenant_id INTEGER;

CREATE TABLE IF NOT EXISTS sport_center.tenants (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES sport_center.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  business_category TEXT,
  logo_url TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sport_center.users
  DROP CONSTRAINT IF EXISTS users_tenant_id_fkey;
ALTER TABLE sport_center.users
  ADD CONSTRAINT users_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES sport_center.tenants(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS sport_center.tenant_bookings (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES sport_center.tenants(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES sport_center.users(id) ON DELETE SET NULL,
  booking_type TEXT NOT NULL DEFAULT 'booth' CHECK (booking_type IN ('booth','event_space','advertising_space','renewal')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  duration_months INTEGER,
  requested_area TEXT,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','uploaded','verified','rejected')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','active','expired')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sport_center.tenant_payments (
  id SERIAL PRIMARY KEY,
  tenant_booking_id INTEGER NOT NULL REFERENCES sport_center.tenant_bookings(id) ON DELETE CASCADE,
  proof_image_url TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function run() {
  try {
    await client.connect();
    console.log("Connected. Running tenant migration...");
    await client.query(SQL);
    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration error:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
