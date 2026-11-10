CREATE OR REPLACE FUNCTION sport_center.x904_stage_new_nonmember_candidate(p_command_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','sport_center'
AS $function$
DECLARE
  c record;
  latest record;
  inv record;
  inserted_pin text;
BEGIN
  IF session_user NOT IN ('sport_center_app','postgres') THEN
    RAISE EXCEPTION 'X904_STAGE_CANDIDATE_UNAUTHORIZED';
  END IF;

  SELECT command_id,user_pin,completed_at,payload,result INTO c
  FROM sport_center.x904_user_commands
  WHERE command_id=p_command_id
    AND device_serial='TDBD234200545'
    AND command_type='SUSPEND_USER' AND state='completed'
    AND payload->>'source'='AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND'
    AND result->>'readBackConfirmed'='true'
    AND result->>'afterGroup'='2'
  FOR UPDATE;
  IF NOT FOUND OR c.completed_at IS NULL THEN RETURN false; END IF;
  IF c.user_pin !~ '^[0-9]{1,8}$' OR c.payload->>'expectedUid' !~ '^[0-9]{1,5}$'
     OR length(btrim(c.payload->>'expectedName'))<2
     OR c.result->>'deviceUid' IS DISTINCT FROM c.payload->>'expectedUid' THEN RETURN false; END IF;

  SELECT observed_at,user_count,users INTO latest
  FROM sport_center.gym_x904_access_snapshots
  WHERE device_serial='TDBD234200545'
  ORDER BY snapshot_id DESC LIMIT 1;
  IF NOT FOUND OR latest.observed_at<=c.completed_at
     OR jsonb_array_length(latest.users)<>latest.user_count THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(latest.users) x(v)
    WHERE x.v->>'pin'=c.user_pin
      AND x.v->>'name'=c.payload->>'expectedName'
      AND x.v->>'role'='0' AND x.v->>'group'='2' AND x.v->>'enabled'='true') THEN RETURN false; END IF;

  SELECT device_uid,display_name,device_role INTO inv
  FROM sport_center.gym_x904_lan_users
  WHERE device_serial='TDBD234200545' AND user_pin=c.user_pin;
  IF NOT FOUND OR inv.device_role<>0
     OR inv.device_uid<>(c.payload->>'expectedUid')::integer
     OR inv.display_name<>c.payload->>'expectedName' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM sport_center.gym_x904_member_mapping
    WHERE device_serial='TDBD234200545' AND user_pin=c.user_pin) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM sport_center.x904_nonmember_daily_access
    WHERE device_serial='TDBD234200545' AND user_pin=c.user_pin
      AND (access_state IN ('pending','active') OR activated_at IS NOT NULL)) THEN RETURN false; END IF;

  INSERT INTO sport_center.x904_verified_nonmember_identities
    (device_serial,user_pin,device_uid,display_name,verification_state)
  VALUES ('TDBD234200545',c.user_pin,inv.device_uid,inv.display_name,'review_required')
  ON CONFLICT (device_serial,user_pin) DO NOTHING
  RETURNING user_pin INTO inserted_pin;

  IF inserted_pin IS NOT NULL THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM sport_center.x904_verified_nonmember_identities r
    WHERE r.device_serial='TDBD234200545' AND r.user_pin=c.user_pin
      AND r.device_uid=inv.device_uid AND r.display_name=inv.display_name
      AND r.verification_state IN ('review_required','verified') AND r.revoked_at IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION sport_center.x904_stage_new_nonmember_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sport_center.x904_stage_new_nonmember_candidate(uuid) TO sport_center_app;
