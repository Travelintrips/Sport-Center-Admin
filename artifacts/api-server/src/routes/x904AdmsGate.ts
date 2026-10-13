import { Router, text as parseText, type Request, type Response } from "express";
import { createHmac, randomBytes } from "node:crypto";
import { classifyX904AdmsRequest } from "../lib/x904AdmsProtocol";
import { adminMiddleware } from "../lib/auth";

/**
 * Deliberately narrow, opt-in diagnostic handshake. Same SC backend, no new service.
 * Never persists logs, ACKs ATTLOG, enrolls members or controls the door.
 * Serial numbers are NOT authentication, so diagnostic activation is time-limited
 * by operations and must not be treated as production device trust.
 */
const router=Router();
type Contact={kind:string;receivedAt:string;method:string;contentType:string;bytes:number};
const startedAt = new Date().toISOString();
// Release fingerprint for verifying Hostinger actually loaded this backend build.
const releaseFingerprint = "x904-release-proof-20261012-v1";
let lastContact:Contact|null=null;
// Counters disclose neither serials nor request bodies; reset on process restart.
const refusedRequests:{unsupported:number;unknownSerial:number}={unsupported:0,unknownSerial:0};
// Fixed reason buckets only: never preserve URLs, serials, query values, or request bodies.
const rejectedReasons:Record<"invalid_url"|"serial_invalid"|"unsupported",number>={invalid_url:0,serial_invalid:0,unsupported:0};
const sourceSalt=randomBytes(32);
type ContactTrace=Contact & {sourceTag:string; clientHint:string; sourceTagIsAuthentication:false};
const recentContacts:ContactTrace[]=[];
let lastAttlogShape:{receivedAt:string;rows:number;columnCounts:number[];bodyBytes:number;parseable:boolean}|null=null;
const enabled=()=>process.env.GYM_X904_ADMS_PROBE_ENABLED==="true" &&
 process.env.GYM_X904_ADMS_HANDSHAKE_DIAGNOSTIC_ENABLED==="true";
const deviceSerial=()=>process.env.GYM_X904_DEVICE_SERIAL||"";
export const getX904ReceiverState = () => ({ ready: enabled() && deviceSerial().length >= 4, lastContactAt: lastContact?.receivedAt ?? null, contactUnverified: true });
router.get("/api/admin/gym-x904/adms-diagnostic",adminMiddleware,(_req,res)=>{
 res.setHeader("Cache-Control","no-store");
 res.json({releaseFingerprint,enabled:enabled(),hardwareVerified:false,ingesting:false,lastContact,recentContacts,lastAttlogShape,startedAt,ephemeral:true,refusedRequests,rejectedReasons,configuration:{probeEnabled:process.env.GYM_X904_ADMS_PROBE_ENABLED==="true",handshakeEnabled:process.env.GYM_X904_ADMS_HANDSHAKE_DIAGNOSTIC_ENABLED==="true",serialConfigured:deviceSerial().length>=4},blocker:!enabled()?"diagnostic_disabled":deviceSerial().length<4?"serial_not_configured":lastContact===null?"no_device_contact":"device_contact_unverified"});
});
router.all(/^\/iclock\/(?:cdata|getrequest)(?:\.aspx)?$/i, parseText({ type: () => true, limit: "32kb" }), (req:Request,res:Response) => {
 res.setHeader("Cache-Control","no-store");
 res.setHeader("Content-Type","text/plain; charset=utf-8");
 if(!enabled())return res.status(404).send("NOT FOUND\n");
 const classification=classifyX904AdmsRequest(req.method,req.originalUrl);
 if(classification.kind==="reject"){refusedRequests.unsupported++;rejectedReasons[classification.reason as keyof typeof rejectedReasons] = (rejectedReasons[classification.reason as keyof typeof rejectedReasons] ?? 0)+1;return res.status(404).send("NOT FOUND\n");}
 const allowed=deviceSerial();
 if(allowed.length<4||classification.serial!==allowed){refusedRequests.unknownSerial++;return res.status(403).send("UNKNOWN DEVICE\n");}
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
 recentContacts.unshift({...lastContact,sourceTag,clientHint,sourceTagIsAuthentication:false});
 if(recentContacts.length>40)recentContacts.length=40;
 if(classification.kind==="handshake"){
  // Candidate ZK Push 2.x response, to be confirmed against physical X904.
  // No log cursor, status changes, clock writes, enrollment or door commands.
  return res.status(200).send("GET OPTION FROM: "+allowed+"\nErrorDelay=60\nDelay=30\nTransInterval=1\nTransFlag=TransData AttLog\nRealtime=1\n");
 }
 if(classification.kind==="poll")return res.status(200).send("OK\n");
 // Inspect only the schema shape of a live ATTLOG upload. Never store its PINs,
 // names, timestamps, cards, or biometrics; never log or return the raw payload.
 if(classification.kind==="attendance") {
  const body=typeof req.body==="string" ? req.body : "";
  const bodyBytes=Buffer.byteLength(body,"utf8");
  if(bodyBytes>0 && bodyBytes<=32768) {
   const rows=body.split(/\r?\n/).filter(line=>line.trim().length>0);
   const columnCounts=[...new Set(rows.slice(0,100).map(line=>line.split("\t").length))].sort((a,b)=>a-b);
   lastAttlogShape={receivedAt:new Date().toISOString(),rows:rows.length,columnCounts,
     bodyBytes,parseable:rows.length>0 && rows.every(line=>line.split("\t").length>=2)};
  } else {
   lastAttlogShape={receivedAt:new Date().toISOString(),rows:0,columnCounts:[],
     bodyBytes,parseable:false};
  }
 }
 // ATTLOG upload must NOT be acknowledged before identity verification,
 // durable storage, deduplication and schema validation are in place.
 return res.status(503).send("ATTLOG NOT IMPORTED\n");
});
export default router;
