-- Apply to DEV first. Production requires explicit migration approval.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_wa_outbox (
  event_id text PRIMARY KEY REFERENCES sport_center.gym_x904_processed_events(event_id),
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  member_name text NOT NULL,
  device_time text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  gateway_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS gym_x904_wa_outbox_due_idx
  ON sport_center.gym_x904_wa_outbox(status,next_attempt_at);
