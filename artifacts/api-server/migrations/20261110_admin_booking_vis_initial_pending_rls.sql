-- Initial VIS grant for direct Admin Lapangan booking only. No public grants.
CREATE POLICY x904_nonmember_app_admin_card_initial_pending_insert ON sport_center.x904_nonmember_daily_access AS PERMISSIVE FOR INSERT TO sport_center_app WITH CHECK (
 device_serial='TDBD234200545' AND identity_type='card' AND access_state='pending' AND verification_state='pending'
 AND activated_at IS NULL AND payment_id IS NULL AND confirmed_at IS NULL AND expires_at IS NULL
 AND ((identity_label='VIS001' AND user_pin='78' AND device_uid=338) OR (identity_label='VIS002' AND user_pin='90' AND device_uid=339) OR (identity_label='VIS003' AND user_pin='13' AND device_uid=13) OR (identity_label='VIS004' AND user_pin='17' AND device_uid=17) OR (identity_label='VIS005' AND user_pin='11' AND device_uid=11) OR (identity_label='VIS006' AND user_pin='15' AND device_uid=15))
 AND EXISTS(SELECT 1 FROM sport_center.sport_bookings b JOIN sport_center.sport_facilities f ON f.id=b.facility_id WHERE b.id=x904_nonmember_daily_access.booking_id AND b.source='admin' AND b.payer_type='personal' AND b.booking_type IS DISTINCT FROM 'event' AND b.status::text='pending_payment' AND b.booking_date::date >= (now() AT TIME ZONE 'Asia/Jakarta')::date AND (f.booking_mode='walk_in' OR f.name ~* 'gym|fitness' OR f.category ~* 'gym|fitness'))
);
