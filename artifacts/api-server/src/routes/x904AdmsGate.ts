import { Router, text as parseText, type Request, type Response } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { classifyX904AdmsRequest } from "../lib/x904AdmsProtocol";
import { parseX904Attlog } from "../lib/x904AttlogParser";
import { adminMiddleware } from "../lib/auth";
import { persistX904AdmsAudit, x904AdmsAuditCounters, type X904AdmsOutcome } from "../lib/x904AdmsDurableAudit";

/**
 * Deliberately narrow, opt-in diagnostic handshake. Same SC backend, no new service.
 * Records only anonymous protocol metadata. Matching-serial untrusted ATTLOG
 * may receive a transport ACK to stop retry storms, but is never persisted,
 * enrolled, or treated as authenticated device data.
 * Serial numbers are NOT authentication, so diagnostic activation is time-limited
 * by operations and must not be treated as production device trust.
 */
const router=Router();
type Contact={kind:string;receivedAt:string;method:string;contentType:string;bytes:number};
const startedAt = new Date().toISOString();
// Release fingerprint for verifying Hostinger actually loaded this backend build.
const releaseFingerprint = "x904-adms-durable-audit-20261015-v3";
let lastContact:Contact|null=null;
let lastTrustedIngestAt:string|null=null;
let lastTrustedIngestRows=0;
let lastRejectedAttendanceAt:string|null=null;
let rejectedUntrustedAttendance=0;
let rejectedUnparseableAttendance=0;
let attendanceStorageFailures=0;
const trustedIngestRecent=()=>lastTrustedIngestAt!==null && Date.now()-Date.parse(lastTrustedIngestAt)<90000;
// Structured, privacy-safe operational logs survive process restarts in Hostinger log collection.
// Never log attendance payloads, PINs, names, serials, source IPs, or credentials.
const auditAdms=(outcome:string,details:Record<string,string|number|boolean>={})=>{
  console.info(JSON.stringify({event:"x904_adms_ingress",outcome,...details}));
};
// Counters disclose neither serials nor request bodies; reset on process restart.
const refusedRequests:{unsupported:number;unknownSerial:number}={unsupported:0,unknownSerial:0};
// Fixed reason buckets only: never preserve URLs, serials, query values, or request bodies.
const rejectedReasons:Record<"invalid_url"|"serial_invalid"|"unsupported",number>={invalid_url:0,serial_invalid:0,unsupported:0};
// Fixed metadata buckets only; no URL, query, IP, serial, or body retained.
const rejectedOperations:Record<string,number>=Object.create(null);
const rejectedTables:Record<string,number>=Object.create(null);
// Only coarse schema hints; no raw table values, event rows or identity information.
const rejectedPostShapes:Record<string,number>=Object.create(null);
const payloadShape=(body:unknown)=>{
 if(typeof body!=="string" || body.length===0)return "empty";
 if(body.length>32768)return "oversized";
 const lines=body.split(/\r?\n/).filter(Boolean);
 if(lines.length===0)return "whitespace";
 const tabs=lines.slice(0,8).map(line=>line.split("\t").length);
 return tabs.every(n=>n>=2)?"tabular":"other-text";
};
const rejectedTableBucket=(method:string,requestUrl:string)=>{
 if(method!=="POST")return "non-post";
 try {
  const u=new URL(requestUrl,"https://localhost");
  const t=(u.searchParams.get("table")??u.searchParams.get("Table")??"").toUpperCase();
  return ["ATTLOG","OPERLOG","USERINFO","ATTPHOTO","RTLOG","TRANSACTION","BIODATA","FP","FACE","USERPIC","ERRORLOG"].includes(t)?t:t?"other-table":"missing-table";
 } catch {return "invalid-url";}
};
const rejectedBucket=(method:string,url:string)=>{
 const verb=method==="GET"||method==="POST"?method:"OTHER";
 let path="other";
 try { const p=new URL(url,"https://localhost").pathname.toLowerCase(); path=/^\/iclock\/(?:cdata|getrequest)(?:\.aspx)?$/.test(p)?"known-path":"other-path"; } catch { path="invalid-path"; }
 return `${verb}:${path}`;
};
const sourceSalt=randomBytes(32);
type ContactTrace=Contact & {sourceTag:string; clientHint:string; sourceTagIsAuthentication:false};
const recentContacts:ContactTrace[]=[];
let lastAttlogShape:{receivedAt:string;rows:number;columnCounts:number[];bodyBytes:number;parseable:boolean}|null=null;
const enabled=()=>process.env.GYM_X904_ADMS_PROBE_ENABLED==="true" &&
 process.env.GYM_X904_ADMS_HANDSHAKE_DIAGNOSTIC_ENABLED==="true";
