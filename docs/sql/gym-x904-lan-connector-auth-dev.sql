-- DEV-only connector credential hash. Raw token remains DPAPI-protected on ALMANO.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_auth (
  device_serial text PRIMARY KEY,
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sport_center.gym_x904_lan_auth ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.gym_x904_lan_auth FROM PUBLIC, anon, authenticated;
