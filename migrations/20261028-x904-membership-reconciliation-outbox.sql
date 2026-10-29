-- Safe foundation only: no device writes, no active trigger, no automatic suspension.
-- Apply to isolated DEV first; validate against PROD before deployment.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_membership_reconciliation_outbox (
  event_key text PRIMARY KEY CHECK (event_key ~ '^[a-f0-9]{64}$'),
  membership_id integer NOT NULL,
  device_serial text NOT NULL,
  user_pin text,
  device_uid integer,
  entitlement text NOT NULL CHECK (entitlement IN ('active','grace_period','suspended','review_required')),
  identity_status text NOT NULL CHECK (identity_status IN ('verified','review_required')),
  operation_state text NOT NULL DEFAULT 'review_required' CHECK (operation_state IN ('ready','review_required','completed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT x904_recon_no_unverified_ready CHECK (
    operation_state <> 'ready' OR
    (identity_status='verified' AND user_pin IS NOT NULL AND device_uid BETWEEN 1 AND 65534)
  )
);
CREATE INDEX IF NOT EXISTS x904_membership_reconciliation_member_created_idx
  ON sport_center.gym_x904_membership_reconciliation_outbox (membership_id,created_at DESC);
COMMENT ON TABLE sport_center.gym_x904_membership_reconciliation_outbox IS
  'Review-only audit outbox. No machine command consumer; unique event_key prevents duplicate reconciliation receipts.';
