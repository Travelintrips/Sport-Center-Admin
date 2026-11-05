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