const deviceSerial=()=>process.env.GYM_X904_DEVICE_SERIAL||"";
export const getX904ReceiverState = () => ({ ready: enabled() && deviceSerial().length >= 4, lastContactAt: lastContact?.receivedAt ?? null, contactUnverified: true, lastTrustedIngestAt });
router.get("/api/admin/gym-x904/adms-diagnostic",adminMiddleware,(_req,res)=>{
 res.setHeader("Cache-Control","no-store");
 res.json({releaseFingerprint,enabled:enabled(),hardwareVerified:false,ingesting:false,trustedIngestRecent:trustedIngestRecent(),lastTrustedIngestAt,lastTrustedIngestRows,lastRejectedAttendanceAt,rejectedUntrustedAttendance,rejectedUnparseableAttendance,attendanceStorageFailures,lastContact,recentContacts,lastAttlogShape,startedAt,ephemeral:true,refusedRequests,rejectedReasons,rejectedOperations,rejectedTables,rejectedPostShapes,configuration:{probeEnabled:process.env.GYM_X904_ADMS_PROBE_ENABLED==="true",handshakeEnabled:process.env.GYM_X904_ADMS_HANDSHAKE_DIAGNOSTIC_ENABLED==="true",serialConfigured:deviceSerial().length>=4,trialEnabled:process.env.GYM_X904_ADMS_TRIAL_INGEST_ENABLED==="true"},blocker:!enabled()?"diagnostic_disabled":deviceSerial().length<4?"serial_not_configured":lastContact===null?"no_device_contact":"device_contact_unverified"});
});
// Database-backed protocol audit, intentionally not a hardware attestation.
// Admin-only, anonymous operational metadata; no IDs, serials, IPs or raw payloads.
router.get("/api/admin/gym-x904/adms-audit",adminMiddleware,async (_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  try {
    const result=await db.execute(sql`
      SELECT id::text, received_at::text, kind, outcome, method, client_hint,
             body_bytes, row_count, connector_authorized, device_identity_verified,
             attlog_parseable, attlog_min_columns
      FROM sport_center.gym_x904_adms_audit
      ORDER BY received_at DESC, id DESC LIMIT 40
    `);
    res.json({ready:true,hardwareVerified:false,sourceIdentity:"unverified",
      eventCount:result.rows.length,events:result.rows,
      transientCounters:x904AdmsAuditCounters()});
  } catch {
    res.status(503).json({ready:false,hardwareVerified:false,
      sourceIdentity:"unverified",error:"ADMS audit storage unavailable"});
  }
});
router.all(/^\/iclock\/(?:cdata|getrequest)(?:\.aspx)?$/i, parseText({ type: () => true, limit: "32kb" }), async (req:Request,res:Response) => {
 res.setHeader("Cache-Control","no-store");
 res.setHeader("Content-Type","text/plain; charset=utf-8");
 if(!enabled())return res.status(404).send("NOT FOUND\n");
 const classification=classifyX904AdmsRequest(req.method,req.originalUrl);
 auditAdms("request_classified",{kind:classification.kind,method:req.method==="POST"?"POST":req.method==="GET"?"GET":"OTHER"});
 if(classification.kind==="reject"){if(req.method==="POST"){const shape=payloadShape(req.body);rejectedPostShapes[shape]=(rejectedPostShapes[shape]??0)+1;}const tableBucket=rejectedTableBucket(req.method,req.originalUrl);rejectedTables[tableBucket]=(rejectedTables[tableBucket]??0)+1;const bucket=rejectedBucket(req.method,req.originalUrl);rejectedOperations[bucket]=(rejectedOperations[bucket]??0)+1;refusedRequests.unsupported++;rejectedReasons[classification.reason as keyof typeof rejectedReasons] = (rejectedReasons[classification.reason as keyof typeof rejectedReasons] ?? 0)+1;return res.status(404).send("NOT FOUND\n");}
 const allowed=deviceSerial();
 if(allowed.length<4||classification.serial!==allowed){auditAdms("rejected_serial",{kind:classification.kind});refusedRequests.unknownSerial++;return res.status(403).send("UNKNOWN DEVICE\n");}
 // Metadata only. Never record query, body, PIN, fingerprint, face or card data.
 const bytes=Number(req.headers["content-length"]||0);
 lastContact={kind:classification.kind,receivedAt:new Date().toISOString(),method:req.method,
  contentType:String(req.headers["content-type"]||"").slice(0,80),bytes:Number.isSafeInteger(bytes)&&bytes>=0?bytes:-1};
 // Ephemeral correlation only: does not expose or persist the source IP or user agent.
 // Shared NAT/proxies or crafted headers can make tags collide; not authentication.
 const sourceTag=createHmac("sha256",sourceSalt).update(req.ip||"unknown").update("\\0").update(String(req.headers["user-agent"]||"")).digest("hex").slice(0,10);
 // Coarse, untrusted client hint helps operators spot scripted heartbeats during Wi-Fi OFF tests.
 // Do not expose the original User-Agent or treat this label as device authentication.
 const agent=String(req.headers["user-agent"]||"").toLowerCase();
 const clientHint=/curl|wget|python-requests|postman|axios|node-fetch|undici/.test(agent) ? "automation-like" : /mozilla|chrome|safari|firefox/.test(agent) ? "browser-like" : agent ? "unknown-client" : "no-user-agent";
 res.setHeader("X-X904-ADMS-Audit", "db-v1");
 const persist = (outcome:X904AdmsOutcome,extra:{rows?:number;connectorAuthorized?:boolean;parseable?:boolean;minColumns?:number}={}) =>
   persistX904AdmsAudit({kind:classification.kind,outcome,method:req.method==="POST"?"POST":"GET",
     clientHint,bodyBytes:Number.isSafeInteger(bytes) && bytes>=0?bytes:0,...extra});
 recentContacts.unshift({...lastContact,sourceTag,clientHint,sourceTagIsAuthentication:false});
 if(recentContacts.length>40)recentContacts.length=40;
 if(classification.kind==="handshake"){
  auditAdms("configuration_sent",{kind:"handshake"});
  await persist("configuration_sent");
  // Candidate ZK Push 2.x response, to be confirmed against physical X904.
  // No log cursor, status changes, clock writes, enrollment or door commands.
  return res.status(200).send("GET OPTION FROM: "+allowed+"\nATTLOGStamp=None\nOPERLOGStamp=9999\nErrorDelay=60\nDelay=30\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=TransData AttLog\nRealtime=1\nEncrypt=None\n");
 }
 if(classification.kind==="poll"){auditAdms("poll_ack",{kind:"poll"});await persist("poll_ack");return res.status(200).send("OK\n");}
 // OPTIONS is the device configuration announcement, not an attendance log.
 // Acknowledge transport only; never treat this as a biometric verification.
 if(classification.kind==="device_options"){auditAdms("device_options_ack",{kind:"device_options"});await persist("device_options_ack");return res.status(200).send("OK\n");}
 // Inspect only the schema shape of a live ATTLOG upload. Never store its PINs,
 // names, timestamps, cards, or biometrics; never log or return the raw payload.
 if(classification.kind==="attendance") {
  const body=typeof req.body==="string" ? req.body : "";
  const bodyBytes=Buffer.byteLength(body,"utf8");
  if(bodyBytes>0 && bodyBytes<=32768) {
   const rows=body.split(/\r?\n/).filter(line=>line.trim().length>0);
   const columnCounts=[...new Set(rows.slice(0,100).map(line=>line.split("\t").length))].sort((a,b)=>a-b);
   lastAttlogShape={receivedAt:new Date().toISOString(),rows:rows.length,columnCounts,
     bodyBytes,parseable:parseX904Attlog(body)!==null};
  } else {
   lastAttlogShape={receivedAt:new Date().toISOString(),rows:0,columnCounts:[],
     bodyBytes,parseable:false};
  }
 }
 // Fail closed: an ADMS serial is not device authentication. Only a trusted
 // ingress that verifies the physical device may inject this header.
 if (classification.kind === "attendance" &&
     process.env.GYM_X904_ADMS_ATTLOG_INGEST_ENABLED === "true") {
   // Explicit short-lived commissioning only; never evidence of device identity.
   const trialUntil = Date.parse(process.env.GYM_X904_ADMS_TRIAL_UNTIL ?? "");
   const trialMode = process.env.GYM_X904_ADMS_TRIAL_INGEST_ENABLED === "true" && Number.isFinite(trialUntil) && Date.now() < trialUntil && trialUntil-Date.now() <= 24*60*60*1000;
   const secret = process.env.GYM_X904_ADMS_TRUSTED_INGRESS_KEY ?? "";
   const provided = req.headers["x-gym-trusted-ingress-key"];
   // Constant-time equality for an explicitly provisioned trusted ingress key.
   // A serial, diagnostic trial, or plain device request does not authorize writes.
   const expectedKey = Buffer.from(secret, "utf8");
   const receivedKey = typeof provided === "string" ? Buffer.from(provided, "utf8") : Buffer.alloc(0);
   const authenticated = expectedKey.length >= 32 &&
     expectedKey.length === receivedKey.length &&
     timingSafeEqual(expectedKey, receivedKey);
   // A timed trial is a diagnostic switch, not proof of the sender. Do not
   // permit it to bypass ingress authentication for durable attendance writes.
   if (!authenticated) { auditAdms("rejected_untrusted",{kind:"attendance",trialMode}); rejectedUntrustedAttendance++; lastRejectedAttendanceAt=new Date().toISOString(); await persist("attendance_untrusted",{rows:lastAttlogShape?.rows ?? 0,parseable:lastAttlogShape?.parseable ?? false,minColumns:lastAttlogShape?.columnCounts[0] ?? 0}); return res.status(200).send("OK\n"); }
   const parsed = parseX904Attlog(typeof req.body === "string" ? req.body : "");
   if (!parsed) { auditAdms("rejected_invalid_attlog",{kind:"attendance"}); rejectedUnparseableAttendance++; lastRejectedAttendanceAt=new Date().toISOString(); await persist("attendance_invalid",{rows:lastAttlogShape?.rows ?? 0,parseable:lastAttlogShape?.parseable ?? false,minColumns:lastAttlogShape?.columnCounts[0] ?? 0}); return res.status(400).send("INVALID ATTLOG\n"); }
   const records = parsed.map(event => ({
     id: createHash("sha256").update(JSON.stringify([allowed,event.pin,event.occurred,event.status,event.verify])).digest("hex"),
     pin: event.pin, occurred: event.occurred, status: event.status, verify: event.verify
   }));
   try {
     const payload = JSON.stringify(records);
     await db.execute(sql`INSERT INTO sport_center.gym_x904_raw_events
       (event_id,device_serial,user_pin,device_time,attendance_status,verification_type)
       SELECT e.id, ${allowed}, e.pin, e.occurred, e.status, e.verify
       FROM jsonb_to_recordset(${payload}::jsonb)
       AS e(id text,pin text,occurred text,status integer,verify integer)
       ON CONFLICT (event_id) DO NOTHING`);
     auditAdms("stored",{kind:"attendance",rowCount:parsed.length,authenticated});
     await persist("attendance_stored",{rows:parsed.length,connectorAuthorized:authenticated,parseable:true,minColumns:lastAttlogShape?.columnCounts[0] ?? 0});
     if(authenticated) {
       lastTrustedIngestAt=new Date().toISOString();
       lastTrustedIngestRows=parsed.length;
     }
     return res.status(200).send("OK: " + parsed.length + "\n");
   } catch {
     auditAdms("storage_failed",{kind:"attendance"}); attendanceStorageFailures++; lastRejectedAttendanceAt=new Date().toISOString();
     await persist("attendance_storage_failed",{rows:lastAttlogShape?.rows ?? 0,parseable:lastAttlogShape?.parseable ?? false,minColumns:lastAttlogShape?.columnCounts[0] ?? 0});
     return res.status(503).send("ATTLOG STORAGE UNAVAILABLE\n");
   }
 }
 // No success ACK until identity and durable storage have been verified.
 if(classification.kind==="attendance") { auditAdms("not_imported",{kind:"attendance",ingestEnabled:process.env.GYM_X904_ADMS_ATTLOG_INGEST_ENABLED==="true"}); await persist("attendance_not_imported",{rows:lastAttlogShape?.rows ?? 0,parseable:lastAttlogShape?.parseable ?? false,minColumns:lastAttlogShape?.columnCounts[0] ?? 0}); }
 return res.status(503).send("ATTLOG NOT IMPORTED\n");
});
export default router;