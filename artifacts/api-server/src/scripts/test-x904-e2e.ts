import { randomBytes } from "node:crypto";
if(process.env.NODE_ENV!=="development") throw Error("DEV_ONLY");
const url=process.env.SUPABASE_DATABASE_URL_DEV;
if(!url) throw Error("DEV_URL_MISSING");
const u=new URL(url);
if(!u.username.endsWith(".xssrfshdrtdfupgqwfdw")) throw Error("WRONG_PROJECT");
const {db,pool}=await import("@workspace/db");
const {sql}=await import("drizzle-orm");
const {processX904Event}=await import("../services/processX904Event");
const serial="TDBD234200545",pin="1",eventId=randomBytes(32).toString("hex");
const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
const field=(n:string)=>parts.find(p=>p.type===n)?.value;
const day=field("year")+"-"+field("month")+"-"+field("day");
let mappingChanged=false;
try{
 const state=await db.execute(sql`SELECT membership_id,status FROM sport_center.gym_x904_member_mapping WHERE device_serial=${serial} AND user_pin=${pin}`);
 if(state.rows.length!==1 || state.rows[0]?.status!=="review_required") throw Error("MAPPING_NOT_READY");
 const mid=Number(state.rows[0]?.membership_id);
 const previous=await db.execute(sql`SELECT count(*)::int AS n FROM sport_center.gym_checkins WHERE membership_id=${mid} AND checkin_date=${day}::date`);
 if(Number(previous.rows[0]?.n)>0) throw Error("TODAY_ALREADY_CHECKED_IN");
 const changed=await db.execute(sql`UPDATE sport_center.gym_x904_member_mapping SET status='verified',verified_at=now(),verified_by='x904-ci-test' WHERE device_serial=${serial} AND user_pin=${pin} AND membership_id=${mid} AND status='review_required' RETURNING membership_id`);
 if(changed.rows.length!==1) throw Error("MAPPING_UPDATE_FAILED");
 mappingChanged=true;
 await db.execute(sql`INSERT INTO sport_center.gym_x904_raw_events(event_id,device_serial,user_pin,device_time,attendance_status,verification_type) VALUES(${eventId},${serial},${pin},${day+" 10:00:00"},0,1)`);
 const first=await processX904Event({eventId,deviceSerial:serial,userPin:pin});
 const replay=await processX904Event({eventId,deviceSerial:serial,userPin:pin});
 const marker="X904 event "+eventId;
 const counts=await db.execute(sql`SELECT
 (SELECT count(*)::int FROM sport_center.gym_x904_processed_events WHERE event_id=${eventId} AND status='success') AS ledger,
 (SELECT count(*)::int FROM sport_center.gym_checkins WHERE notes=${marker}) AS checkins,
 (SELECT count(*)::int FROM sport_center.sport_bookings WHERE notes=${marker} AND total_price=0) AS bookings,
 (SELECT count(*)::int FROM sport_center.booking_history WHERE note=${marker}) AS history`);
 const row=counts.rows[0];
 const nums=[row?.ledger,row?.checkins,row?.bookings,row?.history].map(Number);
 console.log("X904_E2E",JSON.stringify({first,replay,ledger:nums[0],checkins:nums[1],bookings:nums[2],history:nums[3]}));
 if(first!=="processed" || replay!=="already_processed" || nums.some(n=>n!==1)) throw Error("X904_E2E_FAILED");
} finally {
 try {
  if(mappingChanged) {
   await db.execute(sql`UPDATE sport_center.gym_x904_member_mapping SET status='review_required',verified_at=NULL,verified_by=NULL,review_reason='CI E2E completed' WHERE device_serial=${serial} AND user_pin=${pin} AND verified_by='x904-ci-test'`);
   console.log("X904_MAPPING_RESET=review_required");
  }
 } finally {await pool.end();}
}
