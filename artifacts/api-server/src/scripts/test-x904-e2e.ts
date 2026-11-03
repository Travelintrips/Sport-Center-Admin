import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
if(process.env.NODE_ENV!=="development") throw Error("DEV_ONLY");
const url=process.env.SUPABASE_DATABASE_URL_DEV;
if(!url) throw Error("DEV_URL_MISSING");
const u=new URL(url);
if(!u.username.endsWith(".xssrfshdrtdfupgqwfdw")) throw Error("WRONG_PROJECT");
const {db,pool}=await import("@workspace/db");
const {sql}=await import("drizzle-orm");
const {processX904Event}=await import("../services/processX904Event");
const serial="TDBD234200545",pin=String(100000+randomBytes(4).readUInt32BE(0)%900000),eventId=randomBytes(32).toString("hex"),secondEventId=randomBytes(32).toString("hex");
const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
const field=(n:string)=>parts.find(p=>p.type===n)?.value;
const day=field("year")+"-"+field("month")+"-"+field("day");
let membershipId: number | null = null;
const marker="X904 event "+eventId;
// DEV fixture only: the synthetic event uses code 1. Production stays fail-closed.
const originalTrustedCodes=process.env.GYM_X904_TRUSTED_VERIFICATION_CODES;
process.env.GYM_X904_TRUSTED_VERIFICATION_CODES="1";
try{
 const identity=await db.execute(sql`SELECT current_user AS role_name, session_user AS login_name, has_schema_privilege(current_user, 'sport_center', 'USAGE') AS schema_usage`);
 console.log("X904_DEV_DB_IDENTITY",JSON.stringify(identity.rows[0]));
 // Verify actual application-role RLS within a rolled-back transaction.
 // This must fail closed if the runner cannot assume the application role.
 let appRoleRollback=false;
 try { await db.transaction(async tx => {
   await tx.execute(sql`SET LOCAL ROLE sport_center_app`);
   const role=await tx.execute(sql`SELECT current_user AS role_name, has_schema_privilege(current_user,'sport_center','USAGE') AS schema_usage`);
   if(role.rows[0]?.role_name!=="sport_center_app" || role.rows[0]?.schema_usage!==true)
     throw Error("X904_APP_ROLE_NOT_ACTIVE");
   const denied=await tx.execute(sql`SELECT count(*)::int AS visible FROM sport_center.x904_automatic_entitlement_events WHERE membership_id=-2147483647`);
   if(Number(denied.rows[0]?.visible)!==0) throw Error("X904_APP_ROLE_UNEXPECTED_VISIBILITY");
   console.log("X904_APP_ROLE_RLS_READ_PASS",JSON.stringify(role.rows[0]));
   // INSERT and UPDATE are performed as the real application role, then rolled back.
   const testKey="x904-rls-ci-"+eventId;
   const inserted=await tx.execute(sql`INSERT INTO sport_center.x904_automatic_entitlement_events
     (membership_id,reason,event_key,state)
     VALUES (-2147483647,'PAYMENT_RECOVERY',${testKey},'pending')
     RETURNING event_id`);
   if(inserted.rows.length!==1) throw Error("X904_APP_ROLE_RLS_INSERT_FAILED");
   const updated=await tx.execute(sql`UPDATE sport_center.x904_automatic_entitlement_events
     SET state='review_required' WHERE event_key=${testKey} RETURNING event_id,state`);
   if(updated.rows.length!==1 || updated.rows[0]?.state!=="review_required")
     throw Error("X904_APP_ROLE_RLS_UPDATE_FAILED");
   console.log("X904_APP_ROLE_RLS_WRITE_PASS");
   // Throw sentinel so this transaction cannot persist any synthetic event.
   throw Error("X904_APP_ROLE_TEST_ROLLBACK");

 }); } catch(e) { appRoleRollback=e instanceof Error && e.message==="X904_APP_ROLE_TEST_ROLLBACK"; if(!appRoleRollback) throw e; }
 if(!appRoleRollback) throw Error("X904_APP_ROLE_ROLLBACK_FAILED");
 const leftover=await db.execute(sql`SELECT count(*)::int AS n FROM sport_center.x904_automatic_entitlement_events WHERE event_key=${"x904-rls-ci-"+eventId}`);
 if(Number(leftover.rows[0]?.n)!==0) throw Error("X904_APP_ROLE_ROLLBACK_LEFT_WRITES");
 console.log("X904_APP_ROLE_RLS_ROLLBACK_PASS");

 // DEV-only synthetic membership and mapping; never touch an existing member.
 const member=await db.execute(sql`INSERT INTO sport_center.sport_memberships
  (name,email,phone,start_date,end_date,months,total_price,status,notes)
  VALUES (${`X904 CI ${eventId}`},${`x904-ci-${eventId}@example.invalid`},${`000${pin}`},${day},${day},1,0,'active',${`X904 E2E ${eventId}`})
  RETURNING id`);
 membershipId=Number(member.rows[0]?.id);
 if(!Number.isSafeInteger(membershipId)||membershipId<=0) throw Error('FIXTURE_MEMBERSHIP_FAILED');
 // A trusted synthetic device-user snapshot and payment period are required for automatic attendance.
 await db.execute(sql`INSERT INTO sport_center.gym_x904_lan_users
  (device_serial,user_pin,device_uid,display_name,device_role,last_seen_snapshot)
  VALUES (${serial},${pin},1,${`X904 CI ${eventId}`},0,${randomUUID()}::uuid)`);
 // No confirmed payment fixture: the canonical payment trigger requires a
 // real booking and settlement configuration. Test the safe unpaid rejection,
 // rather than forging an accounting transaction in DEV.
 await db.execute(sql`INSERT INTO sport_center.gym_x904_member_mapping
  (device_serial,user_pin,membership_id,status,verified_at,verified_by)
  VALUES (${serial},${pin},${membershipId},'verified',now(),'x904-ci-test')`);
 await db.execute(sql`INSERT INTO sport_center.gym_x904_raw_events(event_id,device_serial,user_pin,device_time,attendance_status,verification_type) VALUES(${eventId},${serial},${pin},${day+" 10:00:00"},0,1)`);
 // Rollback must not leave a check-in, booking, or processing ledger.
 let rolledBack=false;
 try { await processX904Event({eventId,deviceSerial:serial,userPin:pin},{failBeforeCommit:true}); }
 catch(e) { rolledBack=e instanceof Error && e.message.includes("X904_TEST_ROLLBACK_BEFORE_COMMIT"); }
 if(!rolledBack) throw Error("X904_ROLLBACK_NOT_TRIGGERED");
 const rollbackCheck=await db.execute(sql`SELECT
   (SELECT count(*)::int FROM sport_center.gym_x904_processed_events WHERE event_id=${eventId}) AS ledger,
   (SELECT count(*)::int FROM sport_center.gym_checkins WHERE x904_event_id=${eventId}) AS checkins,
   (SELECT count(*)::int FROM sport_center.sport_bookings WHERE notes=${marker}) AS bookings`);
 if([rollbackCheck.rows[0]?.ledger,rollbackCheck.rows[0]?.checkins,rollbackCheck.rows[0]?.bookings].some(n=>Number(n)!==0))
   throw Error("X904_ROLLBACK_LEFT_WRITES");
 // Simulate two concurrent retries for the exact same authenticated event.
 const concurrent=await Promise.all([
   processX904Event({eventId,deviceSerial:serial,userPin:pin}),
   processX904Event({eventId,deviceSerial:serial,userPin:pin})
 ]);
 const first=concurrent.includes("processed") ? "processed" : concurrent[0];
 // A second event ID from the same verified PIN on the same date must never create another booking.
 await db.execute(sql`INSERT INTO sport_center.gym_x904_raw_events(event_id,device_serial,user_pin,device_time,attendance_status,verification_type) VALUES(${secondEventId},${serial},${pin},${day+" 10:00:01"},0,1)`);
 const [replay,other] = await Promise.all([
   processX904Event({eventId,deviceSerial:serial,userPin:pin}),
   processX904Event({eventId:secondEventId,deviceSerial:serial,userPin:pin})
 ]);
 const counts=await db.execute(sql`SELECT
 (SELECT count(*)::int FROM sport_center.gym_x904_processed_events WHERE event_id=${eventId} AND status='success') AS ledger,
 (SELECT count(*)::int FROM sport_center.gym_checkins WHERE notes=${marker} AND x904_event_id=${eventId}) AS checkins,
 (SELECT count(*)::int FROM sport_center.sport_bookings WHERE notes=${marker} AND total_price=0) AS bookings,
 (SELECT count(*)::int FROM sport_center.booking_history WHERE note=${marker}) AS history`);
 const row=counts.rows[0];
 const nums=[row?.ledger,row?.checkins,row?.bookings,row?.history].map(Number);
 console.log("X904_E2E",JSON.stringify({first,concurrent,replay,other,ledger:nums[0],checkins:nums[1],bookings:nums[2],history:nums[3]}));
 if(first!=="review_required" || concurrent.filter(x=>x==="review_required").length!==1 || concurrent.filter(x=>x==="already_processed").length!==1 || replay!=="already_processed" || other!=="review_required" || nums.some(n=>n!==0)) throw Error("X904_E2E_FAILED");
} catch (error) {
 const e = error instanceof Error ? error : new Error(String(error));
 const redact = (s: string) => s.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]").replace(/password\s*[=:]\s*[^\s,;]+/gi, "password=[REDACTED]");
 const cause = (e as Error & {cause?: unknown}).cause;
 const dbCause = cause && typeof cause === "object" ? cause as {code?: string;message?: string;detail?: string;hint?: string} : null;
 const report = {message:redact(e.message), dbCause:dbCause ? {code:dbCause.code ?? null,message:redact(dbCause.message ?? ""),detail:redact(dbCause.detail ?? ""),hint:redact(dbCause.hint ?? "")} : null, stack:redact(e.stack ?? ""), timestamp:new Date().toISOString()};
 writeFileSync("x904_runtime_error_log.json",JSON.stringify(report,null,2),{mode:0o600});
 console.error("DETAILE_ERROR_E2E:",report.message,JSON.stringify(report.dbCause),report.stack);
 process.exitCode=1;
 throw new Error("X904_E2E_FAILED_CHECK_REPORT");
} finally {
 try {
  // Delete only rows bearing this run's random event identity, children first.
  await db.execute(sql`DELETE FROM sport_center.booking_history WHERE note=${marker}`);
  await db.execute(sql`DELETE FROM sport_center.sport_bookings WHERE notes=${marker}`);
  await db.execute(sql`DELETE FROM sport_center.gym_checkins WHERE notes=${marker}`);
  await db.execute(sql`DELETE FROM sport_center.gym_x904_processed_events WHERE event_id IN (${eventId},${secondEventId})`);
  await db.execute(sql`DELETE FROM sport_center.gym_x904_raw_events WHERE event_id IN (${eventId},${secondEventId})`);
  await db.execute(sql`DELETE FROM sport_center.gym_x904_member_mapping WHERE device_serial=${serial} AND user_pin=${pin} AND verified_by='x904-ci-test'`);
  await db.execute(sql`DELETE FROM sport_center.gym_x904_lan_users WHERE device_serial=${serial} AND user_pin=${pin} AND display_name=${`X904 CI ${eventId}`}`);
  if(membershipId!==null) await db.execute(sql`DELETE FROM sport_center.sport_membership_payments WHERE membership_id=${membershipId} AND amount=0 AND period_start=${day} AND period_end=${day}`);
  if(membershipId!==null) await db.execute(sql`DELETE FROM sport_center.sport_memberships WHERE id=${membershipId} AND notes=${`X904 E2E ${eventId}`}`);
  console.log('X904_FIXTURE_CLEANUP=PASS');
 } catch(error) { console.error('X904_FIXTURE_CLEANUP_FAILED',error instanceof Error?error.message:String(error)); process.exitCode=1; }
 finally {if(originalTrustedCodes===undefined) delete process.env.GYM_X904_TRUSTED_VERIFICATION_CODES;
  else process.env.GYM_X904_TRUSTED_VERIFICATION_CODES=originalTrustedCodes;
  await pool.end();}
}
