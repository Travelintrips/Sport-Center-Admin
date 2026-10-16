import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
if(process.env.NODE_ENV!=="development") throw Error("DEV_ONLY");
const url=process.env.SUPABASE_DATABASE_URL_DEV;
if(!url) throw Error("DEV_URL_MISSING");
const u=new URL(url);
if(!u.username.endsWith(".xssrfshdrtdfupgqwfdw")) throw Error("WRONG_PROJECT");
const {db,pool}=await import("@workspace/db");
const {sql}=await import("drizzle-orm");
const {processX904Event}=await import("../services/processX904Event");
const serial="TDBD234200545",pin=String(100000+randomBytes(4).readUInt32BE(0)%900000),eventId=randomBytes(32).toString("hex");
const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
const field=(n:string)=>parts.find(p=>p.type===n)?.value;
const day=field("year")+"-"+field("month")+"-"+field("day");
let membershipId: number | null = null;
const marker="X904 event "+eventId;
try{
 // DEV-only synthetic membership and mapping; never touch an existing member.
 const member=await db.execute(sql`INSERT INTO sport_center.sport_memberships
  (name,email,phone,start_date,end_date,months,total_price,status,notes)
  VALUES (${`X904 CI ${eventId}`},${`x904-ci-${eventId}@example.invalid`},${`000${pin}`},${day},${day},1,0,'active',${`X904 E2E ${eventId}`})
  RETURNING id`);
 membershipId=Number(member.rows[0]?.id);
 if(!Number.isSafeInteger(membershipId)||membershipId<=0) throw Error('FIXTURE_MEMBERSHIP_FAILED');
 await db.execute(sql`INSERT INTO sport_center.gym_x904_member_mapping
  (device_serial,user_pin,membership_id,status,verified_at,verified_by)
  VALUES (${serial},${pin},${membershipId},'verified',now(),'x904-ci-test')`);
 await db.execute(sql`INSERT INTO sport_center.gym_x904_raw_events(event_id,device_serial,user_pin,device_time,attendance_status,verification_type) VALUES(${eventId},${serial},${pin},${day+" 10:00:00"},0,1)`);
 const first=await processX904Event({eventId,deviceSerial:serial,userPin:pin});
 const replay=await processX904Event({eventId,deviceSerial:serial,userPin:pin});
 const counts=await db.execute(sql`SELECT
 (SELECT count(*)::int FROM sport_center.gym_x904_processed_events WHERE event_id=${eventId} AND status='success') AS ledger,
 (SELECT count(*)::int FROM sport_center.gym_checkins WHERE notes=${marker}) AS checkins,
 (SELECT count(*)::int FROM sport_center.sport_bookings WHERE notes=${marker} AND total_price=0) AS bookings,
 (SELECT count(*)::int FROM sport_center.booking_history WHERE note=${marker}) AS history`);
 const row=counts.rows[0];
 const nums=[row?.ledger,row?.checkins,row?.bookings,row?.history].map(Number);
 console.log("X904_E2E",JSON.stringify({first,replay,ledger:nums[0],checkins:nums[1],bookings:nums[2],history:nums[3]}));
 if(first!=="processed" || replay!=="already_processed" || nums.some(n=>n!==1)) throw Error("X904_E2E_FAILED");
} catch (error) {
 const e = error instanceof Error ? error : new Error(String(error));
 const redact = (s: string) => s.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]").replace(/password\s*[=:]\s*[^\s,;]+/gi, "password=[REDACTED]");
 const report = {message:redact(e.message), stack:redact(e.stack ?? ""), timestamp:new Date().toISOString()};
 writeFileSync("x904_runtime_error_log.json",JSON.stringify(report,null,2),{mode:0o600});
 console.error("DETAILE_ERROR_E2E:",report.message,report.stack);
 process.exitCode=1;
 throw new Error("X904_E2E_FAILED_CHECK_REPORT");
} finally {
 try {
  // Delete only rows bearing this run's random event identity, children first.
  await db.execute(sql`DELETE FROM sport_center.booking_history WHERE note=${marker}`);
  await db.execute(sql`DELETE FROM sport_center.sport_bookings WHERE notes=${marker}`);
  await db.execute(sql`DELETE FROM sport_center.gym_checkins WHERE notes=${marker}`);
  await db.execute(sql`DELETE FROM sport_center.gym_x904_processed_events WHERE event_id=${eventId}`);
  await db.execute(sql`DELETE FROM sport_center.gym_x904_raw_events WHERE event_id=${eventId}`);
  await db.execute(sql`DELETE FROM sport_center.gym_x904_member_mapping WHERE device_serial=${serial} AND user_pin=${pin} AND verified_by='x904-ci-test'`);
  if(membershipId!==null) await db.execute(sql`DELETE FROM sport_center.sport_memberships WHERE id=${membershipId} AND notes=${`X904 E2E ${eventId}`}`);
  console.log('X904_FIXTURE_CLEANUP=PASS');
 } catch(error) { console.error('X904_FIXTURE_CLEANUP_FAILED',error instanceof Error?error.message:String(error)); process.exitCode=1; }
 finally {await pool.end();}
}
