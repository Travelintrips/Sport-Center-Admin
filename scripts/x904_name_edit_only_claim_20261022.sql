CREATE OR REPLACE FUNCTION sport_center.x904_claim_name_edit_command()
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
    WHERE device_serial='TDBD234200545'
      AND state='queued' AND attempts=0
      AND command_type='UPDATE_USER'
      AND user_pin ~ '^[0-9]{1,8}
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


      AND payload->>'expectedUid' ~ '^[0-9]{1,5}
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


      AND (payload->>'expectedUid')::integer BETWEEN 1 AND 65534
      AND payload->>'expectedName' IS NOT NULL
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

REVOKE ALL ON FUNCTION sport_center.x904_claim_name_edit_command() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sport_center.x904_claim_name_edit_command() TO x904_vmsc_evidence_login;
