CREATE OR REPLACE FUNCTION sport_center.link_x904_nonmember_daily_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sport_center', 'pg_temp'
AS $function$
DECLARE changed boolean := TG_OP = 'INSERT';
BEGIN
 IF TG_OP = 'UPDATE' THEN
  changed := OLD.status::text IS DISTINCT FROM NEW.status::text;
 END IF;
 IF NEW.status::text = 'confirmed' AND changed THEN
  UPDATE sport_center.x904_nonmember_daily_access
  SET payment_id = NEW.id,
      confirmed_at = COALESCE(NEW.confirmed_at, NEW.paid_at, now()),
      expires_at = COALESCE(NEW.confirmed_at, NEW.paid_at, now()) + interval '12 hours',
      access_state='pending', verification_state=CASE WHEN identity_type='card' AND EXISTS (SELECT 1 FROM sport_center.sport_bookings b WHERE b.id=NEW.booking_id AND b.source='admin') THEN 'pending' ELSE 'verified' END
  WHERE booking_id=NEW.booking_id AND payment_id IS NULL;
 ELSIF NEW.status::text IN ('cancelled','rejected','refunded') AND changed THEN
  UPDATE sport_center.x904_nonmember_daily_access
  SET access_state=CASE WHEN access_state IN ('active','expired') THEN 'pending' ELSE access_state END
  WHERE payment_id=NEW.id;
 END IF;
 RETURN NEW;
END;
$function$

