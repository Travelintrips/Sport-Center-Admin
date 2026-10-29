-- Read-only candidate projection. No payment, journal, or Sheets writes.
-- A source_key is unique per confirmed actual payment or allocation/invoice item.
create or replace view sport_center.booking_sheets_payment_event_candidates
with (security_invoker=true) as
select s.source_key,s.source_type,s.booking_id,s.payment_id,s.allocation_id,
       s.company_invoice_id,null::integer as membership_payment_id,
       s.amount::numeric(18,2) as amount,s.payment_ts,
       s.validation_status,
       (s.payment_ts at time zone 'Asia/Jakarta')::date as payment_date_wib
from sport_center.booking_sheets_payment_sources s
union all
select 'membership_payment:'||m.id::text as source_key,
       'membership'::text as source_type,null::integer as booking_id,
       null::integer as payment_id,null::integer as allocation_id,
       null::integer as company_invoice_id,m.id as membership_payment_id,
       m.amount::numeric(18,2) as amount,m.confirmed_at as payment_ts,
       case when m.confirmed_at is null then 'MISSING_PAYMENT_DATE'
            when m.amount is null or m.amount<=0 then 'INVALID_AMOUNT'
            else 'CANDIDATE' end as validation_status,
       (m.confirmed_at at time zone 'Asia/Jakarta')::date as payment_date_wib
from sport_center.sport_membership_payments m
where m.status='confirmed';
revoke all on sport_center.booking_sheets_payment_event_candidates from anon,authenticated;
