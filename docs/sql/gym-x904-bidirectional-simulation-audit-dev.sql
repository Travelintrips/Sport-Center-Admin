-- DEV ONLY: audited preview, not device command execution.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_sync_review_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 queue_id bigint NOT NULL REFERENCES sport_center.gym_x904_sync_review_queue(id),
 action text NOT NULL, actor text NOT NULL,
 from_status text, to_status text,
 created_at timestamptz NOT NULL DEFAULT now(), notes text
);
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_sync_simulation(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 queue_id bigint NOT NULL REFERENCES sport_center.gym_x904_sync_review_queue(id),
 idempotency_key text NOT NULL UNIQUE,
 direction text NOT NULL CHECK(direction IN ('sc_to_x904','x904_to_sc')),
 action text NOT NULL,
 result text NOT NULL CHECK(result IN ('blocked_mapping_unverified','blocked_protocol_unverified','ready_for_manual_review')),
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON sport_center.gym_x904_sync_review_audit,sport_center.gym_x904_sync_simulation FROM PUBLIC,anon,authenticated;
-- No automation or database trigger sends commands to VMSC/X904.
