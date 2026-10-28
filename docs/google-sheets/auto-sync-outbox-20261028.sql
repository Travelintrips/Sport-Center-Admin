-- Safe durable outbox for new, confirmed, single-payment personal bookings.
-- The worker remains OFF until SHEETS_AUTO_SYNC_ENABLED=true is explicitly configured.
-- One-row rollout switch. Only database administrators can enable auto writes.
create table if not exists sport_center.booking_sheets_auto_config (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 start_at timestamptz,
 updated_at timestamptz not null default now(),
 constraint enabled_requires_start check (not enabled or start_at is not null)
);
insert into sport_center.booking_sheets_auto_config(id,enabled)
 values(true,false) on conflict(id) do nothing;
alter table sport_center.booking_sheets_auto_config enable row level security;
grant select on sport_center.booking_sheets_auto_config to sport_center_app;
do $
begin
 if not exists (select 1 from pg_policies where schemaname='sport_center'
   and tablename='booking_sheets_auto_config' and policyname='booking_sheets_auto_backend_config_read') then
   create policy booking_sheets_auto_backend_config_read on sport_center.booking_sheets_auto_config
    for select to sport_center_app using (true);
 end if;
end $;

create table if not exists sport_center.booking_sheets_auto_queue (
 id bigint generated always as identity primary key,
 source_key text not null unique,
 booking_id integer not null,
 payment_id integer not null,
 status text not null default 'pending'
    check (status in ('pending','processing','written','blocked','needs_review')),
 attempt_count integer not null default 0,
 last_error_code text,
 created_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz,
 updated_at timestamptz not null default now()
);
create index if not exists booking_sheets_auto_queue_pending_idx
 on sport_center.booking_sheets_auto_queue(status,created_at,id);
alter table sport_center.booking_sheets_auto_queue enable row level security;
grant usage on schema sport_center to sport_center_app;
grant select, update on sport_center.booking_sheets_auto_queue to sport_center_app;
do $$
begin
 if not exists (select 1 from pg_policies where schemaname='sport_center'
   and tablename='booking_sheets_auto_queue' and policyname='booking_sheets_auto_backend_read') then
   create policy booking_sheets_auto_backend_read on sport_center.booking_sheets_auto_queue
     for select to sport_center_app using (true);
 end if;
 if not exists (select 1 from pg_policies where schemaname='sport_center'
   and tablename='booking_sheets_auto_queue' and policyname='booking_sheets_auto_backend_update') then
   create policy booking_sheets_auto_backend_update on sport_center.booking_sheets_auto_queue
     for update to sport_center_app
     using (status in ('pending','processing'))
     with check (status in ('processing','written','blocked','needs_review'));
 end if;
end $$;

create or replace function sport_center.enqueue_booking_sheets_after_confirmation()
returns trigger language plpgsql security definer
set search_path = pg_catalog,sport_center
as $$
declare
 eligible boolean;
begin
 if NEW.status::text <> 'confirmed'
   or (TG_OP = 'UPDATE' and OLD.status::text = 'confirmed') then
   return NEW;
 end if;
 -- Fail closed: only a single confirmed direct payment that covers full charge.
 select exists (
   select 1 from sport_center.sport_bookings b
   where b.id=NEW.booking_id
     and b.group_ref is null and b.payer_type::text='personal'
     and b.membership_id is null and b.membership_payment_id is null
     and NEW.payment_type::text <> 'dp'
     and NEW.amount >= coalesce(b.grand_total,b.total_price)
     and coalesce(b.grand_total,b.total_price)>0
     and (select count(*) from sport_center.sport_payments p
          where p.booking_id=b.id and p.status::text='confirmed')=1
 ) into eligible;
 if eligible then
   insert into sport_center.booking_sheets_auto_queue(source_key,booking_id,payment_id)
     values('payment:'||NEW.id||':booking:'||NEW.booking_id,NEW.booking_id,NEW.id)
     on conflict(source_key) do nothing;
 end if;
 return NEW;
end $$;
drop trigger if exists booking_sheets_auto_enqueue_confirmed on sport_center.sport_payments;
create trigger booking_sheets_auto_enqueue_confirmed
 after insert or update of status on sport_center.sport_payments
 for each row execute function sport_center.enqueue_booking_sheets_after_confirmation();
