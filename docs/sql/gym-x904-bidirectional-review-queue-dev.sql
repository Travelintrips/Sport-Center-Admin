-- CST DEV only. Review queue is not an execution queue.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_sync_review_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  requested_action text NOT NULL CHECK(requested_action IN ('review_mapping','propose_member_update','propose_access_update')),
  status text NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','approved_for_simulation','rejected')),
  membership_id integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by text NULL,
  notes text NULL,
  UNIQUE(device_serial,user_pin,requested_action)
);
REVOKE ALL ON sport_center.gym_x904_sync_review_queue FROM PUBLIC,anon,authenticated;
INSERT INTO sport_center.gym_x904_sync_review_queue(device_serial,user_pin,requested_action,membership_id)
SELECT device_serial,user_pin,'review_mapping',membership_id
FROM sport_center.gym_x904_mapping_readiness
WHERE readiness IN ('MAPPING_NOT_FOUND','MAPPING_NOT_VERIFIED')
ON CONFLICT(device_serial,user_pin,requested_action) DO NOTHING;
-- No worker consumes this table and it cannot trigger X904 device writes.
