-- Backend-only compatibility for a verified no-login Gym PIN that the customer
-- explicitly entered and the server compared to the current machine/registry.
-- This permits only an UNPAID, non-live reservation; payment approval and
-- device activation remain separate, existing guarded stages.
BEGIN;
CREATE POLICY x904_nonmember_app_self_pin_insert
ON sport_center.x904_nonmember_daily_access
AS PERMISSIVE FOR INSERT TO sport_center_app
WITH CHECK (
 device_serial='TDBD234200545'
 AND identity_type='pin'
 AND identity_label='PIN:'||user_pin
 AND user_pin ~ '^[0-9]{1,8}$'
 AND user_pin NOT IN ('12','79','237','78','90','13','17','11','15')
 AND verification_state='verified' AND access_state='pending'
 AND activated_at IS NULL
 AND payment_id IS NULL AND confirmed_at IS NULL AND expires_at IS NULL
 AND EXISTS(
  SELECT 1 FROM sport_center.sport_bookings b
  WHERE b.id=x904_nonmember_daily_access.booking_id
   AND b.source='gym_public_guest' AND b.status::text='pending_payment'
   AND b.notes LIKE '%nama dan PIN X904 sama dengan identitas mesin terverifikasi%'
   AND b.customer_name=x904_nonmember_daily_access.verified_name
 )
 AND EXISTS(
  SELECT 1 FROM sport_center.x904_verified_nonmember_identities r
  JOIN sport_center.gym_x904_lan_users u
    ON u.device_serial=r.device_serial AND u.user_pin=r.user_pin AND u.device_uid=r.device_uid
  WHERE r.device_serial=x904_nonmember_daily_access.device_serial
   AND r.user_pin=x904_nonmember_daily_access.user_pin
   AND r.device_uid=x904_nonmember_daily_access.device_uid
   AND r.display_name=x904_nonmember_daily_access.verified_name
   AND r.verification_state='verified' AND r.revoked_at IS NULL
   AND u.device_role=0 AND u.display_name=r.display_name
 )
 AND NOT EXISTS(
  SELECT 1 FROM sport_center.gym_x904_member_mapping m
  WHERE m.device_serial=x904_nonmember_daily_access.device_serial AND m.user_pin=x904_nonmember_daily_access.user_pin
 )
);
COMMIT;
