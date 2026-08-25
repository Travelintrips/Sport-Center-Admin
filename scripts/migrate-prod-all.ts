import pg from "pg";
const { Client } = pg;

const rawUrl = process.env.SUPABASE_DATABASE_URL;
if (!rawUrl) throw new Error("SUPABASE_DATABASE_URL not set");

const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SQL = `
-- ==========================================================
-- PPN: kolom bookings + tabel tax_settings + tax_transactions
-- ==========================================================
ALTER TABLE sport_center.bookings
  ADD COLUMN IF NOT EXISTS ppn_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ppn_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS grand_total NUMERIC(12,2);

CREATE TABLE IF NOT EXISTS sport_center.tax_settings (
  id SERIAL PRIMARY KEY,
  tax_code TEXT NOT NULL UNIQUE,
  tax_name TEXT NOT NULL,
  tax_rate NUMERIC(5,2) NOT NULL,
  tax_type TEXT NOT NULL DEFAULT 'output_vat',
  applies_to TEXT NOT NULL DEFAULT 'sport_center_booking',
  is_active BOOLEAN NOT NULL DEFAULT true,
  effective_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  status TEXT NOT NULL DEFAULT 'posted',
  transaction_type TEXT NOT NULL DEFAULT 'original',
  reversal_of_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sport_center.tax_settings (tax_code, tax_name, tax_rate, tax_type, applies_to, is_active)
VALUES ('PPN_OUT_11', 'PPN Keluaran 11%', 11.00, 'output_vat', 'sport_center_booking', true)
ON CONFLICT (tax_code) DO NOTHING;

-- tax_settings columns (if table pre-existed without them)
ALTER TABLE sport_center.tax_settings
  ADD COLUMN IF NOT EXISTS effective_date TEXT;

ALTER TABLE sport_center.tax_transactions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'original',
  ADD COLUMN IF NOT EXISTS reversal_of_id INTEGER;

-- ==========================================================
-- WA: source column + wa_action_tokens
-- ==========================================================
ALTER TABLE sport_center.accounting_journals
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted';

ALTER TABLE sport_center.accounting_journals
  ALTER COLUMN status SET DEFAULT 'posted';

UPDATE sport_center.accounting_journals
   SET status = 'posted'
 WHERE journal_type = 'payment_confirmed'
   AND is_reversal = false
   AND status IS DISTINCT FROM 'posted';

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

-- ==========================================================
-- WA Settings columns
-- ==========================================================
ALTER TABLE sport_center.settings
  ADD COLUMN IF NOT EXISTS fonnte_token text,
  ADD COLUMN IF NOT EXISTS fonnte_admin_wa text,
  ADD COLUMN IF NOT EXISTS admin_wa_phones text,
  ADD COLUMN IF NOT EXISTS app_url text;

-- ==========================================================
-- Customer code
-- ==========================================================
ALTER TABLE sport_center.users
  ADD COLUMN IF NOT EXISTS customer_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS registration_source TEXT DEFAULT 'web';

CREATE INDEX IF NOT EXISTS users_customer_code_idx ON sport_center.users(customer_code);
CREATE INDEX IF NOT EXISTS users_phone_idx ON sport_center.users(phone);

-- ==========================================================
-- Company verification tables
-- ==========================================================
DO $$ BEGIN
  CREATE TYPE sport_center.company_verification_status AS ENUM ('pending', 'approved', 'rejected', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sport_center.company_users (
  id                        serial PRIMARY KEY,
  company_id                integer NOT NULL REFERENCES sport_center.users(id) ON DELETE CASCADE,
  customer_id               integer NOT NULL REFERENCES sport_center.users(id) ON DELETE CASCADE,
  employee_id               text NOT NULL,
  office_email              text,
  id_card_url               text,
  verification_status       sport_center.company_verification_status NOT NULL DEFAULT 'pending',
  corporate_billing_enabled boolean NOT NULL DEFAULT false,
  verified_at               timestamptz,
  verified_by               integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  rejection_reason          text,
  requested_at              timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_users_company_employee_unique UNIQUE (company_id, employee_id)
);

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

CREATE TABLE IF NOT EXISTS sport_center.company_verification_tokens (
  id              serial PRIMARY KEY,
  token           text NOT NULL UNIQUE,
  verification_id integer NOT NULL REFERENCES sport_center.company_verifications(id) ON DELETE CASCADE,
  action          text NOT NULL,
  used_at         timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_users_company_id ON sport_center.company_users(company_id);
CREATE INDEX IF NOT EXISTS idx_company_users_customer_id ON sport_center.company_users(customer_id);
CREATE INDEX IF NOT EXISTS idx_company_verifications_customer_id ON sport_center.company_verifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_company_verifications_company_id ON sport_center.company_verifications(company_id);
CREATE INDEX IF NOT EXISTS idx_company_verifications_status ON sport_center.company_verifications(status);
CREATE INDEX IF NOT EXISTS idx_company_verification_tokens_token ON sport_center.company_verification_tokens(token);

-- ==========================================================
-- accounting_journals (jika belum ada dari migrate.ts)
-- ==========================================================
CREATE TABLE IF NOT EXISTS sport_center.accounting_journals (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES sport_center.bookings(id) ON DELETE CASCADE,
  order_number text NOT NULL,
  journal_type text NOT NULL,
  debit_account text NOT NULL DEFAULT 'Kas/Bank',
  debit_amount numeric(14,2) NOT NULL,
  credit_revenue_account text NOT NULL DEFAULT 'Pendapatan Sport Center',
  credit_revenue_amount numeric(14,2) NOT NULL,
  credit_ppn_account text NOT NULL DEFAULT 'PPN Keluaran',
  credit_ppn_amount numeric(14,2) NOT NULL DEFAULT 0,
  journal_date text NOT NULL,
  is_reversal boolean NOT NULL DEFAULT false,
  reversal_of_id integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounting_journals_booking_id_idx ON sport_center.accounting_journals(booking_id);
CREATE INDEX IF NOT EXISTS accounting_journals_journal_date_idx ON sport_center.accounting_journals(journal_date DESC);

-- ==========================================================
-- company_invoice_items (jika belum ada)
-- ==========================================================
CREATE TABLE IF NOT EXISTS sport_center.company_invoice_items (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES sport_center.company_invoices(id) ON DELETE CASCADE,
  booking_id integer,
  company_id integer,
  booking_date text,
  facility_name text,
  customer_name text,
  customer_phone text,
  start_time text,
  end_time text,
  duration_hours numeric(6,2),
  price_per_hour numeric(12,2),
  subtotal numeric(14,2),
  tax_amount numeric(14,2),
  total_amount numeric(14,2),
  order_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_invoice_items_invoice_id_idx ON sport_center.company_invoice_items(invoice_id);
`;

async function main() {
  await client.connect();
  console.log("🔗 Connected to PRODUCTION database. Running migrations...");
  try {
    await client.query(SQL);
    console.log("✅ All migrations completed successfully!");
    console.log("   - ppn_rate / ppn_amount / grand_total on bookings");
    console.log("   - tax_settings + tax_transactions");
    console.log("   - wa_action_tokens");
    console.log("   - WA settings columns on settings");
    console.log("   - customer_code / registration_source on users");
    console.log("   - company_users / company_verifications / company_verification_tokens");
    console.log("   - accounting_journals");
    console.log("   - company_invoice_items");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
