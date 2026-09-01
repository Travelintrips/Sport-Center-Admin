import pg from "pg";
const { Client } = pg;

const rawUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  "";
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

await client.connect();
console.log("Connected");

const stmts = [
  // WA admin columns
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS approved_by_admin_phone text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS approved_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS rejected_reason text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS paid_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS booker_name text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS booking_type text NOT NULL DEFAULT 'regular'`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS event_discount_amount numeric(12,2)`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS invoice_pdf_url text`,
  // user account type
  `DO $$ BEGIN CREATE TYPE sport_center.user_account_type AS ENUM ('personal','company'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE sport_center.payer_type AS ENUM ('personal','company'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE sport_center.billing_status AS ENUM ('unbilled','billed','paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  // users columns
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS account_type sport_center.user_account_type DEFAULT 'personal'`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS company_name text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS pic_name text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS pic_phone text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS pic_email text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS billing_address text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS allow_monthly_billing boolean NOT NULL DEFAULT false`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS company_tax_id text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS payment_terms_days integer DEFAULT 30`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS monthly_credit_limit numeric(14,2)`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active'`,
  `ALTER TABLE sport_center.users ALTER COLUMN email DROP NOT NULL`,
  `ALTER TABLE sport_center.users ALTER COLUMN password_hash DROP NOT NULL`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS google_id text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS registration_source text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS customer_code text`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS tenant_id integer`,
  `ALTER TABLE sport_center.users ADD COLUMN IF NOT EXISTS require_per_booking_approval boolean NOT NULL DEFAULT false`,
  // settings columns used by the current Drizzle schema
  `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS fonnte_token text`,
  `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS fonnte_customer_token text`,
  `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS fonnte_admin_wa text`,
  `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS admin_wa_phones text`,
  `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS app_url text`,
  `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS payment_domain text`,
  `ALTER TABLE sport_center.sport_settings ADD COLUMN IF NOT EXISTS payment_deadline_hours text DEFAULT '24'`,
  // bookings more columns
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS payer_type sport_center.payer_type DEFAULT 'personal'`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS company_customer_id integer`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS booked_for_name text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS booked_for_phone text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS payment_required_now boolean DEFAULT true`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS billing_status sport_center.billing_status`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS company_invoice_id integer`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS booked_by_user_id integer`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS resource_name text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS payment_deadline timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS checked_in_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS completed_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS reminder_h1_sent_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS reminder_day_sent_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS payment_reminder_sent_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS group_ref text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS ppn_rate numeric(5,2)`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS ppn_amount numeric(14,2)`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS grand_total numeric(14,2)`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS down_payment numeric(12,2)`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS is_dp_paid boolean DEFAULT false`,
  // payments
  `DO $$ BEGIN CREATE TYPE sport_center.payment_provider AS ENUM ('mandiri_direct','paylabs','unknown'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'Transfer Bank'`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS confirmed_at timestamptz`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS payment_provider sport_center.payment_provider`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS provider_reference text`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS provider_id text`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS provider_name text`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS provider_order_id text`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS merchant_trade_no text`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS provider_trade_no text`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS paid_at timestamptz`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS mdr_rate numeric(8,5) NOT NULL DEFAULT 0`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS mdr_amount numeric(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'unsettled'`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS expected_settlement_date text`,
  `ALTER TABLE sport_center.sport_payments ADD COLUMN IF NOT EXISTS gross_tax_inclusive boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS sport_center.sport_payment_allocations (
     id serial PRIMARY KEY,
     payment_id integer NOT NULL REFERENCES sport_center.sport_payments(id) ON DELETE CASCADE,
     booking_id integer NOT NULL REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE,
     amount numeric(14,2) NOT NULL CHECK (amount > 0),
     created_at timestamptz NOT NULL DEFAULT NOW(),
     CONSTRAINT sport_payment_allocations_payment_booking_unique UNIQUE (payment_id, booking_id)
   )`,
  `CREATE INDEX IF NOT EXISTS sport_payment_allocations_booking_idx
     ON sport_center.sport_payment_allocations (booking_id)`,
  // confirmed payment journals are finalized, not drafts
  `ALTER TABLE sport_center.accounting_journals ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted'`,
  `ALTER TABLE sport_center.accounting_journals
      ADD COLUMN IF NOT EXISTS provider_name text,
      ADD COLUMN IF NOT EXISTS provider_id text,
      ADD COLUMN IF NOT EXISTS expected_settlement_date text,
      ADD COLUMN IF NOT EXISTS settlement_status text,
      ADD COLUMN IF NOT EXISTS mdr_rate numeric(8,5),
      ADD COLUMN IF NOT EXISTS mdr_amount numeric(14,2)`,
  `UPDATE sport_center.accounting_journals aj
      SET provider_name = sp.provider_name,
          provider_id = sp.provider_id,
          expected_settlement_date = sp.expected_settlement_date,
          settlement_status = sp.settlement_status,
          mdr_rate = sp.mdr_rate,
          mdr_amount = sp.mdr_amount
     FROM sport_center.sport_payments sp
    WHERE aj.payment_id = sp.id
      AND aj.journal_type = 'payment_confirmed'
      AND aj.is_reversal = false`,
  `ALTER TABLE sport_center.accounting_journals ALTER COLUMN status SET DEFAULT 'posted'`,
  `UPDATE sport_center.accounting_journals
      SET status = 'posted'
    WHERE journal_type = 'payment_confirmed'
      AND is_reversal = false
      AND status IS DISTINCT FROM 'posted'`,
  // tenant_bookings period
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS payment_period_type text NOT NULL DEFAULT 'monthly'`,
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS period_start_month integer`,
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS period_start_year integer`,
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS period_end_month integer`,
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS period_end_year integer`,
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS total_months integer`,
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS monthly_price numeric(12,2)`,
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS yearly_price numeric(12,2)`,
  `ALTER TABLE sport_center.tenant_bookings ADD COLUMN IF NOT EXISTS total_price numeric(12,2)`,
  `ALTER TABLE sport_center.tenant_bookings ALTER COLUMN start_date DROP NOT NULL`,
  `ALTER TABLE sport_center.tenant_bookings ALTER COLUMN end_date DROP NOT NULL`,
  // facilities extra
  `ALTER TABLE sport_center.sport_facilities ADD COLUMN IF NOT EXISTS category text`,
  `ALTER TABLE sport_center.sport_facilities ADD COLUMN IF NOT EXISTS image_url text`,
  `ALTER TABLE sport_center.sport_facilities ADD COLUMN IF NOT EXISTS images jsonb`,
  // company_invoices table
  `CREATE TABLE IF NOT EXISTS sport_center.company_invoices (
    id serial PRIMARY KEY,
    invoice_number text NOT NULL UNIQUE,
    company_customer_id integer NOT NULL,
    period_month text NOT NULL,
    total_amount numeric(14,2) NOT NULL DEFAULT 0,
    ppn_amount numeric(14,2) NOT NULL DEFAULT 0,
    grand_total numeric(14,2) NOT NULL DEFAULT 0,
    paid_amount numeric(14,2) NOT NULL DEFAULT 0,
    remaining_amount numeric(14,2) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'unpaid',
    notes text,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  // tax tables
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
  `CREATE TABLE IF NOT EXISTS sport_center.tax_transactions (
    id serial PRIMARY KEY,
    reference_type text NOT NULL,
    reference_id integer NOT NULL,
    reference_number text NOT NULL,
    tax_code text NOT NULL,
    tax_rate numeric(5,2) NOT NULL,
    dpp numeric(14,2) NOT NULL,
    tax_amount numeric(14,2) NOT NULL,
    transaction_date text NOT NULL,
    status text NOT NULL DEFAULT 'posted',
    transaction_type text NOT NULL DEFAULT 'original',
    reversal_of_id integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // bank recon
  `DO $$ BEGIN CREATE TYPE sport_center.bank_mutation_status AS ENUM ('unmatched','need_review','auto_matched','matched','duplicate_need_review','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE sport_center.recon_match_status AS ENUM ('candidate','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE sport_center.recon_candidate_type AS ENUM ('payment','order','invoice','expense'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS sport_center.bank_mutations (
    id serial PRIMARY KEY,
    bank_account_id text,
    transaction_date text NOT NULL,
    description text NOT NULL,
    credit_amount numeric(14,2) DEFAULT 0,
    debit_amount numeric(14,2) DEFAULT 0,
    amount numeric(14,2) NOT NULL,
    direction text NOT NULL,
    mutation_key text NOT NULL,
    normalized_description text,
    provider_name text,
    provider_order_id text,
    raw_payload jsonb,
    status sport_center.bank_mutation_status NOT NULL DEFAULT 'unmatched',
    matched_payment_id integer,
    matched_order_id integer,
    uploaded_proof_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sport_center.bank_reconciliation_matches (
    id serial PRIMARY KEY,
    mutation_id integer NOT NULL REFERENCES sport_center.bank_mutations(id) ON DELETE CASCADE,
    candidate_type sport_center.recon_candidate_type NOT NULL,
    candidate_id integer NOT NULL,
    match_score integer NOT NULL DEFAULT 0,
    match_reason text,
    amount_match boolean NOT NULL DEFAULT false,
    date_match boolean NOT NULL DEFAULT false,
    name_match boolean NOT NULL DEFAULT false,
    order_id_match boolean NOT NULL DEFAULT false,
    proof_match boolean NOT NULL DEFAULT false,
    status_valid_match boolean NOT NULL DEFAULT false,
    tolerance_used boolean NOT NULL DEFAULT false,
    note text,
    status sport_center.recon_match_status NOT NULL DEFAULT 'candidate',
    ocr_amount text,
    ocr_name text,
    ocr_date text,
    ocr_raw text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // wa_action_tokens
  `CREATE TABLE IF NOT EXISTS sport_center.wa_action_tokens (
    id serial PRIMARY KEY,
    token text NOT NULL UNIQUE,
    booking_id integer NOT NULL,
    action text NOT NULL,
    used_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // seed admin  
  `INSERT INTO sport_center.sport_settings (center_name, address, phone, whatsapp, email) VALUES ('Sport Center Dev','Jakarta','021-000000','08000000000','admin@sportcenter.com') ON CONFLICT DO NOTHING`,
  `INSERT INTO sport_center.sport_facilities (name, category, description, price_per_hour, open_time, close_time, is_active)
   SELECT 'Lapangan Futsal A','futsal','Lapangan futsal indoor',150000,'06:00','22:00',true
   WHERE NOT EXISTS (
     SELECT 1 FROM sport_center.sport_facilities WHERE name = 'Lapangan Futsal A'
   )`,
];

let ok = 0, fail = 0;
for (const s of stmts) {
  try { await client.query(s); ok++; } catch(e: any) { fail++; /* idempotent fails expected */ }
}
console.log(`Applied: ${ok} ok, ${fail} skipped (already exist or idempotent)`);
await client.end();
