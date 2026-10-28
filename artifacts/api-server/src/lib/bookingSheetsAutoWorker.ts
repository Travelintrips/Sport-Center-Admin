import { db, bookingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { syncPaidBookingFromAutoQueue } from "../routes/bookingSheetsAudit";

function rows(value:unknown): Record<string,unknown>[] {
  if(Array.isArray(value))return value as Record<string,unknown>[];
  if(value && typeof value==="object" && "rows" in value &&
     Array.isArray((value as {rows?:unknown}).rows)) return (value as {rows:Record<string,unknown>[]}).rows;
  throw new Error("Unexpected database result");
}

let running=false;
async function tick(startAt:string):Promise<void> {
  if(running)return;
  running=true;
  let job:Record<string,unknown>|undefined;
  try {
    const claimed=rows(await db.execute(sql`
      update sport_center.booking_sheets_auto_queue
      set status='processing', attempt_count=attempt_count+1, started_at=now(), updated_at=now()
      where id=(
        select id from sport_center.booking_sheets_auto_queue
        where status='pending' and created_at >= ${startAt}::timestamptz
        order by created_at,id limit 1 for update skip locked
      )
      returning id,source_key,booking_id
    `));
    job=claimed[0];
    if(!job)return;
    const [booking]=await db.select({orderNumber:bookingsTable.orderNumber}).from(bookingsTable)
      .where(eq(bookingsTable.id,Number(job.booking_id))).limit(1);
    if(!booking)throw new Error("AUTO_BOOKING_MISSING");
    const result=await syncPaidBookingFromAutoQueue(booking.orderNumber,logger);
    // Existing Sheet rows with no ledger require manual reconciliation.
    const succeeded=result.statusCode===200 && result.body.written===true;
    const state=succeeded?"written":result.statusCode===409?"blocked":"needs_review";
    const safeCode=String(result.body.reason??result.body.stage??result.statusCode).slice(0,90);
    await db.execute(sql`
      update sport_center.booking_sheets_auto_queue
      set status=${state},last_error_code=${succeeded?null:safeCode},
          finished_at=now(),updated_at=now()
      where id=${Number(job.id)} and status='processing'
    `);
    if(!succeeded)logger.warn({orderNumber:booking.orderNumber,statusCode:result.statusCode,stage:safeCode},
      "Sheets auto-sync requires manual review; no retries");
  } catch(error) {
    logger.error({err:error,jobId:job?.id},"Sheets auto-sync worker stopped current job");
    if(job) {
      try {
        await db.execute(sql`
          update sport_center.booking_sheets_auto_queue
          set status='needs_review',last_error_code='WORKER_EXCEPTION',
              finished_at=now(),updated_at=now()
          where id=${Number(job.id)} and status='processing'
        `);
      }catch(updateError){logger.error({err:updateError,jobId:job.id},"Unable to mark auto-sync failure");}
    }
  } finally {running=false;}
}

export function startBookingSheetsAutoWorker():void {
  if(process.env.SHEETS_AUTO_SYNC_ENABLED!=="true"){
    logger.info("Sheets auto-sync disabled; no automatic writes");
    return;
  }
  const startAt=process.env.SHEETS_AUTO_SYNC_START_AT;
  if(!startAt || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(startAt) || Number.isNaN(Date.parse(startAt))){
    logger.error("Sheets auto-sync refused to start: SHEETS_AUTO_SYNC_START_AT required");
    return;
  }
  logger.info({startAt},"Sheets auto-sync enabled for fresh confirmed personal full payments only");
  void tick(startAt);
  const timer=setInterval(()=>void tick(startAt),30_000);
  timer.unref();
}
