import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { adminMiddleware } from "../lib/auth";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getX904ReceiverState } from "./x904AdmsGate";

/** Volatile evidence only: never treat unauthenticated ADMS handshakes as machine proof. */
const router = Router();
const HEARTBEAT_TTL_MS = 300_000;
const equal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const heartbeatEnabled = () => process.env.GYM_X904_CONNECTOR_HEARTBEAT_ENABLED === "true" &&
  (process.env.GYM_X904_EVENT_INGEST_KEY ?? "").length >= 32 &&
  (process.env.GYM_X904_DEVICE_SERIAL ?? "").length >= 3;

/** Trusted ALMANO connector attestation. Must be called only after a successful, authenticated,
 * read-only connection to X904. Do not send Comm Key, user data, or biometric templates.
 * A shared secret proves connector authorization, not independent hardware identity.
 */
router.post("/internal/gym-x904/connector-heartbeat", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!heartbeatEnabled()) return res.status(404).json({error:"Not found"});
  const key = req.headers["x-gym-ingress-key"];
  const serial = req.body?.serial;
  const connectorId = req.body?.connectorId === "VMSC" ? "VMSC" : "unattributed";
  const users = req.body?.users;
  const logs = req.body?.logs;
  if (typeof key !== "string" || typeof serial !== "string" ||
      !equal(key, process.env.GYM_X904_EVENT_INGEST_KEY ?? "") ||
      !equal(serial, process.env.GYM_X904_DEVICE_SERIAL ?? "")) {
    return res.status(403).json({error:"Unauthorized connector"});
  }
  if (!Number.isSafeInteger(users) || users < 0 || users > 100000 ||
      !Number.isSafeInteger(logs) || logs < 0 || logs > 1000000 ||
      req.body?.readAuthenticated !== true) {
    return res.status(400).json({error:"Invalid connector proof"});
  }
  try {
    const receipt = await db.execute(sql`INSERT INTO sport_center.gym_x904_connector_heartbeats
      (device_serial,connector_id,last_seen,reported_users,reported_logs,read_authenticated)
      VALUES (${serial},${connectorId},now(),${users},${logs},true)
      ON CONFLICT (device_serial) DO UPDATE SET
      connector_id=EXCLUDED.connector_id,last_seen=EXCLUDED.last_seen,
      reported_users=EXCLUDED.reported_users,reported_logs=EXCLUDED.reported_logs,
      read_authenticated=EXCLUDED.read_authenticated
      RETURNING last_seen::text AS last_seen`);
    return res.json({ok:true,acceptedAt:String(receipt.rows[0]?.last_seen)});
  } catch {
    return res.status(503).json({error:"Heartbeat persistence unavailable"});
  }
});

