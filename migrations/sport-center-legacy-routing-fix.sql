-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: sport-center-legacy-routing-fix
-- Versi: 2.0 (update 2026-06-23)
-- Tujuan: Rename tabel utama ke prefix sport_* resmi
--         Buat tabel accounting_journal_lines (double-entry lines)
--         Buat views sport_invoices, sport_invoice_items, sport_customers
--         Update nilai applies_to di tax_settings
--         Buat tabel jika belum ada (idempotent)
-- Scope: DEV dulu; PROD hanya setelah backup dan approval manual
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Rename main tables (hanya jika nama lama masih ada) ──────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='sport_center' AND tablename='bookings') THEN
    ALTER TABLE sport_center.bookings RENAME TO sport_bookings;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='sport_center' AND tablename='facilities') THEN
    ALTER TABLE sport_center.facilities RENAME TO sport_facilities;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='sport_center' AND tablename='payments') THEN
    ALTER TABLE sport_center.payments RENAME TO sport_payments;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='sport_center' AND tablename='gym_memberships') THEN
    ALTER TABLE sport_center.gym_memberships RENAME TO sport_memberships;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='sport_center' AND tablename='settings') THEN
    ALTER TABLE sport_center.settings RENAME TO sport_settings;
  END IF;
END$$;

-- ── 2. Rename sequences (jika masih dengan nama lama) ────────────────────────
ALTER SEQUENCE IF EXISTS sport_center.bookings_id_seq        RENAME TO sport_bookings_id_seq;
ALTER SEQUENCE IF EXISTS sport_center.facilities_id_seq      RENAME TO sport_facilities_id_seq;
ALTER SEQUENCE IF EXISTS sport_center.payments_id_seq        RENAME TO sport_payments_id_seq;
ALTER SEQUENCE IF EXISTS sport_center.gym_memberships_id_seq RENAME TO sport_memberships_id_seq;
ALTER SEQUENCE IF EXISTS sport_center.settings_id_seq        RENAME TO sport_settings_id_seq;

-- ── 3. Buat tabel accounting_journal_lines (double-entry lines) ───────────────
CREATE TABLE IF NOT EXISTS sport_center.accounting_journal_lines (
  id              serial PRIMARY KEY,
  journal_id      integer NOT NULL REFERENCES sport_center.accounting_journals(id) ON DELETE CASCADE,
  line_type       text    NOT NULL,          -- 'debit' | 'credit'
  account_code    text    NOT NULL,          -- mis. '1-1001', '4-1001', '2-1101'
  account_name    text    NOT NULL,
  amount          numeric(14,2) NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index untuk query per jurnal
CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_journal_id
  ON sport_center.accounting_journal_lines(journal_id);

-- ── 4. Jadikan accounting_journals.booking_id nullable (untuk expense journals) ─
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sport_center'
      AND table_name   = 'accounting_journals'
      AND column_name  = 'booking_id'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE sport_center.accounting_journals ALTER COLUMN booking_id DROP NOT NULL;
  END IF;
END$$;

-- ── 5. Update applies_to value (idempotent) ───────────────────────────────────
UPDATE sport_center.tax_settings
SET applies_to = 'sport_booking'
WHERE applies_to = 'sport_center_booking';

-- ── 6. Create views (sport_invoices, sport_invoice_items, sport_customers) ────
CREATE OR REPLACE VIEW sport_center.sport_invoices AS
  SELECT * FROM sport_center.company_invoices;

CREATE OR REPLACE VIEW sport_center.sport_invoice_items AS
  SELECT * FROM sport_center.company_invoice_items;

CREATE OR REPLACE VIEW sport_center.sport_customers AS
  SELECT * FROM sport_center.users WHERE role = 'customer';

-- ── Note: bizportalSync sync tables ─────────────────────────────────────────
-- The bizportalSync.ts code now creates:
--   sport_center.sport_facilities        (was sport_center_facilities)
--   sport_center.sport_bookings_sync     (was sport_center_bookings)
--   sport_center.sport_memberships_sync  (was sport_center_memberships)
-- These are created on-demand by initBizportalTables(). No manual migration needed.

COMMIT;
