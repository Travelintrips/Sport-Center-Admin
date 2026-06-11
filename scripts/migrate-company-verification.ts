import pg from "pg";

const { Client } = pg;

const rawUrl =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!rawUrl) throw new Error("No DATABASE_URL found");

const url = rawUrl.replace(
  "pooler.supabase.com:6543",
  "pooler.supabase.com:5432"
);

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
-- ============================================================
-- Employee Verification for Corporate Billing
-- ============================================================

-- 1. Create enum for verification status
DO $$ BEGIN
  CREATE TYPE sport_center.company_verification_status AS ENUM ('pending', 'approved', 'rejected', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. company_users — links personal customers to company accounts
CREATE TABLE IF NOT EXISTS sport_center.company_users (
  id                      serial PRIMARY KEY,
  company_id              integer NOT NULL REFERENCES sport_center.users(id) ON DELETE CASCADE,
  customer_id             integer NOT NULL REFERENCES sport_center.users(id) ON DELETE CASCADE,
  employee_id             text NOT NULL,
  office_email            text,
  id_card_url             text,
  verification_status     sport_center.company_verification_status NOT NULL DEFAULT 'pending',
  corporate_billing_enabled boolean NOT NULL DEFAULT false,
  verified_at             timestamptz,
  verified_by             integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  rejection_reason        text,
  requested_at            timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_users_company_employee_unique UNIQUE (company_id, employee_id)
);

-- 3. company_verifications — audit trail of each verification request
CREATE TABLE IF NOT EXISTS sport_center.company_verifications (
  id              serial PRIMARY KEY,
  company_user_id integer REFERENCES sport_center.company_users(id) ON DELETE SET NULL,
  company_id      integer NOT NULL REFERENCES sport_center.users(id) ON DELETE CASCADE,
  customer_id     integer NOT NULL REFERENCES sport_center.users(id) ON DELETE CASCADE,
  employee_id     text NOT NULL,
  office_email    text,
  id_card_url     text,
  status          sport_center.company_verification_status NOT NULL DEFAULT 'pending',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  approved_at     timestamptz,
  approved_by     integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  rejection_reason text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 4. company_verification_tokens — secure tokens for WA approve/reject links
CREATE TABLE IF NOT EXISTS sport_center.company_verification_tokens (
  id              serial PRIMARY KEY,
  token           text NOT NULL UNIQUE,
  verification_id integer NOT NULL REFERENCES sport_center.company_verifications(id) ON DELETE CASCADE,
  action          text NOT NULL,
  used_at         timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_company_users_company_id ON sport_center.company_users(company_id);
CREATE INDEX IF NOT EXISTS idx_company_users_customer_id ON sport_center.company_users(customer_id);
CREATE INDEX IF NOT EXISTS idx_company_verifications_customer_id ON sport_center.company_verifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_company_verifications_company_id ON sport_center.company_verifications(company_id);
CREATE INDEX IF NOT EXISTS idx_company_verifications_status ON sport_center.company_verifications(status);
CREATE INDEX IF NOT EXISTS idx_company_verification_tokens_token ON sport_center.company_verification_tokens(token);
`;

async function main() {
  await client.connect();
  console.log("Connected. Running migration...");
  await client.query(SQL);
  console.log("Migration completed successfully.");
  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
