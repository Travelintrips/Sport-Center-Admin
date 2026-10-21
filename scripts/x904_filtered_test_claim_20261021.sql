-- Target-filtered X904 claim. Does not touch attendance or biometric records.
CREATE OR REPLACE FUNCTION sport_center.x904_claim_user_command(p_user_pin text, p_expected_uid integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sport_center
AS $x904$
DECLARE c record;
BEGIN
  IF session_user NOT IN ('x904_vmsc_evidence_login','postgres') THEN
    RAISE EXCEPTION 'X904_WORKER_UNAUTHORIZED';
  END IF;
  IF p_user_pin IS NULL OR p_user_pin !~ '^[0-9]{1,8}$'
     OR p_expected_uid IS NULL OR p_expected_uid NOT BETWEEN 1 AND 65534 THEN
    RAISE EXCEPTION 'INVALID_TEST_TARGET';
  END IF;
  WITH candidate AS (
    SELECT command_id FROM sport_center.x904_user_commands
    WHERE device_serial='TDBD234200545'
      AND state='queued' AND attempts=0
      AND user_pin=p_user_pin
      AND payload->>'expectedUid'=p_expected_uid::text
      AND command_type IN ('UPDATE_USER','DELETE_USER')
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE sport_center.x904_user_commands q
  SET state='claimed', lease_token=gen_random_uuid(),
      leased_until=now()+interval '120 seconds', attempts=attempts+1
  FROM candidate WHERE q.command_id=candidate.command_id
  RETURNING q.command_id,q.command_type,q.user_pin,q.payload,q.lease_token INTO c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('commandId',c.command_id,'commandType',c.command_type,
    'userPin',c.user_pin,'payload',c.payload,'leaseToken',c.lease_token,
    'deviceSerial','TDBD234200545');
END $x904$;

REVOKE ALL ON FUNCTION sport_center.x904_claim_user_command(text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION sport_center.x904_claim_user_command() FROM PUBLIC;
REVOKE ALL ON FUNCTION sport_center.x904_claim_user_command() FROM x904_vmsc_evidence_login;
GRANT EXECUTE ON FUNCTION sport_center.x904_claim_user_command(text,integer)
 TO x904_vmsc_evidence_login;
