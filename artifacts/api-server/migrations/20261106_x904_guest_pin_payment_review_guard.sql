-- No-login PIN guests are NOT authenticated by their device display name.
-- Preserve review_required after canonical payment confirmation until a
-- logged-in staff member independently attests PIN ownership.
-- This change is scoped to source='gym_public_guest'; other (including VIS)
-- payment flows keep their previous trigger behavior.
BEGIN;

CREATE OR REPLACE FUNCTION sport_center.link_x904_nonmember_daily_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sport_center, pg_temp
AS $$
DECLARE
  changed boolean := TG_OP = 'INSERT';
  is_guest boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    changed := OLD.status::text IS DISTINCT FROM NEW.status::text;
  END IF;

  IF NEW.status::text = 'confirmed' AND changed THEN
    SELECT EXISTS(SELECT 1 FROM sport_center.sport_bookings b
      WHERE b.id = NEW.booking_id AND b.source='gym_public_guest')
      INTO is_guest;

    UPDATE sport_center.x904_nonmember_daily_access a
       SET payment_id = NEW.id,
           confirmed_at = COALESCE(NEW.confirmed_at, NEW.paid_at, now()),
           expires_at = COALESCE(NEW.confirmed_at, NEW.paid_at, now()) + interval '12 hours',
           access_state = CASE WHEN is_guest THEN 'review_required' ELSE 'pending' END,
           verification_state = CASE WHEN is_guest THEN 'review_required' ELSE 'verified' END
     WHERE a.booking_id = NEW.booking_id AND a.payment_id IS NULL;
  ELSIF NEW.status::text IN ('cancelled','rejected','refunded') AND changed THEN
    UPDATE sport_center.x904_nonmember_daily_access
       SET access_state = CASE WHEN access_state IN ('active','expired') THEN 'pending' ELSE access_state END
     WHERE payment_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION sport_center.link_x904_nonmember_daily_payment() FROM PUBLIC;
COMMIT;
