-- Correct the already-applied DEV policy; idempotently restates the narrow booking/payment join.
ALTER POLICY gym_vis_app_direct_admin_handover_insert
ON sport_center.gym_vis_card_reservations
WITH CHECK (
 device_serial='TDBD234200545' AND state='collected'
 AND collected_at IS NOT NULL AND returned_at IS NULL
 AND funds_reference=('ADMINVIS-HANDOVER-' || payment_id::text)
 AND funds_verified_by ~ '^STAFF-HANDOVER-[1-9][0-9]*$'
 AND (
  (card_code='VIS001' AND user_pin='78' AND device_uid=338) OR
  (card_code='VIS002' AND user_pin='90' AND device_uid=339) OR
  (card_code='VIS003' AND user_pin='13' AND device_uid=13) OR
  (card_code='VIS004' AND user_pin='17' AND device_uid=17) OR
  (card_code='VIS005' AND user_pin='11' AND device_uid=11) OR
  (card_code='VIS006' AND user_pin='15' AND device_uid=15)
 )
 AND EXISTS (
   SELECT 1 FROM sport_center.sport_bookings b
   JOIN sport_center.sport_payments p
     ON p.booking_id=b.id AND p.id=gym_vis_card_reservations.payment_id
   WHERE b.id=gym_vis_card_reservations.booking_id AND b.source='admin'
     AND b.status::text='confirmed' AND p.status::text='confirmed'
     AND p.confirmed_at IS NOT NULL
     AND b.booking_date::date=(now() AT TIME ZONE 'Asia/Jakarta')::date
 )
);
