-- Existing public Gym booking paths stay intact. Only guests whose server-side
-- machine PIN+name verification seeded `verification_state='verified'` may
-- become pending automatically after canonical payment confirmation.
-- Name-only public bookings stay review_required; VIS and Admin unaffected.
-- Device activation still requires the separate worker's verified snapshot,
-- UID/role and physical ACK/read-back.
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
    -- PIN only. A VIS grant belonging to gym_public_guest retains the
    -- existing VIS payment and allocation behavior maintained elsewhere.
    SELECT EXISTS(SELECT 1 FROM sport_center.sport_bookings b
      JOIN sport_center.x904_nonmember_daily_access a ON a.booking_id=b.id
      WHERE b.id = NEW.booking_id AND b.source='gym_public_guest'
        AND a.identity_type='pin')
      INTO is_guest;

    UPDATE sport_center.x904_nonmember_daily_access a
       SET payment_id = NEW.id,
           confirmed_at = COALESCE(NEW.confirmed_at, NEW.paid_at, now()),
           expires_at = COALESCE(NEW.confirmed_at, NEW.paid_at, now()) + interval '12 hours',
           access_state = CASE WHEN is_guest AND a.verification_state<>'verified'
                            THEN 'review_required' ELSE 'pending' END,
           verification_state = CASE WHEN is_guest AND a.verification_state<>'verified'
                                  THEN 'review_required' ELSE 'verified' END
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
