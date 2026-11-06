-- DEV-ONLY DRAFT. Do not apply to PROD.
-- Persistence for Gmail transaction detection/reconciliation candidates.
CREATE TABLE IF NOT EXISTS sport_center.qris_email_transactions_dev (
  id bigserial PRIMARY KEY,
  gmail_message_id text NOT NULL UNIQUE,
  source_mailbox text NOT NULL,
  merchant_name text NOT NULL,
  acquirer text NOT NULL,
  provider_reference text NOT NULL,
  issuer_rrn text,
  payer_bank text,
  payer_name text,
  transaction_at timestamptz NOT NULL,
  amount numeric(14,2) NOT NULL,
  tip numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL,
  parse_status text NOT NULL,
  match_status text NOT NULL DEFAULT 'review_required',
  candidate_payment_ids integer[] NOT NULL DEFAULT '{}',
  fingerprint_sha256 text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qris_email_dev_never_final_status
    CHECK (match_status IN ('review_required','reference_match_review','ambiguous','unmatched','invalid'))
);
CREATE UNIQUE INDEX IF NOT EXISTS qris_email_transactions_dev_reference_unique
  ON sport_center.qris_email_transactions_dev(acquirer, provider_reference, transaction_at, total);

-- Intentionally no FK/update trigger to sport_payments:
-- email ingestion must not auto-confirm or mutate the canonical payment ledger.


-- Defense in depth: this DEV ingestion table is server-only.
ALTER TABLE sport_center.qris_email_transactions_dev ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sport_center.qris_email_transactions_dev FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE sport_center.qris_email_transactions_dev_id_seq FROM PUBLIC, anon, authenticated;


-- Least-privilege group role for the isolated DEV runtime.
-- Environment-specific login roles may be granted membership in this NOLOGIN role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qris_gmail_dev_runtime') THEN
    CREATE ROLE qris_gmail_dev_runtime
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      INHERIT
      NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA sport_center TO qris_gmail_dev_runtime;
GRANT SELECT ON sport_center.sport_payments TO qris_gmail_dev_runtime;
GRANT SELECT, INSERT ON sport_center.qris_email_transactions_dev TO qris_gmail_dev_runtime;
GRANT UPDATE (match_status, candidate_payment_ids, updated_at)
  ON sport_center.qris_email_transactions_dev
  TO qris_gmail_dev_runtime;
GRANT USAGE, SELECT ON SEQUENCE sport_center.qris_email_transactions_dev_id_seq
  TO qris_gmail_dev_runtime;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON sport_center.sport_payments
  FROM qris_gmail_dev_runtime;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON sport_center.qris_email_transactions_dev
  FROM qris_gmail_dev_runtime;

DROP POLICY IF EXISTS qris_gmail_dev_runtime_payment_read
  ON sport_center.sport_payments;
CREATE POLICY qris_gmail_dev_runtime_payment_read
  ON sport_center.sport_payments
  FOR SELECT
  TO qris_gmail_dev_runtime
  USING (
    payment_method = 'QRIS'
    AND payment_provider::text = 'mandiri_direct'
    AND status::text NOT IN ('confirmed','rejected')
  );

DROP POLICY IF EXISTS qris_gmail_dev_runtime_detection_read
  ON sport_center.qris_email_transactions_dev;
CREATE POLICY qris_gmail_dev_runtime_detection_read
  ON sport_center.qris_email_transactions_dev
  FOR SELECT
  TO qris_gmail_dev_runtime
  USING (true);

DROP POLICY IF EXISTS qris_gmail_dev_runtime_detection_insert
  ON sport_center.qris_email_transactions_dev;
CREATE POLICY qris_gmail_dev_runtime_detection_insert
  ON sport_center.qris_email_transactions_dev
  FOR INSERT
  TO qris_gmail_dev_runtime
  WITH CHECK (
    parse_status IN ('parsed','invalid')
    AND match_status IN ('review_required','reference_match_review','ambiguous','unmatched','invalid')
  );

DROP POLICY IF EXISTS qris_gmail_dev_runtime_detection_update
  ON sport_center.qris_email_transactions_dev;
CREATE POLICY qris_gmail_dev_runtime_detection_update
  ON sport_center.qris_email_transactions_dev
  FOR UPDATE
  TO qris_gmail_dev_runtime
  USING (true)
  WITH CHECK (
    parse_status IN ('parsed','invalid')
    AND match_status IN ('review_required','reference_match_review','ambiguous','unmatched','invalid')
  );
