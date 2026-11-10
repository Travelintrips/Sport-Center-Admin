-- Add one narrow gate: Admin Lapangan booking with a VIS card remains pending
-- after payment confirmation until its witnessed physical handover endpoint.
-- Preserve the existing guest/PIN semantics, which differ between DEV and PROD.
-- Refuse to rewrite an unfamiliar function rather than silently replacing logic.
DO $admin_vis_gate$
DECLARE
  original_sql text;
  old_guard text;
  new_guard text;
  new_sql text;
  current_hash text;
BEGIN
  original_sql := pg_get_functiondef('sport_center.link_x904_nonmember_daily_payment()'::regprocedure);
  current_hash := md5(original_sql);
  IF current_hash = 'c4520dc7d76f5082b5f33b74dce13edf' THEN
    -- Existing PROD keeps the self-service guest PIN review_required behavior.
    old_guard := 'verification_state = CASE WHEN is_guest THEN ''review_required'' ELSE ''verified'' END';
    new_guard := 'verification_state = CASE WHEN is_guest THEN ''review_required'' WHEN identity_type=''card'' AND EXISTS (SELECT 1 FROM sport_center.sport_bookings b WHERE b.id=NEW.booking_id AND b.source=''admin'') THEN ''pending'' ELSE ''verified'' END';
  ELSIF current_hash = '1bef278ae9e71a7322776edc0b7408e1' THEN
    -- Existing DEV lacks the guest PIN exception; do not broaden this migration.
    old_guard := 'verification_state=''verified''';
    new_guard := 'verification_state=CASE WHEN identity_type=''card'' AND EXISTS (SELECT 1 FROM sport_center.sport_bookings b WHERE b.id=NEW.booking_id AND b.source=''admin'') THEN ''pending'' ELSE ''verified'' END';
  ELSE
    RAISE EXCEPTION 'ADMIN_VIS_PAYMENT_TRIGGER_DRIFT';
  END IF;
  IF (length(original_sql) - length(replace(original_sql,old_guard,''))) <> length(old_guard) THEN
    RAISE EXCEPTION 'ADMIN_VIS_PAYMENT_GUARD_NOT_UNIQUE';
  END IF;
  new_sql := replace(original_sql,old_guard,new_guard);
  EXECUTE new_sql;
END;
$admin_vis_gate$;
