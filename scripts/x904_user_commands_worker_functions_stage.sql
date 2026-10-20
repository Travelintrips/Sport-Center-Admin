-- Run after x904_user_commands_stage.sql. No write commands are sent by this migration.
-- SECURITY DEFINER is intentionally restricted to the existing VMSC evidence DB role.
CREATE OR REPLACE FUNCTION sport_center.x904_claim_user_command()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sport_center
AS $x904$
DECLARE c record;
BEGIN
  IF session_user NOT IN ('x904_vmsc_evidence_login','postgres') THEN
    RAISE EXCEPTION 'X904_WORKER_UNAUTHORIZED';
  END IF;
  WITH candidate AS (
    SELECT command_id FROM sport_center.x904_user_commands
    WHERE device_serial='TDBD234200545' AND state='queued' AND attempts=0
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE sport_center.x904_user_commands q SET state='claimed',
    lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds',
    attempts=attempts+1
  FROM candidate WHERE q.command_id=candidate.command_id
  RETURNING q.command_id,q.command_type,q.user_pin,q.payload,q.lease_token
  INTO c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('commandId',c.command_id,'commandType',c.command_type,
    'userPin',c.user_pin,'payload',c.payload,'leaseToken',c.lease_token,
    'deviceSerial','TDBD234200545');
END $x904$;

CREATE OR REPLACE FUNCTION sport_center.x904_complete_user_command(
  p_command_id uuid,p_lease_token uuid,p_readback boolean,p_device_uid integer,
  p_count_before integer,p_count_after integer,p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sport_center
AS $x904$
DECLARE cmd text; verified boolean := false;
BEGIN
  IF session_user NOT IN ('x904_vmsc_evidence_login','postgres') THEN
    RAISE EXCEPTION 'X904_WORKER_UNAUTHORIZED';
  END IF;
  IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'INVALID_ERROR_CODE';
  END IF;
  SELECT command_type INTO cmd FROM sport_center.x904_user_commands
  WHERE command_id=p_command_id AND lease_token=p_lease_token
    AND device_serial='TDBD234200545' AND state='claimed'
    AND leased_until>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  verified := p_readback IS TRUE
    AND p_device_uid BETWEEN 1 AND 65534
    AND p_count_before BETWEEN 1 AND 10000
    AND p_count_after BETWEEN 0 AND 10000
    AND ((cmd='CREATE_USER' AND p_count_after=p_count_before+1)
      OR (cmd='UPDATE_USER' AND p_count_after=p_count_before)
      OR (cmd='DELETE_USER' AND p_count_after=p_count_before-1));
  UPDATE sport_center.x904_user_commands
  SET state=CASE WHEN verified THEN 'completed' ELSE 'failed' END,
    result=jsonb_build_object('readBackConfirmed',verified,'deviceUid',p_device_uid,
      'beforeCount',p_count_before,'afterCount',p_count_after,
      'errorCode',CASE WHEN verified THEN NULL ELSE coalesce(p_error_code,'READBACK_MISMATCH') END),
    completed_at=now(),leased_until=NULL
  WHERE command_id=p_command_id AND lease_token=p_lease_token;
  RETURN true;
END $x904$;

REVOKE ALL ON FUNCTION sport_center.x904_claim_user_command() FROM PUBLIC;
REVOKE ALL ON FUNCTION sport_center.x904_complete_user_command(uuid,uuid,boolean,integer,integer,integer,text) FROM PUBLIC;
REVOKE ALL ON TABLE sport_center.x904_user_commands FROM PUBLIC;

DO $x904$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='x904_vmsc_evidence_login') THEN
   EXECUTE 'GRANT USAGE ON SCHEMA sport_center TO x904_vmsc_evidence_login';
   EXECUTE 'GRANT EXECUTE ON FUNCTION sport_center.x904_claim_user_command() TO x904_vmsc_evidence_login';
   EXECUTE 'GRANT EXECUTE ON FUNCTION sport_center.x904_complete_user_command(uuid,uuid,boolean,integer,integer,integer,text) TO x904_vmsc_evidence_login';
 END IF;
END $x904$;
