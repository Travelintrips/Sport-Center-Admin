-- STAGING ONLY: apply after review; does not enable any machine writes.
-- Group-specific ACK requires verified group readback and unchanged user count.
CREATE OR REPLACE FUNCTION sport_center.x904_complete_group_command(
 p_command_id uuid,p_lease_token uuid,p_readback boolean,p_device_uid integer,
 p_count_before integer,p_count_after integer,p_group_before integer,p_group_after integer,
 p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sport_center
AS $$
DECLARE c record; verified boolean;
BEGIN
 IF session_user NOT IN ('x904_vmsc_evidence_login','postgres') THEN
   RAISE EXCEPTION 'X904_WORKER_UNAUTHORIZED';
 END IF;
 IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z0-9_]{1,64}$' THEN
   RAISE EXCEPTION 'INVALID_ERROR_CODE';
 END IF;
 SELECT command_type,payload INTO c FROM sport_center.x904_user_commands
 WHERE command_id=p_command_id AND lease_token=p_lease_token
   AND device_serial='TDBD234200545' AND state='claimed'
   AND leased_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF c.command_type NOT IN ('SUSPEND_USER','ACTIVATE_USER') THEN RETURN false; END IF;
 verified := p_readback IS TRUE
   AND p_device_uid BETWEEN 1 AND 65534
   AND p_device_uid=(c.payload->>'expectedUid')::integer
   AND p_count_before BETWEEN 1 AND 10000
   AND p_count_after=p_count_before
   AND p_group_before IN (1,2)
   AND p_group_after=CASE WHEN c.command_type='SUSPEND_USER' THEN 2 ELSE 1 END;
 UPDATE sport_center.x904_user_commands
 SET state=CASE WHEN verified THEN 'completed' ELSE 'failed' END,
   result=jsonb_build_object('readBackConfirmed',verified,'deviceUid',p_device_uid,
     'beforeCount',p_count_before,'afterCount',p_count_after,
     'beforeGroup',p_group_before,'afterGroup',p_group_after,
     'errorCode',CASE WHEN verified THEN NULL ELSE coalesce(p_error_code,'GROUP_READBACK_MISMATCH') END),
   completed_at=now(),leased_until=NULL
 WHERE command_id=p_command_id AND lease_token=p_lease_token;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION sport_center.x904_complete_group_command(uuid,uuid,boolean,integer,integer,integer,integer,integer,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='x904_vmsc_evidence_login') THEN
  GRANT EXECUTE ON FUNCTION sport_center.x904_complete_group_command(uuid,uuid,boolean,integer,integer,integer,integer,integer,text) TO x904_vmsc_evidence_login;
 END IF;
END $$;
