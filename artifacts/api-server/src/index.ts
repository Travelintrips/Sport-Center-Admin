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

async function runStartupMigrations() {
  // Jalankan setiap migration secara terpisah — ADD VALUE harus di luar transaksi
  const migrations = [
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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  runStartupMigrations().catch(() => {});
  startScheduler();
  ensureDefaultTemplates().catch(() => {});
});
