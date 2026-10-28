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
async function tick():Promise<void> {
  if(running)return;
  running=true;
  let job:Record<string,unknown>|undefined;
  let stage="READ_CONFIG";
  try {
    const config=rows(await db.execute(sql`select enabled,start_at::text as start_at from sport_center.booking_sheets_auto_config where id=true`))[0];
    if(!config?.enabled || !config.start_at)return;
    const startAt=String(config.start_at);
    stage="QUEUE_CLAIM";
    const claimed=rows(await db.execute(sql`
      update sport_center.booking_sheets_auto_queue
      set status='processing', attempt_count=attempt_count+1, started_at=now(), updated_at=now()
      where id=(
        select id from sport_center.booking_sheets_auto_queue
        where status='pending' and created_at >= ${startAt}::timestamptz
        order by created_at,id limit 1 for update skip locked
      )
      returning id,source_key,booking_id,payment_id
    `));
    job=claimed[0];
    if(!job)return;
    stage="BOOKING_LOOKUP";
    const [booking]=await db.select({orderNumber:bookingsTable.orderNumber}).from(bookingsTable)
      .where(eq(bookingsTable.id,Number(job.booking_id))).limit(1);
    if(!booking)throw new Error("AUTO_BOOKING_MISSING");
    stage="SHEETS_SYNC";
    const result=await syncPaidBookingFromAutoQueue(booking.orderNumber,logger);
    // Already-present rows are success ONLY when their exact location agrees with
    // the durable written ledger. A manually inserted row without a ledger is NOT success.
    let alreadyVerified=false;
    const locations=result.body.locations;
    if(result.statusCode===200 && result.body.alreadyPresent===true &&
       Array.isArray(locations) && locations.length===1) {
      stage="LEDGER_VERIFY";
      const ledger=rows(await db.execute(sql`
        select status,target_tab,sheet_row
        from sport_center.booking_sheets_sync_ledger
        where booking_id=${Number(job.booking_id)} and payment_id=${Number(job.payment_id)}
        order by id desc limit 1
      `))[0];
      alreadyVerified=ledger?.status==="written" &&
        ledger.target_tab===locations[0]?.tab &&
        Number(ledger.sheet_row)===Number(locations[0]?.row);
    }
    const succeeded=result.statusCode===200 && (result.body.written===true || alreadyVerified);
    const state=succeeded?"written":result.statusCode===409?"blocked":"needs_review";
    const safeCode=String(result.body.reason??result.body.stage??result.statusCode).slice(0,90);
    stage="QUEUE_FINALIZE";
    await db.execute(sql`
      update sport_center.booking_sheets_auto_queue
      set status=${state},last_error_code=${succeeded?null:safeCode},
          finished_at=now(),updated_at=now()
      where id=${Number(job.id)} and status='processing'
    `);
    if(!succeeded)logger.warn({orderNumber:booking.orderNumber,statusCode:result.statusCode,stage:safeCode},
      "Sheets auto-sync requires manual review; no retries");
  } catch(error) {
    logger.error({err:error,jobId:job?.id,stage},"Sheets auto-sync worker stopped current job");
    if(job) {
      try {
        await db.execute(sql`
          update sport_center.booking_sheets_auto_queue
          set status='needs_review',last_error_code=${'AUTO_'+stage},
              finished_at=now(),updated_at=now()
          where id=${Number(job.id)} and status='processing'
        `);
      }catch(updateError){logger.error({err:updateError,jobId:job.id},"Unable to mark auto-sync failure");}
    }
  } finally {running=false;}
}

export function startBookingSheetsAutoWorker():void {
  logger.info("Sheets auto-sync worker started; DB rollout flag is disabled by default");
  void tick();
  const timer=setInterval(()=>void tick(),30_000);
  timer.unref();
}
