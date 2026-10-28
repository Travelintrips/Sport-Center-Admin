-- Apply to DEV first, then PROD. Scoped solely to the Sport Center backend DB role.
-- Recover a previously written ledger row through an exclusive writing claim.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='sport_center'
    and tablename='booking_sheets_sync_ledger' and policyname='booking_sheets_app_recovery_claim') then
    create policy booking_sheets_app_recovery_claim on sport_center.booking_sheets_sync_ledger
      for update to sport_center_app using (status='written')
      with check (status='writing' and attempt_count >= 2 and payment_id is not null and company_invoice_id is null);
  end if;
end $$;

create table if not exists sport_center.booking_sheets_recovery_history (
 id bigint generated always as identity primary key,
 source_key text not null references sport_center.booking_sheets_sync_ledger(source_key),
 booking_id integer not null,
 order_number text not null,
 target_tab text not null,
 old_sheet_row integer,
 new_sheet_row integer not null check (new_sheet_row > 1),
 admin_user_id integer,
 created_at timestamptz not null default now()
);
alter table sport_center.booking_sheets_recovery_history enable row level security;
grant select, insert on sport_center.booking_sheets_recovery_history to sport_center_app;
do $$
begin
 if not exists (select 1 from pg_policies where schemaname='sport_center'
   and tablename='booking_sheets_recovery_history' and policyname='booking_sheets_app_history_insert') then
   create policy booking_sheets_app_history_insert on sport_center.booking_sheets_recovery_history
     for insert to sport_center_app with check (new_sheet_row > 1);
 end if;
 if not exists (select 1 from pg_policies where schemaname='sport_center'
   and tablename='booking_sheets_recovery_history' and policyname='booking_sheets_app_history_read') then
   create policy booking_sheets_app_history_read on sport_center.booking_sheets_recovery_history
     for select to sport_center_app using (true);
 end if;
end $$;
