-- Verified paid Gym day admissions: booking's WIB date and 06:00–23:00 opening
-- replace a strict one-hour slot / 12-hour-from-payment expectation.
-- Backward compatible with all historical activated+12h and earlier 23:00-capped rows.
-- Source/identity/payment/device authorization still happens in the existing worker.
-- No data rows, commands, users or memberships are modified.
BEGIN;
ALTER TABLE sport_center.x904_nonmember_daily_access
  DROP CONSTRAINT IF EXISTS x904_nonmember_business_hours_clock_check;
ALTER TABLE sport_center.x904_nonmember_daily_access
  ADD CONSTRAINT x904_nonmember_business_hours_clock_check
  CHECK (
    (payment_id IS NULL AND confirmed_at IS NULL AND expires_at IS NULL AND activated_at IS NULL)
    OR
    (payment_id IS NOT NULL AND confirmed_at IS NOT NULL AND expires_at IS NOT NULL AND (
      activated_at IS NULL
      OR expires_at = activated_at + interval '12 hours'
      OR expires_at = LEAST(
        activated_at + interval '12 hours',
        ((activated_at AT TIME ZONE 'Asia/Jakarta')::date + time '23:00')
          AT TIME ZONE 'Asia/Jakarta'
      )
      OR expires_at = (((activated_at AT TIME ZONE 'Asia/Jakarta')::date + time '23:00')
        AT TIME ZONE 'Asia/Jakarta')
    ))
  ) NOT VALID;
ALTER TABLE sport_center.x904_nonmember_daily_access
  VALIDATE CONSTRAINT x904_nonmember_business_hours_clock_check;
COMMIT;
