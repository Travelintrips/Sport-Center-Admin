-- Existing booking SC-1758 uses source='web'. Existing 20261107 RLS policies
-- only allow source='gym_public_guest', so PostgreSQL rejects INSERT even
-- though the payment/booking/card pass the application checks.
-- Append narrowly scoped permissive INSERT policies; never replace existing
-- guest/PIN policies, grant access to anon/authenticated, or issue X904 commands.
-- Run DEV before PROD. Application already requires authenticated booking role,
-- date/time, facility=Gym, unique confirmed payment, proof/amount, live X904
-- Group 2, and physical handover + ACK before any activation.

CREATE POLICY gym_vis_app_paid_web_insert
ON sport_center.gym_vis_card_reservations
AS PERMISSIVE FOR INSERT TO sport_center_app
WITH CHECK (
  device_serial='TDBD234200545' AND state='reserved'
  AND ((card_code='VIS001' AND user_pin='78' AND device_uid=338)
    OR (card_code='VIS002' AND user_pin='90' AND device_uid=339)
    OR (card_code='VIS003' AND user_pin='13' AND device_uid=13)
    OR (card_code='VIS004' AND user_pin='17' AND device_uid=17)
    OR (card_code='VIS005' AND user_pin='11' AND device_uid=11)
    OR (card_code='VIS006' AND user_pin='15' AND device_uid=15))
  AND EXISTS (
    SELECT 1 FROM sport_center.sport_bookings b
    JOIN sport_center.sport_payments p ON p.booking_id=b.id
    WHERE b.id=gym_vis_card_reservations.booking_id
      AND p.id=gym_vis_card_reservations.payment_id
      AND b.source='web' AND b.payer_type='personal'
      AND b.booking_type IS DISTINCT FROM 'event'
      AND b.status::text='confirmed' AND p.status::text='confirmed'
      AND p.confirmed_at IS NOT NULL AND nullif(btrim(p.proof_url),'') IS NOT NULL
      AND p.amount >= coalesce(b.grand_total,b.total_price)
      AND b.booking_date::date=(now() AT TIME ZONE 'Asia/Jakarta')::date
      AND gym_vis_card_reservations.funds_reference='ADMINPAY-'||p.id::text
  )
);

CREATE POLICY x904_nonmember_app_paid_web_card_insert
ON sport_center.x904_nonmember_daily_access
AS PERMISSIVE FOR INSERT TO sport_center_app
WITH CHECK (
  device_serial='TDBD234200545'
  AND identity_type='card' AND access_state='pending'
  AND verification_state='pending' AND activated_at IS NULL
  AND payment_id IS NOT NULL AND confirmed_at IS NOT NULL AND expires_at IS NOT NULL
  AND ((identity_label='VIS001' AND user_pin='78' AND device_uid=338)
    OR (identity_label='VIS002' AND user_pin='90' AND device_uid=339)
    OR (identity_label='VIS003' AND user_pin='13' AND device_uid=13)
    OR (identity_label='VIS004' AND user_pin='17' AND device_uid=17)
    OR (identity_label='VIS005' AND user_pin='11' AND device_uid=11)
    OR (identity_label='VIS006' AND user_pin='15' AND device_uid=15))
  AND EXISTS (
    SELECT 1 FROM sport_center.sport_bookings b
    JOIN sport_center.sport_payments p ON p.booking_id=b.id
    WHERE b.id=x904_nonmember_daily_access.booking_id
      AND p.id=x904_nonmember_daily_access.payment_id
      AND b.source='web' AND b.payer_type='personal'
      AND b.booking_type IS DISTINCT FROM 'event'
      AND b.status::text='confirmed' AND p.status::text='confirmed'
      AND p.confirmed_at IS NOT NULL AND nullif(btrim(p.proof_url),'') IS NOT NULL
      AND p.amount >= coalesce(b.grand_total,b.total_price)
      AND x904_nonmember_daily_access.confirmed_at=p.confirmed_at
      AND b.booking_date::date=(now() AT TIME ZONE 'Asia/Jakarta')::date
      AND expires_at=((b.booking_date::date + time '23:00') AT TIME ZONE 'Asia/Jakarta')
  )
);
