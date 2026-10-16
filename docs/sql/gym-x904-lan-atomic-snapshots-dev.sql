-- Stage each authenticated read without altering the currently completed snapshot.
-- The edge gateway switches the public snapshot and clears staging atomically.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_pending_users (
  device_serial text NOT NULL,
  snapshot_id uuid NOT NULL,
  user_pin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_serial, snapshot_id, user_pin)
);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_pending_logs (
  device_serial text NOT NULL,
  snapshot_id uuid NOT NULL,
  event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_serial, snapshot_id, event_id)
);
ALTER TABLE sport_center.gym_x904_lan_pending_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_x904_lan_pending_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.gym_x904_lan_pending_users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON sport_center.gym_x904_lan_pending_logs FROM PUBLIC, anon, authenticated;
