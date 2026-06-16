import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureDefaultTemplates } from "./lib/seedTemplates";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * validateProductionEnv — runs BEFORE server listens.
 * Fails fast on missing critical secrets in production.
 * In development: only warns, never exits.
 */
function validateProductionEnv(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  const fatal: string[] = [];
  const warn: string[] = [];

  // Critical — DB
  if (!process.env.SUPABASE_DATABASE_URL) {
    fatal.push("SUPABASE_DATABASE_URL is not set — production DB unreachable");
  }

  // Critical — Storage
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fatal.push("SUPABASE_SERVICE_ROLE_KEY is not set — file uploads will fail");
  }

  // Soft — Realtime (no-op allowed, but must be explicit)
  if (!process.env.SUPABASE_URL) {
    warn.push("SUPABASE_URL not set — realtime availability broadcasts are no-ops");
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    warn.push("SUPABASE_ANON_KEY not set — realtime availability broadcasts are no-ops");
  }

  // Banned flags in production
  if (process.env.ALLOW_DEV_ON_PROD_DB === "true") {
    fatal.push("ALLOW_DEV_ON_PROD_DB=true must NEVER be set in production");
  }
  if (process.env.ALLOW_DEV_ON_PROD_STORAGE === "true") {
    fatal.push("ALLOW_DEV_ON_PROD_STORAGE=true must NEVER be set in production");
  }
  if (process.env.SUPABASE_DATABASE_URL_DEV) {
    warn.push("SUPABASE_DATABASE_URL_DEV is set in production env — this var is for development only");
  }

  for (const w of warn) {
    logger.warn(`[prod-env] ${w}`);
  }

  if (fatal.length > 0) {
    logger.error(
      { missing: fatal },
      "[prod-env] FATAL: Production environment is missing required variables. Refusing to start."
    );
    for (const f of fatal) {
      logger.error(`[prod-env] ✗ ${f}`);
    }
    process.exit(1);
  }

  logger.info("[prod-env] Production environment validation passed.");
}

