import pg from "pg";

const { Client } = pg;

export const CUSTOM_MIGRATION_SQL = `
-- ============================================================
-- Facility → company ownership mapping (effective-dated)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS sport_center.facility_company_mappings (
  id serial PRIMARY KEY,
  facility_id integer NOT NULL REFERENCES sport_center.sport_facilities(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  effective_until date,
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'admin_config',
  notes text,
  created_by integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES sport_center.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facility_company_mappings_date_range_valid
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

-- The canonical company master is public.companies. Existing rows are not
-- silently converted: a populated legacy table must be reviewed explicitly.
DO $$
DECLARE
  current_company_target text;
  mapping_count integer;
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'COMPANY_MODEL_MIGRATION_BLOCKED: public.companies is missing';
  END IF;

  SELECT COUNT(*) INTO mapping_count
    FROM sport_center.facility_company_mappings;
  IF mapping_count > 0 THEN
    SELECT n.nspname || '.' || c.relname
      INTO current_company_target
      FROM pg_constraint fk
      JOIN pg_class local_table ON local_table.oid = fk.conrelid
      JOIN pg_namespace local_schema ON local_schema.oid = local_table.relnamespace
      JOIN pg_class c ON c.oid = fk.confrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE fk.conname = 'facility_company_mappings_company_id_fkey'
       AND local_schema.nspname = 'sport_center'
       AND local_table.relname = 'facility_company_mappings';
    IF current_company_target = 'sport_center.users' THEN
      RAISE EXCEPTION 'COMPANY_MODEL_MIGRATION_BLOCKED: existing legacy facility ownership rows require manual translation';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_constraint fk
      JOIN pg_class local_table ON local_table.oid = fk.conrelid
      JOIN pg_namespace local_schema ON local_schema.oid = local_table.relnamespace
      JOIN pg_class target_table ON target_table.oid = fk.confrelid
      JOIN pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
     WHERE fk.conname = 'facility_company_mappings_company_id_fkey'
       AND local_schema.nspname = 'sport_center'
       AND local_table.relname = 'facility_company_mappings'
       AND target_schema.nspname = 'sport_center'
       AND target_table.relname = 'users'
  ) THEN
    ALTER TABLE sport_center.facility_company_mappings
      DROP CONSTRAINT facility_company_mappings_company_id_fkey;
    ALTER TABLE sport_center.facility_company_mappings
      ADD CONSTRAINT facility_company_mappings_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS facility_company_mappings_lookup_idx
  ON sport_center.facility_company_mappings (facility_id, effective_from, effective_until)
  WHERE is_active = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'facility_company_mappings_no_active_overlap'
       AND conrelid = 'sport_center.facility_company_mappings'::regclass
  ) THEN
    ALTER TABLE sport_center.facility_company_mappings
      ADD CONSTRAINT facility_company_mappings_no_active_overlap
      EXCLUDE USING gist (
        facility_id WITH =,
        daterange(effective_from, COALESCE(effective_until, 'infinity'::date), '[]') WITH &&
      )
      WHERE (is_active = true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sport_center.validate_facility_company_mapping_company()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.companies
     WHERE id = NEW.company_id
        AND is_active = true
  ) THEN
    RAISE EXCEPTION 'FACILITY_COMPANY_MAPPING_COMPANY_INVALID:%', NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_facility_company_mapping_company
  ON sport_center.facility_company_mappings;
CREATE TRIGGER trg_validate_facility_company_mapping_company
  BEFORE INSERT OR UPDATE OF company_id
  ON sport_center.facility_company_mappings
  FOR EACH ROW
  EXECUTE FUNCTION sport_center.validate_facility_company_mapping_company();

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
  ALTER TYPE sport_center.payment_status ADD VALUE IF NOT EXISTS 'waiting_confirmation';
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
-- 2b. Canonical payment provider metadata (backward-compatible)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE sport_center.payment_provider AS ENUM ('mandiri_direct','paylabs','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE sport_center.sport_payments
  ADD COLUMN IF NOT EXISTS payment_provider sport_center.payment_provider,
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS provider_id text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS merchant_trade_no text,
  ADD COLUMN IF NOT EXISTS provider_trade_no text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_id integer,
  ADD COLUMN IF NOT EXISTS bank_account_id text,
  ADD COLUMN IF NOT EXISTS mdr_rate numeric(8,5) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mdr_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'unsettled',
  ADD COLUMN IF NOT EXISTS gross_tax_inclusive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expected_settlement_date text;

UPDATE sport_center.sport_payments
   SET payment_provider = COALESCE(payment_provider, 'unknown'::sport_center.payment_provider),
       provider_name = COALESCE(NULLIF(btrim(provider_name), ''), payment_provider::text, 'unknown'),
       provider_id = COALESCE(
         NULLIF(btrim(provider_id), ''),
         NULLIF(btrim(provider_trade_no), ''),
         NULLIF(btrim(provider_reference), ''),
         NULLIF(btrim(merchant_trade_no), ''),
         'legacy-' || id::text
        ),
        provider_order_id = COALESCE(
          NULLIF(btrim(provider_order_id), ''),
          NULLIF(btrim(merchant_trade_no), ''),
          NULLIF(btrim(provider_trade_no), ''),
          NULLIF(btrim(provider_reference), ''),
          'legacy-order-' || id::text
        )
 WHERE payment_provider IS NULL
    OR provider_name IS NULL
    OR btrim(provider_name) = ''
    OR provider_id IS NULL
     OR btrim(provider_id) = ''
     OR provider_order_id IS NULL
     OR btrim(provider_order_id) = '';

ALTER TABLE sport_center.sport_payments
  ALTER COLUMN payment_provider SET NOT NULL,
  ALTER COLUMN provider_name SET NOT NULL,
  ALTER COLUMN provider_id SET NOT NULL,
  ALTER COLUMN provider_order_id SET NOT NULL;

-- New payments must have usable accounting metadata. This is INSERT-only so
-- legacy historical rows with old metadata remain readable and unchanged.
CREATE OR REPLACE FUNCTION sport_center.validate_new_payment_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'sport_center'
AS $function$
BEGIN
  IF NEW.company_id IS NULL OR NEW.company_id <= 0 THEN
    RAISE EXCEPTION
      'NEW_PAYMENT_COMPANY_ID_REQUIRED: payment metadata must include a valid company_id';
  END IF;

  IF NEW.provider_name IS NULL
     OR btrim(NEW.provider_name) = ''
     OR lower(btrim(NEW.provider_name)) = 'unknown' THEN
    RAISE EXCEPTION
      'NEW_PAYMENT_PROVIDER_NAME_REQUIRED: provider_name cannot be empty or unknown';
  END IF;

  IF NEW.bank_account_id IS NULL
     OR btrim(NEW.bank_account_id) = ''
     OR lower(btrim(NEW.bank_account_id)) = 'unknown' THEN
    RAISE EXCEPTION
      'NEW_PAYMENT_BANK_ACCOUNT_ID_REQUIRED: bank_account_id cannot be empty or unknown';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_new_payment_metadata
  ON sport_center.sport_payments;
CREATE TRIGGER trg_validate_new_payment_metadata
BEFORE INSERT ON sport_center.sport_payments
FOR EACH ROW
EXECUTE FUNCTION sport_center.validate_new_payment_metadata();

-- ============================================================
-- Payment accounting/mirror audit metadata (additive)
-- ============================================================
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
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS merchant_trade_no text,
  ADD COLUMN IF NOT EXISTS provider_trade_no text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_id integer,
  ADD COLUMN IF NOT EXISTS bank_account_id text,
  ADD COLUMN IF NOT EXISTS expected_settlement_date text;

CREATE TABLE IF NOT EXISTS sport_center.payment_settlement_configs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL,
  provider_code text NOT NULL,
  bank_account_id text NOT NULL,
  settlement_delay_business_days integer NOT NULL DEFAULT 1,
  effective_from date NOT NULL,
  effective_until date,
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'admin_config',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, provider_code, bank_account_id, effective_from)
);

CREATE TABLE IF NOT EXISTS sport_center.payment_business_calendar (
  calendar_date date PRIMARY KEY,
  is_business_day boolean NOT NULL DEFAULT true,
  label text,
  source text NOT NULL DEFAULT 'admin_config',
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sport_center.bank_import_source_mappings (
  id serial PRIMARY KEY,
  source_type text NOT NULL DEFAULT 'google_sheet',
  source_id text NOT NULL,
  worksheet_name text,
  company_id integer NOT NULL,
  bank_account_id text NOT NULL,
  provider_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id, worksheet_name)
);

-- Create paylabs_transactions if it doesn't exist yet (fresh dev DB).
-- On Supabase prod this table already exists; the ADD COLUMN below is idempotent.
CREATE TABLE IF NOT EXISTS sport_center.paylabs_transactions (
  id                SERIAL PRIMARY KEY,
  booking_id        INTEGER,
  order_number      TEXT NOT NULL,
  merchant_trade_no TEXT NOT NULL UNIQUE,
  paylabs_trade_no  TEXT,
  payment_method    TEXT NOT NULL,
  amount            NUMERIC(12,2) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING',
  provider_status   TEXT,
  notify_url        TEXT,
  qr_code_url       TEXT,
  qr_content        TEXT,
  va_number         TEXT,
  pay_url           TEXT,
  raw_request       JSONB,
  raw_response      JSONB,
  raw_notification  JSONB,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

ALTER TABLE sport_center.accounting_journals
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS payment_id integer
    REFERENCES sport_center.sport_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id integer,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS provider_id text,
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS bank_account_id text,
  ADD COLUMN IF NOT EXISTS expected_settlement_date text,
  ADD COLUMN IF NOT EXISTS settlement_status text,
  ADD COLUMN IF NOT EXISTS mdr_rate numeric(8,5),
  ADD COLUMN IF NOT EXISTS mdr_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS gross_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS dpp_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS merchant_trade_no text,
  ADD COLUMN IF NOT EXISTS provider_trade_no text;

UPDATE sport_center.accounting_journals aj
   SET payment_method = sp.payment_method,
       payment_provider = sp.payment_provider::text,
       provider_name = sp.provider_name,
       provider_id = sp.provider_id,
       payment_type = sp.payment_type::text,
       bank_account_id = sp.bank_account_id,
       expected_settlement_date = sp.expected_settlement_date,
       settlement_status = sp.settlement_status,
       mdr_rate = sp.mdr_rate,
       mdr_amount = sp.mdr_amount,
       provider_reference = sp.provider_reference,
       provider_order_id = sp.provider_order_id,
       merchant_trade_no = sp.merchant_trade_no,
       provider_trade_no = sp.provider_trade_no,
       company_id = COALESCE(sp.company_id, aj.company_id)
  FROM sport_center.sport_payments sp
 WHERE aj.payment_id = sp.id
   AND aj.journal_type = 'payment_confirmed'
   AND aj.is_reversal = false;

ALTER TABLE sport_center.accounting_journals
  ALTER COLUMN status SET DEFAULT 'posted';

UPDATE sport_center.accounting_journals
   SET status = 'posted'
 WHERE journal_type = 'payment_confirmed'
   AND is_reversal = false
   AND status IS DISTINCT FROM 'posted';

CREATE UNIQUE INDEX IF NOT EXISTS accounting_journals_payment_confirmed_unique
  ON sport_center.accounting_journals (payment_id)
  WHERE payment_id IS NOT NULL
    AND journal_type = 'payment_confirmed'
    AND is_reversal = false;

-- The shared public accounting schema uses an enum for source. Add the
-- Sport Center payment source before creating source-scoped constraints.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'accounting_entry_source'
       AND n.nspname = 'public'
  ) THEN
    ALTER TYPE public.accounting_entry_source
      ADD VALUE IF NOT EXISTS 'sport_center_payment';
  END IF;
END
$$;

-- Payment-level public accounting idempotency. This is intentionally scoped
-- to Sport Center payment entries so legacy accounting streams keep their
-- existing contract.
-- Guard: public.accounting_entries only exists on the shared Supabase instance.
-- On a fresh dev DB this table is absent; skip the index gracefully.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'accounting_entries'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'accounting_entries'
        AND indexname = 'uq_public_accounting_entries_sc_payment_correlation'
    ) THEN
      EXECUTE $sql$
        CREATE UNIQUE INDEX uq_public_accounting_entries_sc_payment_correlation
          ON public.accounting_entries (correlation_id)
          WHERE source = 'sport_center_payment'
            AND correlation_id IS NOT NULL
      $sql$;
    END IF;
  END IF;
END $$;

-- Durable payment accounting/mirror retry queue. A trigger below enqueues
-- every newly-confirmed payment in the same transaction as the status change.
CREATE TABLE IF NOT EXISTS sport_center.payment_accounting_outbox (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL REFERENCES sport_center.sport_payments(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'payment_confirmed',
  source_project text NOT NULL DEFAULT 'SPORT_CENTER',
  source_schema text NOT NULL DEFAULT 'sport_center',
  source_table text NOT NULL DEFAULT 'sport_payments',
  booking_id integer,
  company_id integer,
  amount numeric(14,2),
  payment_type text,
  payment_method text,
  payment_provider text,
  provider_reference text,
  provider_order_id text,
  paid_at timestamptz,
  confirmed_at timestamptz,
  correlation_id text,
  schema_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_accounting_outbox_payment_event_unique UNIQUE (payment_id, event_type)
);
ALTER TABLE sport_center.payment_accounting_outbox
  ADD COLUMN IF NOT EXISTS source_project text NOT NULL DEFAULT 'SPORT_CENTER',
  ADD COLUMN IF NOT EXISTS source_schema text NOT NULL DEFAULT 'sport_center',
  ADD COLUMN IF NOT EXISTS source_table text NOT NULL DEFAULT 'sport_payments',
  ADD COLUMN IF NOT EXISTS booking_id integer,
  ADD COLUMN IF NOT EXISTS company_id integer,
  ADD COLUMN IF NOT EXISTS amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;
UPDATE sport_center.payment_accounting_outbox o
   SET booking_id = COALESCE(o.booking_id, sp.booking_id),
       company_id = COALESCE(o.company_id, sp.company_id),
       amount = COALESCE(o.amount, sp.amount),
       payment_type = COALESCE(o.payment_type, sp.payment_type::text),
       payment_method = COALESCE(o.payment_method, sp.payment_method),
       payment_provider = COALESCE(o.payment_provider, sp.payment_provider::text),
       provider_reference = COALESCE(o.provider_reference, sp.provider_reference),
       provider_order_id = COALESCE(o.provider_order_id, sp.provider_order_id),
       paid_at = COALESCE(o.paid_at, sp.paid_at),
       confirmed_at = COALESCE(o.confirmed_at, sp.confirmed_at),
       updated_at = now()
  FROM sport_center.sport_payments sp
 WHERE o.payment_id = sp.id
   AND (o.booking_id IS NULL OR o.amount IS NULL OR o.payment_method IS NULL);
UPDATE sport_center.payment_accounting_outbox
   SET correlation_id = 'sc_payment_' || payment_id::text,
       updated_at = now()
 WHERE correlation_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounting_outbox_correlation_unique
  ON sport_center.payment_accounting_outbox (correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_accounting_outbox_ready_idx
  ON sport_center.payment_accounting_outbox (status, available_at, locked_at);

CREATE OR REPLACE FUNCTION sport_center.enqueue_payment_accounting_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status::text = 'confirmed' THEN
    IF TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'confirmed' THEN
      INSERT INTO sport_center.payment_accounting_outbox
        (payment_id, event_type, source_project, source_schema, source_table,
         booking_id, company_id, amount, payment_type, payment_method,
         payment_provider, provider_reference, provider_order_id, paid_at,
         confirmed_at, correlation_id, schema_version, status, available_at,
         created_at, updated_at)
      VALUES (NEW.id, 'payment_confirmed', 'SPORT_CENTER', 'sport_center',
              'sport_payments', NEW.booking_id, NEW.company_id, NEW.amount,
              NEW.payment_type, NEW.payment_method, NEW.payment_provider,
              NEW.provider_reference, NEW.provider_order_id, NEW.paid_at,
              NEW.confirmed_at, 'sc_payment_' || NEW.id::text, 1, 'pending',
              now(), now(), now())
      ON CONFLICT (payment_id, event_type) DO UPDATE
        SET status = CASE
              WHEN sport_center.payment_accounting_outbox.status = 'posted'
                THEN sport_center.payment_accounting_outbox.status
              ELSE 'pending'
            END,
            available_at = CASE
              WHEN sport_center.payment_accounting_outbox.status = 'posted'
                THEN sport_center.payment_accounting_outbox.available_at
              ELSE now()
            END,
            locked_at = NULL,
            updated_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_accounting_outbox
  ON sport_center.sport_payments;
CREATE TRIGGER trg_payment_accounting_outbox
AFTER INSERT OR UPDATE OF status ON sport_center.sport_payments
FOR EACH ROW
EXECUTE FUNCTION sport_center.enqueue_payment_accounting_outbox();

-- Central Finance owns processing state separately from the Sport Center
-- legacy worker state. It is additive and safe to apply repeatedly.
CREATE TABLE IF NOT EXISTS sport_center.central_finance_processing (
  id serial PRIMARY KEY,
  source_project text NOT NULL,
  source_payment_id integer NOT NULL,
  event_type text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  comparison_class text,
  comparison_evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT central_finance_processing_identity
    UNIQUE (source_project, source_payment_id, event_type),
  CONSTRAINT central_finance_processing_correlation_unique
    UNIQUE (correlation_id)
);
CREATE INDEX IF NOT EXISTS central_finance_processing_ready_idx
  ON sport_center.central_finance_processing (status, available_at, locked_at);

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

-- ============================================================
-- Required payment receiving account
-- ============================================================
-- Existing payments are backfilled from the configured Sport Center
-- receiving account before the database constraint is tightened.
UPDATE sport_center.sport_payments p
   SET bank_account_id = s.bank_account
  FROM sport_center.sport_settings s
 WHERE (p.bank_account_id IS NULL OR btrim(p.bank_account_id) = '')
   AND s.bank_account IS NOT NULL
   AND btrim(s.bank_account) <> '';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
      FROM sport_center.sport_payments
     WHERE bank_account_id IS NULL OR btrim(bank_account_id) = ''
  ) THEN
    RAISE EXCEPTION 'Cannot enforce sport_payments.bank_account_id: payment rows still lack a receiving account';
  END IF;
  ALTER TABLE sport_center.sport_payments
    ALTER COLUMN bank_account_id SET NOT NULL;
END $$;

-- ============================================================
-- Runtime accounting contracts (captured from verified DEV)
-- ============================================================
-- Keep these definitions in the canonical migration runner so a fresh
-- environment receives the same runtime behavior as DEV.  The functions
-- are intentionally installed after the accounting tables and payment
-- metadata columns have been created above.
CREATE OR REPLACE FUNCTION sport_center.guard_posted_accounting_journal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'sport_center'
AS $function$
BEGIN

  -- Posted / reversed tetap tidak boleh DELETE
  IF TG_OP = 'DELETE'
     AND OLD.status IN ('posted', 'reversed') THEN

    RAISE EXCEPTION
      'POSTED_ACCOUNTING_JOURNAL_CANNOT_BE_DELETED: %',
      OLD.id;
  END IF;


  -- POSTED: payment method/provider boleh berubah melalui metadata flow.
  -- Koreksi company/bank historis hanya boleh melalui transaksi koreksi
  -- eksplisit yang mengaktifkan local GUC ini; field finansial tetap immutable.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'posted' THEN

    IF COALESCE(
         current_setting(
           'sport_center.allow_posted_accounting_metadata_correction',
           true
         ),
         'off'
       ) = 'on' THEN
      IF
        (
          to_jsonb(NEW)
          - ARRAY[
              'payment_method',
              'payment_provider',
              'company_id',
              'bank_account_id'
            ]::text[]
        )
        IS DISTINCT FROM
        (
          to_jsonb(OLD)
          - ARRAY[
              'payment_method',
              'payment_provider',
              'company_id',
              'bank_account_id'
            ]::text[]
        )
      THEN
        RAISE EXCEPTION
          'POSTED_ACCOUNTING_JOURNAL_FINANCIAL_FIELDS_IMMUTABLE: %',
          OLD.id;
      END IF;
    ELSIF
      (
        to_jsonb(NEW)
        - ARRAY[
            'payment_method',
            'payment_provider'
          ]::text[]
      )
      IS DISTINCT FROM
      (
        to_jsonb(OLD)
        - ARRAY[
            'payment_method',
            'payment_provider'
          ]::text[]
      )
    THEN
      RAISE EXCEPTION
        'POSTED_ACCOUNTING_JOURNAL_FINANCIAL_FIELDS_IMMUTABLE: %',
        OLD.id;
    END IF;

    RETURN NEW;
  END IF;


  -- REVERSED tetap full immutable
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'reversed' THEN

    RAISE EXCEPTION
      'REVERSED_ACCOUNTING_JOURNAL_IS_IMMUTABLE: %',
      OLD.id;
  END IF;


  RETURN COALESCE(NEW, OLD);

END;
$function$;

CREATE OR REPLACE FUNCTION sport_center.sync_payment_accounting_journal()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_journal_id integer;
  v_journal_status text;
  v_count integer;
BEGIN

  /*
    Jangan LIMIT 1 diam-diam.
    Pastikan payment memiliki maksimal satu payment_confirmed journal aktif.
  */

  SELECT
    COUNT(*),
    MIN(id)
  INTO
    v_count,
    v_journal_id
  FROM sport_center.accounting_journals
  WHERE payment_id = NEW.id
    AND journal_type = 'payment_confirmed'
    AND is_reversal = false;


  -- Belum ada jurnal: tidak perlu sync
  IF v_count = 0 THEN
    RETURN NEW;
  END IF;


  -- Ambiguous: fail closed
  IF v_count > 1 THEN
    RAISE EXCEPTION
      'PAYMENT_ACCOUNTING_JOURNAL_AMBIGUOUS: payment_id=% journal_count=%',
      NEW.id,
      v_count;
  END IF;


  SELECT status::text
  INTO v_journal_status
  FROM sport_center.accounting_journals
  WHERE id = v_journal_id;


  -- Jurnal reversed jangan disentuh
  IF v_journal_status = 'reversed' THEN
    RETURN NEW;
  END IF;


  /*
    METADATA ONLY.

    Tidak menyentuh:
    amount
    DPP
    PPN
    debit / credit
    COA
    journal lines
    journal date
    status
  */

  UPDATE sport_center.accounting_journals
  SET
    payment_method = NEW.payment_method,
    payment_provider = NEW.payment_provider::text
  WHERE id = v_journal_id;


  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_posted_accounting_journal
  ON sport_center.accounting_journals;
CREATE TRIGGER trg_guard_posted_accounting_journal
BEFORE DELETE OR UPDATE ON sport_center.accounting_journals
FOR EACH ROW
EXECUTE FUNCTION sport_center.guard_posted_accounting_journal();

DROP TRIGGER IF EXISTS trg_sync_payment_accounting_journal
  ON sport_center.sport_payments;
CREATE TRIGGER trg_sync_payment_accounting_journal
AFTER INSERT OR UPDATE OF payment_method, payment_provider
ON sport_center.sport_payments
FOR EACH ROW
EXECUTE FUNCTION sport_center.sync_payment_accounting_journal();

-- Keep the public accounting-entry header aligned with the public payment
-- mirror. This only changes payment classification metadata; financial values,
-- tax, posting state, and journal lines remain immutable.
CREATE OR REPLACE FUNCTION public.sync_sport_payment_entry_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_entry_status text;
BEGIN
  IF NEW.entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ae.status::text
    INTO v_entry_status
    FROM public.accounting_entries ae
   WHERE ae.id = NEW.entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PUBLIC_PAYMENT_ACCOUNTING_ENTRY_MISSING: payment=% entry_id=%',
      NEW.id,
      NEW.entry_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_entry_status = 'reversed' THEN
    RAISE EXCEPTION
      'REVERSED_PUBLIC_ACCOUNTING_ENTRY_IS_IMMUTABLE: entry_id=%',
      NEW.entry_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.accounting_entries
     SET payment_method = NEW.method,
         payment_provider = NEW.payment_provider
   WHERE id = NEW.entry_id
     AND (
       payment_method IS DISTINCT FROM NEW.method
       OR payment_provider IS DISTINCT FROM NEW.payment_provider
     );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_sport_payment_entry_metadata
  ON public.sport_payments;
CREATE TRIGGER trg_sync_sport_payment_entry_metadata
AFTER INSERT OR UPDATE OF method, payment_provider
ON public.sport_payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_sport_payment_entry_metadata();

-- AP2 discount settings support a fixed nominal amount in addition to percentage.
ALTER TABLE sport_center.discount_settings
  ADD COLUMN IF NOT EXISTS discount_amount integer;

-- Group payments are one financial event. This table stores only the
-- invoice allocation references for each session; it must never be mirrored
-- as a payment or posted to accounting.
CREATE TABLE IF NOT EXISTS sport_center.sport_payment_allocations (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL
    REFERENCES sport_center.sport_payments(id) ON DELETE CASCADE,
  booking_id integer NOT NULL
    REFERENCES sport_center.sport_bookings(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT sport_payment_allocations_payment_booking_unique
    UNIQUE (payment_id, booking_id),
  CONSTRAINT sport_payment_allocations_amount_positive
    CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS sport_payment_allocations_booking_idx
  ON sport_center.sport_payment_allocations (booking_id);
`;