router.get("/admin/gym-x904/integration", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const receiverState = getX904ReceiverState();
  let eventStorageReady = false;
  let storedEventCount: number | null = null;
  let processedEventCount: number | null = null;
  let pendingEventCount: number | null = null;
  const lastAuthenticatedAt: string | null = receiverState.lastTrustedIngestAt ?? null;
  let processingLedgerReady = false;
  let lastStoredEventAt: string | null = null;
  let connectorProof: null | {at:string;users:number;logs:number;serial:string} = null;
  let lastDurableSyncAt: string | null = null;
  try {
    const check = await db.execute(sql`SELECT to_regclass('sport_center.gym_x904_raw_events') IS NOT NULL AS ready`);
    eventStorageReady = check.rows[0]?.ready === true;
    if (eventStorageReady && (process.env.GYM_X904_DEVICE_SERIAL ?? "").length >= 4) {
      const summary = await db.execute(sql`SELECT count(*)::int AS total, max(received_at)::text AS latest FROM sport_center.gym_x904_raw_events WHERE device_serial = ${process.env.GYM_X904_DEVICE_SERIAL ?? ""}`);
      storedEventCount = Number(summary.rows[0]?.total ?? 0);
      lastStoredEventAt = summary.rows[0]?.latest ? String(summary.rows[0]?.latest) : null;
      // Ledger-backed metrics remain unavailable until a durable event writer exists.
      const ledger = await db.execute(sql`SELECT to_regclass('sport_center.gym_x904_processed_events') IS NOT NULL AS ready`);
      processingLedgerReady = ledger.rows[0]?.ready === true;
      if (processingLedgerReady) {
        const counts = await db.execute(sql`
          SELECT
            (SELECT count(*)::int FROM sport_center.gym_x904_processed_events p
             JOIN sport_center.gym_x904_raw_events r ON r.event_id = p.event_id
             WHERE r.device_serial = ${process.env.GYM_X904_DEVICE_SERIAL ?? ""}) AS processed,
            (SELECT count(*)::int FROM sport_center.gym_x904_raw_events r
             WHERE r.device_serial = ${process.env.GYM_X904_DEVICE_SERIAL ?? ""}
               AND NOT EXISTS (
                 SELECT 1 FROM sport_center.gym_x904_processed_events p
                 WHERE p.event_id = r.event_id
               )) AS pending`);
        processedEventCount = Number(counts.rows[0]?.processed ?? 0);
        pendingEventCount = Number(counts.rows[0]?.pending ?? 0);
      }
    }
  } catch { /* Fail closed on DB errors. */ }
  try {
    {
      const heartbeat = await db.execute(sql`SELECT device_serial, last_seen::text AS last_seen,
        reported_users, reported_logs FROM sport_center.gym_x904_connector_heartbeats
        WHERE device_serial=${process.env.GYM_X904_DEVICE_SERIAL || "TDBD234200545"}`);
      const row = heartbeat.rows[0];
      if (row) connectorProof={serial:String(row.device_serial),at:String(row.last_seen),
        users:Number(row.reported_users),logs:Number(row.reported_logs)};
    }
  } catch { /* fail closed if DB cannot be queried */ }
  try {
    const sync = await db.execute(sql`SELECT last_complete_at::text AS last_complete_at
      FROM sport_center.gym_x904_lan_state
      WHERE device_serial=${process.env.GYM_X904_DEVICE_SERIAL || "TDBD234200545"} LIMIT 1`);
    lastDurableSyncAt = sync.rows[0]?.last_complete_at ? String(sync.rows[0].last_complete_at) : null;
  } catch { /* Keep status unavailable rather than inventing a successful sync. */ }
  const recent = connectorProof !== null &&
    Number.isFinite(Date.parse(connectorProof.at)) &&
    Date.now() - Date.parse(connectorProof.at) >= 0 &&
    Date.now() - Date.parse(connectorProof.at) < HEARTBEAT_TTL_MS &&
    connectorProof.serial === (process.env.GYM_X904_DEVICE_SERIAL || "TDBD234200545");
  res.json({
    eventStorageReady,
    storedEventCount,
    stored_logs: storedEventCount,
    processed_events: processedEventCount,
    pending_events: pendingEventCount,
    last_authenticated_at: lastAuthenticatedAt,
    processingLedgerReady,
    lastStoredEventAt,
    device: "Solution X904",
    attendanceSource: "sport-center-manual",
    legacyGymService: "retired",
    receiver: receiverState.ready ? "diagnostic-ready" : "not-connected",
    hardware: recent ? "connector-attested" : receiverState.lastTrustedIngestAt && storedEventCount !== null && storedEventCount > 0 && lastStoredEventAt ? "trusted-adms-data-received" : storedEventCount !== null && storedEventCount > 0 ? "stored-adms-unverified" : "unverified",
    synchronizing: false,
    eventIngestConfigured: process.env.GYM_X904_ADMS_ATTLOG_INGEST_ENABLED === "true" &&
      (process.env.GYM_X904_DEVICE_SERIAL || "").length >= 4,
    connectorHeartbeatEnabled: true,
    trustedAdmsIngestAt: receiverState.lastTrustedIngestAt,
    eventReadEnabled: process.env.GYM_X904_LOG_READ_ENABLED === "true",
    doorControl: "device-local",
    connectionTestedAt: recent && connectorProof ? new Date(connectorProof.at).toISOString() : null,
    lastDurableSyncAt,
    lastDeviceEventAt: receiverState.lastTrustedIngestAt,
    note: recent && connectorProof
      ? `Konektor tepercaya melaporkan pembacaan X904: ${connectorProof.users} pengguna dan ${connectorProof.logs} log. Ini bukan bukti sinkronisasi data ke database.`
      : receiverState.lastTrustedIngestAt && storedEventCount !== null && storedEventCount > 0 && lastStoredEventAt
        ? `Log ADMS terautentikasi sudah diterima dan ${storedEventCount} event tersimpan. Status online fisik belum dibuktikan.`
        : storedEventCount !== null && storedEventCount > 0
        ? `Ada ${storedEventCount} log ADMS tersimpan pada database, tetapi identitas perangkat belum terautentikasi. Tidak membuktikan mesin online.`
        : receiverState.ready
        ? "Receiver diagnostik aktif. Belum ada heartbeat konektor terautentikasi yang masih berlaku; absensi X904 belum diimpor."
        : "Receiver diagnostik belum siap. Data check-in yang tampil berasal dari SC.",
  });
});

