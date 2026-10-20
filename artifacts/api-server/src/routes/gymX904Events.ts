import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { processX904Event } from "../services/processX904Event";

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
    const outcomes = {processed:0, already_processed:0, review_required:0};
    for (const event of parsed) {
      const outcome = await processX904Event({eventId:event.id, deviceSerial:serial, userPin:event.pin});
      outcomes[outcome]++;
    }
    return res.json({ok:true,accepted:parsed.length,inserted:result.rows.length,duplicates:parsed.length-result.rows.length,outcomes});
  } catch (error) {
    console.error("[gym-x904] ingress persistence/processing failed", {
      error: error instanceof Error ? error.message : String(error),
      eventCount: parsed.length,
    });
    return res.status(503).json({error:"X904 event processing unavailable"});
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
        typeof occurred !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(occurred))
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

// Read-only shadow view: LAN logs are not authoritative ADMS attestations.
router.get("/admin/gym-x904/lan-reconciliation", adminMiddleware, async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  const date = String(req.query.date ?? "");
  const serial = process.env.GYM_X904_DEVICE_SERIAL ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || serial.length < 4) return res.status(400).json({error:"Invalid date/device"});
  try {
    const result = await db.execute(sql`SELECT l.event_index,l.user_pin,l.device_time,u.display_name,m.membership_id,
      COALESCE(m.status,'unmapped') AS mapping_status,sm.status AS membership_status,
      sm.start_date,sm.end_date,v.verification_code,v.evidence_status,
      (v.capture_source='vmsc_automated' AND v.evidence_status='verified' AND v.verification_code IN (1,4,15)
       AND CASE WHEN v.raw_hex ~ '^[0-9a-f]{80}$'
         THEN get_byte(decode(substr(v.raw_hex,53,2),'hex'),0)=v.verification_code ELSE false END) AS evidence_trusted,
      (SELECT count(*)::integer FROM sport_center.gym_checkins c WHERE c.membership_id=m.membership_id
        AND c.checkin_date=${date}::date) AS existing_checkins
      FROM sport_center.gym_x904_lan_logs l
      LEFT JOIN sport_center.gym_x904_lan_users u ON u.device_serial=l.device_serial AND u.user_pin=l.user_pin
      LEFT JOIN sport_center.gym_x904_member_mapping m ON m.device_serial=l.device_serial AND m.user_pin=l.user_pin
      LEFT JOIN sport_center.sport_memberships sm ON sm.id=m.membership_id
      LEFT JOIN sport_center.gym_x904_verification_evidence v ON v.device_serial=l.device_serial
        AND v.event_index=l.event_index AND v.user_pin=l.user_pin AND v.source_event_id=l.event_id
      WHERE l.device_serial=${serial} AND LEFT(l.device_time,10)=${date}
      ORDER BY l.device_time DESC LIMIT 250`);
    return res.json({readOnly:true,source:"lan_shadow",date,events:result.rows.map(r => ({
      ...r,review_category:r.mapping_status!=="verified"?"identity_review":
      r.membership_status!=="active" || String(r.start_date).slice(0,10)>date || String(r.end_date).slice(0,10)<date?"membership_review":
      r.evidence_trusted!==true?"verification_review":
      Number(r.existing_checkins)>0?"already_checked_in":"shadow_eligible"
    }))});
  } catch(error) {
    console.error("[gym-x904] LAN shadow reconciliation failed",error instanceof Error?error.message:String(error));
    return res.status(503).json({error:"LAN reconciliation unavailable"});
  }
});

