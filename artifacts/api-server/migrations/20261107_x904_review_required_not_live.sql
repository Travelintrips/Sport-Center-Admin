BEGIN;
DROP INDEX IF EXISTS sport_center.x904_nonmember_one_live_access_per_pin_idx;
CREATE UNIQUE INDEX x904_nonmember_one_live_access_per_pin_idx
  ON sport_center.x904_nonmember_daily_access(device_serial,user_pin)
  WHERE access_state IN ('pending','active');
COMMIT;
