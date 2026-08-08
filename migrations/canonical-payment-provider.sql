-- Canonical provider metadata for Sport Center payments.
-- All additions are nullable so historical payments remain valid.
DO $$ BEGIN
  CREATE TYPE sport_center.payment_provider AS ENUM ('mandiri_direct','paylabs','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE sport_center.sport_payments
  ADD COLUMN IF NOT EXISTS payment_provider sport_center.payment_provider,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS merchant_trade_no text,
  ADD COLUMN IF NOT EXISTS provider_trade_no text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;