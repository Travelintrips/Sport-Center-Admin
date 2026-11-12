-- X904 verified booking scan read permission: intentionally narrow and read-only.
-- Apply only after the trusted VMSC attestation pipeline is enabled and
-- the feature-gated nonmember booking reconciliation has passed isolated tests.
-- No public roles, no data rewrite, no changes to the existing X904 worker.
BEGIN;
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='sport_center.gym_x904_verification_evidence'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='sport_center.gym_x904_raw_events'::regclass) THEN
    RAISE EXCEPTION 'X904_ATTESTATION_TABLE_RLS_REQUIRED';
  END IF;
END $$;
GRANT SELECT ON sport_center.gym_x904_verification_evidence,
  sport_center.gym_x904_raw_events TO sport_center_app;
CREATE POLICY x904_verified_booking_evidence_backend_read
  ON sport_center.gym_x904_verification_evidence
  FOR SELECT TO sport_center_app
  USING (capture_source='trusted_vmsc_ingress'
     AND evidence_status='protocol_verified'
     AND verification_code IN (1,4,15));
CREATE POLICY x904_verified_booking_raw_event_backend_read
  ON sport_center.gym_x904_raw_events
  FOR SELECT TO sport_center_app
  USING (attendance_status IN (0,255) AND verification_type IN (1,4,15));
COMMIT;
