-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: sport-center-legacy-routing-fix
-- Tujuan: Rename tabel utama ke prefix sport_* resmi
--         Buat views sport_invoices, sport_invoice_items, sport_customers
--         Update nilai applies_to di tax_settings
-- Scope: DEV dulu; PROD hanya setelah approval manual
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Rename main tables ────────────────────────────────────────────────────
ALTER TABLE sport_center.bookings      RENAME TO sport_bookings;
ALTER TABLE sport_center.facilities    RENAME TO sport_facilities;
ALTER TABLE sport_center.payments      RENAME TO sport_payments;
ALTER TABLE sport_center.gym_memberships RENAME TO sport_memberships;
ALTER TABLE sport_center.settings      RENAME TO sport_settings;

-- ── 2. Rename sequences ──────────────────────────────────────────────────────
ALTER SEQUENCE IF EXISTS sport_center.bookings_id_seq        RENAME TO sport_bookings_id_seq;
ALTER SEQUENCE IF EXISTS sport_center.facilities_id_seq      RENAME TO sport_facilities_id_seq;
ALTER SEQUENCE IF EXISTS sport_center.payments_id_seq        RENAME TO sport_payments_id_seq;
ALTER SEQUENCE IF EXISTS sport_center.gym_memberships_id_seq RENAME TO sport_memberships_id_seq;
ALTER SEQUENCE IF EXISTS sport_center.settings_id_seq        RENAME TO sport_settings_id_seq;

-- ── 3. Update applies_to value ───────────────────────────────────────────────
UPDATE sport_center.tax_settings
SET applies_to = 'sport_booking'
WHERE applies_to = 'sport_center_booking';

-- ── 4. Create views (sport_invoices, sport_invoice_items, sport_customers) ───
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
