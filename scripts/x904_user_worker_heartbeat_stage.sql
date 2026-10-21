-- Isolated writer-liveness attestation. No device access and no existing rows changed.
CREATE TABLE IF NOT EXISTS sport_center.x904_user_worker_status (
  device_serial text PRIMARY KEY,
  last_seen timestamptz NOT NULL,
  worker_version text NOT NULL
);
CREATE OR REPLACE FUNCTION sport_center.x904_user_worker_heartbeat(p_version text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,sport_center
AS $x904$
BEGIN
  IF session_user NOT IN ('x904_vmsc_evidence_login','postgres') THEN
    RAISE EXCEPTION 'X904_WORKER_UNAUTHORIZED';
  END IF;
  IF p_version !~ '^vmsc-node-v[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'INVALID_WORKER_VERSION';
  END IF;
  INSERT INTO sport_center.x904_user_worker_status(device_serial,last_seen,worker_version)
  VALUES('TDBD234200545',now(),p_version)
  ON CONFLICT(device_serial) DO UPDATE SET last_seen=excluded.last_seen,
    worker_version=excluded.worker_version;
  RETURN true;
END $x904$;
REVOKE ALL ON FUNCTION sport_center.x904_user_worker_heartbeat(text) FROM PUBLIC;
REVOKE ALL ON TABLE sport_center.x904_user_worker_status FROM PUBLIC;
DO $x904$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='x904_vmsc_evidence_login') THEN
   EXECUTE 'GRANT EXECUTE ON FUNCTION sport_center.x904_user_worker_heartbeat(text) TO x904_vmsc_evidence_login';
 END IF;
END $x904$;
