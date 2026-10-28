-- DEV verified: column-scoped SELECT and row-scoped RLS for the backend role only.
-- No changes to anon/authenticated, no mutation grants and no RLS bypass.
grant select on sport_center.booking_sheets_payment_sources to sport_center_app;
grant select(id,booking_id,amount,status,paid_at,confirmed_at) on sport_center.sport_payments to sport_center_app;
grant select(id,payment_id,booking_id,amount) on sport_center.sport_payment_allocations to sport_center_app;
grant select(id,order_number,payer_type,total_price) on sport_center.sport_bookings to sport_center_app;
grant select(id,status,paid_at) on sport_center.company_invoices to sport_center_app;
grant select(id,invoice_id,booking_id,total_amount) on sport_center.company_invoice_items to sport_center_app;
grant select(id,status,amount,confirmed_at) on sport_center.sport_membership_payments to sport_center_app;
create policy sheets_events_payment_read on sport_center.sport_payments for select to sport_center_app using(status='confirmed');
create policy sheets_events_allocations_read on sport_center.sport_payment_allocations for select to sport_center_app using(true);
create policy sheets_events_bookings_read on sport_center.sport_bookings for select to sport_center_app using(total_price>0);
create policy sheets_events_invoice_read on sport_center.company_invoices for select to sport_center_app using(status='paid');
create policy sheets_events_invoice_items_read on sport_center.company_invoice_items for select to sport_center_app using(booking_id is not null);
create policy sheets_events_membership_read on sport_center.sport_membership_payments for select to sport_center_app using(status='confirmed');
