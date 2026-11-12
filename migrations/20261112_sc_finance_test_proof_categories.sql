-- Additive classification of payment evidence vs supplemental receipts for TEST expenses.
-- Existing receipt_urls remain untouched and visible as legacy/unclassified evidence.
ALTER TABLE sport_center.sc_finance_test_entries
  ADD COLUMN IF NOT EXISTS payment_proof_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS supporting_receipt_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sc_finance_test_payment_proof_array'
    AND conrelid='sport_center.sc_finance_test_entries'::regclass) THEN
    ALTER TABLE sport_center.sc_finance_test_entries
      ADD CONSTRAINT sc_finance_test_payment_proof_array
        CHECK (jsonb_typeof(payment_proof_urls)='array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sc_finance_test_supporting_receipt_array'
    AND conrelid='sport_center.sc_finance_test_entries'::regclass) THEN
    ALTER TABLE sport_center.sc_finance_test_entries
      ADD CONSTRAINT sc_finance_test_supporting_receipt_array
        CHECK (jsonb_typeof(supporting_receipt_urls)='array');
  END IF;
END $$;
