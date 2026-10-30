-- Dedicated durable Gateway delivery lifecycle for the existing daily usage queue.
-- Idempotent; do not touch legacy LAN scan digest or historical message rows.
ALTER TABLE sport_center.x904_gym_usage_wa_queue
  ADD COLUMN IF NOT EXISTS gateway_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_body text,
  ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'pending';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='x904_gym_usage_delivery_state_check'
    AND conrelid='sport_center.x904_gym_usage_wa_queue'::regclass) THEN
    ALTER TABLE sport_center.x904_gym_usage_wa_queue
      ADD CONSTRAINT x904_gym_usage_delivery_state_check
      CHECK (delivery_state IN ('pending','sending','pending_ack','sent','failed'));
  END IF;
END $$;
