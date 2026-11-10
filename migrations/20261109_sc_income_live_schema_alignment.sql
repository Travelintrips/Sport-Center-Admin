-- Align pre-existing SC operational income table with the API and retry worker.
-- Additive metadata only; does not create journal/payment/bank mutations.
ALTER TABLE sport_center.sc_income_entries
  ADD COLUMN IF NOT EXISTS sheet_sync_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE sport_center.sc_income_entries
  DROP CONSTRAINT IF EXISTS sc_income_entries_source_name_check,
  ADD CONSTRAINT sc_income_entries_source_name_check
    CHECK (length(btrim(source_name)) BETWEEN 2 AND 160);

ALTER TABLE sport_center.sc_income_entries
  DROP CONSTRAINT IF EXISTS sc_income_entries_sender_bank_check,
  ADD CONSTRAINT sc_income_entries_sender_bank_check
    CHECK (length(btrim(sender_bank)) BETWEEN 2 AND 120);

ALTER TABLE sport_center.sc_income_entries
  DROP CONSTRAINT IF EXISTS sc_income_entries_receiving_account_check,
  ADD CONSTRAINT sc_income_entries_receiving_account_check
    CHECK (length(btrim(receiving_account)) <= 160
      AND (method <> 'Transfer Bank' OR length(btrim(receiving_account)) >= 2));

-- Keep the conservative reconciliation guard: SC records are UNVERIFIED.
