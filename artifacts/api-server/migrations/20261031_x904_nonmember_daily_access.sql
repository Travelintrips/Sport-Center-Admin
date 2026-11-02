-- PREPARATION ONLY: no live device commands and no changes to existing payment methods.
-- A row is created atomically with the walk-in booking; payment_id/12h clock are filled only after canonical payment confirmation.
CREATE TABLE IF NOT EXISTS sport_center.x904_nonmember_daily_access (
  access_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_serial text NOT NULL CHECK (device_serial = 'TDBD234200545'),
  identity_type text NOT NULL CHECK (identity_type IN ('pin','card')),
  identity_label text NOT NULL,
  user_pin text NOT NULL CHECK (user_pin ~ '^[0-9]{1,8}$'),
  device_uid integer NOT NULL CHECK (device_uid > 0),
  verified_name text NOT NULL CHECK (length(btrim(verified_name)) > 0),
  booking_id integer NOT NULL UNIQUE REFERENCES sport_center.sport_bookings(id),
  payment_id integer UNIQUE REFERENCES sport_center.sport_payments(id),
  confirmed_at timestamptz,
  expires_at timestamptz,
  verification_state text NOT NULL DEFAULT 'verified' CHECK (verification_state IN ('pending','verified','review_required')),
  access_state text NOT NULL DEFAULT 'pending' CHECK (access_state IN ('pending','active','expired','review_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((payment_id IS NULL AND confirmed_at IS NULL AND expires_at IS NULL)
      OR (payment_id IS NOT NULL AND confirmed_at IS NOT NULL AND expires_at = confirmed_at + interval '12 hours'))
);
CREATE INDEX IF NOT EXISTS x904_nonmember_daily_due_idx
  ON sport_center.x904_nonmember_daily_access(access_state,expires_at);
DROP INDEX IF EXISTS sport_center.x904_nonmember_one_live_access_per_pin_idx;
CREATE UNIQUE INDEX x904_nonmember_one_live_access_per_pin_idx
  ON sport_center.x904_nonmember_daily_access(device_serial,user_pin)
  WHERE access_state IN ('pending','active','review_required');
ALTER TABLE sport_center.x904_nonmember_daily_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.x904_nonmember_daily_access FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON sport_center.x904_nonmember_daily_access FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON sport_center.x904_nonmember_daily_access FROM authenticated';
  END IF;
END $$;

-- Upload/OCR does not create a confirmed payment. Only the canonical sport_payments status transition starts the 12-hour clock.
CREATE OR REPLACE FUNCTION sport_center.link_x904_nonmember_daily_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sport_center, pg_temp
AS $$
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
           access_state = 'pending',
           verification_state = 'verified'
     WHERE booking_id = NEW.booking_id AND payment_id IS NULL;
  ELSIF NEW.status::text IN ('cancelled','rejected','refunded') AND changed THEN
    UPDATE sport_center.x904_nonmember_daily_access
       SET access_state = CASE WHEN access_state IN ('active','expired') THEN 'pending' ELSE access_state END
     WHERE payment_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION sport_center.link_x904_nonmember_daily_payment() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_link_x904_nonmember_daily_payment ON sport_center.sport_payments;
CREATE TRIGGER trg_link_x904_nonmember_daily_payment
AFTER INSERT OR UPDATE OF status ON sport_center.sport_payments
FOR EACH ROW EXECUTE FUNCTION sport_center.link_x904_nonmember_daily_payment();
