-- Apply in DEV first. The event worker is separately disabled by default.
-- Explicit narrow backend-only rights, never anon or authenticated.
grant usage on schema sport_center to sport_center_app;
grant select on sport_center.booking_sheets_payment_event_candidates to sport_center_app;
grant select on sport_center.booking_sheets_payment_event_config to sport_center_app;
grant select,insert,update on sport_center.booking_sheets_payment_event_ledger to sport_center_app;
grant usage,select on sequence sport_center.booking_sheets_payment_event_ledger_id_seq to sport_center_app;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='sport_center' and tablename='booking_sheets_payment_event_config' and policyname='booking_sheets_events_config_read') then
  create policy booking_sheets_events_config_read on sport_center.booking_sheets_payment_event_config
   for select to sport_center_app using(true);
 end if;
 if not exists(select 1 from pg_policies where schemaname='sport_center' and tablename='booking_sheets_payment_event_ledger' and policyname='booking_sheets_events_backend_select') then
  create policy booking_sheets_events_backend_select on sport_center.booking_sheets_payment_event_ledger
   for select to sport_center_app using(true);
 end if;
 if not exists(select 1 from pg_policies where schemaname='sport_center' and tablename='booking_sheets_payment_event_ledger' and policyname='booking_sheets_events_backend_insert') then
  create policy booking_sheets_events_backend_insert on sport_center.booking_sheets_payment_event_ledger
   for insert to sport_center_app with check(status='writing' and attempt_count=1 and target_tab is null and sheet_row is null);
 end if;
 if not exists(select 1 from pg_policies where schemaname='sport_center' and tablename='booking_sheets_payment_event_ledger' and policyname='booking_sheets_events_backend_update') then
  create policy booking_sheets_events_backend_update on sport_center.booking_sheets_payment_event_ledger
   for update to sport_center_app using(status='writing') with check(status in ('written','needs_review'));
 end if;
end $$;
