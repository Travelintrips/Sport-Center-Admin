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
ALTER TABLE sport_center.bookings
  ADD COLUMN IF NOT EXISTS resource_name text,
  ADD COLUMN IF NOT EXISTS payment_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ============================================================
-- 3. booking_history
-- ============================================================
CREATE TABLE IF NOT EXISTS sport_center.booking_history (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES sport_center.bookings(id) ON DELETE CASCADE,
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
  facility_id integer REFERENCES sport_center.facilities(id) ON DELETE CASCADE,
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
  facility_id integer NOT NULL REFERENCES sport_center.facilities(id) ON DELETE CASCADE,
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
  booking_id integer NOT NULL REFERENCES sport_center.bookings(id) ON DELETE CASCADE,
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
  booking_id integer NOT NULL REFERENCES sport_center.bookings(id) ON DELETE CASCADE UNIQUE,
  facility_id integer NOT NULL REFERENCES sport_center.facilities(id) ON DELETE CASCADE,
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
  booking_id integer NOT NULL REFERENCES sport_center.bookings(id) ON DELETE CASCADE UNIQUE,
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

ALTER TABLE sport_center.gym_memberships
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_proof_url text;

-- ============================================================
-- 14. payments: payment_method + confirmed_at
-- ============================================================
ALTER TABLE sport_center.payments
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'Transfer Bank',
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

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
ALTER TABLE sport_center.bookings
  ADD COLUMN IF NOT EXISTS reminder_h1_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_day_sent_at timestamptz;

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

ALTER TABLE sport_center.bookings
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
  booking_id integer REFERENCES sport_center.bookings(id) ON DELETE CASCADE,
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
`;

async function main() {
  await client.connect();
  console.log("Connected to database. Running migrations...");
  try {
    await client.query(SQL);
    console.log("✅ Migration completed successfully!");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
