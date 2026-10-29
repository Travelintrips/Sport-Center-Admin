-- Durable, non-device-mutating synchronization events. Financial tables untouched.
CREATE TABLE IF NOT EXISTS sport_center.x904_automatic_entitlement_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  membership_id integer NOT NULL,
  payment_id integer,
  reason text NOT NULL CHECK (reason IN ('PAYMENT_CONFIRMED','DAILY_EXPIRY','PAYMENT_RECOVERY')),
  event_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','review_required','processed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result jsonb
);
CREATE INDEX IF NOT EXISTS x904_auto_entitlement_pending_idx
  ON sport_center.x904_automatic_entitlement_events(state,created_at);
ALTER TABLE sport_center.x904_automatic_entitlement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.x904_automatic_entitlement_events FROM PUBLIC, anon, authenticated;
