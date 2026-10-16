-- DEV ONLY: apply only in isolated CST-DEV database after review.
-- No biometric access, no door control, no write-to-device commands.
CREATE SCHEMA IF NOT EXISTS sport_center;
CREATE TABLE IF NOT EXISTS sport_center.x904_vmsc_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL DEFAULT 'VMSC' CHECK(device_id = 'VMSC'),
  command_type text NOT NULL CHECK(command_type IN ('device_info','clock_read')),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','claimed','completed','failed','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  claimed_at timestamptz,
  finished_at timestamptz,
  claim_token_hash text,
  result_json jsonb,
  error_code text,
  CONSTRAINT command_expiration_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX IF NOT EXISTS x904_vmsc_commands_status_idx
  ON sport_center.x904_vmsc_commands(status, created_at);
CREATE TABLE IF NOT EXISTS sport_center.x904_vmsc_command_receipts (
  command_id uuid PRIMARY KEY REFERENCES sport_center.x904_vmsc_commands(id),
  callback_received_at timestamptz NOT NULL DEFAULT now(),
  result_sha256 text NOT NULL,
  verified boolean NOT NULL DEFAULT false
);
REVOKE ALL ON sport_center.x904_vmsc_commands FROM PUBLIC;
REVOKE ALL ON sport_center.x904_vmsc_command_receipts FROM PUBLIC;
