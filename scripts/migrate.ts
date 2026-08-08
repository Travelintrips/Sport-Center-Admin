import pg from "pg";

const { Client } = pg;

export const CUSTOM_MIGRATION_SQL = `
-- ============================================================
-- 0. sport_vendors table (idempotent)
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.sport_vendors (
  id serial PRIMARY KEY,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add vendor_id FK to sport_expenses (idempotent)
ALTER TABLE sport_center.sport_expenses
  ADD COLUMN IF NOT EXISTS vendor_id integer REFERENCES sport_center.sport_vendors(id) ON DELETE SET NULL;

-- Add vendor_id FK to sport_bookings (idempotent)
ALTER TABLE sport_center.sport_bookings
  ADD COLUMN IF NOT EXISTS vendor_id integer REFERENCES sport_center.sport_vendors(id) ON DELETE SET NULL;


-- ============================================================
-- 1. Extend enums (safe, idempotent via IF NOT EXISTS)
-- ============================================================
DO $$ BEGIN
  ALTER TYPE sport_center.booking_status ADD VALUE IF NOT EXISTS 'waiting_confirmation';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE sport_center.booking_status ADD VALUE IF NOT EXISTS 'rejected';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE sport_center.booking_status ADD VALUE IF NOT EXISTS 'expired';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE sport_center.user_role ADD VALUE IF NOT EXISTS 'super_admin';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE sport_center.user_role ADD VALUE IF NOT EXISTS 'admin_booking';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE sport_center.user_role ADD VALUE IF NOT EXISTS 'finance';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE sport_center.user_role ADD VALUE IF NOT EXISTS 'staff';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Add new columns to bookings
-- ============================================================
ALTER TABLE sport_center.sport_bookings
  ADD COLUMN IF NOT EXISTS resource_name text,
  ADD COLUMN IF NOT EXISTS payment_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ============================================================
-- 3. booking_history
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.booking_history (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  changed_by_name text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.audit_logs (
  id serial PRIMARY KEY,
  user_id integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  user_name text,
  user_role text,
  action text NOT NULL,
  entity text,
  entity_id integer,
  before jsonb,
  after jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. pricing_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.pricing_rules (
  id serial PRIMARY KEY,
  facility_id integer REFERENCES sport_center.sport_facilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  rule_type text NOT NULL,
  day_type text,
  peak_start_time text,
  peak_end_time text,
  price_override numeric(12,2),
  price_addon numeric(12,2),
  price_multiplier numeric(5,3),
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. notification_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.notification_templates (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  subject text,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. maintenance_schedules
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.maintenance_schedules (
  id serial PRIMARY KEY,
  facility_id integer NOT NULL REFERENCES sport_center.sport_facilities(id) ON DELETE CASCADE,
  title text NOT NULL,
  maintenance_type text NOT NULL DEFAULT 'maintenance',
  start_date text NOT NULL,
  end_date text NOT NULL,
  start_time text,
  end_time text,
  all_day boolean NOT NULL DEFAULT false,
  reason text,
  created_by integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. reschedule_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.reschedule_requests (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE,
  requested_by integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  new_date text NOT NULL,
  new_start_time text NOT NULL,
  new_end_time text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 9. booking_reviews
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.booking_reviews (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE UNIQUE,
  facility_id integer NOT NULL REFERENCES sport_center.sport_facilities(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  reviewer_name text,
  is_public integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 10. booking_cancellations
-- ============================================================

CREATE TABLE IF NOT EXISTS sport_center.booking_cancellations (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE UNIQUE,
  cancelled_by text NOT NULL DEFAULT 'customer',
  cancelled_by_user_id integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  reason text,
  refund_amount numeric(12,2) NOT NULL DEFAULT 0,
  refund_status text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 11. Seed default notification templates
-- ============================================================
INSERT INTO sport_center.notification_templates (key, name, channel, body) VALUES
  ('booking_created', 'Booking Baru (Customer)', 'whatsapp', 
   'Halo {{customerName}}! Booking Anda berhasil dibuat.\n\nNomor Order: *{{orderNumber}}*\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\nJam: {{startTime}} - {{endTime}}\nTotal: Rp {{totalPrice}}\n\nSilakan lakukan pembayaran sebelum {{paymentDeadline}} ke:\nBank: {{bankName}}\nNo. Rek: {{bankAccount}}\na.n. {{bankAccountName}}\n\nKirim bukti transfer ke WA ini setelah membayar. Terima kasih!'),
  ('payment_reminder', 'Pengingat Pembayaran (Customer)', 'whatsapp',
   'Halo {{customerName}}, pengingat pembayaran untuk booking Anda.\n\nNomor Order: *{{orderNumber}}*\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\nTotal: Rp {{totalPrice}}\n\nBatas pembayaran: *{{paymentDeadline}}*\n\nJangan sampai expired ya! 🏃'),
  ('payment_confirmed', 'Pembayaran Dikonfirmasi (Customer)', 'whatsapp',
   'Halo {{customerName}}! Pembayaran Anda telah *dikonfirmasi*. ✅\n\nNomor Order: *{{orderNumber}}*\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\nJam: {{startTime}} - {{endTime}}\n\nSampai jumpa di Sport Center! 🏆'),
  ('booking_cancelled', 'Booking Dibatalkan (Customer)', 'whatsapp',
   'Halo {{customerName}}, booking Anda telah *dibatalkan*.\n\nNomor Order: *{{orderNumber}}*\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\n\nAlasan: {{reason}}\n\nJika ada pertanyaan hubungi kami. Terima kasih!'),
  ('booking_completed', 'Booking Selesai (Customer)', 'whatsapp',
   'Halo {{customerName}}! Booking Anda telah *selesai*. 🎉\n\nNomor Order: *{{orderNumber}}*\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\n\nTerima kasih telah menggunakan layanan kami! Berikan rating pengalaman Anda di: {{reviewUrl}}'),
  ('reminder_h1', 'Reminder H-1 Bermain (Customer)', 'whatsapp',
   'Halo {{customerName}}! Pengingat: Anda memiliki jadwal bermain *besok*. 🏓\n\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\nJam: {{startTime}} - {{endTime}}\n\nSampai jumpa besok!'),
  ('booking_expired', 'Booking Expired (Customer)', 'whatsapp',
   'Halo {{customerName}}, booking Anda telah *expired* karena melewati batas waktu pembayaran.\n\nNomor Order: *{{orderNumber}}*\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\n\nSilakan buat booking baru. Terima kasih!'),
  ('admin_new_booking', 'Booking Baru (Admin)', 'whatsapp',
   '🔔 *Booking Baru Masuk!*\n\nNomor Order: {{orderNumber}}\nCustomer: {{customerName}} ({{customerPhone}})\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\nJam: {{startTime}} - {{endTime}}\nTotal: Rp {{totalPrice}}\n\nCek di Admin Panel untuk konfirmasi.'),
  ('admin_payment_proof', 'Bukti Transfer Baru (Admin)', 'whatsapp',
   '💳 *Bukti Transfer Diterima!*\n\nNomor Order: {{orderNumber}}\nCustomer: {{customerName}}\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\nJumlah: Rp {{totalPrice}}\n\nSegera konfirmasi pembayaran di Admin Panel.'),
  ('admin_booking_expired', 'Booking Expired (Admin)', 'whatsapp',
   '⏰ *Booking Expired*\n\nNomor Order: {{orderNumber}}\nCustomer: {{customerName}}\nFasilitas: {{facilityName}}\nTanggal: {{bookingDate}}\n\nSlot sudah kembali tersedia.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 12. tenant_bookings period-based payment fields
-- ============================================================

ALTER TABLE sport_center.tenant_bookings
  ADD COLUMN IF NOT EXISTS payment_period_type text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS period_start_month integer,
  ADD COLUMN IF NOT EXISTS period_start_year integer,
  ADD COLUMN IF NOT EXISTS period_end_month integer,
  ADD COLUMN IF NOT EXISTS period_end_year integer,
  ADD COLUMN IF NOT EXISTS total_months integer,
  ADD COLUMN IF NOT EXISTS monthly_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS yearly_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS total_price numeric(12,2);

-- Make start_date and end_date nullable (they were NOT NULL before)
ALTER TABLE sport_center.tenant_bookings
  ALTER COLUMN start_date DROP NOT NULL,
  ALTER COLUMN end_date DROP NOT NULL;

-- ============================================================
-- 13. gym_memberships: payment flow columns + new enum values
-- ============================================================
DO $$ BEGIN
  ALTER TYPE sport_center.membership_status ADD VALUE IF NOT EXISTS 'pending_payment';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE sport_center.membership_status ADD VALUE IF NOT EXISTS 'waiting_confirmation';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE sport_center.sport_memberships
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_proof_url text;

-- ============================================================
-- 14. payments: payment_method + confirmed_at
-- ============================================================
DO $$ BEGIN
  CREATE TYPE sport_center.payment_provider AS ENUM ('mandiri_direct','paylabs','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE sport_center.sport_payments
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'Transfer Bank',
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_provider sport_center.payment_provider,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS merchant_trade_no text,
  ADD COLUMN IF NOT EXISTS provider_trade_no text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

ALTER TABLE sport_center.paylabs_transactions
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sport_payments_provider
  ON sport_center.sport_payments (payment_provider);
CREATE INDEX IF NOT EXISTS idx_sport_payments_merchant_trade_no
  ON sport_center.sport_payments (merchant_trade_no);

-- ============================================================
-- 15. users: google_id + make email/password_hash nullable
-- ============================================================
ALTER TABLE sport_center.users
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS google_id text UNIQUE;

-- ============================================================
-- 17. bookings: reminder sent flags (prevent duplicate WA)
-- ============================================================
ALTER TABLE sport_center.sport_bookings
  ADD COLUMN IF NOT EXISTS reminder_h1_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_day_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_reminder_sent_at timestamptz;

-- Daily admin WhatsApp usage-list delivery state
CREATE TABLE IF NOT EXISTS sport_center.wa_daily_usage_snapshots (
  id serial PRIMARY KEY,
  usage_date text NOT NULL UNIQUE,
  fingerprint text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 18. company_invoices table (idempotent) + bookings linkage
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'sport_center' AND t.typname = 'payer_type'
  ) THEN
    CREATE TYPE sport_center.payer_type AS ENUM ('personal', 'company');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'sport_center' AND t.typname = 'billing_status'
  ) THEN
    CREATE TYPE sport_center.billing_status AS ENUM ('unbilled', 'billed', 'paid');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'sport_center' AND t.typname = 'user_account_type'
  ) THEN
    CREATE TYPE sport_center.user_account_type AS ENUM ('personal', 'company');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sport_center.company_invoices (
  id serial PRIMARY KEY,
  invoice_number text NOT NULL UNIQUE,
  company_customer_id integer NOT NULL REFERENCES sport_center.users(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  ppn_amount numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid',
  notes text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sport_center.users
  ADD COLUMN IF NOT EXISTS account_type sport_center.user_account_type DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS pic_name text,
  ADD COLUMN IF NOT EXISTS pic_phone text,
  ADD COLUMN IF NOT EXISTS pic_email text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS allow_monthly_billing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS company_tax_id text,
  ADD COLUMN IF NOT EXISTS payment_terms_days integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS monthly_credit_limit numeric(14,2),
  ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active';

ALTER TABLE sport_center.sport_bookings
  ADD COLUMN IF NOT EXISTS payer_type sport_center.payer_type DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS company_customer_id integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booked_for_name text,
  ADD COLUMN IF NOT EXISTS booked_for_phone text,
  ADD COLUMN IF NOT EXISTS payment_required_now boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS billing_status sport_center.billing_status,
  ADD COLUMN IF NOT EXISTS company_invoice_id integer REFERENCES sport_center.company_invoices(id) ON DELETE SET NULL;

-- ============================================================
-- 16. ap2_employee role + verification_logs table
-- ============================================================
DO $$ BEGIN
  ALTER TYPE sport_center.user_role ADD VALUE IF NOT EXISTS 'ap2_employee';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sport_center.verification_logs (
  id serial PRIMARY KEY,
  booking_id integer REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE,
  order_number text,
  verified_by_user_id integer,
  id_card_number_input text NOT NULL,
  status text NOT NULL,
  notes text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_logs_booking_id_idx ON sport_center.verification_logs(booking_id);
CREATE INDEX IF NOT EXISTS verification_logs_created_at_idx ON sport_center.verification_logs(created_at DESC);

-- ============================================================
-- 21. bookings: booked_by_user_id (siapa yang membuat booking)
-- ============================================================
ALTER TABLE sport_center.sport_bookings
  ADD COLUMN IF NOT EXISTS booked_by_user_id integer REFERENCES sport_center.users(id) ON DELETE SET NULL;

-- Backfill: booking yang customer_email cocok dengan email user → set booked_by_user_id ke user tersebut
UPDATE sport_center.sport_bookings b
SET booked_by_user_id = u.id
FROM sport_center.users u
WHERE b.booked_by_user_id IS NULL
  AND b.customer_id IS NULL
  AND LOWER(b.customer_email) = LOWER(u.email)
  AND u.email IS NOT NULL;

-- ============================================================
-- 19. tax_transactions: tambah status + transaction_type + reversal_of_id
-- ============================================================
ALTER TABLE sport_center.tax_transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'original',
  ADD COLUMN IF NOT EXISTS reversal_of_id integer;

-- ============================================================
-- 20. accounting_journals
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.accounting_journals (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE,
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

-- ============================================================
-- 21. company_invoice_items + unique constraint on company_invoices
-- ============================================================
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

-- Add unique constraint: 1 invoice per company per period
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_invoices_company_period_unique'
      AND conrelid = 'sport_center.company_invoices'::regclass
  ) THEN
    ALTER TABLE sport_center.company_invoices
      ADD CONSTRAINT company_invoices_company_period_unique
      UNIQUE (company_customer_id, period_month);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ============================================================
-- Bank Reconciliation
-- ============================================================

DO $$ BEGIN
  CREATE TYPE sport_center.bank_mutation_status AS ENUM (
    'unmatched', 'matched', 'duplicate_need_review', 'approved', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sport_center.recon_match_status AS ENUM ('candidate', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sport_center.recon_candidate_type AS ENUM ('payment', 'order', 'invoice', 'expense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sport_center.bank_mutations (
  id                     serial PRIMARY KEY,
  bank_account_id        text,
  transaction_date       text NOT NULL,
  description            text NOT NULL,
  credit_amount          numeric(14,2) DEFAULT 0,
  debit_amount           numeric(14,2) DEFAULT 0,
  amount                 numeric(14,2) NOT NULL,
  direction              text NOT NULL,
  mutation_key           text NOT NULL,
  normalized_description text,
  provider_name          text,
  provider_order_id      text,
  raw_payload            jsonb,
  status                 sport_center.bank_mutation_status NOT NULL DEFAULT 'unmatched',
  matched_payment_id     integer,
  matched_order_id       integer,
  uploaded_proof_url     text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_mutations_mutation_key_idx    ON sport_center.bank_mutations(mutation_key);
CREATE INDEX IF NOT EXISTS bank_mutations_status_idx          ON sport_center.bank_mutations(status);
CREATE INDEX IF NOT EXISTS bank_mutations_transaction_date_idx ON sport_center.bank_mutations(transaction_date);

CREATE TABLE IF NOT EXISTS sport_center.bank_reconciliation_matches (
  id             serial PRIMARY KEY,
  mutation_id    integer NOT NULL REFERENCES sport_center.bank_mutations(id) ON DELETE CASCADE,
  candidate_type sport_center.recon_candidate_type NOT NULL,
  candidate_id   integer NOT NULL,
  match_score    integer NOT NULL DEFAULT 0,
  match_reason   text,
  amount_match   boolean NOT NULL DEFAULT false,
  date_match     boolean NOT NULL DEFAULT false,
  name_match     boolean NOT NULL DEFAULT false,
  order_id_match boolean NOT NULL DEFAULT false,
  proof_match    boolean NOT NULL DEFAULT false,
  status         sport_center.recon_match_status NOT NULL DEFAULT 'candidate',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_recon_matches_mutation_id_idx ON sport_center.bank_reconciliation_matches(mutation_id);

-- ============================================================
-- Booking Groups (Gabung Pembayaran)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE sport_center.booking_group_status AS ENUM ('pending', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sport_center.booking_groups (
  id             SERIAL PRIMARY KEY,
  group_ref      TEXT NOT NULL UNIQUE,
  customer_phone TEXT NOT NULL,
  customer_name  TEXT NOT NULL,
  total_payment  NUMERIC(12,2) NOT NULL,
  status         sport_center.booking_group_status NOT NULL DEFAULT 'pending',
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sport_center.sport_bookings
  ADD COLUMN IF NOT EXISTS group_ref TEXT REFERENCES sport_center.booking_groups(group_ref) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_group_ref_idx ON sport_center.sport_bookings(group_ref);

-- ============================================================
-- Company Document Templates
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.company_document_templates (
  id serial PRIMARY KEY,
  company_id integer REFERENCES sport_center.users(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  header_logo_url text,
  kop_surat_html text,
  footer_html text,
  company_display_name text,
  finance_name text,
  finance_title text,
  finance_signature text,
  address text,
  phone text,
  email text,
  number_format_prefix text,
  number_format_pattern text,
  paper_style text NOT NULL DEFAULT 'A4',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_document_templates_company_id_idx ON sport_center.company_document_templates(company_id);
CREATE INDEX IF NOT EXISTS company_document_templates_document_type_idx ON sport_center.company_document_templates(document_type);

-- Document number sequences per company per document_type per year
-- company_id = 0 is sentinel for system-default (NULL cannot be used with ON CONFLICT)
CREATE TABLE IF NOT EXISTS sport_center.document_number_sequences (
  id serial PRIMARY KEY,
  company_id integer NOT NULL DEFAULT 0,
  document_type text NOT NULL,
  year integer NOT NULL,
  current_seq integer NOT NULL DEFAULT 0
);

-- Migrate any pre-sentinel NULL rows to 0
UPDATE sport_center.document_number_sequences SET company_id = 0 WHERE company_id IS NULL;

DO $$
BEGIN
  ALTER TABLE sport_center.document_number_sequences ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE sport_center.document_number_sequences ALTER COLUMN company_id SET DEFAULT 0;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'doc_num_seq_unique'
      AND conrelid = 'sport_center.document_number_sequences'::regclass
  ) THEN
    ALTER TABLE sport_center.document_number_sequences
      ADD CONSTRAINT doc_num_seq_unique UNIQUE (company_id, document_type, year);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Idempotent issued-number tracking for document template engine
-- company_id = 0 is sentinel for system-default (NULL cannot be used with ON CONFLICT)
CREATE TABLE IF NOT EXISTS sport_center.document_issued_numbers (
  id serial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  document_type text NOT NULL,
  company_id integer NOT NULL DEFAULT 0,
  document_number text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

-- Migrate any pre-sentinel NULL rows to 0
UPDATE sport_center.document_issued_numbers SET company_id = 0 WHERE company_id IS NULL;

DO $$
BEGIN
  ALTER TABLE sport_center.document_issued_numbers ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE sport_center.document_issued_numbers ALTER COLUMN company_id SET DEFAULT 0;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'doc_issued_unique'
      AND conrelid = 'sport_center.document_issued_numbers'::regclass
  ) THEN
    ALTER TABLE sport_center.document_issued_numbers
      ADD CONSTRAINT doc_issued_unique UNIQUE (entity_type, entity_id, document_type, company_id);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Seed system default templates (idempotent)
INSERT INTO sport_center.company_document_templates
  (company_id, document_type, is_default, company_display_name, finance_name, finance_title, number_format_prefix, paper_style)
SELECT NULL, t.dt, true, 'Sport Center Jakarta', 'Kepala Keuangan', 'Finance Manager', t.prefix, 'A4'
FROM (VALUES
  ('invoice',      'INV'),
  ('spp',          'SPP'),
  ('faktur',       'FAKTUR'),
  ('kwitansi',     'KWT'),
  ('lampiran',     'LMP'),
  ('berita_acara', 'BA')
) AS t(dt, prefix)
WHERE NOT EXISTS (
  SELECT 1 FROM sport_center.company_document_templates
  WHERE company_id IS NULL AND document_type = t.dt AND is_default = true
);

-- ============================================================
-- require_per_booking_approval per company (opsional)
-- ============================================================
ALTER TABLE sport_center.users
  ADD COLUMN IF NOT EXISTS require_per_booking_approval boolean NOT NULL DEFAULT false;

-- ============================================================
-- public.sport_center_expenses mirror table (sync dari sport_center.sport_expenses)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sport_center_expenses (
  id              SERIAL PRIMARY KEY,
  source_id       INTEGER,
  expense_no      TEXT NOT NULL,
  expense_date    TEXT NOT NULL,
  category        TEXT NOT NULL,
  description     TEXT NOT NULL,
  vendor_name     TEXT,
  facility_id     INTEGER,
  facility_name   TEXT,
  amount          NUMERIC(14,2) NOT NULL,
  ppn_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(14,2) NOT NULL,
  payment_method  TEXT,
  payment_account TEXT,
  payment_status  TEXT NOT NULL DEFAULT 'draft',
  receipt_url     TEXT,
  receipt_urls    JSONB DEFAULT '[]',
  notes           TEXT,
  rejected_reason TEXT,
  journal_id      TEXT,
  source          TEXT NOT NULL DEFAULT 'sport_center',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sc_expenses_expense_no_idx ON public.sport_center_expenses(expense_no);
CREATE INDEX IF NOT EXISTS sc_expenses_source_id_idx ON public.sport_center_expenses(source_id);
CREATE INDEX IF NOT EXISTS sc_expenses_expense_date_idx ON public.sport_center_expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS sc_expenses_payment_status_idx ON public.sport_center_expenses(payment_status);

-- ============================================================
-- public.sport_center_memberships mirror table (sync dari sport_center.sport_memberships)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sport_center_memberships (
  id              SERIAL PRIMARY KEY,
  source_id       INTEGER,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  months          INTEGER NOT NULL DEFAULT 1,
  total_price     NUMERIC(12,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_payment',
  notes           TEXT,
  payment_method  TEXT,
  payment_proof_url TEXT,
  source          TEXT NOT NULL DEFAULT 'sport_center',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sc_memberships_source_id_idx ON public.sport_center_memberships(source_id);
CREATE INDEX IF NOT EXISTS sc_memberships_status_idx ON public.sport_center_memberships(status);
CREATE INDEX IF NOT EXISTS sc_memberships_start_date_idx ON public.sport_center_memberships(start_date DESC);

-- ============================================================
-- company_document_settings (kop surat, bank, finance, TTD)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE sport_center.document_type_enum AS ENUM (
    'general', 'invoice', 'spp', 'kwitansi', 'lampiran', 'berita_acara', 'surat_pengantar'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sport_center.company_document_settings (
  id              SERIAL PRIMARY KEY,
  document_type   sport_center.document_type_enum NOT NULL DEFAULT 'general',
  logo_url        TEXT,
  kop_surat_html  TEXT,
  footer_html     TEXT,
  bank_name       TEXT NOT NULL DEFAULT '',
  bank_account    TEXT NOT NULL DEFAULT '',
  bank_holder     TEXT NOT NULL DEFAULT '',
  finance_name    TEXT NOT NULL DEFAULT '',
  finance_title   TEXT NOT NULL DEFAULT 'Finance Manager',
  signature_url   TEXT,
  prefix_number   TEXT NOT NULL DEFAULT 'INV',
  tax_rate        NUMERIC(5,2) NOT NULL DEFAULT 11,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- coa_accounts (chart of accounts for expense categorization)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE sport_center.coa_account_type AS ENUM (
    'asset', 'liability', 'equity', 'revenue', 'expense'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sport_center.coa_accounts (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  account_type sport_center.coa_account_type NOT NULL,
  parent_code  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- receipt_urls column on sport_expenses (jsonb multi-attachment)
ALTER TABLE sport_center.sport_expenses
  ADD COLUMN IF NOT EXISTS receipt_urls JSONB DEFAULT '[]';

-- ============================================================
-- sport_vendors master table
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.sport_vendors (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  contact_person TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- vendor_id FK on sport_expenses
ALTER TABLE sport_center.sport_expenses
  ADD COLUMN IF NOT EXISTS vendor_id INTEGER
    REFERENCES sport_center.sport_vendors(id)
    ON DELETE SET NULL;

-- ============================================================
-- wa_notif_logs: log pengiriman notifikasi WhatsApp per booking
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.wa_notif_logs (
  id              SERIAL PRIMARY KEY,
  booking_id      INTEGER,
  order_number    TEXT,
  event           TEXT,
  recipient_phone TEXT NOT NULL,
  message_preview TEXT,
  status          TEXT NOT NULL DEFAULT 'sent',
  error_message   TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- gym_checkins: rekam check-in harian member gym
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.gym_checkins (
  id              SERIAL PRIMARY KEY,
  membership_id   INTEGER NOT NULL REFERENCES sport_center.sport_memberships(id) ON DELETE CASCADE,
  checkin_date    TEXT NOT NULL,
  checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gym_checkins_date_idx       ON sport_center.gym_checkins(checkin_date);
CREATE INDEX IF NOT EXISTS gym_checkins_membership_idx ON sport_center.gym_checkins(membership_id);

-- ============================================================
-- Event booking: booking_type + event_discount_amount
-- ============================================================
ALTER TABLE sport_center.sport_bookings
  ADD COLUMN IF NOT EXISTS booking_type TEXT NOT NULL DEFAULT 'regular';

ALTER TABLE sport_center.sport_bookings
  ADD COLUMN IF NOT EXISTS event_discount_amount NUMERIC(12,2);
`;

