-- Migration: add effective_date column to sport_center.tax_settings
-- This enables backward-compatible PPN: bookings before effective_date are tax-free.
-- Run via: node scripts/node_modules/.bin/tsx scripts/migrate.ts
-- Or manually against the session pooler (port 5432).

ALTER TABLE sport_center.tax_settings
  ADD COLUMN IF NOT EXISTS effective_date TEXT;

-- Optional: set the effective date for the PPN_OUT_11 row.
-- Uncomment and set the date from which PPN should apply to new bookings.
-- UPDATE sport_center.tax_settings
--   SET effective_date = '2025-01-01'
-- WHERE tax_code = 'PPN_OUT_11';
