-- X904 nonmember: maximum 12 hours, with a hard 23:00 WIB business closing.
-- Rollout-safe: accept BOTH the existing 12-hour clock and the new capped
-- clock during rolling application deployment; tighten only after all workers
-- have migrated. Never change already expired historical access rows.
BEGIN;

ALTER TABLE sport_center.x904_nonmember_daily_access
  DROP CONSTRAINT IF EXISTS x904_nonmember_verified_clock_check;

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
    ))
  ) NOT VALID;

-- Active paid grants must no longer advertise an expiry after closing.
-- Historical expired records remain unchanged for reconciliation/audit.
UPDATE sport_center.x904_nonmember_daily_access
SET expires_at = LEAST(
  expires_at,
  activated_at + interval '12 hours',
  ((activated_at AT TIME ZONE 'Asia/Jakarta')::date + time '23:00')
    AT TIME ZONE 'Asia/Jakarta'
)
WHERE access_state = 'active' AND activated_at IS NOT NULL
  AND expires_at > LEAST(
    activated_at + interval '12 hours',
    ((activated_at AT TIME ZONE 'Asia/Jakarta')::date + time '23:00')
      AT TIME ZONE 'Asia/Jakarta'
  );

ALTER TABLE sport_center.x904_nonmember_daily_access
  VALIDATE CONSTRAINT x904_nonmember_business_hours_clock_check;

COMMIT;
