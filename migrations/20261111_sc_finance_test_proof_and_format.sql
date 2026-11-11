-- Additive, TEST-only. Never modify operational expenses, bank mutations, or journals.
ALTER TABLE sport_center.sc_finance_test_entries
  ADD COLUMN IF NOT EXISTS receipt_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expense_kind text,
  ADD COLUMN IF NOT EXISTS destination_bank text,
  ADD COLUMN IF NOT EXISTS description_version integer NOT NULL DEFAULT 1;
-- Existing entries stay at v1 so reconciliation cannot alter historical Sheets row B.
ALTER TABLE sport_center.sc_finance_test_entries
  ADD CONSTRAINT sc_finance_test_description_version_valid CHECK (description_version IN (1,2));
ALTER TABLE sport_center.sc_finance_test_entries
  ADD CONSTRAINT sc_finance_test_receipt_urls_array CHECK (jsonb_typeof(receipt_urls)='array');
