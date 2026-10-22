-- Staged only: apply to DEV first; do not enable production workers until end-to-end ACK is verified.
-- A batch and all its commands are durable in Postgres, independent of browser lifetime.
CREATE TABLE IF NOT EXISTS sport_center.x904_delete_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_serial text NOT NULL CHECK (device_serial='TDBD234200545'),
  requested_by bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sport_center.x904_user_commands
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES sport_center.x904_delete_batches(batch_id),
  ADD COLUMN IF NOT EXISTS batch_order integer;
CREATE UNIQUE INDEX IF NOT EXISTS x904_batch_command_order_uq
  ON sport_center.x904_user_commands(batch_id,batch_order)
  WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS x904_batch_command_status_idx
  ON sport_center.x904_user_commands(batch_id,state,created_at)
  WHERE batch_id IS NOT NULL;
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='x904_batch_order_positive'
   AND conrelid='sport_center.x904_user_commands'::regclass) THEN
  ALTER TABLE sport_center.x904_user_commands
    ADD CONSTRAINT x904_batch_order_positive CHECK (
      (batch_id IS NULL AND batch_order IS NULL) OR
      (batch_id IS NOT NULL AND batch_order BETWEEN 1 AND 100)
    );
 END IF;
END $guard$;
REVOKE ALL ON sport_center.x904_delete_batches FROM PUBLIC,anon,authenticated;

-- Separate claim function: existing single-user test claims are not widened by this migration.
-- Worker must opt in explicitly, authenticate as the restricted VMSC DB role,
-- and verify target PIN/UID/name on the physical device before sending DELETE_USER.
CREATE OR REPLACE FUNCTION sport_center.x904_claim_batch_delete_command()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sport_center
AS $claim$
DECLARE c record;
BEGIN
  IF session_user NOT IN ('x904_vmsc_evidence_login','postgres') THEN
    RAISE EXCEPTION 'X904_WORKER_UNAUTHORIZED';
  END IF;
  WITH candidate AS (
    SELECT q.command_id FROM sport_center.x904_user_commands q
    JOIN sport_center.x904_delete_batches b ON b.batch_id=q.batch_id
    WHERE q.device_serial='TDBD234200545'
      AND q.command_type='DELETE_USER' AND q.state='queued' AND q.attempts=0
      AND q.batch_id IS NOT NULL AND q.batch_order>=1
      AND (q.payload->>'expectedUid') ~ '^[0-9]{1,5}$'
      AND (q.payload->>'expectedUid')::integer BETWEEN 1 AND 65534
      AND q.payload->>'expectedName' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sport_center.x904_user_commands prev
        WHERE prev.batch_id=q.batch_id AND prev.batch_order<q.batch_order
          AND prev.state<>'completed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM sport_center.x904_user_commands active
        WHERE active.device_serial=q.device_serial AND active.state='claimed'
      )
    ORDER BY b.created_at,q.batch_order,q.created_at
    FOR UPDATE OF q SKIP LOCKED LIMIT 1
  )
  UPDATE sport_center.x904_user_commands q
    SET state='claimed',lease_token=gen_random_uuid(),
      leased_until=now()+interval '120 seconds',attempts=attempts+1
    FROM candidate WHERE q.command_id=candidate.command_id
    RETURNING q.command_id,q.command_type,q.user_pin,q.payload,q.lease_token INTO c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('commandId',c.command_id,'commandType',c.command_type,
    'userPin',c.user_pin,'payload',c.payload,'leaseToken',c.lease_token,
    'deviceSerial','TDBD234200545');
END $claim$;
REVOKE ALL ON FUNCTION sport_center.x904_claim_batch_delete_command() FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='x904_vmsc_evidence_login') THEN
  GRANT USAGE ON SCHEMA sport_center TO x904_vmsc_evidence_login;
  GRANT EXECUTE ON FUNCTION sport_center.x904_claim_batch_delete_command() TO x904_vmsc_evidence_login;
 END IF;
END $grant$;
-- Fail-closed: failed/expired ACK blocks subsequent batch items; never replay writes automatically.
