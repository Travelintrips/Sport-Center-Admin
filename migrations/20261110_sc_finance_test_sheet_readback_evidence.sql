-- Timestamp of successful direct Google Sheets read-back, including missing rows.
ALTER TABLE sport_center.sc_finance_test_entries
  ADD COLUMN IF NOT EXISTS sheet_verified_at timestamptz;
