-- Dedicated queue for unverified X904 LAN scan observations. Does not touch check-in ledger.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_wa_outbox (
 event_id text PRIMARY KEY REFERENCES sport_center.gym_x904_lan_logs(event_id),
 group_id text NOT NULL,
 body text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','pending_ack','sent','failed')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 locked_until timestamptz,
 gateway_message_id text,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS gym_x904_lan_wa_outbox_due_idx
 ON sport_center.gym_x904_lan_wa_outbox(group_id,status,next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS gym_x904_lan_wa_message_idx
 ON sport_center.gym_x904_lan_wa_outbox(gateway_message_id) WHERE gateway_message_id IS NOT NULL;
