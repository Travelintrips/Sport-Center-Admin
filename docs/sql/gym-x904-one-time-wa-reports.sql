-- One-time X904 group report only; isolated from per-scan durable outbox.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_wa_one_time_reports (
  report_id text PRIMARY KEY,
  group_id text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','failed','pending_ack','sent')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  gateway_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
