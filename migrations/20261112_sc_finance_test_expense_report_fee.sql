-- Additive metadata: preserve historical amount, Sheets rows, and journal boundaries.
ALTER TABLE sport_center.sc_finance_test_entries
  ADD COLUMN IF NOT EXISTS base_amount bigint,
  ADD COLUMN IF NOT EXISTS admin_fee bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ppn_amount bigint NOT NULL DEFAULT 0;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sc_finance_test_fee_nonnegative'
   AND conrelid='sport_center.sc_finance_test_entries'::regclass) THEN
  ALTER TABLE sport_center.sc_finance_test_entries
    ADD CONSTRAINT sc_finance_test_fee_nonnegative CHECK (
      admin_fee >= 0 AND ppn_amount >= 0 AND (base_amount IS NULL OR base_amount >= 0)
    );
 END IF;
END $$;
-- Legacy description_version=1,2 remain unchanged. Version=3 uses method, not report category.
ALTER TABLE sport_center.sc_finance_test_entries
  DROP CONSTRAINT IF EXISTS sc_finance_test_description_version_valid;
ALTER TABLE sport_center.sc_finance_test_entries
  ADD CONSTRAINT sc_finance_test_description_version_valid
  CHECK (description_version IN (1,2,3));
