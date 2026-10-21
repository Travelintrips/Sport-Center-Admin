import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { processX904Event } from "../services/processX904Event";

/**
 * Staged trusted-VMSC ingress. Enabled only with a separately provisioned,
 * connector-scoped credential. A bearer token or a LAN snapshot ALONE is never
 * enough to attest a physical scan. The caller must have read the physical
 * device using its local Comm Key immediately before signing its original
 * 40-byte attendance record; Comm Key and biometric templates never leave VMSC.
 */
const router = Router();
const methods: Record<number, string> = { 1: "fingerprint", 4: "card", 15: "face" };
const digits = (n:number) => String(n).padStart(2,"0");
function unpackTime(packed:number): string {
  let n=packed;
  const ss=n%60; n=(n-ss)/60;
  const mm=n%60; n=(n-mm)/60;
  const hh=n%24; n=(n-hh)/24;
  const dd=n%31+1; n=(n-(dd-1))/31;
  const month=n%12; n=(n-month)/12;
  const year=n+2000;
  const d=new Date(Date.UTC(year,month,dd,hh,mm,ss));
  if (!Number.isFinite(d.getTime()) || d.getUTCFullYear()!==year ||
      d.getUTCMonth()!==month || d.getUTCDate()!==dd) throw Error("X904_INVALID_CLOCK");
  return `${year}-${digits(month+1)}-${digits(dd)} ${digits(hh)}:${digits(mm)}:${digits(ss)}`;
}
const localDay=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const val=(t:string)=>parts.find(p=>p.type===t)?.value??"";return `${val("year")}-${val("month")}-${val("day")}`;};
router.post("/internal/gym-x904/vmsc/attest", async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  const secret=process.env.GYM_X904_VMSC_ATTEST_KEY || "";
  if(process.env.GYM_X904_VMSC_ATTEST_ENABLED!=="true" || secret.length<32)
    return res.status(404).json({error:"Not found"});
  const b=req.body;
  if(!b || typeof b!=="object" ||
     Object.keys(b).sort().join(",")!=="index,issuedAt,occurred,pin,rawHex,readAuthenticated,serial")
    return res.status(400).json({error:"Invalid attestation"});
  const {index,issuedAt,occurred,pin,rawHex,readAuthenticated,serial}=b;
  if(serial!==process.env.GYM_X904_DEVICE_SERIAL ||
     typeof pin!=="string" || !/^\d{1,9}$/.test(pin) ||
     !Number.isSafeInteger(index) || index<0 || index>999999 ||
     typeof rawHex!=="string" || !/^[a-f0-9]{80}$/.test(rawHex) ||
     typeof occurred!=="string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(occurred) ||
     typeof issuedAt!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(issuedAt) ||
     readAuthenticated!==true) return res.status(400).json({error:"Invalid attendance proof"});
  const issued=Date.parse(issuedAt);
  if(!Number.isFinite(issued) || Math.abs(Date.now()-issued)>120000 ||
     occurred.slice(0,10)!==localDay())
    return res.status(409).json({error:"Stale attestation"});
  const canonical=[serial,index,pin,occurred,rawHex,issuedAt,"true"].join("|");
  const signature=req.headers["x-gym-vmsc-signature"];
  const expected=createHmac("sha256",secret).update(canonical).digest("hex");
  if(typeof signature!=="string" || !/^[a-f0-9]{64}$/.test(signature) ||
     !timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex")))
    return res.status(403).json({error:"Unauthorized connector"});
  const raw=Buffer.from(rawHex,"hex");
  const ordinal=raw.readUInt16LE(0);
  const rawPin=raw.subarray(2,11).toString("ascii").split("\0")[0];
  const verify=raw.readUInt8(26),status=raw.readUInt8(31);
  let recordTime:string;
  try {recordTime=unpackTime(raw.readUInt32LE(27));}
  catch {return res.status(422).json({error:"Invalid machine timestamp"});}
  const scanInstant=Date.parse(occurred.replace(" ","T")+"+07:00");
  if(ordinal!==index+1 || rawPin!==pin || recordTime!==occurred ||
     !methods[verify] || status!==0 || !Number.isFinite(scanInstant) ||
     scanInstant>Date.now()+120000 || scanInstant<Date.now()-7200000)
    return res.status(422).json({error:"Device record mismatch"});
  try {
    const eventId=await db.transaction(async tx=>{
      // The exact event must already be durably ACKed from a complete
      // authenticated X904 LAN snapshot. Never trust a supplied event ID.
      const matched=await tx.execute(sql`SELECT l.event_id FROM sport_center.gym_x904_lan_logs l
        JOIN sport_center.gym_x904_lan_state s ON s.device_serial=l.device_serial
        WHERE l.device_serial=${serial} AND l.event_index=${index}
          AND l.user_pin=${pin} AND l.device_time=${occurred}
          AND l.last_seen_snapshot=s.last_snapshot_id
          AND s.last_complete_at>now()-interval '90 minutes'
        FOR UPDATE OF l`);
      if(matched.rows.length!==1) throw Error("X904_LAN_SNAPSHOT_NOT_MATCHED");
      const eventId=String(matched.rows[0].event_id);
      // If the ID was previously used for different content, fail closed.
      const prior=await tx.execute(sql`SELECT device_serial,user_pin,device_time,
         attendance_status,verification_type FROM sport_center.gym_x904_raw_events
         WHERE event_id=${eventId} FOR UPDATE`);
      if(prior.rows.length && (prior.rows[0].device_serial!==serial ||
         prior.rows[0].user_pin!==pin || prior.rows[0].device_time!==occurred ||
         Number(prior.rows[0].attendance_status)!==status ||
         Number(prior.rows[0].verification_type)!==verify))
        throw Error("X904_EVENT_ID_CONFLICT");
      if(!prior.rows.length)
        await tx.execute(sql`INSERT INTO sport_center.gym_x904_raw_events
          (event_id,device_serial,user_pin,device_time,attendance_status,verification_type)
          VALUES (${eventId},${serial},${pin},${occurred},${status},${verify})`);
      // Existing diagnostic-only evidence is not silently promoted.
      const evidence=await tx.execute(sql`SELECT evidence_status,raw_hex
        FROM sport_center.gym_x904_verification_evidence
        WHERE device_serial=${serial} AND event_index=${index} FOR UPDATE`);
      if(evidence.rows.length && evidence.rows[0].evidence_status!=="unverified" &&
         !(evidence.rows[0].evidence_status==="protocol_verified" &&
           evidence.rows[0].raw_hex===rawHex))
        throw Error("X904_EVIDENCE_CONFLICT");
      await tx.execute(sql`INSERT INTO sport_center.gym_x904_verification_evidence
        (event_index,device_serial,user_pin,verification_code,verification_method,
         raw_hex,evidence_status,source_event_id,capture_source)
        VALUES (${index},${serial},${pin},${verify},${methods[verify]},
          ${rawHex},'protocol_verified',${eventId},'trusted_vmsc_ingress')
        ON CONFLICT (device_serial,event_index) DO UPDATE SET
          verification_code=EXCLUDED.verification_code,
          verification_method=EXCLUDED.verification_method,
          raw_hex=EXCLUDED.raw_hex,evidence_status=EXCLUDED.evidence_status,
          source_event_id=EXCLUDED.source_event_id,
          capture_source=EXCLUDED.capture_source
        WHERE sport_center.gym_x904_verification_evidence.evidence_status IN
          ('unverified','protocol_verified')
        RETURNING event_index`);
      return eventId;
    });
    const outcome=await processX904Event({eventId,deviceSerial:serial,userPin:pin});
    return res.json({ok:true,accepted:1,outcome});
  } catch(error) {
    console.error("[x904] authenticated VMSC proof rejected",error instanceof Error?error.message:"UNKNOWN");
    return res.status(409).json({error:"Attestation could not be committed"});
  }
});
export default router;
