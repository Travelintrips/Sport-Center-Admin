-- Issue #682: persist the narrow production VIS app-role RLS contract.
-- REVIEW / DEV FIRST. Never run automatically against PROD.
-- No anon/authenticated policy and no machine command side effects.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sport_center_app') THEN
    RAISE EXCEPTION 'Missing required sport_center_app role';
  END IF;
  IF to_regclass('sport_center.gym_vis_card_reservations') IS NULL OR
     to_regclass('sport_center.x904_nonmember_daily_access') IS NULL THEN
    RAISE EXCEPTION 'Gym VIS tables not installed';
  END IF;
END
$migration$;

ALTER TABLE sport_center.gym_vis_card_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.x904_nonmember_daily_access ENABLE ROW LEVEL SECURITY;

-- The backend requires table privileges in addition to row policies.
GRANT SELECT, INSERT, UPDATE ON sport_center.gym_vis_card_reservations TO sport_center_app;
GRANT USAGE, SELECT ON SEQUENCE sport_center.gym_vis_card_reservations_id_seq TO sport_center_app;
GRANT SELECT, INSERT ON sport_center.x904_nonmember_daily_access TO sport_center_app;

-- Preserve the existing policy names in PROD. Do not overwrite drift silently.
DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='gym_vis_card_reservations' AND policyname='gym_vis_app_select') THEN
    EXECUTE 'CREATE POLICY gym_vis_app_select ON sport_center.gym_vis_card_reservations FOR SELECT TO sport_center_app USING (device_serial = ''TDBD234200545'' AND card_code IN (''VIS001'',''VIS002'',''VIS003'',''VIS004'',''VIS005'',''VIS006''))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='gym_vis_card_reservations' AND policyname='gym_vis_app_insert') THEN
    EXECUTE 'CREATE POLICY gym_vis_app_insert ON sport_center.gym_vis_card_reservations FOR INSERT TO sport_center_app WITH CHECK (device_serial = ''TDBD234200545'' AND state = ''reserved'' AND card_code IN (''VIS001'',''VIS002'',''VIS003'',''VIS004'',''VIS005'',''VIS006'') AND EXISTS (SELECT 1 FROM sport_center.sport_bookings b JOIN sport_center.sport_payments p ON p.booking_id=b.id WHERE b.id=booking_id AND b.source=''gym_public_guest'' AND p.id=payment_id AND p.status::text=''confirmed''))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='gym_vis_card_reservations' AND policyname='gym_vis_app_update') THEN
    EXECUTE 'CREATE POLICY gym_vis_app_update ON sport_center.gym_vis_card_reservations FOR UPDATE TO sport_center_app USING (device_serial = ''TDBD234200545'' AND card_code IN (''VIS001'',''VIS002'',''VIS003'',''VIS004'',''VIS005'',''VIS006'')) WITH CHECK (device_serial = ''TDBD234200545'' AND card_code IN (''VIS001'',''VIS002'',''VIS003'',''VIS004'',''VIS005'',''VIS006''))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='x904_nonmember_daily_access' AND policyname='gym_vis_app_grant_insert') THEN
    EXECUTE 'CREATE POLICY gym_vis_app_grant_insert ON sport_center.x904_nonmember_daily_access FOR INSERT TO sport_center_app WITH CHECK (device_serial = ''TDBD234200545'' AND identity_type = ''card'' AND identity_label IN (''VIS001'',''VIS002'',''VIS003'',''VIS004'',''VIS005'',''VIS006'') AND verification_state = ''verified'' AND access_state = ''pending'' AND payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM sport_center.sport_bookings b JOIN sport_center.sport_payments p ON p.booking_id=b.id WHERE b.id=booking_id AND b.source=''gym_public_guest'' AND p.id=payment_id AND p.status::text=''confirmed''))';
  END IF;
END
$policies$;
