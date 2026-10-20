-- Staging migration only. Do not apply in PROD until worker and audit verification are PASS.
CREATE TABLE IF NOT EXISTS sport_center.x904_user_commands (
 command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 device_serial text NOT NULL,
 command_type text NOT NULL CHECK (command_type IN ('CREATE_USER','UPDATE_USER','DELETE_USER')),
 user_pin text NOT NULL CHECK (user_pin ~ '^[0-9]{1,12}$'),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 requested_by bigint NOT NULL,
 idempotency_key text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','completed','failed','cancelled')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS x904_user_commands_pending_idx ON sport_center.x904_user_commands(created_at) WHERE state='queued';
