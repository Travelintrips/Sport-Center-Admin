import { db, scEmployeesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { writeNewKasbonToPool } from "./scKasbonPoolGoogle";

type EventRow={id:unknown;kasbon_id:unknown;employee_id:unknown;event_type:unknown;new_record:unknown};
function records(raw:unknown): Record<string,unknown>[] {
 if(Array.isArray(raw)) return raw as Record<string,unknown>[];
 if(raw&&typeof raw==="object"&&"rows" in raw && Array.isArray((raw as {rows:unknown}).rows))
  return (raw as {rows:Record<string,unknown>[]}).rows;
 throw Error("UNEXPECTED_DATABASE_RESULT");
}
let busy=false;
async function finish(id:number,status:"synced"|"needs_review",reason:string|null) {
 await db.execute(sql`UPDATE sport_center.sc_kasbon_pool_sync_events
  SET status=${status},last_error_code=${reason},processed_at=now()
  WHERE id=${id} AND status='processing'`);
}
export async function kasbonPoolTick():Promise<void> {
 if(process.env.SC_KASBON_POOL_SYNC_ENABLED!=="true"||busy)return;
 busy=true;
 let id:number|null=null;
 try{
  const claimed=records(await db.execute(sql`
    UPDATE sport_center.sc_kasbon_pool_sync_events SET status='processing',attempts=attempts+1
    WHERE id=(SELECT id FROM sport_center.sc_kasbon_pool_sync_events
      WHERE status='pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,kasbon_id,employee_id,event_type,new_record`))[0] as EventRow|undefined;
  if(!claimed)return;
  id=Number(claimed.id);
  const kasbonId=Number(claimed.kasbon_id);
  if(!Number.isSafeInteger(id)||!Number.isSafeInteger(kasbonId))throw Error("EVENT_ID_INVALID");
  const latest=records(await db.execute(sql`
    SELECT max(id) as latest_id FROM sport_center.sc_kasbon_pool_sync_events
    WHERE kasbon_id=${kasbonId}`))[0];
  if(Number(latest?.latest_id)!==id){await finish(id,"needs_review","SUPERSEDED_BY_NEWER_EVENT");return;}
  if(claimed.event_type!=="created"){
   // Edits/deletes that could affect previously written cells need an audited
   // reconciliation protocol; never overwrite a legacy grid from an assumption.
   await finish(id,"needs_review","EDIT_DELETE_RECONCILIATION_REQUIRED");return;
  }
  const ledger=records(await db.execute(sql`
    SELECT kasbon_id FROM sport_center.sc_kasbon_pool_sync_ledger WHERE kasbon_id=${kasbonId}`));
  if(ledger.length){await finish(id,"needs_review","SOURCE_ALREADY_LINKED");return;}
  const data=claimed.new_record as Record<string,unknown>|null;
  if(!data||typeof data!=="object")throw Error("EVENT_SNAPSHOT_INVALID");
  const employeeId=String(claimed.employee_id);
  const [employee]=await db.select({name:scEmployeesTable.fullName})
    .from(scEmployeesTable).where(eq(scEmployeesTable.employeeId,employeeId)).limit(1);
  if(!employee){await finish(id,"needs_review","EMPLOYEE_MISSING");return;}
  const result=await writeNewKasbonToPool({
   id:kasbonId,employeeId,employeeName:employee.name,
   kasbonDate:String(data.kasbonDate??data.kasbon_date),
   amount:String(data.amount)
  });
  // Sheet updates cannot participate in a PostgreSQL transaction. If saving
  // this ledger fails AFTER Sheets changed, the retry must not re-send: it
  // will see the occupied cell and be marked needs_review.
  await db.transaction(async tx=>{
   await tx.execute(sql`INSERT INTO sport_center.sc_kasbon_pool_sync_ledger
     (kasbon_id,employee_id,sheet_cell,spreadsheet_id,amount,source_event_id)
     VALUES (${kasbonId},${employeeId},${result.cell},${result.sheetId},${result.amount}::numeric,${id})
     ON CONFLICT DO NOTHING`);
   await tx.execute(sql`UPDATE sport_center.sc_kasbon_pool_sync_events
     SET status='synced',last_error_code=null,processed_at=now()
     WHERE id=${id} AND status='processing'`);
  });
  logger.info({kasbonId,eventId:id,cell:result.cell},"Kasbon POOL sync completed with readback");
 } catch(e) {
  logger.warn({eventId:id,errorCode:e instanceof Error?e.message:"UNKNOWN"}, "Kasbon POOL sync blocked for review");
  if(id!==null)try{await finish(id,"needs_review",String(e instanceof Error?e.message:"UNKNOWN").slice(0,90));}
   catch(err){logger.error({err,eventId:id},"Unable to record Kasbon sync review state");}
 } finally{busy=false;}
}
export function startKasbonPoolAutoWorker():void{
 if(process.env.SC_KASBON_POOL_SYNC_ENABLED!=="true")return;
 logger.info("Kasbon POOL opt-in sync worker started");
 // An interrupted write could already be present in Sheets. Never replay it.
 void db.execute(sql`UPDATE sport_center.sc_kasbon_pool_sync_events
  SET status='needs_review',last_error_code='INTERRUPTED_WRITE_CHECK_REQUIRED'
  WHERE status='processing' AND created_at < now()-interval '10 minutes'`)
  .catch(err=>logger.error({err},"Kasbon POOL interrupted queue recovery failed"));
 void kasbonPoolTick();
 const timer=setInterval(()=>void kasbonPoolTick(),30_000);timer.unref();
}
