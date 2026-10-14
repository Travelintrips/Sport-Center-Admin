-- Applied additively to Sport Center PROD on 2026-10-14.
-- LAN SDK events must not be mixed with unverified ADMS rows.
-- Unknown attendance status and verification mode intentionally remain NULL.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_events (
 event_id text PRIMARY KEY,
 device_serial text NOT NULL,
 event_index integer NOT NULL,
 user_pin text NOT NULL,
 device_uid integer,
 device_time text NOT NULL,
 attendance_status integer NULL,
 verification_type integer NULL,
 source text NOT NULL DEFAULT 'authenticated_lan_sdk',
 received_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT gym_x904_lan_events_valid_source CHECK (source = 'authenticated_lan_sdk'),
 CONSTRAINT gym_x904_lan_events_pin_check CHECK (user_pin ~ '^[A-Za-z0-9_-]{1,50}$'),
 CONSTRAINT gym_x904_lan_events_timestamp_check CHECK (device_time ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'),
 CONSTRAINT gym_x904_lan_events_nonnegative_index CHECK (event_index >= 0)
);
CREATE INDEX IF NOT EXISTS gym_x904_lan_events_device_time_idx ON sport_center.gym_x904_lan_events(device_time DESC);
REVOKE ALL ON TABLE sport_center.gym_x904_lan_events FROM anon, authenticated;
