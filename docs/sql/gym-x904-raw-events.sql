-- Apply only to designated Sport Center DEV database first.
-- Production migration requires verified backup, review and explicit release gate.
-- Does not touch existing membership, booking, payments, or access-control data.
CREATE SCHEMA IF NOT EXISTS sport_center;
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_raw_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[a-f0-9]{64}$'),
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  device_time text NOT NULL,
  attendance_status integer NOT NULL,
  verification_type integer NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gym_x904_raw_events_device_time_idx
ON sport_center.gym_x904_raw_events (device_time DESC);
REVOKE ALL ON sport_center.gym_x904_raw_events FROM PUBLIC;
-- Grant table permissions only to the dedicated backend DB role after review.
