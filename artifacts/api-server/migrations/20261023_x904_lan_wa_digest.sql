-- X904-only durable digest storage. No changes to booking, payments or other WhatsApp queues.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_wa_batches (
  batch_id text PRIMARY KEY,
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
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_wa_batch_events (
  event_id text PRIMARY KEY REFERENCES sport_center.gym_x904_lan_logs(event_id),
  batch_id text NOT NULL REFERENCES sport_center.gym_x904_lan_wa_batches(batch_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gym_x904_lan_wa_batches_ready_idx
 ON sport_center.gym_x904_lan_wa_batches(status,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS gym_x904_lan_wa_batch_events_batch_idx
 ON sport_center.gym_x904_lan_wa_batch_events(batch_id);

-- Activation is explicit and disabled until PROD deployment is verified.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_lan_wa_digest_config (
  config_key text PRIMARY KEY,
  activated_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO sport_center.gym_x904_lan_wa_digest_config(config_key,enabled)
 VALUES ('main',false) ON CONFLICT (config_key) DO NOTHING;
