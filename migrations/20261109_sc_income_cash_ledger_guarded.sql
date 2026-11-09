-- Separate, auditable cash-sheet delivery state. No historical backfill.
-- Never run bank-account receipts through this cash-only delivery path.
ALTER TABLE sport_center.sc_income_entries
  ADD COLUMN IF NOT EXISTS cash_received_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cash_sheet_state text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS cash_sheet_row integer,
  ADD COLUMN IF NOT EXISTS cash_sheet_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_sheet_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS cash_sheet_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS cash_sheet_error text;
