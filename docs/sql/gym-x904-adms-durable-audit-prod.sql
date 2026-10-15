-- Persistent, privacy-minimal ADMS protocol audit.
-- Source identity is UNVERIFIED. This audit does not prove physical X904 ownership,
-- contain machine user data, or ACK attendance.
CREATE TABLE IF NOT EXISTS sport_center.gym_x904_adms_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('handshake','poll','device_options','attendance')),
  outcome text NOT NULL CHECK (outcome IN (
    'configuration_sent','poll_ack','device_options_ack',
    'attendance_untrusted','attendance_invalid','attendance_stored',
    'attendance_storage_failed','attendance_not_imported'
  )),
  method text NOT NULL CHECK (method IN ('GET','POST')),
  client_hint text NOT NULL CHECK (client_hint IN
    ('automation-like','browser-like','unknown-client','no-user-agent')),
  body_bytes integer NOT NULL DEFAULT 0 CHECK (body_bytes BETWEEN 0 AND 32768),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count BETWEEN 0 AND 1000),
  connector_authorized boolean NOT NULL DEFAULT false,
  device_identity_verified boolean NOT NULL DEFAULT false CHECK (device_identity_verified = false)
);
CREATE INDEX IF NOT EXISTS gym_x904_adms_audit_recent_idx
 ON sport_center.gym_x904_adms_audit (received_at DESC, id DESC);
ALTER TABLE sport_center.gym_x904_adms_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.gym_x904_adms_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON sport_center.gym_x904_adms_audit TO sport_center_app;
GRANT USAGE, SELECT ON SEQUENCE sport_center.gym_x904_adms_audit_id_seq TO sport_center_app;
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='sport_center'
      AND tablename='gym_x904_adms_audit'
      AND policyname='x904_adms_backend_select'
  ) THEN
    CREATE POLICY x904_adms_backend_select
      ON sport_center.gym_x904_adms_audit FOR SELECT
      TO sport_center_app USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='sport_center'
      AND tablename='gym_x904_adms_audit'
      AND policyname='x904_adms_backend_insert'
  ) THEN
    CREATE POLICY x904_adms_backend_insert
      ON sport_center.gym_x904_adms_audit FOR INSERT
      TO sport_center_app WITH CHECK (true);
  END IF;
END
$policy$;
