import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();
const equal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x,y);
};
const ready = () => process.env.GYM_X904_EVENT_INGEST_ENABLED === "true" &&
  (process.env.GYM_X904_EVENT_INGEST_KEY || "").length >= 32 &&
  (process.env.GYM_X904_DEVICE_SERIAL || "").length >= 3;

/** Private trusted-gateway handoff only, never the device's public ADMS URL.
 * Deploy behind an ingress that authenticates the actual X904 and strips user
 * supplied X-Gym-Ingress-Key headers before injecting its own.
 */
router.post("/internal/gym-x904/events", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!ready()) return res.status(404).json({error:"Not found"});
  const token = String(req.headers["x-gym-ingress-key"] || "");
  const expected = process.env.GYM_X904_EVENT_INGEST_KEY || "";
  const serial = String(req.body?.serial || "");
  if (!equal(token, expected) || !equal(serial, process.env.GYM_X904_DEVICE_SERIAL || "")) {
    return res.status(403).json({error:"Unauthorized device gateway"});
  }
  if (!Array.isArray(req.body?.events) || req.body.events.length === 0 || req.body.events.length > 100) {
    return res.status(400).json({error:"Invalid event batch"});
  }
  const events = req.body.events as unknown[];
  const parsed: Array<{id:string;pin:string;occurred:string;status:number;verify:number}> = [];
  for (const item of events) {
    if (!item || typeof item !== "object") return res.status(400).json({error:"Invalid event"});
    const v = item as Record<string,unknown>;
    const id = String(v.id ?? ""), pin = String(v.pin ?? ""), occurred = String(v.occurred ?? "");
    const status = v.status, verify = v.verify;
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[A-Za-z0-9_-]{1,50}$/.test(pin) ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(occurred) ||
      !Number.isInteger(status) || !Number.isInteger(verify) ||
      Number(status) < 0 || Number(status) > 255 || Number(verify) < 0 || Number(verify) > 255) {
      return res.status(400).json({error:"Invalid attendance record"});
    }
    parsed.push({id,pin,occurred,status:Number(status),verify:Number(verify)});
  }
  try {
    // Single atomic statement: a failed batch cannot be partially acknowledged.
    // Do not modify membership, payments, booking, or door control tables.
    const payload = JSON.stringify(parsed);
    const result = await db.execute(sql`INSERT INTO sport_center.gym_x904_raw_events
      (event_id, device_serial, user_pin, device_time, attendance_status, verification_type)
      SELECT e.id, ${serial}, e.pin, e.occurred, e.status, e.verify
      FROM jsonb_to_recordset(${payload}::jsonb)
        AS e(id text, pin text, occurred text, status integer, verify integer)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id`);
    return res.json({ok:true,accepted:parsed.length,inserted:result.rows.length,duplicates:parsed.length-result.rows.length});
  } catch {
    return res.status(503).json({error:"X904 event storage unavailable"});
  }
});
router.get("/admin/gym-x904/device-events", adminMiddleware, async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  if (process.env.GYM_X904_LOG_READ_ENABLED !== "true") return res.json({enabled:false,events:[]});
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:"Invalid date"});
  try {
    const result = await db.execute(sql`SELECT event_id, user_pin, device_time,
      attendance_status, verification_type, received_at
      FROM sport_center.gym_x904_raw_events
      WHERE LEFT(device_time,10) = ${date}
      ORDER BY device_time DESC LIMIT 200`);
    return res.json({enabled:true,events:result.rows});
  } catch {
    return res.status(503).json({error:"X904 event storage unavailable"});
  }
});
export default router;
