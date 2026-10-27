-- DEV-validated ledger foundation. Apply through reviewed migration pipeline before enabling writes.
-- Do not insert historic data into this ledger by guessing payment allocations.
create table if not exists sport_center.booking_sheets_sync_ledger (
 id bigint generated always as identity primary key,
 source_key text not null unique,
 booking_id integer not null,
 payment_id integer,
 allocation_id integer,
 company_invoice_id integer,
 payment_date_wib date not null,
 target_tab text not null,
 amount numeric(18,2) not null check (amount >= 0),
 status text not null default 'pending' check (status in ('pending','blocked','writing','written','failed')),
 sheet_row integer,
 attempt_count integer not null default 0,
 last_error_code text,
 last_attempt_at timestamptz,
 written_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint booking_sheets_ledger_source check (
  (payment_id is not null and company_invoice_id is null) or
  (payment_id is null and company_invoice_id is not null)
 )
);
create index if not exists booking_sheets_sync_ledger_status_idx
 on sport_center.booking_sheets_sync_ledger (status, target_tab);
alter table sport_center.booking_sheets_sync_ledger enable row level security;
revoke all on sport_center.booking_sheets_sync_ledger from anon, authenticated;
-- Writing service must use tightly-scoped server-side connection. No public grants.
