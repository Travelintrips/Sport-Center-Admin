-- Staged narrow RLS for the EXISTING signed VMSC ingress, not a new
-- attendance system. This does not change legacy X904 LAN sync or access.
-- Never grant these policies to anon/authenticated/public.
BEGIN;
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='sport_center.gym_x904_raw_events'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='sport_center.gym_x904_verification_evidence'::regclass)
  THEN RAISE EXCEPTION 'X904_PROOF_RLS_MUST_REMAIN_ON';
  END IF;
END $$;

GRANT SELECT,INSERT ON sport_center.gym_x904_raw_events TO sport_center_app;
GRANT SELECT,INSERT,UPDATE ON sport_center.gym_x904_verification_evidence TO sport_center_app;

CREATE POLICY x904_attest_raw_read
ON sport_center.gym_x904_raw_events FOR SELECT TO sport_center_app
USING (
  device_serial='TDBD234200545'
  AND attendance_status IN (0,255)
  AND verification_type IN (1,4,15)
);
CREATE POLICY x904_attest_raw_insert
ON sport_center.gym_x904_raw_events FOR INSERT TO sport_center_app
WITH CHECK (
  device_serial='TDBD234200545'
  AND attendance_status IN (0,255)
  AND verification_type IN (1,4,15)
  AND EXISTS (
    SELECT 1 FROM sport_center.gym_x904_lan_logs l
    WHERE l.event_id=event_id AND l.device_serial=device_serial
      AND l.user_pin=user_pin AND l.device_time=device_time
  )
);
-- The existing *unverified* VMSC capture can be promoted only by the
-- separately authenticated, signature-validated app ingress.
CREATE POLICY x904_attest_evidence_read
ON sport_center.gym_x904_verification_evidence FOR SELECT TO sport_center_app
USING (
  device_serial='TDBD234200545' AND (
    (evidence_status='unverified' AND capture_source='vmsc_automated')
    OR
    (evidence_status='protocol_verified' AND capture_source='trusted_vmsc_ingress')
  )
);
CREATE POLICY x904_attest_evidence_insert
ON sport_center.gym_x904_verification_evidence FOR INSERT TO sport_center_app
WITH CHECK (
  device_serial='TDBD234200545'
  AND evidence_status='protocol_verified'
  AND capture_source='trusted_vmsc_ingress'
  AND verification_code IN (1,4,15)
  AND verification_method=CASE verification_code
    WHEN 1 THEN 'fingerprint' WHEN 4 THEN 'card' WHEN 15 THEN 'face' END
  AND raw_hex ~ '^[0-9a-f]{80}$'
  AND get_byte(decode(raw_hex,'hex'),26)=verification_code
  AND get_byte(decode(raw_hex,'hex'),31) IN (0,255)
  AND get_byte(decode(raw_hex,'hex'),0)
    + 256*get_byte(decode(raw_hex,'hex'),1)=event_index+1
  AND EXISTS (
    SELECT 1 FROM sport_center.gym_x904_lan_logs l
    WHERE l.event_id=source_event_id AND l.device_serial=device_serial
      AND l.user_pin=user_pin AND l.event_index=event_index
  )
);
CREATE POLICY x904_attest_evidence_update
ON sport_center.gym_x904_verification_evidence FOR UPDATE TO sport_center_app
USING (
  device_serial='TDBD234200545' AND (
    (evidence_status='unverified' AND capture_source='vmsc_automated')
    OR
    (evidence_status='protocol_verified' AND capture_source='trusted_vmsc_ingress')
  )
)
WITH CHECK (
  device_serial='TDBD234200545'
  AND evidence_status='protocol_verified'
  AND capture_source='trusted_vmsc_ingress'
  AND verification_code IN (1,4,15)
  AND verification_method=CASE verification_code
    WHEN 1 THEN 'fingerprint' WHEN 4 THEN 'card' WHEN 15 THEN 'face' END
  AND raw_hex ~ '^[0-9a-f]{80}$'
  AND get_byte(decode(raw_hex,'hex'),26)=verification_code
  AND get_byte(decode(raw_hex,'hex'),31) IN (0,255)
  AND get_byte(decode(raw_hex,'hex'),0)
    + 256*get_byte(decode(raw_hex,'hex'),1)=event_index+1
  AND EXISTS (
    SELECT 1 FROM sport_center.gym_x904_lan_logs l
    WHERE l.event_id=source_event_id AND l.device_serial=device_serial
      AND l.user_pin=user_pin AND l.event_index=event_index
  )
);
COMMIT;
