-- Sport Center release security gate: restrict EXECUTE on two existing
-- SECURITY DEFINER trigger functions. No business logic or trigger changes.
-- CST-DEV tested on 2026-11-20; do not apply to PROD without release gate.
-- Idempotent. Explicitly retain the existing application role permission.
BEGIN;
REVOKE EXECUTE ON FUNCTION sport_center.enqueue_booking_sheets_after_confirmation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sport_center.x904_queue_gym_usage_on_first_checkin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sport_center.enqueue_booking_sheets_after_confirmation() TO sport_center_app;
GRANT EXECUTE ON FUNCTION sport_center.x904_queue_gym_usage_on_first_checkin() TO sport_center_app;
DO $check$
DECLARE not_ready integer;
BEGIN
  SELECT COUNT(*) INTO not_ready
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='sport_center'
    AND p.proname IN ('enqueue_booking_sheets_after_confirmation','x904_queue_gym_usage_on_first_checkin')
    AND p.prorettype='trigger'::regtype
    AND p.prosecdef
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND has_function_privilege('sport_center_app',p.oid,'EXECUTE')
    AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal);
  IF not_ready <> 2 THEN
    RAISE EXCEPTION 'SC_TRIGGER_EXECUTE_ACL_NOT_VERIFIED: %/2',not_ready;
  END IF;
END
$check$;
COMMIT;
