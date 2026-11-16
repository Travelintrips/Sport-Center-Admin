-- Permit canonical backend to restore a *held* PIN review row for an already
-- confirmed public Gym booking that was paid while X904 identity registry was stale.
-- Not a device grant: only review_required; owner/staff attestation happens
-- in the existing authenticated booking endpoint before pending/ACK.
-- Keep the original pending-payment PIN insert policy unchanged.
BEGIN;
CREATE POLICY x904_nonmember_app_paid_guest_pin_recovery_insert
ON sport_center.x904_nonmember_daily_access
AS PERMISSIVE FOR INSERT TO sport_center_app
WITH CHECK (
 device_serial='TDBD234200545'
 AND identity_type='pin'
 AND identity_label='PIN:' || user_pin
 AND user_pin ~ '^[0-9]{1,8}$'
 AND user_pin NOT IN ('12','79','237','78','90','13','17','11','15')
 AND verification_state='review_required'
 AND access_state='review_required'
 AND activated_at IS NULL
 AND payment_id IS NOT NULL AND confirmed_at IS NOT NULL AND expires_at IS NOT NULL
 AND expires_at=confirmed_at+interval '12 hours'
 AND EXISTS(
  SELECT 1 FROM sport_center.sport_bookings b
  JOIN sport_center.sport_payments p ON p.booking_id=b.id
  WHERE b.id=x904_nonmember_daily_access.booking_id
   AND b.source='gym_public_guest'
   AND b.status::text IN ('confirmed','paid','completed')
   -- RLS authorizes only creation of a HELD review row, never activation.
   -- The authenticated endpoint separately enforces today's WIB date and opening hours.
   AND b.booking_date::date >= (p.confirmed_at AT TIME ZONE 'Asia/Jakarta')::date
   AND p.id=x904_nonmember_daily_access.payment_id
   AND p.status::text='confirmed'
   AND p.confirmed_at=x904_nonmember_daily_access.confirmed_at
   AND NULLIF(btrim(p.proof_url),'') IS NOT NULL
   AND p.amount>=COALESCE(b.grand_total,b.total_price)
   AND COALESCE(b.grand_total,b.total_price)>0
   AND upper(regexp_replace(trim(b.customer_name),'[[:space:]]+',' ','g'))=
       upper(regexp_replace(trim(x904_nonmember_daily_access.verified_name),'[[:space:]]+',' ','g'))
 )
 AND EXISTS(
  SELECT 1 FROM sport_center.x904_verified_nonmember_identities r
  JOIN sport_center.gym_x904_lan_users u
   ON u.device_serial=r.device_serial AND u.user_pin=r.user_pin
    AND u.device_uid=r.device_uid
  WHERE r.device_serial=x904_nonmember_daily_access.device_serial
   AND r.user_pin=x904_nonmember_daily_access.user_pin
   AND r.device_uid=x904_nonmember_daily_access.device_uid
   AND r.display_name=x904_nonmember_daily_access.verified_name
   AND r.verification_state='verified' AND r.revoked_at IS NULL
   AND u.device_role=0 AND u.display_name=r.display_name
 )
 AND NOT EXISTS(
  SELECT 1 FROM sport_center.gym_x904_member_mapping m
  WHERE m.device_serial=x904_nonmember_daily_access.device_serial
   AND m.user_pin=x904_nonmember_daily_access.user_pin
 )
);
COMMIT;
