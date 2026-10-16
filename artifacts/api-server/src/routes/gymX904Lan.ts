import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

/**
 * X904 LAN read-only ingest. The ALMANO connector authenticates the physical
 * machine using its LOCAL Comm Key; that key and biometric templates must never
 * leave ALMANO. This endpoint only stores a verified snapshot, not door commands.
 */
const router = Router();
const pinPattern = /^[A-Za-z0-9_-]{1,50}$/;
const snapshotPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const stampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const serialConfigured = () => (process.env.GYM_X904_DEVICE_SERIAL || "").length >= 4;
const available = () => process.env.GYM_X904_LAN_INGEST_ENABLED === "true" &&
  (process.env.GYM_X904_LAN_INGEST_KEY || "").length >= 32 && serialConfigured();
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const isStamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !stampPattern.test(value)) return false;
  const date = new Date(value.replace(" ", "T") + "Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19).replace("T", " ") === value;
};
const isSnapshot = (v: unknown): v is string =>
  typeof v === "string" && snapshotPattern.test(v);
const authorized = (req: any, res: any) => {
  res.setHeader("Cache-Control", "no-store");
  if (!available()) { res.status(404).json({ error: "Not found" }); return false; }
  const header = req.headers["x-gym-lan-key"];
  if (typeof header !== "string" || !same(header, process.env.GYM_X904_LAN_INGEST_KEY || "") ||
      typeof req.body?.serial !== "string" ||
      !same(req.body.serial, process.env.GYM_X904_DEVICE_SERIAL || "") ||
      req.body?.readAuthenticated !== true ||
      !isSnapshot(req.body?.snapshotId)) {
    res.status(403).json({ error: "Unauthorized connector" });
    return false;
  }
  return true;
};
const exactKeys = (v: object, keys: string[]) =>
  Object.keys(v).every(key => keys.includes(key)) && Object.keys(v).length === keys.length;

// A full user roster is supplied as one bounded snapshot; no passwords, cards or
// fingerprint records are accepted. No absent user is deleted or deactivated.
router.post("/internal/gym-x904/lan/users", async (req, res) => {
  if (!authorized(req, res)) return;
  const users: unknown = req.body.users;
  if (!Array.isArray(users) || users.length < 1 || users.length > 500 ||
      !isInt(req.body.userCount, 1, 500) || users.length !== req.body.userCount) {
    return res.status(400).json({ error: "Invalid user snapshot" });
  }
  const parsed: Array<{ pin: string; uid: number; name: string; role: number }> = [];
  for (const user of users) {
    if (!user || typeof user !== "object" || !exactKeys(user, ["pin", "uid", "name", "role"])) {
      return res.status(400).json({ error: "User data cannot include credentials or biometric fields" });
    }
    const v = user as Record<string, unknown>;
    if (typeof v.pin !== "string" || !pinPattern.test(v.pin) ||
        !isInt(v.uid, 0, 65535) || !isInt(v.role, 0, 255) ||
        typeof v.name !== "string" || v.name.length > 100 || /[\u0000-\u001f\u007f]/.test(v.name)) {
      return res.status(400).json({ error: "Invalid user field" });
    }
    parsed.push({ pin: v.pin, uid: v.uid, name: v.name, role: v.role });
  }
  if (new Set(parsed.map(row => row.pin)).size !== parsed.length) {
    return res.status(400).json({ error: "Duplicate user PIN" });
  }
  try {
    const payload = JSON.stringify(parsed);
    await db.execute(sql`INSERT INTO sport_center.gym_x904_lan_users
      (device_serial,user_pin,device_uid,display_name,device_role,last_seen_snapshot)
      SELECT ${req.body.serial}, u.pin, u.uid, u.name, u.role, ${req.body.snapshotId}::uuid
      FROM jsonb_to_recordset(${payload}::jsonb)
      AS u(pin text, uid integer, name text, role integer)
      ON CONFLICT (device_serial,user_pin) DO UPDATE SET
        device_uid=EXCLUDED.device_uid, display_name=EXCLUDED.display_name,
        device_role=EXCLUDED.device_role,
        last_seen_snapshot=EXCLUDED.last_seen_snapshot,last_seen_at=now()`);
    return res.json({ ok: true, acknowledged: parsed.length, snapshotId: req.body.snapshotId });
  } catch {
    return res.status(503).json({ error: "LAN user storage unavailable" });
  }
});

router.post("/internal/gym-x904/lan/logs", async (req, res) => {
  if (!authorized(req, res)) return;
  const events: unknown = req.body.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 500 ||
      !isInt(req.body.offset, 0, 999999) ||
      !isInt(req.body.deviceLogCount, 1, 1000000) ||
      req.body.offset + events.length > req.body.deviceLogCount) {
    return res.status(400).json({ error: "Invalid log batch" });
  }
  const parsed: Array<{ id: string; ix: number; pin: string; uid: number; occurred: string }> = [];
  for (let i = 0; i < events.length; i++) {
    const item = events[i];
    if (!item || typeof item !== "object" || !exactKeys(item, ["index", "pin", "uid", "occurred"])) {
      return res.status(400).json({ error: "Invalid log fields" });
    }
    const v = item as Record<string, unknown>;
    if (v.index !== req.body.offset + i || typeof v.pin !== "string" ||
        !pinPattern.test(v.pin) || !isInt(v.uid, 0, 65535) || !isStamp(v.occurred)) {
      return res.status(400).json({ error: "Invalid attendance record" });
    }
    const hash = createHash("sha256")
      .update(JSON.stringify([req.body.serial, v.index, v.pin, v.uid, v.occurred]))
      .digest("hex");
    parsed.push({ id: hash, ix: v.index as number, pin: v.pin, uid: v.uid as number, occurred: v.occurred });
  }
  try {
    const payload = JSON.stringify(parsed);
    const result = await db.execute(sql`INSERT INTO sport_center.gym_x904_lan_logs
      (event_id,device_serial,event_index,user_pin,device_uid,device_time,last_seen_snapshot)
      SELECT e.id, ${req.body.serial}, e.ix, e.pin, e.uid, e.occurred, ${req.body.snapshotId}::uuid
      FROM jsonb_to_recordset(${payload}::jsonb)
      AS e(id text,ix integer,pin text,uid integer,occurred text)
      ON CONFLICT (event_id) DO UPDATE SET
        last_seen_snapshot=EXCLUDED.last_seen_snapshot
      RETURNING event_id`);
    // UPDATE on duplicate is intentional: each snapshot must account for every device log.
    return res.json({ ok: true, acknowledged: parsed.length, storedOrRefreshed: result.rows.length,
      snapshotId: req.body.snapshotId });
  } catch {
    return res.status(503).json({ error: "LAN log storage unavailable" });
  }
});

