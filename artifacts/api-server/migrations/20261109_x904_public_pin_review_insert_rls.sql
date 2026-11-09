-- Permit only held, unpaid public Gym PIN reservations to be inserted by backend.
-- Existing x904_nonmember_app_insert policy supports verified 'pending' grants,
-- but POST /api/wa/booking deliberately inserts 'review_required' for
-- unauthenticated visitors until staff attests identity and real funds.
-- Keep these grants non-live: no payment link, no activation, no expiry.
CREATE POLICY x904_nonmember_app_public_pin_review_insert
ON sport_center.x904_nonmember_daily_access
AS PERMISSIVE FOR INSERT TO sport_center_app
WITH CHECK (
  device_serial = 'TDBD234200545'
  AND identity_type = 'pin'
  AND identity_label = 'PIN:' || user_pin
  AND user_pin ~ '^[0-9]{1,8}$'
  AND user_pin NOT IN ('12','79','237','78','90','13','17','11','15')
  AND verification_state = 'review_required'
  AND access_state = 'review_required'
  AND payment_id IS NULL
  AND confirmed_at IS NULL
  AND expires_at IS NULL
  AND activated_at IS NULL
  AND EXISTS (
    SELECT 1 FROM sport_center.sport_bookings b
    WHERE b.id = booking_id
      AND b.source = 'gym_public_guest'
      AND b.status::text = 'pending_payment'
      AND b.customer_name = verified_name
  )
  AND EXISTS (
    SELECT 1 FROM sport_center.x904_verified_nonmember_identities v
    WHERE v.device_serial = device_serial
      AND v.user_pin = user_pin
      AND v.device_uid = device_uid
      AND v.display_name = verified_name
      AND v.verification_state = 'verified'
      AND v.revoked_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM sport_center.gym_x904_member_mapping m
    WHERE m.device_serial = device_serial AND m.user_pin = user_pin
  )
);
