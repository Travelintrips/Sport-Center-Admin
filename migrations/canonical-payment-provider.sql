-- Canonical provider metadata for Sport Center payments.
-- Provider metadata is required for new and historical payment rows.
DO $$ BEGIN
  CREATE TYPE sport_center.payment_provider AS ENUM ('mandiri_direct','paylabs','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE sport_center.sport_payments
  ADD COLUMN IF NOT EXISTS payment_provider sport_center.payment_provider,
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS provider_id text,
  ADD COLUMN IF NOT EXISTS merchant_trade_no text,
  ADD COLUMN IF NOT EXISTS provider_trade_no text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_id integer,
  ADD COLUMN IF NOT EXISTS bank_account_id text,
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
       )
 WHERE payment_provider IS NULL
    OR provider_name IS NULL
    OR btrim(provider_name) = ''
    OR provider_id IS NULL
    OR btrim(provider_id) = '';

ALTER TABLE sport_center.sport_payments
  ALTER COLUMN payment_provider SET NOT NULL,
  ALTER COLUMN provider_name SET NOT NULL,
  ALTER COLUMN provider_id SET NOT NULL;