-- Post-enrollment recovery for an already-paid, Admin-approved public Gym booking.
-- Application role ONLY; no grant to anon/authenticated, no SECURITY DEFINER,
-- no direct device writes. Requires exactly one confirmed full payment and
-- independent, nonmember PIN/UID registry, no existing VIS reservation.
-- The existing worker still requires Group 2 preflight then real Group 1 ACK.
BEGIN;
CREATE POLICY x904_nonmember_app_post_enrollment_paid_pin_insert
ON sport_center.x904_nonmember_daily_access
AS PERMISSIVE FOR INSERT TO sport_center_app
WITH CHECK (
  device_serial='TDBD234200545'
  AND identity_type='pin'
  AND identity_label='PIN:'||user_pin
  AND user_pin ~ '^[0-9]{1,8}$'
  AND user_pin NOT IN ('12','79','237','78','90','13','17','11','15')
  AND device_uid>0
  AND verification_state='pending'
  AND access_state='pending'
  AND activated_at IS NULL
  AND payment_id IS NOT NULL
  AND confirmed_at IS NOT NULL
  AND expires_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM sport_center.sport_bookings b
    JOIN sport_center.sport_payments p
      ON p.booking_id=b.id AND p.id=x904_nonmember_daily_access.payment_id
    WHERE b.id=x904_nonmember_daily_access.booking_id
      AND b.facility_id=6 AND b.source='gym_public_guest'
      AND b.status::text='confirmed'
      AND b.membership_id IS NULL AND b.membership_payment_id IS NULL
      AND b.notes LIKE '%Kartu VIS001–VIS006 menunggu pilihan%'
      AND p.status::text='confirmed' AND p.payment_type::text='full_payment'
      AND p.confirmed_at IS NOT NULL
      AND p.confirmed_at=x904_nonmember_daily_access.confirmed_at
      AND p.source_membership_payment_id IS NULL
      AND NULLIF(btrim(p.proof_url),'') IS NOT NULL
      AND p.amount>=COALESCE(b.grand_total,b.total_price)
      AND COALESCE(b.grand_total,b.total_price)>0
      AND b.booking_date::date=(p.confirmed_at AT TIME ZONE 'Asia/Jakarta')::date
      AND x904_nonmember_daily_access.expires_at =
        ((b.booking_date::date + time '23:00') AT TIME ZONE 'Asia/Jakarta')
      AND (SELECT count(*) FROM sport_center.sport_payments pp
           WHERE pp.booking_id=b.id AND pp.status::text='confirmed')=1
      AND EXISTS (
        SELECT 1 FROM sport_center.audit_logs al
        WHERE al.entity='payment' AND al.entity_id=p.id
          AND al.action='FINAL_PAYMENT_APPROVED'
      )
      AND NOT EXISTS (
        SELECT 1 FROM sport_center.gym_vis_card_reservations r
        WHERE r.booking_id=b.id
      )
      AND upper(regexp_replace(trim(b.customer_name),'[[:space:]]+','','g')) =
          upper(regexp_replace(trim(x904_nonmember_daily_access.verified_name),'[[:space:]]+','','g'))
  )
  AND EXISTS (
    SELECT 1 FROM sport_center.x904_verified_nonmember_identities r
    JOIN sport_center.gym_x904_lan_users u
      ON u.device_serial=r.device_serial AND u.user_pin=r.user_pin
      AND u.device_uid=r.device_uid
    WHERE r.device_serial=x904_nonmember_daily_access.device_serial
      AND r.user_pin=x904_nonmember_daily_access.user_pin
      AND r.device_uid=x904_nonmember_daily_access.device_uid
      AND r.verification_state='verified' AND r.revoked_at IS NULL
      AND u.device_role=0
      AND upper(regexp_replace(trim(r.display_name),'[[:space:]]+','','g')) =
          upper(regexp_replace(trim(x904_nonmember_daily_access.verified_name),'[[:space:]]+','','g'))
      AND upper(regexp_replace(trim(u.display_name),'[[:space:]]+','','g')) =
          upper(regexp_replace(trim(x904_nonmember_daily_access.verified_name),'[[:space:]]+','','g'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM sport_center.gym_x904_member_mapping m
    WHERE m.device_serial=x904_nonmember_daily_access.device_serial
      AND m.user_pin=x904_nonmember_daily_access.user_pin
  )
);
COMMIT;
