-- DEV/TEST ONLY. Verify target DB identity and backup before executing.
BEGIN;
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_processed_events (
  event_id text PRIMARY KEY REFERENCES sport_center.gym_x904_raw_events(event_id) ON DELETE RESTRICT,
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('success', 'failed', 'review_required'))
);
CREATE INDEX IF NOT EXISTS gym_x904_processed_events_device_time_idx
  ON sport_center.gym_x904_processed_events (device_serial, processed_at DESC);
REVOKE ALL ON sport_center.gym_x904_processed_events FROM PUBLIC;
COMMIT;
