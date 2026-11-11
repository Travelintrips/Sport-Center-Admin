-- A read-back verified balance from Google Sheets E for TEST rows only.
ALTER TABLE sport_center.sc_finance_test_entries
  ADD COLUMN IF NOT EXISTS sheet_balance numeric(15,2);
