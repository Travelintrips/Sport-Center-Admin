-- Forward-only migration; existing rows remain unchanged.
-- The original anonymous table CHECK is named by PostgreSQL and must be replaced
-- because expiry moves from payment confirmation to verified activation.
BEGIN;
ALTER TABLE sport_center.x904_nonmember_daily_access
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;
DO $$
DECLARE old_check text;
BEGIN
  SELECT c.conname INTO old_check
  FROM pg_constraint c
  WHERE c.conrelid = 'sport_center.x904_nonmember_daily_access'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%expires_at%'
    AND pg_get_constraintdef(c.oid) LIKE '%confirmed_at%'
    AND pg_get_constraintdef(c.oid) LIKE '%12:00:00%'
  ORDER BY c.oid LIMIT 1;
  IF old_check IS NULL THEN
    RAISE EXCEPTION 'Expected original nonmember 12h constraint missing; migration aborted';
  END IF;
  EXECUTE format('ALTER TABLE sport_center.x904_nonmember_daily_access DROP CONSTRAINT %I', old_check);
END $$;
ALTER TABLE sport_center.x904_nonmember_daily_access
  ADD CONSTRAINT x904_nonmember_verified_clock_check
  CHECK ((payment_id IS NULL AND confirmed_at IS NULL AND expires_at IS NULL AND activated_at IS NULL)
     OR (payment_id IS NOT NULL AND confirmed_at IS NOT NULL AND expires_at IS NOT NULL
       AND (activated_at IS NULL OR expires_at = activated_at + interval '12 hours')));
COMMIT;
