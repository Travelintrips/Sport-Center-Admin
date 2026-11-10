-- Reconcile deletions/edits performed manually in Google Sheets without re-append.
ALTER TABLE sport_center.sc_finance_test_entries
  DROP CONSTRAINT IF EXISTS sc_finance_test_entries_sheet_sync_state_check;
ALTER TABLE sport_center.sc_finance_test_entries
  ADD CONSTRAINT sc_finance_test_entries_sheet_sync_state_check
  CHECK (sheet_sync_state IN ('pending','syncing','failed','synced','removed','mismatch'));
