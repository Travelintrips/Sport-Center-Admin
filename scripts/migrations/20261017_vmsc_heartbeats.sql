-- VMSC monitoring ONLY. No attendance data or X904 ledger mutations.
CREATE SCHEMA IF NOT EXISTS sport_center;
CREATE TABLE IF NOT EXISTS sport_center.vmsc_heartbeats (
  device_id text PRIMARY KEY CHECK (device_id = 'VMSC'),
  device_serial text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  device_status text NOT NULL DEFAULT 'online' CHECK (device_status IN ('online', 'offline'))
);
REVOKE ALL ON sport_center.vmsc_heartbeats FROM PUBLIC;
-- Effective status must be derived from last_seen_at, not the stale stored
-- device_status value: offline when now() - last_seen_at >= 300 seconds.
