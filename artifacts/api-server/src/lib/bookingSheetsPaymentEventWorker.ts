import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { writeClaimedPaymentEvent } from "./bookingSheetsPaymentEventWriter";
import { createPaymentEventGooglePort } from "./bookingSheetsPaymentEventGooglePort";
import type { PaymentEventCandidate } from "./bookingSheetsPaymentEventContract";

const MONTHS=["JANUARI","FEBRUARI","MARET","APRIL","MEI","JUNI","JULI","AGUSTUS","SEPTEMBER","OKTOBER","NOVEMBER","DESEMBER"];
function rows(value:unknown):Record<string,unknown>[] {
  if(Array.isArray(value))return value as Record<string,unknown>[];
  if(value && typeof value==="object" && "rows" in value && Array.isArray((value as {rows?:unknown}).rows))
    return (value as {rows:Record<string,unknown>[]}).rows;
  throw new Error("Unexpected SQL response");
}
let running=false;
async function tick():Promise<void> {
  if(running)return;
  running=true;
  try {
    const config=rows(await db.execute(sql`select enabled,start_at from sport_center.booking_sheets_payment_event_config where id=true`))[0];
    if(config?.enabled!==true || !config.start_at)return;
    const startAt=new Date(String(config.start_at));
    if(!Number.isFinite(startAt.getTime()))throw new Error("INVALID_EVENT_START_AT");
    // Source events must be both confirmed and after activation; no historical backfill.
    const candidates=rows(await db.execute(sql`
      select source_key,source_type,booking_id,payment_id,allocation_id,
        company_invoice_id,membership_payment_id,amount::text as amount,
        payment_date_wib::text as payment_date_wib,validation_status,payment_ts
      from sport_center.booking_sheets_payment_event_candidates c
      where c.validation_status='CANDIDATE' and c.payment_ts >= ${startAt.toISOString()}::timestamptz
        and not exists(select 1 from sport_center.booking_sheets_payment_event_ledger l where l.source_key=c.source_key)
      order by c.payment_ts,c.source_key limit 5
    `));
    const port=createPaymentEventGooglePort();
    for(const candidate of candidates){
      const event=candidate as unknown as PaymentEventCandidate;
      let claimed=false;
      try {
        // Durable unique claim prior to ANY Sheets operation. No automatic retries.
        const claim=rows(await db.execute(sql`
          insert into sport_center.booking_sheets_payment_event_ledger
            (source_key,source_type,booking_id,payment_id,allocation_id,company_invoice_id,membership_payment_key,amount,payment_at,status,attempt_count)
          values (${event.source_key},${event.source_type},${event.booking_id},${event.payment_id},${event.allocation_id},
            ${event.company_invoice_id},${event.membership_payment_id==null?null:String(event.membership_payment_id)},
            ${event.amount}::numeric,${new Date(String(candidate.payment_ts)).toISOString()}::timestamptz,'writing',1)
          on conflict(source_key) do nothing returning id
        `));
        claimed=claim.length===1;
        if(!claimed)continue;
        const date=event.payment_date_wib;
        const [year,month]=date.split('-').map(Number);
        if(!year||month<1||month>12)throw new Error("INVALID_EVENT_MONTH");
        const tab=`PAYMENT EVENTS ${MONTHS[month-1]} ${year}`;
        const result=await writeClaimedPaymentEvent(event,tab,port);
        if(result.status==='written') {
          await db.execute(sql`update sport_center.booking_sheets_payment_event_ledger
            set status='written',target_tab=${tab},sheet_row=${result.row},updated_at=now()
            where source_key=${event.source_key} and status='writing'`);
        } else {
          await db.execute(sql`update sport_center.booking_sheets_payment_event_ledger
            set status='needs_review',last_error_code=${result.reason},updated_at=now()
            where source_key=${event.source_key} and status='writing'`);
        }
      } catch(error) {
        logger.error({err:error,sourceKey:event.source_key},"Payment event requires reconciliation");
        if(claimed) {
          try {await db.execute(sql`update sport_center.booking_sheets_payment_event_ledger
            set status='needs_review',last_error_code='EVENT_WORKER_ERROR',updated_at=now()
            where source_key=${event.source_key} and status='writing'`);
          } catch(err) {logger.error({err},"Unable to finalize payment event error");}
        }
        break;
      }
    }
  } catch(error) {logger.error({err:error},"Payment event auto-sync unavailable");}
  finally {running=false;}
}
export function startBookingSheetsPaymentEventWorker():void {
  // A deployment without both the env opt-in and DB activation cannot write any event.
  if(process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=="true")return;
  // Fail closed before scheduling: no DEV job may point to the production workbook.
  try { createPaymentEventGooglePort(); }
  catch (error) {
    logger.error({err:error},"Payment event worker not started: spreadsheet isolation or credentials invalid");
    return;
  }
  logger.info("Payment event worker opted in; DB configuration still gates all writes");
  void tick();
  const timer=setInterval(()=>void tick(),30000);
  timer.unref();
}