router.get("/admin/gym-x904/read-command", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const result = await db.execute(sql`SELECT command_id, command_type, state, created_at, completed_at, result, error_code
      FROM sport_center.gym_x904_read_commands
      WHERE device_serial='TDBD234200545' ORDER BY created_at DESC LIMIT 1`);
    res.json({ command: result.rows[0] ?? null });
  } catch { res.status(503).json({ error: "COMMAND_STATUS_UNAVAILABLE" }); }
});
router.post("/admin/gym-x904/read-command", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const result = await db.execute(sql`INSERT INTO sport_center.gym_x904_read_commands(command_type)
      VALUES ('GET_STATUS') ON CONFLICT (device_serial,command_type) WHERE state='queued' DO NOTHING
      RETURNING command_id,state`);
    if (!result.rows.length) { res.status(409).json({ error: "COMMAND_ALREADY_QUEUED" }); return; }
    res.status(202).json({ command: result.rows[0] });
  } catch { res.status(503).json({ error: "COMMAND_QUEUE_UNAVAILABLE" }); }
});

// Staged administrative user mutations. Fail-closed until VMSC write executor is independently tested.
router.post("/admin/gym-x904/user-command", adminMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const actor = (req as any).user;
  if (!actor || !["owner", "super_admin"].includes(actor.role)) return res.status(403).json({error:"OWNER_OR_SUPER_ADMIN_REQUIRED"});
  if (process.env.GYM_X904_USER_WRITE_ENABLED !== "true") return res.status(503).json({error:"USER_WRITE_DISABLED"});
  const {commandType, userPin, expectedSerial, confirmPin, idempotencyKey, name} = req.body ?? {};
  if (!(["CREATE_USER","UPDATE_USER","DELETE_USER"].includes(commandType)) ||
      typeof userPin !== "string" || !/^[0-9]{1,12}$/.test(userPin) ||
      expectedSerial !== "TDBD234200545" || confirmPin !== userPin ||
      typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{16,96}$/.test(idempotencyKey) ||
      (commandType !== "DELETE_USER" && (typeof name !== "string" || name.trim().length < 2 || name.length > 80))) {
    return res.status(400).json({error:"INVALID_USER_COMMAND"});
  }
  try {
    const r=await db.execute(sql`INSERT INTO sport_center.x904_user_commands
      (device_serial, command_type, user_pin, payload, requested_by, idempotency_key)
      VALUES (${expectedSerial}, ${commandType}, ${userPin}, ${JSON.stringify({name:commandType==='DELETE_USER'?null:name.trim()})}::jsonb,
              ${actor.userId}, ${idempotencyKey})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING command_id`);
    if (!r.rows.length) return res.status(409).json({error:"DUPLICATE_COMMAND"});
    return res.status(202).json({command_id:r.rows[0].command_id,state:"queued"});
  } catch { return res.status(503).json({error:"USER_COMMAND_QUEUE_UNAVAILABLE"}); }
});