// Completion is ACKed only after both complete sets exist DURABLY in the DB.
// Device count alone or an ALMANO heartbeat never proves successful storage.
router.post("/internal/gym-x904/lan/complete", async (req, res) => {
  if (!authorized(req, res)) return;
  if (!isInt(req.body.userCount, 1, 500) ||
      !isInt(req.body.deviceLogCount, 0, 1000000)) {
    return res.status(400).json({ error: "Invalid expected counts" });
  }
  try {
    const counts = await db.execute(sql`SELECT
      (SELECT count(*)::int FROM sport_center.gym_x904_lan_users
         WHERE device_serial=${req.body.serial} AND last_seen_snapshot=${req.body.snapshotId}::uuid) AS users,
      (SELECT count(*)::int FROM sport_center.gym_x904_lan_logs
         WHERE device_serial=${req.body.serial} AND last_seen_snapshot=${req.body.snapshotId}::uuid) AS logs`);
    const users = Number(counts.rows[0]?.users ?? -1);
    const logs = Number(counts.rows[0]?.logs ?? -1);
    if (users !== req.body.userCount || logs !== req.body.deviceLogCount) {
      return res.status(409).json({ error: "Snapshot incomplete", users, logs });
    }
    await db.execute(sql`INSERT INTO sport_center.gym_x904_lan_state
      (device_serial,last_snapshot_id,user_count,device_log_count,stored_log_count)
      VALUES (${req.body.serial},${req.body.snapshotId}::uuid,${users},${req.body.deviceLogCount},${logs})
      ON CONFLICT (device_serial) DO UPDATE SET
        last_snapshot_id=EXCLUDED.last_snapshot_id,user_count=EXCLUDED.user_count,
        device_log_count=EXCLUDED.device_log_count,stored_log_count=EXCLUDED.stored_log_count,
        last_authenticated_at=now(),last_complete_at=now()`);
    return res.json({ ok: true, verifiedStored: true, users, logs, snapshotId: req.body.snapshotId });
  } catch {
    return res.status(503).json({ error: "LAN snapshot verification unavailable" });
  }
});

router.get("/admin/gym-x904/lan-status", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!serialConfigured()) return res.status(503).json({ error: "Device not configured" });
  try {
    const result = await db.execute(sql`SELECT user_count,device_log_count,stored_log_count,
      last_complete_at,last_authenticated_at
      FROM sport_center.gym_x904_lan_state
      WHERE device_serial=${process.env.GYM_X904_DEVICE_SERIAL ?? ""}`);
    if (!result.rows.length) return res.json({ synchronized: false, users: 0, logs: 0 });
    const state = result.rows[0];
    return res.json({ synchronized: true, users: state.user_count, logs: state.stored_log_count,
      deviceLogs: state.device_log_count, lastCompleteAt: state.last_complete_at,
      lastAuthenticatedAt: state.last_authenticated_at });
  } catch {
    return res.status(503).json({ error: "LAN status database unavailable" });
  }
});
router.get("/admin/gym-x904/lan-users", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!serialConfigured()) return res.status(503).json({ error: "Device not configured" });
  try {
    const result = await db.execute(sql`SELECT u.user_pin,u.display_name,u.device_uid,u.device_role,u.last_seen_at
      FROM sport_center.gym_x904_lan_users u
      JOIN sport_center.gym_x904_lan_state s ON s.device_serial=u.device_serial
       AND s.last_snapshot_id=u.last_seen_snapshot
      WHERE u.device_serial=${process.env.GYM_X904_DEVICE_SERIAL ?? ""}
      ORDER BY u.user_pin LIMIT 500`);
    return res.json({ source: "x904-lan-authenticated", users: result.rows });
  } catch {
    return res.status(503).json({ error: "LAN users database unavailable" });
  }
});
router.get("/admin/gym-x904/lan-logs", adminMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!serialConfigured()) return res.status(503).json({ error: "Device not configured" });
  const date = String(req.query.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Invalid date" });
  try {
    const result = await db.execute(sql`SELECT l.event_id,l.user_pin,l.device_time,l.received_at
      FROM sport_center.gym_x904_lan_logs l
      JOIN sport_center.gym_x904_lan_state s ON s.device_serial=l.device_serial
        AND s.last_snapshot_id=l.last_seen_snapshot
      WHERE l.device_serial=${process.env.GYM_X904_DEVICE_SERIAL ?? ""}
        AND left(l.device_time,10)=${date}
      ORDER BY l.device_time DESC LIMIT 200`);
    return res.json({ source: "x904-lan-readonly", events: result.rows });
  } catch {
    return res.status(503).json({ error: "LAN log database unavailable" });
  }
});
export default router;
