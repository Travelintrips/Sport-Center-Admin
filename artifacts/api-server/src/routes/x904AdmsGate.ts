import { Router, type Request, type Response } from "express";
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
let lastContact:Contact|null=null;
const enabled=()=>process.env.GYM_X904_ADMS_PROBE_ENABLED==="true" &&
 process.env.GYM_X904_ADMS_HANDSHAKE_DIAGNOSTIC_ENABLED==="true";
const deviceSerial=()=>process.env.GYM_X904_DEVICE_SERIAL||"";
router.get("/api/admin/gym-x904/adms-diagnostic",adminMiddleware,(_req,res)=>{
 res.setHeader("Cache-Control","no-store");
 res.json({enabled:enabled(),hardwareVerified:false,ingesting:false,lastContact});
});
router.all(/^\/iclock\/(?:cdata|getrequest)$/, (req:Request,res:Response) => {
 res.setHeader("Cache-Control","no-store");
 res.setHeader("Content-Type","text/plain; charset=utf-8");
 if(!enabled())return res.status(404).send("NOT FOUND\n");
 const classification=classifyX904AdmsRequest(req.method,req.originalUrl);
 if(classification.kind==="reject")return res.status(404).send("NOT FOUND\n");
 const allowed=deviceSerial();
 if(allowed.length<4||classification.serial!==allowed)return res.status(403).send("UNKNOWN DEVICE\n");
 // Metadata only. Never record query, body, PIN, fingerprint, face or card data.
 const bytes=Number(req.headers["content-length"]||0);
 lastContact={kind:classification.kind,receivedAt:new Date().toISOString(),method:req.method,
  contentType:String(req.headers["content-type"]||"").slice(0,80),bytes:Number.isSafeInteger(bytes)&&bytes>=0?bytes:-1};
 if(classification.kind==="handshake"){
  // Candidate ZK Push 2.x response, to be confirmed against physical X904.
  // No log cursor, status changes, clock writes, enrollment or door commands.
  return res.status(200).send("GET OPTION FROM: "+allowed+"\nErrorDelay=60\nDelay=30\nTransInterval=1\nRealtime=1\n");
 }
 if(classification.kind==="poll")return res.status(200).send("OK\n");
 // ATTLOG upload must NOT be acknowledged before identity verification,
 // durable storage, deduplication and schema validation are in place.
 return res.status(503).send("ATTLOG NOT IMPORTED\n");
});
export default router;