async function runStartupMigrations() {
  // Jalankan setiap migration secara terpisah — ADD VALUE harus di luar transaksi
  const migrations = [
    // Buat schema jika belum ada (idempotent)
    `CREATE SCHEMA IF NOT EXISTS sport_center`,
    // Enums — DO $$ pakai EXCEPTION agar tidak error jika sudah ada
    `DO $$ BEGIN
       CREATE TYPE sport_center.bank_mutation_status AS ENUM (
         'unmatched','need_review','auto_matched','matched','duplicate_need_review','approved','rejected'
       );
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
       CREATE TYPE sport_center.recon_match_status AS ENUM ('candidate','approved','rejected');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
       CREATE TYPE sport_center.recon_candidate_type AS ENUM ('payment','order','invoice','expense');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    // Tambah nilai enum baru jika belum ada
    `DO $$ BEGIN
       ALTER TYPE sport_center.bank_mutation_status ADD VALUE IF NOT EXISTS 'auto_matched';
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
       ALTER TYPE sport_center.bank_mutation_status ADD VALUE IF NOT EXISTS 'need_review';
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    // Tabel utama rekonsiliasi bank
    `CREATE TABLE IF NOT EXISTS sport_center.bank_account_balances (
       id serial PRIMARY KEY,
       bank_account_id text NOT NULL,
       company_id int,
       opening_balance numeric(14,2) NOT NULL DEFAULT 0,
       current_balance numeric(14,2) NOT NULL DEFAULT 0,
       last_reconciled_balance numeric(14,2) DEFAULT 0,
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS sport_center.bank_mutations (
       id serial PRIMARY KEY,
       company_id int,
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
       matched_payment_id int,
       matched_order_id int,
       uploaded_proof_url text,
       transaction_type text,
       tax_type text,
       tax_period text,
       tax_payment_reference text,
       accounting_posted boolean NOT NULL DEFAULT false,
       journal_id text,
       approved_by text,
       approved_at timestamptz,
       rejected_by text,
       rejected_at timestamptz,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS sport_center.bank_reconciliation_matches (
       id serial PRIMARY KEY,
       mutation_id int NOT NULL REFERENCES sport_center.bank_mutations(id) ON DELETE CASCADE,
       candidate_type sport_center.recon_candidate_type NOT NULL,
       candidate_id int NOT NULL,
       match_score int NOT NULL DEFAULT 0,
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
       created_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS sport_center.bank_journal_entries (
       id serial PRIMARY KEY,
       company_id int,
       journal_id text UNIQUE NOT NULL,
       mutation_id int NOT NULL REFERENCES sport_center.bank_mutations(id) ON DELETE CASCADE,
       direction text NOT NULL,
       amount numeric(14,2) NOT NULL,
       debit_account_code text NOT NULL,
       debit_account_name text NOT NULL,
       credit_account_code text NOT NULL,
       credit_account_name text NOT NULL,
       memo text,
       candidate_type text,
       candidate_id int,
       posted_at timestamptz NOT NULL DEFAULT NOW(),
       posted_by text
     )`,
    `CREATE TABLE IF NOT EXISTS sport_center.bank_reconciliation_account_rules (
       id serial PRIMARY KEY,
       company_id int,
       bank_account_id text,
       transaction_type text NOT NULL,
       direction text NOT NULL,
       debit_coa_id text NOT NULL,
       debit_coa_name text NOT NULL,
       credit_coa_id text NOT NULL,
       credit_coa_name text NOT NULL,
       is_active boolean NOT NULL DEFAULT true,
       created_by text,
       updated_by text,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS sport_center.bank_reconciliation_closing (
       id serial PRIMARY KEY,
       company_id int,
       bank_account_id text,
       period_year int NOT NULL,
       period_month int NOT NULL,
       opening_balance numeric(14,2) NOT NULL DEFAULT 0,
       total_in numeric(14,2) NOT NULL DEFAULT 0,
       total_out numeric(14,2) NOT NULL DEFAULT 0,
       system_ending_balance numeric(14,2) NOT NULL DEFAULT 0,
       statement_ending_balance numeric(14,2) NOT NULL DEFAULT 0,
       difference numeric(14,2) NOT NULL DEFAULT 0,
       status text NOT NULL DEFAULT 'unreconciled',
       closed_by text,
       closed_at timestamptz,
       reopened_by text,
       reopened_at timestamptz,
       notes text,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // Kolom lama (idempotent)
    `ALTER TABLE sport_center.bank_reconciliation_matches
       ADD COLUMN IF NOT EXISTS status_valid_match boolean NOT NULL DEFAULT false`,
    `ALTER TABLE sport_center.bank_reconciliation_matches
       ADD COLUMN IF NOT EXISTS tolerance_used boolean NOT NULL DEFAULT false`,
    `ALTER TABLE sport_center.bank_reconciliation_matches
       ADD COLUMN IF NOT EXISTS note text`,
    // Tambah nilai enum baru — ALTER TYPE ADD VALUE tidak bisa di dalam transaksi eksplisit
    // IF NOT EXISTS mencegah error jika sudah ada
    `DO $$ BEGIN
       ALTER TYPE sport_center.bank_mutation_status ADD VALUE IF NOT EXISTS 'auto_matched';
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
       ALTER TYPE sport_center.bank_mutation_status ADD VALUE IF NOT EXISTS 'need_review';
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    // Indexes untuk performa query filter, duplicate detection, dan scheduler guard
    `CREATE INDEX IF NOT EXISTS idx_bank_mutations_status
       ON sport_center.bank_mutations (status)`,
    `CREATE INDEX IF NOT EXISTS idx_bank_mutations_transaction_date
       ON sport_center.bank_mutations (transaction_date)`,
    `CREATE INDEX IF NOT EXISTS idx_bank_mutations_mutation_key
       ON sport_center.bank_mutations (mutation_key)`,
    `CREATE INDEX IF NOT EXISTS idx_bank_mutations_status_date
       ON sport_center.bank_mutations (status, transaction_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_recon_matches_mutation_id
       ON sport_center.bank_reconciliation_matches (mutation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recon_matches_status
       ON sport_center.bank_reconciliation_matches (status)`,
    `CREATE INDEX IF NOT EXISTS idx_recon_matches_candidate
       ON sport_center.bank_reconciliation_matches (candidate_type, candidate_id)`,
    // Kolom baru bank_mutations: accounting + approval tracking
    `ALTER TABLE sport_center.bank_mutations
       ADD COLUMN IF NOT EXISTS accounting_posted boolean NOT NULL DEFAULT false`,
    `ALTER TABLE sport_center.bank_mutations
       ADD COLUMN IF NOT EXISTS journal_id text`,
    `ALTER TABLE sport_center.bank_mutations
       ADD COLUMN IF NOT EXISTS approved_by text`,
    `ALTER TABLE sport_center.bank_mutations
       ADD COLUMN IF NOT EXISTS approved_at timestamptz`,
    `ALTER TABLE sport_center.bank_mutations
       ADD COLUMN IF NOT EXISTS rejected_by text`,
    `ALTER TABLE sport_center.bank_mutations
       ADD COLUMN IF NOT EXISTS rejected_at timestamptz`,
    // Tabel jurnal akuntansi
    `CREATE TABLE IF NOT EXISTS sport_center.bank_journal_entries (
       id serial PRIMARY KEY,
       journal_id text UNIQUE NOT NULL,
       mutation_id int NOT NULL REFERENCES sport_center.bank_mutations(id) ON DELETE CASCADE,
       direction text NOT NULL,
       amount numeric(14,2) NOT NULL,
       debit_account_code text NOT NULL,
       debit_account_name text NOT NULL,
       credit_account_code text NOT NULL,
       credit_account_name text NOT NULL,
       memo text,
       candidate_type text,
       candidate_id int,
       posted_at timestamptz NOT NULL DEFAULT NOW(),
       posted_by text
     )`,
    `CREATE INDEX IF NOT EXISTS idx_bank_journal_entries_mutation
       ON sport_center.bank_journal_entries (mutation_id)`,
    // Kolom OCR pada payments
    `ALTER TABLE sport_center.payments
       ADD COLUMN IF NOT EXISTS ocr_name text`,
    `ALTER TABLE sport_center.payments
       ADD COLUMN IF NOT EXISTS ocr_amount numeric(14,2)`,
    `ALTER TABLE sport_center.payments
       ADD COLUMN IF NOT EXISTS ocr_date text`,
    `ALTER TABLE sport_center.payments
       ADD COLUMN IF NOT EXISTS ocr_raw text`,
    `ALTER TABLE sport_center.payments
       ADD COLUMN IF NOT EXISTS ocr_data jsonb`,
    // Enum billing_status untuk bookings
    `DO $$ BEGIN
       CREATE TYPE sport_center.billing_status AS ENUM ('unbilled','billed','paid');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    // Kolom-kolom baru pada bookings (idempotent)
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS booked_for_name text`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS booked_for_phone text`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS payment_required_now boolean DEFAULT true`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS billing_status sport_center.billing_status`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS company_invoice_id int`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS ppn_rate numeric(5,2)`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS ppn_amount numeric(12,2)`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS grand_total numeric(12,2)`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS down_payment numeric(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS is_dp_paid boolean NOT NULL DEFAULT false`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS booked_by_user_id int`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS group_ref text`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS approved_by_admin_phone text`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS approved_at timestamptz`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS rejected_reason text`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS paid_at timestamptz`,
    // ── Tabel-tabel yang belum ada di prod ─────────────────────────────────────
    // booking_groups
    `DO $$ BEGIN
       CREATE TYPE sport_center.booking_group_status AS ENUM ('pending','paid');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `CREATE TABLE IF NOT EXISTS sport_center.booking_groups (
       id serial PRIMARY KEY,
       group_ref text NOT NULL UNIQUE,
       customer_phone text NOT NULL,
       customer_name text NOT NULL,
       total_payment numeric(12,2) NOT NULL,
       status sport_center.booking_group_status NOT NULL DEFAULT 'pending',
       notes text,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // wa_booking_sessions
    `CREATE TABLE IF NOT EXISTS sport_center.wa_booking_sessions (
       id serial PRIMARY KEY,
       phone text NOT NULL,
       customer_id int,
       current_step text NOT NULL DEFAULT 'ask_facility',
       facility_id int,
       booking_date text,
       start_time text,
       duration_minutes int,
       customer_name text,
       notes text,
       status text NOT NULL DEFAULT 'active',
       raw_messages jsonb NOT NULL DEFAULT '[]',
       expired_at timestamptz NOT NULL,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    `ALTER TABLE sport_center.wa_booking_sessions
       ADD COLUMN IF NOT EXISTS notes text`,
    `ALTER TABLE sport_center.wa_booking_sessions
       ADD COLUMN IF NOT EXISTS booker_name text`,
    `ALTER TABLE sport_center.bookings
       ADD COLUMN IF NOT EXISTS booker_name text`,
    // wa_blocked_phones — spam protection
    `CREATE TABLE IF NOT EXISTS sport_center.wa_blocked_phones (
       id serial PRIMARY KEY,
       phone text NOT NULL UNIQUE,
       reason text,
       blocked_by text,
       is_active boolean NOT NULL DEFAULT true,
       expires_at timestamptz,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // wa_action_tokens
    `CREATE TABLE IF NOT EXISTS sport_center.wa_action_tokens (
       id serial PRIMARY KEY,
       token text NOT NULL UNIQUE,
       booking_id int NOT NULL REFERENCES sport_center.bookings(id) ON DELETE CASCADE,
       action text NOT NULL,
       used_at timestamptz,
       expires_at timestamptz,
       created_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // notification_templates
    `CREATE TABLE IF NOT EXISTS sport_center.notification_templates (
       id serial PRIMARY KEY,
       key text NOT NULL UNIQUE,
       name text NOT NULL,
       channel text NOT NULL DEFAULT 'whatsapp',
       subject text,
       body text NOT NULL,
       is_active boolean NOT NULL DEFAULT true,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // tax_settings
    `CREATE TABLE IF NOT EXISTS sport_center.tax_settings (
       id serial PRIMARY KEY,
       tax_code text NOT NULL UNIQUE,
       tax_name text NOT NULL,
       tax_rate numeric(5,2) NOT NULL,
       tax_type text NOT NULL DEFAULT 'output_vat',
       applies_to text NOT NULL DEFAULT 'sport_center_booking',
       is_active boolean NOT NULL DEFAULT true,
       effective_date text,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // tax_transactions
    `CREATE TABLE IF NOT EXISTS sport_center.tax_transactions (
       id serial PRIMARY KEY,
       reference_type text NOT NULL,
       reference_id int NOT NULL,
       reference_number text NOT NULL,
       tax_code text NOT NULL,
       tax_rate numeric(5,2) NOT NULL,
       dpp numeric(14,2) NOT NULL,
       tax_amount numeric(14,2) NOT NULL,
       transaction_date text NOT NULL,
       status text NOT NULL DEFAULT 'posted',
       transaction_type text NOT NULL DEFAULT 'original',
       reversal_of_id int,
       created_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // invoice_status enum + company_invoices + company_invoice_items
    `DO $$ BEGIN
       CREATE TYPE sport_center.invoice_status AS ENUM ('unpaid','partial_paid','paid');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `CREATE TABLE IF NOT EXISTS sport_center.company_invoices (
       id serial PRIMARY KEY,
       invoice_number text NOT NULL UNIQUE,
       company_customer_id int NOT NULL,
       period_month text NOT NULL,
       total_amount numeric(14,2) NOT NULL DEFAULT 0,
       ppn_amount numeric(14,2) NOT NULL DEFAULT 0,
       grand_total numeric(14,2) NOT NULL DEFAULT 0,
       paid_amount numeric(14,2) NOT NULL DEFAULT 0,
       remaining_amount numeric(14,2) NOT NULL DEFAULT 0,
       invoice_status sport_center.invoice_status NOT NULL DEFAULT 'unpaid',
       paid_at timestamptz,
       notes text,
       created_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS company_invoices_company_period_unique
       ON sport_center.company_invoices (company_customer_id, period_month)`,
    `CREATE TABLE IF NOT EXISTS sport_center.company_invoice_items (
       id serial PRIMARY KEY,
       invoice_id int NOT NULL REFERENCES sport_center.company_invoices(id) ON DELETE CASCADE,
       booking_id int,
       company_id int,
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
       created_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // Seed tax_settings jika kosong
    `INSERT INTO sport_center.tax_settings (tax_code, tax_name, tax_rate, tax_type, applies_to, is_active)
     SELECT 'PPN_OUT_11','PPN Keluaran 11%',11,'output_vat','sport_center_booking',false
     WHERE NOT EXISTS (SELECT 1 FROM sport_center.tax_settings WHERE tax_code = 'PPN_OUT_11')`,
    // payment_type enum untuk DP flow
    `DO $$ BEGIN
       CREATE TYPE sport_center.payment_type AS ENUM ('dp', 'pelunasan', 'full_payment');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `ALTER TABLE sport_center.payments
       ADD COLUMN IF NOT EXISTS payment_type sport_center.payment_type NOT NULL DEFAULT 'full_payment'`,
    // Hapus unique constraint booking_id agar bisa ada multiple payments per booking
    `ALTER TABLE sport_center.payments
       DROP CONSTRAINT IF EXISTS payments_booking_id_unique`,
    // expense_status enum
    `DO $$ BEGIN
       CREATE TYPE sport_center.expense_status AS ENUM ('draft','pending_approval','approved','paid','rejected','cancelled');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    // expense_category enum
    `DO $$ BEGIN
       CREATE TYPE sport_center.expense_category AS ENUM ('Alat Gym','Bola & Peralatan Olahraga','Perbaikan Lapangan','Maintenance Fasilitas','Listrik & Air','Kebersihan','Gaji / Fee Staff','Sewa / Vendor','Lain-lain');
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    // sport_expenses table
    `CREATE TABLE IF NOT EXISTS sport_center.sport_expenses (
       id serial PRIMARY KEY,
       expense_no text NOT NULL,
       expense_date text NOT NULL,
       category sport_center.expense_category NOT NULL,
       description text NOT NULL,
       vendor_name text,
       facility_id int REFERENCES sport_center.facilities(id) ON DELETE SET NULL,
       amount numeric(14,2) NOT NULL,
       ppn_amount numeric(14,2) NOT NULL DEFAULT 0,
       total_amount numeric(14,2) NOT NULL,
       payment_method text,
       payment_account text,
       payment_status sport_center.expense_status NOT NULL DEFAULT 'draft',
       receipt_url text,
       notes text,
       created_by int REFERENCES sport_center.users(id) ON DELETE SET NULL,
       approved_by int REFERENCES sport_center.users(id) ON DELETE SET NULL,
       approved_at timestamptz,
       paid_at timestamptz,
       rejected_reason text,
       journal_id text,
       created_at timestamptz NOT NULL DEFAULT NOW(),
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    // sequence for expense_no
    `CREATE SEQUENCE IF NOT EXISTS sport_center.expense_no_seq`,
    // accounting_journals.booking_id nullable untuk expense journal entries
    `ALTER TABLE sport_center.accounting_journals ALTER COLUMN booking_id DROP NOT NULL`,
  ];

  for (const stmt of migrations) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (err) {
      logger.warn({ err, stmt: stmt.slice(0, 80) }, "Startup migration warning (non-fatal)");
    }
  }
  logger.info("Startup migrations OK");
}

// Run BEFORE listening — fails fast in production if env is incomplete
validateProductionEnv();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  runStartupMigrations().catch(() => {});
  startScheduler();
  ensureDefaultTemplates().catch(() => {});

  // Validate Supabase Storage buckets at startup
  import("./lib/supabaseStorage").then(({ validateBuckets }) => {
    validateBuckets().catch((err) =>
      logger.warn({ err }, "Storage bucket validation failed (non-fatal)")
    );
  });
});
