-- Staging migration only. Do not apply in PROD until worker and audit verification are PASS.
CREATE TABLE IF NOT EXISTS sport_center.x904_user_commands (
 command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 device_serial text NOT NULL,
 command_type text NOT NULL CHECK (command_type IN ('CREATE_USER','UPDATE_USER','DELETE_USER')),
 user_pin text NOT NULL CHECK (user_pin ~ '^[0-9]{1,12}$'),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 requested_by bigint NOT NULL,
 idempotency_key text NOT NULL UNIQUE,
 lease_token uuid,
 leased_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','completed','failed','cancelled')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS x904_user_commands_pending_idx ON sport_center.x904_user_commands(created_at) WHERE state='queued';

-- The queue is not executable until the operator has deployed a verified VMSC worker.
-- Fail-closed: expired leases remain claimed for manual review (no automatic replay of writes).
