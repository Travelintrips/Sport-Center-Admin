-- Additive foundation only; does not auto-write or alter the 14-column booking export.
-- Disabled until source-by-source reconciliation and DEV E2E validation.
create table if not exists sport_center.booking_sheets_payment_event_config (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 start_at timestamptz,
 updated_at timestamptz not null default now(),
 constraint payment_event_start_required check (not enabled or start_at is not null)
);
insert into sport_center.booking_sheets_payment_event_config(id,enabled)
 values (true,false) on conflict (id) do nothing;
create table if not exists sport_center.booking_sheets_payment_event_ledger (
 id bigint generated always as identity primary key,
 source_key text not null unique,
 source_type text not null check(source_type in ('direct','allocation','corporate_invoice','membership')),
 booking_id integer,
 payment_id integer,
 allocation_id integer,
 company_invoice_id integer,
 membership_payment_key text,
 amount numeric(18,2) not null check(amount>0),
 payment_at timestamptz not null,
 target_tab text,
 sheet_row integer,
 status text not null default 'pending'
   check(status in ('pending','writing','written','blocked','needs_review')),
 attempt_count integer not null default 0,
 last_error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint event_source_link_required check (
   (source_type='direct' and booking_id is not null and payment_id is not null and allocation_id is null and company_invoice_id is null and membership_payment_key is null)
   or (source_type='allocation' and booking_id is not null and payment_id is not null and allocation_id is not null and company_invoice_id is null and membership_payment_key is null)
   or (source_type='corporate_invoice' and booking_id is not null and company_invoice_id is not null and payment_id is null and allocation_id is null and membership_payment_key is null)
   or (source_type='membership' and membership_payment_key is not null and payment_id is null and allocation_id is null and company_invoice_id is null)
 ),
 constraint event_written_location_required check(status <> 'written' or (target_tab is not null and sheet_row > 0))
);
create index if not exists booking_sheets_payment_event_pending_idx
 on sport_center.booking_sheets_payment_event_ledger(status,created_at,id);
alter table sport_center.booking_sheets_payment_event_config enable row level security;
alter table sport_center.booking_sheets_payment_event_ledger enable row level security;
-- Intentionally no policies or DML grants yet: default deny until reviewed rollout.
