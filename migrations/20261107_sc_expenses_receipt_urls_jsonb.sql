-- Align legacy SC source evidence column with Drizzle jsonb receipts model.
-- Idempotent: already-jsonb environments are not rewritten.
-- Metadata only; no payment, GL journal, or bank mutation operations.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'sport_center'
      AND table_name = 'sport_expenses'
      AND column_name = 'receipt_urls'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE sport_center.sport_expenses
      ALTER COLUMN receipt_urls TYPE jsonb
      USING CASE
        WHEN receipt_urls IS NULL OR btrim(receipt_urls) = '' THEN '[]'::jsonb
        ELSE receipt_urls::jsonb
      END;
  END IF;
END
$migration$;
ALTER TABLE sport_center.sport_expenses
  ALTER COLUMN receipt_urls SET DEFAULT '[]'::jsonb;
