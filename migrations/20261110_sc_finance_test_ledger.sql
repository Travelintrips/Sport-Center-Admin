-- Isolated test-only ledger. No FK to payments, bank_mutations or accounting.
CREATE TABLE IF NOT EXISTS sport_center.sc_finance_test_entries (
  id bigserial PRIMARY KEY,
  entry_key uuid NOT NULL UNIQUE,
  direction text NOT NULL CHECK (direction IN ('IN','OUT')),
  transaction_date date NOT NULL,
  source_name text NOT NULL,
  sender_bank text NOT NULL DEFAULT '',
  receiving_account text NOT NULL DEFAULT '',
  method text NOT NULL DEFAULT '',
  bank_reference text,
  notes text,
  amount numeric(15,0) NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  sheet_sync_state text NOT NULL DEFAULT 'pending'
    CHECK (sheet_sync_state IN ('pending','syncing','failed','synced')),
  sheet_row integer,
  sheet_sync_attempts integer NOT NULL DEFAULT 0,
  sheet_sync_started_at timestamptz,
  sheet_sync_error text,
  sheet_synced_at timestamptz,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_finance_test_sync_state_idx
  ON sport_center.sc_finance_test_entries(sheet_sync_state, id);
ALTER TABLE sport_center.sc_finance_test_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sport_center.sc_finance_test_entries TO sport_center_app;
GRANT USAGE,SELECT ON SEQUENCE sport_center.sc_finance_test_entries_id_seq TO sport_center_app;
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname='sport_center'
   AND tablename='sc_finance_test_entries' AND policyname='sc_finance_test_app_internal'
 ) THEN
  CREATE POLICY sc_finance_test_app_internal ON sport_center.sc_finance_test_entries
    FOR ALL TO sport_center_app USING (true) WITH CHECK (true);
 END IF;
END $$;
