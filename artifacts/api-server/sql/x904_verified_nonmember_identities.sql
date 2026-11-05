-- Apply in a controlled migration before deploying the registry worker.
-- Verified identities are explicitly operator-approved, not inferred from absent memberships.
CREATE TABLE IF NOT EXISTS sport_center.x904_verified_nonmember_identities (
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  device_uid integer NOT NULL CHECK (device_uid > 0),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  verification_state text NOT NULL DEFAULT 'review_required'
    CHECK (verification_state IN ('review_required','verified','revoked')),
  verified_by text,
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_serial,user_pin),
  CHECK (verification_state <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
ALTER TABLE sport_center.x904_verified_nonmember_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.x904_verified_nonmember_identities FROM anon,authenticated;
-- Preserve the three already confirmed and physically verified identities.
INSERT INTO sport_center.x904_verified_nonmember_identities
  (device_serial,user_pin,device_uid,display_name,verification_state,verified_by,verified_at)
VALUES
  ('TDBD234200545','109',124,'sugi','verified','operator-confirmed-2026-11-05','2026-11-05T00:00:00Z'),
  ('TDBD234200545','116',131,'angel','verified','operator-confirmed-2026-11-05','2026-11-05T00:00:00Z'),
  ('TDBD234200545','147',162,'HELMI S','verified','operator-confirmed-2026-11-05','2026-11-05T00:00:00Z')
ON CONFLICT (device_serial,user_pin) DO NOTHING;
-- New PINs must be inserted as review_required until identity and membership are verified.
