-- Read-only SDK census publication. No access-control mutation.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_access_snapshots (
  snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_serial text NOT NULL CHECK (device_serial = 'TDBD234200545'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  user_count integer NOT NULL CHECK (user_count BETWEEN 1 AND 2000),
  users jsonb NOT NULL CHECK (jsonb_typeof(users)='array' AND jsonb_array_length(users) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS gym_x904_access_snapshots_latest
 ON sport_center.gym_x904_access_snapshots (device_serial, observed_at DESC, snapshot_id DESC);
ALTER TABLE sport_center.gym_x904_access_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.gym_x904_access_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON sport_center.gym_x904_access_snapshots TO sport_center_app;
DROP POLICY IF EXISTS x904_snapshot_app_read ON sport_center.gym_x904_access_snapshots;
CREATE POLICY x904_snapshot_app_read ON sport_center.gym_x904_access_snapshots
 FOR SELECT TO sport_center_app USING (device_serial='TDBD234200545');

CREATE OR REPLACE FUNCTION sport_center.x904_publish_access_snapshot(p_users jsonb, p_count integer)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id bigint;
BEGIN
  IF session_user <> 'x904_vmsc_evidence_login' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF p_count IS NULL OR p_count NOT BETWEEN 1 AND 2000 OR
     jsonb_typeof(p_users) IS DISTINCT FROM 'array' OR
     jsonb_array_length(p_users) <> p_count THEN RAISE EXCEPTION 'INVALID_SNAPSHOT'; END IF;
  IF EXISTS (
     SELECT 1 FROM jsonb_array_elements(p_users) AS x(v)
     WHERE jsonb_typeof(x.v) <> 'object'
       OR x.v->>'pin' !~ '^[0-9]{1,8}$'
       OR x.v->>'name' !~ '^[A-Za-z0-9 ._-]{0,24}
       OR jsonb_typeof(x.v->'role') <> 'number'
       OR (x.v->>'role')::integer NOT BETWEEN 0 AND 15
       OR jsonb_typeof(x.v->'group') <> 'number'
       OR (x.v->>'group')::integer NOT BETWEEN 0 AND 99
       OR jsonb_typeof(x.v->'enabled') <> 'boolean'
  ) THEN RAISE EXCEPTION 'INVALID_USER_ROW'; END IF;
  IF (SELECT count(DISTINCT x.v->>'pin') FROM jsonb_array_elements(p_users) AS x(v)) <> p_count
  THEN RAISE EXCEPTION 'DUPLICATE_PIN'; END IF;
  INSERT INTO sport_center.gym_x904_access_snapshots(device_serial, user_count, users)
    VALUES ('TDBD234200545',p_count,p_users) RETURNING snapshot_id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION sport_center.x904_publish_access_snapshot(jsonb,integer) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA sport_center TO x904_vmsc_evidence_login;
GRANT EXECUTE ON FUNCTION sport_center.x904_publish_access_snapshot(jsonb,integer) TO x904_vmsc_evidence_login;

       OR jsonb_typeof(x.v->'role') <> 'number'
       OR (x.v->>'role')::integer NOT BETWEEN 0 AND 15
       OR jsonb_typeof(x.v->'group') <> 'number'
       OR (x.v->>'group')::integer NOT BETWEEN 0 AND 99
       OR jsonb_typeof(x.v->'enabled') <> 'boolean'
  ) THEN RAISE EXCEPTION 'INVALID_USER_ROW'; END IF;
  IF (SELECT count(DISTINCT x.v->>'pin') FROM jsonb_array_elements(p_users) AS x(v)) <> p_count
  THEN RAISE EXCEPTION 'DUPLICATE_PIN'; END IF;
  INSERT INTO sport_center.gym_x904_access_snapshots(device_serial, user_count, users)
    VALUES ('TDBD234200545',p_count,p_users) RETURNING snapshot_id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION sport_center.x904_publish_access_snapshot(jsonb,integer) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA sport_center TO x904_vmsc_evidence_login;
GRANT EXECUTE ON FUNCTION sport_center.x904_publish_access_snapshot(jsonb,integer) TO x904_vmsc_evidence_login;
