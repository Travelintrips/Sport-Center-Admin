-- PREPARATION ONLY: no live device commands, no modifications to existing payment methods.
-- Link a verified nonmember PIN to a canonical booking and paid transaction, not a public-login account.
CREATE TABLE IF NOT EXISTS sport_center.x904_nonmember_daily_access (
  access_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_serial text NOT NULL CHECK (device_serial = 'TDBD234200545'),
  user_pin text NOT NULL CHECK (user_pin ~ '^[0-9]{1,8}$'),
  device_uid integer NOT NULL CHECK (device_uid > 0),
  verified_name text NOT NULL CHECK (length(btrim(verified_name)) > 0),
  booking_id integer NOT NULL UNIQUE REFERENCES sport_center.sport_bookings(id),
  payment_id integer NOT NULL UNIQUE REFERENCES sport_center.sport_payments(id),
  confirmed_at timestamptz NOT NULL,
  expires_at timestamptz GENERATED ALWAYS AS (confirmed_at + interval '12 hours') STORED,
  verification_state text NOT NULL DEFAULT 'pending' CHECK (verification_state IN ('pending','verified','review_required')),
  access_state text NOT NULL DEFAULT 'pending' CHECK (access_state IN ('pending','active','expired','review_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confirmed_at > '2026-01-01'::timestamptz)
);
CREATE INDEX IF NOT EXISTS x904_nonmember_daily_due_idx
  ON sport_center.x904_nonmember_daily_access(access_state,expires_at);
ALTER TABLE sport_center.x904_nonmember_daily_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.x904_nonmember_daily_access FROM PUBLIC, anon, authenticated;