// Explicit read-only review queue. Historical events are never replayed into bookings.
router.get("/admin/gym-x904/event-review", adminMiddleware, async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  const serial = process.env.GYM_X904_DEVICE_SERIAL ?? "";
  if (serial.length < 4) return res.status(503).json({error:"Device not configured"});
  try {
    const result = await db.execute(sql`SELECT r.event_id,r.user_pin,r.device_time,
      COALESCE(p.status,'unprocessed') AS processing_status,
      COALESCE(m.status,'unmapped') AS mapping_status,
      m.membership_id,
      CASE WHEN LEFT(r.device_time,10) <> to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')
           THEN 'historical_manual_review'
           WHEN m.status IS DISTINCT FROM 'verified' THEN 'identity_review'
           ELSE 'current_day_review' END AS review_category
      FROM sport_center.gym_x904_raw_events r
      LEFT JOIN sport_center.gym_x904_processed_events p ON p.event_id=r.event_id
      LEFT JOIN sport_center.gym_x904_member_mapping m ON m.device_serial=r.device_serial AND m.user_pin=r.user_pin
      WHERE r.device_serial=${serial} AND COALESCE(p.status,'unprocessed')<>'success'
      ORDER BY r.device_time DESC LIMIT 200`);
    return res.json({readOnly:true,events:result.rows});
  } catch { return res.status(503).json({error:"Review queue unavailable"}); }
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
// DEV-only read-only member mapping; distinct from actual enrolled LAN users.
router.get("/admin/gym-x904/member-mapping", adminMiddleware, async (_req,res) => {
  res.setHeader("Cache-Control","no-store");
  if (!["development","dev"].includes(process.env.APP_ENV ?? process.env.NODE_ENV ?? "")) return res.status(404).json({error:"Not found"});
  if (!process.env.GYM_X904_DEVICE_SERIAL) return res.status(503).json({error:"Device serial not configured"});
  try {
    const result = await db.execute(sql`SELECT device_serial,user_pin,membership_id,status,review_reason,verified_at,updated_at
      FROM sport_center.gym_x904_member_mapping
      WHERE device_serial = ${process.env.GYM_X904_DEVICE_SERIAL}
      ORDER BY user_pin LIMIT 500`);
    return res.json({source:"database-mapping",readOnly:true,rows:result.rows});
  } catch {
    return res.status(503).json({error:"Mapping X904 unavailable"});
  }
});

/** Cross-system read-only reconciliation. Device PIN is NOT a membership ID.
 * Name matches are candidates, never automatic authorization to check in.
 * Paid membership and one-off booking are independently observable.
 */
router.get("/admin/gym-x904/cross-system-reconciliation", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const serial = process.env.GYM_X904_DEVICE_SERIAL ?? "";
  if (serial.length < 4) return res.status(503).json({error:"Device not configured"});
  try {
    const result = await db.execute(sql`
      WITH local_day AS (
        SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS today
      ),
      candidate AS (
        SELECT u.user_pin, u.display_name, u.device_uid, u.device_role,
          matches.match_count, matches.membership_id, matches.membership_status,
          matches.start_date, matches.end_date,
          COALESCE(paid.has_confirmed_payment,false) AS has_confirmed_payment,
          COALESCE(bookings.booking_count,0) AS booking_count,
          COALESCE(bookings.today_booking_count,0) AS today_booking_count,
          COALESCE(bookings.today_paid_booking_count,0) AS today_paid_booking_count,
          verified_map.status AS verified_mapping_status,
          verified_map.membership_id AS mapped_membership_id
        FROM sport_center.gym_x904_lan_users u
        CROSS JOIN local_day d
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS match_count, min(m.id)::int AS membership_id,
            min(m.status) AS membership_status, min(m.start_date) AS start_date, min(m.end_date) AS end_date
          FROM sport_center.sport_memberships m
          WHERE lower(trim(m.name))=lower(trim(u.display_name))
        ) matches ON true
        LEFT JOIN LATERAL (
          SELECT true AS has_confirmed_payment
          FROM sport_center.sport_membership_payments p
          WHERE p.membership_id=matches.membership_id
            AND p.status='confirmed' AND p.period_start<=d.today AND p.period_end>=d.today
          LIMIT 1
        ) paid ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS booking_count,
            count(*) FILTER (WHERE b.booking_date=d.today AND b.status::text NOT IN ('cancelled','rejected'))::int AS today_booking_count,
            count(*) FILTER (WHERE b.booking_date=d.today AND b.status::text IN ('confirmed','completed')
              AND EXISTS (SELECT 1 FROM sport_center.sport_payments sp
                WHERE sp.booking_id=b.id AND sp.status::text='confirmed' AND sp.amount>0))::int AS today_paid_booking_count
          FROM sport_center.sport_bookings b
          WHERE lower(trim(b.customer_name))=lower(trim(u.display_name))
            OR lower(trim(coalesce(b.booked_for_name,'')))=lower(trim(u.display_name))
        ) bookings ON true
        LEFT JOIN sport_center.gym_x904_member_mapping verified_map
          ON verified_map.device_serial=u.device_serial AND verified_map.user_pin=u.user_pin
        WHERE u.device_serial=${serial}
      )
      SELECT user_pin, display_name,device_uid,device_role,match_count,membership_id,
        membership_status,start_date,end_date,has_confirmed_payment,booking_count,today_booking_count,today_paid_booking_count,
        verified_mapping_status,mapped_membership_id,
        CASE
          WHEN device_role <> 0 THEN 'device_admin_not_member'
          WHEN match_count > 1 THEN 'ambiguous_identity_review'
          WHEN match_count = 1 AND membership_status='active'
            AND start_date<=to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')
            AND end_date>=to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD')
            AND has_confirmed_payment THEN 'paid_member_candidate'
          WHEN today_paid_booking_count=1 THEN 'paid_visitor_booking_candidate_requires_identity_attestation'
          WHEN today_paid_booking_count>1 THEN 'multiple_paid_bookings_review'
          WHEN today_booking_count>0 THEN 'today_booking_unpaid_or_unconfirmed_review'
          WHEN match_count>0 THEN 'inactive_or_unpaid_member'
          WHEN booking_count>0 THEN 'historical_booking_candidate'
          ELSE 'unmatched_review'
        END AS reconciliation_category
      FROM candidate ORDER BY device_role DESC,display_name,user_pin LIMIT 1000
    `);
    return res.json({readOnly:true,autoApproved:false,source:"x904_lan_users+sport_memberships+sport_membership_payments+sport_bookings",asOf:new Date().toISOString(),rows:result.rows});
  } catch (error) {
    console.error("[gym-x904] cross-system reconciliation unavailable",error instanceof Error?error.message:String(error));
    return res.status(503).json({error:"Cross-system reconciliation unavailable"});
  }
});

export default router;
