-- Permit a new paid nonmember booking after an old access was sent
-- to review_required. Do not delete history or reclassify the old access.
-- Still enforce one pending/active access per machine PIN.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
      WHERE schemaname='sport_center'
        AND tablename='x904_nonmember_daily_access'
        AND indexname='x904_nonmember_one_live_access_per_pin_idx'
        AND indexdef LIKE '%review_required%') THEN
    RAISE EXCEPTION 'Expected old index absent or already changed; verify before proceeding';
  END IF;
END $$;
DROP INDEX sport_center.x904_nonmember_one_live_access_per_pin_idx;
CREATE UNIQUE INDEX x904_nonmember_one_live_access_per_pin_idx
  ON sport_center.x904_nonmember_daily_access (device_serial,user_pin)
  WHERE access_state IN ('pending','active');
COMMIT;
