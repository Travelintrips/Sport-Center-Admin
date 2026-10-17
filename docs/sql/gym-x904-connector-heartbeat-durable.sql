-- Apply to CST DEV first; production requires separate deployment approval.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_connector_heartbeats (
 device_serial text PRIMARY KEY,
 connector_id text NOT NULL,
 last_seen timestamptz NOT NULL DEFAULT now(),
 reported_users integer NOT NULL CHECK (reported_users BETWEEN 0 AND 100000),
 reported_logs integer NOT NULL CHECK (reported_logs BETWEEN 0 AND 1000000),
 read_authenticated boolean NOT NULL DEFAULT true
);
REVOKE ALL ON sport_center.gym_x904_connector_heartbeats FROM PUBLIC, anon, authenticated;
