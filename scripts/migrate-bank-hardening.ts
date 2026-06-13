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
-- FASE 1: Partial Payment & Invoice Settlement
-- ============================================================

-- Extend invoice_status enum
DO $$ BEGIN
  ALTER TYPE sport_center.invoice_status ADD VALUE IF NOT EXISTS 'partial_paid';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add paid_amount, remaining_amount to company_invoices
ALTER TABLE sport_center.company_invoices
  ADD COLUMN IF NOT EXISTS paid_amount  numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount numeric(14,2) NOT NULL DEFAULT 0;

-- Backfill existing paid invoices
UPDATE sport_center.company_invoices
SET
  paid_amount      = grand_total,
  remaining_amount = 0
WHERE invoice_status = 'paid'
  AND paid_amount = 0;

-- Backfill remaining_amount for unpaid invoices
UPDATE sport_center.company_invoices
SET remaining_amount = grand_total - paid_amount
WHERE remaining_amount = 0 AND invoice_status != 'paid';

-- ============================================================
-- FASE 2: Dynamic COA Mapping — bank_reconciliation_account_rules
-- ============================================================

CREATE TABLE IF NOT EXISTS sport_center.bank_reconciliation_account_rules (
  id                serial PRIMARY KEY,
  company_id        integer,
  bank_account_id   text,
  transaction_type  text NOT NULL,
  direction         text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  debit_coa_id      text NOT NULL,
  debit_coa_name    text NOT NULL,
  credit_coa_id     text NOT NULL,
  credit_coa_name   text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        text,
  updated_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Seed default COA rules mirroring existing ACCOUNT_MAP
INSERT INTO sport_center.bank_reconciliation_account_rules
  (transaction_type, direction, debit_coa_id, debit_coa_name, credit_coa_id, credit_coa_name, created_by)
VALUES
  ('payment',      'IN',  '1001', 'Kas/Bank',             '4001', 'Pendapatan Booking',        'system'),
  ('order',        'IN',  '1001', 'Kas/Bank',             '4001', 'Pendapatan Booking',        'system'),
  ('invoice',      'IN',  '1001', 'Kas/Bank',             '1201', 'Piutang Usaha (AR)',        'system'),
  ('other_in',     'IN',  '1001', 'Kas/Bank',             '2001', 'Uang Muka Diterima',        'system'),
  ('BANK_FEE',     'OUT', '6001', 'Biaya Administrasi Bank','1001','Kas/Bank',                  'system'),
  ('REFUND',       'OUT', '2002', 'Refund Payable',        '1001', 'Kas/Bank',                  'system'),
  ('RENT_AP',      'OUT', '6003', 'Beban Sewa',            '1001', 'Kas/Bank',                  'system'),
  ('VENDOR_PAYMENT','OUT','6002', 'Beban Vendor/Pemasok',  '1001', 'Kas/Bank',                  'system'),
  ('OPERATIONAL',  'OUT', '6005', 'Beban Operasional',     '1001', 'Kas/Bank',                  'system'),
  ('TAX_PPN',      'OUT', '2101', 'Utang PPN',             '1001', 'Kas/Bank',                  'system'),
  ('TAX_PPH21',    'OUT', '2102', 'Utang PPh 21',          '1001', 'Kas/Bank',                  'system'),
  ('TAX_PPH23',    'OUT', '2103', 'Utang PPh 23',          '1001', 'Kas/Bank',                  'system'),
  ('TAX_PPH_FINAL','OUT', '2104', 'Utang PPh Final',       '1001', 'Kas/Bank',                  'system'),
  ('TAX_PPH_BADAN','OUT', '2105', 'Utang PPh Badan',       '1001', 'Kas/Bank',                  'system'),
  ('TAX_PAYMENT',  'OUT', '2003', 'Hutang Pajak',          '1001', 'Kas/Bank',                  'system'),
  ('OTHER',        'OUT', '6099', 'Beban Lain-lain',       '1001', 'Kas/Bank',                  'system')
ON CONFLICT DO NOTHING;

-- ============================================================
-- FASE 3: Tax fields on bank_mutations
-- ============================================================

ALTER TABLE sport_center.bank_mutations
  ADD COLUMN IF NOT EXISTS transaction_type       text,
  ADD COLUMN IF NOT EXISTS tax_type               text,
  ADD COLUMN IF NOT EXISTS tax_period             text,
  ADD COLUMN IF NOT EXISTS tax_payment_reference  text;

-- ============================================================
-- FASE 4: Monthly Bank Closing
-- ============================================================

CREATE TABLE IF NOT EXISTS sport_center.bank_reconciliation_closing (
  id                       serial PRIMARY KEY,
  company_id               integer,
  bank_account_id          text,
  period_year              integer NOT NULL,
  period_month             integer NOT NULL,
  opening_balance          numeric(14,2) NOT NULL DEFAULT 0,
  total_in                 numeric(14,2) NOT NULL DEFAULT 0,
  total_out                numeric(14,2) NOT NULL DEFAULT 0,
  system_ending_balance    numeric(14,2) NOT NULL DEFAULT 0,
  statement_ending_balance numeric(14,2) NOT NULL DEFAULT 0,
  difference               numeric(14,2) NOT NULL DEFAULT 0,
  status                   text NOT NULL DEFAULT 'unreconciled',
  closed_by                text,
  closed_at                timestamptz,
  reopened_by              text,
  reopened_at              timestamptz,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, period_year, period_month)
);
`;

async function main() {
  console.log("Connecting to DB...");
  await client.connect();
  console.log("Running Bank Hardening Migration...");
  await client.query(SQL);
  console.log("✅ Migration complete.");
  await client.end();
}

main().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
