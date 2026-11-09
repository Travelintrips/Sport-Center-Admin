-- Preserve idempotency by entry_key; bank reference uniqueness remains mandatory.
-- Fingerprint is a warning for same-day similar transactions, not a prohibition.
ALTER TABLE sport_center.sc_income_entries
  DROP CONSTRAINT IF EXISTS sc_income_entries_fingerprint_key;
CREATE INDEX IF NOT EXISTS sc_income_entries_fingerprint_idx
  ON sport_center.sc_income_entries (fingerprint);
