-- X904 verified attendance outbox; apply in DEV first.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_wa_outbox (
 event_id text PRIMARY KEY REFERENCES sport_center.gym_x904_processed_events(event_id),
 device_serial text NOT NULL,
 user_pin text NOT NULL,
 member_name text NOT NULL,
 device_time text NOT NULL,
 attendance_date date NOT NULL,
 verification_method text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','pending_ack','sent','failed')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 locked_until timestamptz,
 gateway_message_id text,
 batch_id text,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz
);
-- event_id uniquely identifies the notification; repeat scans on one day are valid.
CREATE INDEX IF NOT EXISTS gym_x904_wa_outbox_due_idx ON sport_center.gym_x904_wa_outbox(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_wa_batches (
 batch_id text PRIMARY KEY,
 group_id text NOT NULL,
 body text NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 gateway_message_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 locked_until timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gym_x904_wa_outbox_batch_idx ON sport_center.gym_x904_wa_outbox(batch_id);
