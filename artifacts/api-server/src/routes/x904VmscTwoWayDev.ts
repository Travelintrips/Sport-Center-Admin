import { Router } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// DEV ONLY: read-only machine commands; no deployment to PROD.
const router = Router();
const enabled = () => process.env.NODE_ENV === "development" &&
  process.env.APP_ENV === "development" &&
  process.env.X904_VMSC_COMMANDS_DEV_ENABLED === "true" &&
  (process.env.X904_VMSC_WORKER_TOKEN_DEV ?? "").length >= 32;
const authorized = (req: any, res: any) => {
  res.setHeader("Cache-Control", "no-store");
  if (!enabled()) { res.status(404).json({ error: "Not found" }); return false; }
  const supplied = req.headers["x-vmsc-worker-token"];
  const expected = process.env.X904_VMSC_WORKER_TOKEN_DEV ?? "";
  if (typeof supplied !== "string") { res.status(403).json({ error: "Forbidden" }); return false; }
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a,b)) {
    res.status(403).json({error:"Forbidden"}); return false;
  }
  return true;
};
const uuid = (x: unknown) => typeof x === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
router.post("/internal/dev/x904-vmsc/claim", async (req,res) => {
  if (!authorized(req,res)) return;
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  try {
    const answer = await db.execute(sql`WITH selected AS (
      SELECT id FROM sport_center.x904_vmsc_commands
      WHERE device_id='VMSC' AND expires_at > now()
      AND (status='queued' OR (status='claimed' AND claimed_at < now() - interval '60 seconds'))
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE sport_center.x904_vmsc_commands AS c
      SET status='claimed', claimed_at=now(), claim_token_hash=${hash}
      FROM selected WHERE c.id=selected.id
      RETURNING c.id,c.command_type,c.expires_at`);
    const row = answer.rows[0];
    return res.json(row ? { job: {...row, claimToken: token} } : {job:null});
  } catch { return res.status(503).json({error:"Queue unavailable"}); }
});
router.post("/internal/dev/x904-vmsc/result", async (req,res) => {
  if (!authorized(req,res)) return;
  const {id,claimToken,status,result,errorCode}=req.body ?? {};
  if (!uuid(id) || typeof claimToken!=="string" || !/^[0-9a-f]{64}$/.test(claimToken) ||
      !["completed","failed"].includes(status) || (result!==undefined &&
      (typeof result!=="object" || result===null || JSON.stringify(result).length>4096))) {
    return res.status(400).json({error:"Invalid receipt"});
  }
  const hash=createHash("sha256").update(claimToken).digest("hex");
  const digest=createHash("sha256").update(JSON.stringify({status,result:result??null,errorCode:errorCode??null})).digest("hex");
  try {
    const updated=await db.execute(sql`WITH changed AS (
      UPDATE sport_center.x904_vmsc_commands SET status=${status},
        result_json=${JSON.stringify(result??null)}::jsonb,
        error_code=${typeof errorCode === "string" ? errorCode.slice(0,80) : null},
        finished_at=now()
      WHERE id=${id}::uuid AND status='claimed' AND expires_at>now()
        AND claim_token_hash=${hash}
      RETURNING id
    ) INSERT INTO sport_center.x904_vmsc_command_receipts
        (command_id,result_sha256,verified)
      SELECT id,${digest},true FROM changed
      ON CONFLICT (command_id) DO NOTHING RETURNING command_id`);
    if (updated.rows.length) return res.json({ack:"RESULT_VERIFIED",id});
    const known=await db.execute(sql`SELECT c.status,r.result_sha256 FROM sport_center.x904_vmsc_commands c
      LEFT JOIN sport_center.x904_vmsc_command_receipts r ON r.command_id=c.id
      WHERE c.id=${id}::uuid AND c.claim_token_hash=${hash}`);
    const previous=known.rows[0];
    if (previous && previous.status===status && previous.result_sha256===digest)
      return res.json({ack:"RESULT_VERIFIED",id,duplicate:true});
    return res.status(409).json({error:"Invalid, expired or conflicting callback"});
  } catch { return res.status(503).json({error:"Result persistence unavailable"}); }
});
router.get("/internal/dev/x904-vmsc/receipt/:id", async(req,res)=>{
  if(!authorized(req,res)) return;
  if(!uuid(req.params.id)) return res.status(400).json({error:"Invalid id"});
  try {
    const result=await db.execute(sql`SELECT c.status,r.verified,r.callback_received_at FROM
      sport_center.x904_vmsc_commands c LEFT JOIN sport_center.x904_vmsc_command_receipts r
      ON r.command_id=c.id WHERE c.id=${req.params.id}::uuid`);
    return res.json({receipt:result.rows[0]??null});
  } catch { return res.status(503).json({error:"Receipt unavailable"}); }
});
export default router;
