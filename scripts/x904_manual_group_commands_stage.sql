-- Staging only. Apply only after VMSC group worker has been tested.
-- Existing queued CUD commands and their state remain unchanged.
ALTER TABLE sport_center.x904_user_commands
  DROP CONSTRAINT IF EXISTS x904_user_commands_command_type_check;
ALTER TABLE sport_center.x904_user_commands
  ADD CONSTRAINT x904_user_commands_command_type_check
  CHECK (command_type IN ('CREATE_USER','UPDATE_USER','DELETE_USER','SUSPEND_USER','ACTIVATE_USER'));
-- Prevent simultaneous queued/claimed operations for a physical PIN.
-- Existing conflicting rows must be reviewed before creating this index.
CREATE UNIQUE INDEX IF NOT EXISTS x904_user_commands_one_active_per_pin
  ON sport_center.x904_user_commands(device_serial,user_pin)
  WHERE state IN ('queued','claimed');
-- IMPORTANT: existing completion function validates only CUD count semantics.
-- Group commands must not be enabled until a separate ACK/readback contract is installed.
