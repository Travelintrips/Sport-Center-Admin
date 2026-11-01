-- PREPARATION ONLY: no live device commands and no changes to existing payment methods.
-- A row may be created when the daily gym booking is registered; payment_id is filled only after real confirmation.
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
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sport_center.x904_nonmember_daily_access
  ALTER COLUMN payment_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS x904_nonmember_daily_due_idx
  ON sport_center.x904_nonmember_daily_access(access_state,expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS x904_nonmember_one_live_access_per_pin_idx
  ON sport_center.x904_nonmember_daily_access(device_serial,user_pin)
  WHERE access_state IN ('pending','active');
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

-- Link the already-confirmed canonical Sport Center payment; upload/OCR alone never confirms.
CREATE OR REPLACE FUNCTION sport_center.link_x904_nonmember_daily_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sport_center, pg_temp
AS $$
BEGIN
  IF NEW.status::text = 'confirmed' AND
     (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM NEW.status::text) THEN
    UPDATE sport_center.x904_nonmember_daily_access
       SET payment_id = NEW.id,
           confirmed_at = COALESCE(NEW.confirmed_at, NEW.paid_at, now()),
           expires_at = COALESCE(NEW.confirmed_at, NEW.paid_at, now()) + interval '12 hours',
           access_state = 'pending',
           verification_state = 'verified'
     WHERE booking_id = NEW.booking_id
       AND payment_id IS NULL;
  ELSIF NEW.status::text IN ('cancelled','rejected','refunded') THEN
    UPDATE sport_center.x904_nonmember_daily_access
       SET access_state = CASE WHEN access_state='active' THEN 'review_required' ELSE access_state END,
           verification_state = 'review_required'
     WHERE payment_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_link_x904_nonmember_daily_payment ON sport_center.sport_payments;
CREATE TRIGGER trg_link_x904_nonmember_daily_payment
AFTER INSERT OR UPDATE OF status ON sport_center.sport_payments
FOR EACH ROW EXECUTE FUNCTION sport_center.link_x904_nonmember_daily_payment();