// Connector worker claims are lease-fenced and require the existing private VMSC ingest key.
// QUEUE ACK is not physical device success. Connector must read back target after execution.
router.post("/internal/gym-x904/user-command/claim", async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  if (process.env.GYM_X904_USER_WRITE_ENABLED !== "true") return res.status(404).json({error:"Not found"});
  const key=req.headers["x-gym-ingress-key"];
  if (typeof key !== "string" || !equal(key,process.env.GYM_X904_EVENT_INGEST_KEY ?? "") ||
      key.length < 32 || req.body?.deviceSerial !== "TDBD234200545" ||
      req.body?.connectorId !== "VMSC") return res.status(403).json({error:"CONNECTOR_UNAUTHORIZED"});
  try {
    const r=await db.execute(sql`WITH pick AS (
      SELECT command_id FROM sport_center.x904_user_commands
      WHERE device_serial='TDBD234200545' AND state='queued'
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE sport_center.x904_user_commands q
    SET state='claimed', lease_token=gen_random_uuid(),
        leased_until=now()+interval '90 seconds', attempts=attempts+1
    FROM pick WHERE q.command_id=pick.command_id
    RETURNING q.command_id,q.command_type,q.user_pin,q.payload,q.lease_token,q.leased_until`);
    return res.json({command:r.rows[0] ?? null});
  } catch { return res.status(503).json({error:"USER_CLAIM_UNAVAILABLE"}); }
});
router.post("/internal/gym-x904/user-command/result", async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  if (process.env.GYM_X904_USER_WRITE_ENABLED !== "true") return res.status(404).json({error:"Not found"});
  const key=req.headers["x-gym-ingress-key"];
  if (typeof key !== "string" || key.length < 32 ||
      !equal(key,process.env.GYM_X904_EVENT_INGEST_KEY ?? "") ||
      req.body?.deviceSerial !== "TDBD234200545" ||
      req.body?.connectorId !== "VMSC") return res.status(403).json({error:"CONNECTOR_UNAUTHORIZED"});
  const {commandId,leaseToken,readBackConfirmed,errorCode}=req.body ?? {};
  if (typeof commandId !== "string" || !/^[0-9a-f-]{36}$/i.test(commandId) ||
      typeof leaseToken !== "string" || !/^[0-9a-f-]{36}$/i.test(leaseToken) ||
      typeof readBackConfirmed !== "boolean" ||
      (errorCode !== undefined && (typeof errorCode !== "string" || !/^[A-Z0-9_]{1,64}$/.test(errorCode)))) {
    return res.status(400).json({error:"INVALID_RESULT_RECEIPT"});
  }
  try {
    const r=await db.execute(sql`UPDATE sport_center.x904_user_commands
      SET state=${readBackConfirmed?'completed':'failed'},
          result=jsonb_build_object('readBackConfirmed',${readBackConfirmed},'errorCode',${errorCode??null}),
          completed_at=now(),leased_until=NULL
      WHERE command_id=${commandId}::uuid AND lease_token=${leaseToken}::uuid
        AND state='claimed' AND leased_until>now()
        AND device_serial='TDBD234200545'
      RETURNING command_id,state`);
    if (!r.rows.length) return res.status(409).json({error:"STALE_OR_UNKNOWN_LEASE"});
    return res.json({receipt:r.rows[0]});
  } catch {return res.status(503).json({error:"USER_RECEIPT_UNAVAILABLE"});}
});
router.get("/admin/gym-x904/user-command/:commandId",adminMiddleware,async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const actor=(req as any).user;
  if(!actor||!["owner","super_admin"].includes(actor.role)) return res.status(403).json({error:"OWNER_OR_SUPER_ADMIN_REQUIRED"});
  const commandId=String(req.params.commandId ?? "");
  if(!/^[0-9a-f-]{36}$/i.test(commandId)) return res.status(400).json({error:"INVALID_COMMAND_ID"});
  try {
    const r=await db.execute(sql`SELECT command_id,command_type,user_pin,state,created_at,
      completed_at,result FROM sport_center.x904_user_commands
      WHERE command_id=${commandId}::uuid AND requested_by=${actor.userId}
        AND device_serial='TDBD234200545'`);
    if(!r.rows.length) return res.status(404).json({error:"COMMAND_NOT_FOUND"});
    return res.json({command:r.rows[0]});
  } catch {return res.status(503).json({error:"COMMAND_STATUS_UNAVAILABLE"});}
});

export default router;
