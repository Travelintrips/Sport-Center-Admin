import { Router, type Request, type Response } from "express";
import { classifyX904AdmsRequest } from "../lib/x904AdmsProtocol";

/**
 * Compatibility gate for physical Solution X904 ADMS. Disabled by default.
 * Wire responses remain unverified with firmware Push Service 2.0.33S.
 * This route never acknowledges uploads, stores personal data, or issues commands.
 */
const router=Router();
router.all(/^\/iclock\/(?:cdata|getrequest)$/, (req:Request,res:Response) => {
 res.setHeader("Cache-Control","no-store");
 res.setHeader("Content-Type","text/plain; charset=utf-8");
 if(process.env.GYM_X904_ADMS_PROBE_ENABLED!=="true") return res.status(404).send("NOT FOUND\n");
 const classification=classifyX904AdmsRequest(req.method,req.originalUrl);
 if(classification.kind==="reject") return res.status(404).send("NOT FOUND\n");
 const allowed=process.env.GYM_X904_DEVICE_SERIAL||"";
 if(allowed.length<4 || classification.serial!==allowed)return res.status(403).send("UNKNOWN DEVICE\n");
 // A serial is merely an identifier, not authentication. A safe public receiver
 // requires firmware-compatible device authentication before any 200 handshake.
 return res.status(503).send("ADMS HANDSHAKE NOT YET VERIFIED\n");
});
export default router;
