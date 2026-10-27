-- Source projection for the payment-to-Sheets ledger. DEV tested.
-- This is a read-only view; do not schedule writes before E2E and accounting approval.
create or replace view sport_center.booking_sheets_payment_sources with (security_invoker = true) as
with allocated as (
 select 'payment:'||p.id||':allocation:'||a.id||':booking:'||a.booking_id as source_key,
 a.booking_id,p.id as payment_id,a.id as allocation_id,null::integer as company_invoice_id,
 a.amount as amount,coalesce(p.paid_at,p.confirmed_at) as payment_ts,'allocation'::text as source_type
 from sport_center.sport_payments p join sport_center.sport_payment_allocations a on a.payment_id=p.id
 where p.status='confirmed'
),
direct as (
 select 'payment:'||p.id||':booking:'||p.booking_id as source_key,
 p.booking_id,p.id as payment_id,null::integer as allocation_id,null::integer as company_invoice_id,
 p.amount,coalesce(p.paid_at,p.confirmed_at) as payment_ts,'direct'::text as source_type
 from sport_center.sport_payments p
 where p.status='confirmed'
 and not exists(select 1 from sport_center.sport_payment_allocations a where a.payment_id=p.id)
),
corporate as (
 select 'invoice:'||i.id||':item:'||item.id||':booking:'||item.booking_id as source_key,
 item.booking_id,null::integer as payment_id,null::integer as allocation_id,i.id as company_invoice_id,
 item.total_amount as amount,i.paid_at as payment_ts,'corporate_invoice'::text as source_type
 from sport_center.company_invoices i
 join sport_center.company_invoice_items item on item.invoice_id=i.id
 where i.status='paid' and item.booking_id is not null
),
sources as (select * from allocated union all select * from direct union all select * from corporate)
select s.source_key,s.source_type,s.booking_id,s.payment_id,s.allocation_id,s.company_invoice_id,
 s.amount,s.payment_ts,(s.payment_ts at time zone 'Asia/Jakarta')::date as payment_date_wib,
 b.order_number,b.payer_type::text as payer_type,b.total_price as booking_total_price,
 case when s.payment_ts is null then 'MISSING_PAYMENT_DATE'
 when s.amount is null or s.amount<=0 then 'INVALID_AMOUNT'
 when s.source_type='corporate_invoice' and b.payer_type::text<>'company' then 'PAYER_MISMATCH'
 when s.source_type<>'corporate_invoice' and b.payer_type::text='company' then 'CORPORATE_PAYMENT_NEEDS_REVIEW'
 else 'CANDIDATE' end as validation_status
from sources s join sport_center.sport_bookings b on b.id=s.booking_id where b.total_price>0;
revoke all on sport_center.booking_sheets_payment_sources from anon,authenticated;
