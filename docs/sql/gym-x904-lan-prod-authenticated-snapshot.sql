-- Applied additively to Sport Center PROD (nzdweipzckfszczzqtuw) on 2026-10-15.
-- Authenticated physical X904 LAN data only; never copy rows from CST-DEV.
-- Independent from legacy ADMS, membership, booking, payment or door operations.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_auth (
  device_serial text PRIMARY KEY,
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_users (
  device_serial text NOT NULL, user_pin text NOT NULL, device_uid integer NOT NULL,
  display_name text NOT NULL, device_role integer NOT NULL,
  last_seen_snapshot uuid NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_serial,user_pin)
);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_logs (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[a-f0-9]{64}$'),
  device_serial text NOT NULL,
  event_index integer NOT NULL CHECK (event_index >= 0),
  user_pin text NOT NULL, device_uid integer NOT NULL,
  device_time text NOT NULL, last_seen_snapshot uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_pending_users (
  device_serial text NOT NULL, snapshot_id uuid NOT NULL, user_pin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_serial,snapshot_id,user_pin)
);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_pending_logs (
  device_serial text NOT NULL, snapshot_id uuid NOT NULL, event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_serial,snapshot_id,event_id)
);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_state (
  device_serial text PRIMARY KEY, last_snapshot_id uuid NOT NULL,
  user_count integer NOT NULL CHECK (user_count >= 0),
  device_log_count integer NOT NULL CHECK (device_log_count >= 0),
  stored_log_count integer NOT NULL CHECK (stored_log_count >= 0),
  last_authenticated_at timestamptz NOT NULL DEFAULT now(),
  last_complete_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gym_x904_lan_users_live_idx
  ON sport_center.gym_x904_lan_users(device_serial,last_seen_snapshot);
CREATE INDEX IF NOT EXISTS gym_x904_lan_logs_live_idx
  ON sport_center.gym_x904_lan_logs(device_serial,last_seen_snapshot,device_time DESC);
ALTER TABLE sport_center.gym_x904_lan_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_x904_lan_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_x904_lan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_x904_lan_pending_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_x904_lan_pending_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_x904_lan_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.gym_x904_lan_auth FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_center.gym_x904_lan_users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_center.gym_x904_lan_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_center.gym_x904_lan_pending_users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_center.gym_x904_lan_pending_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_center.gym_x904_lan_state FROM PUBLIC, anon, authenticated;

-- Limited internal backend read path. Browser roles still cannot query these tables.
REVOKE ALL ON sport_center.gym_x904_lan_auth FROM sport_center_app;
REVOKE ALL ON sport_center.gym_x904_lan_pending_users FROM sport_center_app;
REVOKE ALL ON sport_center.gym_x904_lan_pending_logs FROM sport_center_app;
GRANT SELECT ON sport_center.gym_x904_lan_state TO sport_center_app;
GRANT SELECT ON sport_center.gym_x904_lan_users TO sport_center_app;
GRANT SELECT ON sport_center.gym_x904_lan_logs TO sport_center_app;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='gym_x904_lan_state' AND policyname='x904_internal_app_lan_state_read') THEN
    CREATE POLICY x904_internal_app_lan_state_read ON sport_center.gym_x904_lan_state FOR SELECT TO sport_center_app USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='gym_x904_lan_users' AND policyname='x904_internal_app_lan_users_read') THEN
    CREATE POLICY x904_internal_app_lan_users_read ON sport_center.gym_x904_lan_users FOR SELECT TO sport_center_app USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='gym_x904_lan_logs' AND policyname='x904_internal_app_lan_logs_read') THEN
    CREATE POLICY x904_internal_app_lan_logs_read ON sport_center.gym_x904_lan_logs FOR SELECT TO sport_center_app USING (true);
  END IF;
END $$;
