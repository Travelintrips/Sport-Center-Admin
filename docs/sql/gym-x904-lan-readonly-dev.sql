-- DEV-FIRST ONLY. Apply to CST-DEV. No PROD migration without verified backup and release gate.
-- Local connector may read IDs/names and attendance times; biometric templates remain on X904.
CREATE SCHEMA IF NOT EXISTS sport_center;
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_users (
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  device_uid integer NOT NULL,
  display_name text NOT NULL,
  device_role integer NOT NULL,
  last_seen_snapshot uuid NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_serial, user_pin)
);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_logs (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[a-f0-9]{64}$'),
  device_serial text NOT NULL,
  event_index integer NOT NULL CHECK (event_index >= 0),
  user_pin text NOT NULL,
  device_uid integer NOT NULL,
  device_time text NOT NULL,
  last_seen_snapshot uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gym_x904_lan_logs_lookup
ON sport_center.gym_x904_lan_logs (device_serial, device_time DESC);
CREATE INDEX IF NOT EXISTS gym_x904_lan_logs_snapshot
ON sport_center.gym_x904_lan_logs (device_serial, last_seen_snapshot);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_state (
  device_serial text PRIMARY KEY,
  last_snapshot_id uuid NOT NULL,
  user_count integer NOT NULL CHECK (user_count >= 0),
  device_log_count integer NOT NULL CHECK (device_log_count >= 0),
  stored_log_count integer NOT NULL CHECK (stored_log_count >= 0),
  last_authenticated_at timestamptz NOT NULL DEFAULT now(),
  last_complete_at timestamptz NOT NULL DEFAULT now()
);
-- Backend connects using Postgres table owner. No anon/authenticated/browser access.
ALTER TABLE sport_center.gym_x904_lan_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_x904_lan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_x904_lan_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.gym_x904_lan_users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_center.gym_x904_lan_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_center.gym_x904_lan_state FROM PUBLIC, anon, authenticated;
