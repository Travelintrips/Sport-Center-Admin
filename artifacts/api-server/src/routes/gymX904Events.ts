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

// LAN SDK snapshots have different provenance from ADMS and do not contain
// authoritative attendance_status or verification_type. Preserve NULLs.
// This endpoint is opt-in, uses its own credential, and cannot write ADMS events.
router.post("/internal/gym-x904/lan-events", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const expected = process.env.GYM_X904_LAN_EVENT_INGEST_KEY || "";
  if (process.env.GYM_X904_LAN_EVENT_INGEST_ENABLED !== "true" || expected.length < 32)
    return res.status(404).json({error:"Not found"});
  const received = req.headers["x-gym-lan-key"];
  const token = typeof received === "string" ? received : "";
  const serial = String(req.body?.serial || "");
  if (!equal(token, expected) || !equal(serial, process.env.GYM_X904_DEVICE_SERIAL || ""))
    return res.status(403).json({error:"Unauthorized"});
  const events = req.body?.events;
  if (!Array.isArray(events) || !events.length || events.length > 100)
    return res.status(400).json({error:"Invalid batch"});
  const seen = new Set<string>();
  const parsed: Array<{id:string,index:number,pin:string,uid:number|null,occurred:string}> = [];
  for (const item of events) {
    if (!item || typeof item !== "object") return res.status(400).json({error:"Invalid event"});
    const v = item as Record<string,unknown>;
    const id = v.id, index = v.index, pin = v.pin, uid = v.uid, occurred = v.occurred;
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id) || seen.has(id) ||
        !Number.isInteger(index) || Number(index) < 0 || Number(index) > 1000000 ||
        typeof pin !== "string" || !/^[A-Za-z0-9_-]{1,50}$/.test(pin) ||
        !(uid === null || (Number.isInteger(uid) && Number(uid) >= 0 && Number(uid) <= 65535)) ||
        typeof occurred !== "string" || !/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/.test(occurred))
      return res.status(400).json({error:"Invalid event"});
    seen.add(id);
    parsed.push({id,index:Number(index),pin,uid:uid===null?null:Number(uid),occurred});
  }
  try {
    const payload = JSON.stringify(parsed);
    const result = await db.execute(sql`INSERT INTO sport_center.gym_x904_lan_events
      (event_id,device_serial,event_index,user_pin,device_uid,device_time)
      SELECT e.id, ${serial}, e.index, e.pin, e.uid, e.occurred
      FROM jsonb_to_recordset(${payload}::jsonb)
      AS e(id text,index integer,pin text,uid integer,occurred text)
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`);
    return res.json({ok:true,accepted:parsed.length,inserted:result.rows.length,duplicates:parsed.length-result.rows.length});
  } catch {
    return res.status(503).json({error:"LAN event storage unavailable"});
  }
});

router.get("/admin/gym-x904/device-events", adminMiddleware, async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  // Admin-only, read-only history is available whenever the event table exists.
  // Do not tie viewing already-stored events to an independent ingest switch.
  const serial = process.env.GYM_X904_DEVICE_SERIAL ?? "";
  if (serial.length < 4) return res.status(503).json({error:"X904 serial is not configured"});
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:"Invalid date"});
  try {
    const result = await db.execute(sql`SELECT event_id, user_pin, device_time,
      attendance_status, verification_type, received_at
      FROM sport_center.gym_x904_raw_events
      WHERE device_serial = ${serial} AND LEFT(device_time,10) = ${date}
      ORDER BY device_time DESC LIMIT 200`);
    return res.json({enabled:true,events:result.rows});
  } catch {
    return res.status(503).json({error:"X904 event storage unavailable"});
  }
});

/** Read-only observations from previously stored ADMS logs. These are NOT
 * the device's full enrolled-user list and do not prove hardware identity. */
router.get("/admin/gym-x904/observed-pins", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if ((process.env.GYM_X904_DEVICE_SERIAL ?? "").length < 4) {
    return res.status(503).json({error:"X904 device serial is not configured"});
  }
  try {
    const result = await db.execute(sql`SELECT user_pin, count(*)::int AS event_count,
      max(device_time) AS last_device_time, max(received_at) AS last_received_at
      FROM sport_center.gym_x904_raw_events
      WHERE device_serial = ${process.env.GYM_X904_DEVICE_SERIAL ?? ""}
      GROUP BY user_pin ORDER BY last_received_at DESC LIMIT 500`);
    return res.json({source:"stored-adms-events-unverified", users: result.rows});
  } catch {
    return res.status(503).json({error:"X904 stored event data unavailable"});
  }
});
export default router;
