import { Router } from "express";
import { randomUUID, timingSafeEqual, createHmac, createHash } from "node:crypto";
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

// Only the last completed, authenticated device snapshot is eligible for active-user UI.
router.get("/admin/gym-x904/users", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const result = await db.execute(sql`
      SELECT u.user_pin AS "userPin", u.device_uid AS "deviceUid",
             u.display_name AS "displayName", u.device_role AS "deviceRole"
      FROM sport_center.gym_x904_lan_users u
      JOIN sport_center.gym_x904_lan_state s
        ON s.device_serial = u.device_serial
       AND s.last_snapshot_id = u.last_seen_snapshot
      WHERE u.device_serial = 'TDBD234200545'
      ORDER BY u.user_pin
    `);
    return res.json({users: result.rows, count: result.rows.length, source: "completed-device-snapshot"});
  } catch {
    return res.status(503).json({error: "ACTIVE_USERS_UNAVAILABLE"});
  }
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
  const {commandType, userPin, expectedSerial, confirmPin, idempotencyKey, name, expectedUid, expectedName} = req.body ?? {};
  if (!["SUSPEND_USER","ACTIVATE_USER"].includes(commandType) && process.env.GYM_X904_NAME_EDIT_ALL_ENABLED!=="true" && process.env.GYM_X904_USER_WRITE_TEST_PIN && (userPin !== process.env.GYM_X904_USER_WRITE_TEST_PIN || expectedUid !== 335 || !["UPDATE_USER","DELETE_USER"].includes(commandType))) return res.status(403).json({error:"TEST_USER_ONLY"});
  if(!["SUSPEND_USER","ACTIVATE_USER"].includes(commandType) && process.env.GYM_X904_NAME_EDIT_ALL_ENABLED==="true" && commandType!=="UPDATE_USER" && !(commandType==="DELETE_USER" && process.env.GYM_X904_USER_DELETE_ENABLED==="true")) return res.status(403).json({error:"OPERATION_NOT_ENABLED"});
  // Separate explicit readiness gate; never infer manual group readiness from CUD flags.
  const isManualGroup=commandType==="SUSPEND_USER" || commandType==="ACTIVATE_USER";
  if(isManualGroup){
    if(process.env.GYM_X904_MANUAL_ACCESS_ENABLED!=="true")
      return res.status(503).json({error:"VMSC_GROUP_EXECUTOR_NOT_READY"});
    if(typeof userPin!=="string" || !/^[0-9]{1,8}$/.test(userPin) ||
       expectedSerial!=="TDBD234200545" || confirmPin!==userPin ||
       typeof idempotencyKey!=="string" || !/^[a-zA-Z0-9_-]{16,96}$/.test(idempotencyKey) ||
       !Number.isSafeInteger(expectedUid) || expectedUid<1 || expectedUid>=65535 ||
       typeof expectedName!=="string" || !/^[A-Za-z0-9 ._-]{1,24}$/.test(expectedName))
      return res.status(400).json({error:"INVALID_MANUAL_ACCESS_COMMAND"});
    // Fail closed by default: global manual control requires an explicit rollout flag.
    const testIdentity=userPin==="200" && expectedUid===337 && expectedName==="TEST SUSPEND X904" && process.env.GYM_X904_MANUAL_ACCESS_TEST_PIN==="200";
    if(!testIdentity && process.env.GYM_X904_MANUAL_ACCESS_ALL_ENABLED!=="true")
      return res.status(403).json({error:"MANUAL_ACCESS_ALL_DISABLED"});
    if(!testIdentity){
      try{
        const latest=await db.execute(sql`SELECT snapshot_id, observed_at, users FROM sport_center.gym_x904_access_snapshots
          WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
        if(!latest.rows.length || Date.now()-new Date(latest.rows[0].observed_at as string).getTime()>300000 || Date.now()<new Date(latest.rows[0].observed_at as string).getTime())
          return res.status(409).json({error:"SNAPSHOT_STALE"});
        const match=(Array.isArray(latest.rows[0].users)?latest.rows[0].users:[]).find((x:any)=>String(x.pin)===userPin);
        if(!match || match.enabled!==true && match.enabled!==false || Number(match.role)!==0 ||
           String(match.name)!==expectedName || !((commandType==="SUSPEND_USER" && match.enabled===true && Number(match.group)===1) ||
             (commandType==="ACTIVATE_USER" && Number(match.group)===2)))
          return res.status(409).json({error:"MACHINE_ACCESS_STATE_MISMATCH"});
        const mapping=await db.execute(sql`SELECT device_uid, display_name, device_role FROM sport_center.gym_x904_lan_users
          WHERE device_serial='TDBD234200545' AND user_pin=${userPin} LIMIT 1`);
        if(mapping.rows.length!==1 || Number(mapping.rows[0].device_uid)!==expectedUid ||
           String(mapping.rows[0].display_name)!==expectedName || Number(mapping.rows[0].device_role)!==0)
          return res.status(409).json({error:"MACHINE_IDENTITY_MISMATCH"});
      }catch{return res.status(503).json({error:"MACHINE_SNAPSHOT_VALIDATION_UNAVAILABLE"});}
    }
    try{
      const active=await db.execute(sql`SELECT command_id,state FROM sport_center.x904_user_commands
        WHERE device_serial=${expectedSerial} AND user_pin=${userPin}
          AND state IN ('queued','claimed') LIMIT 1`);
      if(active.rows.length) return res.status(409).json({error:"USER_COMMAND_IN_PROGRESS"});
      const result=await db.execute(sql`INSERT INTO sport_center.x904_user_commands
        (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
        VALUES (${expectedSerial},${commandType},${userPin},
          ${JSON.stringify({expectedUid,expectedName})}::jsonb,${actor.userId},${idempotencyKey})
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING command_id`);
      if(!result.rows.length) return res.status(409).json({error:"DUPLICATE_COMMAND"});
      return res.status(202).json({command_id:result.rows[0].command_id,state:"queued"});
    }catch{return res.status(503).json({error:"MANUAL_ACCESS_QUEUE_UNAVAILABLE"});}
  }
  const isCreate=commandType==="CREATE_USER";
  const requiresExisting=commandType==="UPDATE_USER" || commandType==="DELETE_USER";
  const safeDisplay=(v:unknown)=>typeof v==="string" && /^[A-Za-z0-9 ._-]{2,24}$/.test(v);
  if (!(["CREATE_USER","UPDATE_USER","DELETE_USER"].includes(commandType)) ||
      typeof userPin !== "string" || !/^[0-9]{1,8}$/.test(userPin) ||
      expectedSerial !== "TDBD234200545" || confirmPin !== userPin ||
      typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{16,96}$/.test(idempotencyKey) ||
      (commandType !== "DELETE_USER" && !safeDisplay(name)) ||
      (requiresExisting && (!Number.isSafeInteger(expectedUid) || expectedUid < 1 || expectedUid >= 65535 ||
        !safeDisplay(expectedName))) ||
      (isCreate && (expectedUid != null || expectedName != null))) {
    return res.status(400).json({error:"INVALID_USER_COMMAND"});
  }
  try {
    // A cancelled historical command must not block a new request. Reuse only
    // an active command for the same physical PIN and UID.
    if (commandType==="DELETE_USER") {
      const active=await db.execute(sql`SELECT command_id,state
        FROM sport_center.x904_user_commands
        WHERE device_serial=${expectedSerial} AND command_type='DELETE_USER'
          AND user_pin=${userPin} AND payload->>'expectedUid'=${String(expectedUid)}
          AND state IN ('queued','claimed')
        ORDER BY created_at ASC LIMIT 1`);
      if (active.rows.length) return res.status(202).json({
        command_id:active.rows[0].command_id,state:active.rows[0].state,reused:true
      });
    }
    const r=await db.execute(sql`INSERT INTO sport_center.x904_user_commands
      (device_serial, command_type, user_pin, payload, requested_by, idempotency_key)
      VALUES (${expectedSerial}, ${commandType}, ${userPin}, ${JSON.stringify({name:commandType==='DELETE_USER'?null:name.trim(),expectedUid:requiresExisting?expectedUid:null,expectedName:requiresExisting?expectedName:null})}::jsonb,
              ${actor.userId}, ${idempotencyKey})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING command_id`);
    if (!r.rows.length) return res.status(409).json({error:"DUPLICATE_COMMAND"});
    return res.status(202).json({command_id:r.rows[0].command_id,state:"queued"});
  } catch { return res.status(503).json({error:"USER_COMMAND_QUEUE_UNAVAILABLE"}); }
});


// Browser-independent, fail-closed delete batch. Staged behind a separate readiness flag.
router.post("/admin/gym-x904/delete-batches",adminMiddleware,async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 const actor=(req as any).user;
 if(!actor||!["owner","super_admin"].includes(actor.role))return res.status(403).json({error:"OWNER_OR_SUPER_ADMIN_REQUIRED"});
 if(process.env.GYM_X904_DURABLE_BULK_ENABLED!=="true"||process.env.GYM_X904_USER_WRITE_ENABLED!=="true"||process.env.GYM_X904_USER_DELETE_ENABLED!=="true")
   return res.status(503).json({error:"DURABLE_DELETE_NOT_READY"});
 const {targets,idempotencyKey,expectedSerial}=req.body??{};
 if(expectedSerial!=="TDBD234200545"||!Array.isArray(targets)||targets.length<1||targets.length>25||
    typeof idempotencyKey!=="string"||!/^[a-zA-Z0-9_-]{16,96}$/.test(idempotencyKey)||
    !targets.every((t:unknown)=>{if(!t||typeof t!=="object")return false;const x=t as Record<string,unknown>;
      return typeof x.userPin==="string"&&/^[0-9]{1,8}$/.test(x.userPin)&&
        Number.isSafeInteger(x.expectedUid)&&Number(x.expectedUid)>0&&Number(x.expectedUid)<65535&&
        typeof x.expectedName==="string"&&/^[A-Za-z0-9 ._-]{1,24}$/.test(x.expectedName);})||
    new Set(targets.map((t:{userPin:string})=>t.userPin)).size!==targets.length)
   return res.status(400).json({error:"INVALID_BATCH_TARGETS"});
 const batchId=randomUUID();
 try{
  // Idempotent replay after a browser timeout: return the original job only when
  // the authenticated owner and exact ordered PIN/UID/name list match.
  const existing=await db.execute(sql`SELECT b.batch_id AS "batchId",
    COALESCE(jsonb_agg(jsonb_build_object('userPin',q.user_pin,
      'expectedUid',(q.payload->>'expectedUid')::integer,
      'expectedName',q.payload->>'expectedName') ORDER BY q.batch_order)
      FILTER (WHERE q.command_id IS NOT NULL),'[]'::jsonb) AS targets
    FROM sport_center.x904_delete_batches b
    LEFT JOIN sport_center.x904_user_commands q ON q.batch_id=b.batch_id
    WHERE b.idempotency_key=${idempotencyKey}
      AND b.requested_by=${actor.userId} AND b.device_serial='TDBD234200545'
    GROUP BY b.batch_id`);
  if(existing.rows.length){
    const prior=existing.rows[0] as {batchId:string;targets:unknown};
    if(!Array.isArray(prior.targets) ||
       JSON.stringify(prior.targets.map((t:any)=>({userPin:t.userPin,expectedUid:t.expectedUid,expectedName:t.expectedName})))!==JSON.stringify(targets))
      return res.status(409).json({error:"IDEMPOTENCY_KEY_TARGET_MISMATCH"});
    return res.status(200).json({batchId:prior.batchId,state:"accepted",count:targets.length,replayed:true});
  }
  const result=await db.execute(sql`
   WITH supplied AS (
    SELECT value->>'userPin' AS pin,(value->>'expectedUid')::integer AS uid,
      value->>'expectedName' AS display_name,ord::integer AS sequence
    FROM jsonb_array_elements(${JSON.stringify(targets)}::jsonb) WITH ORDINALITY AS t(value,ord)
   ), verified AS (
    SELECT s.* FROM supplied s JOIN sport_center.gym_x904_lan_users u
     ON u.device_serial='TDBD234200545' AND u.user_pin=s.pin AND u.device_uid=s.uid
       AND u.display_name=s.display_name AND u.device_role=0
     JOIN sport_center.gym_x904_lan_state active_snapshot
       ON active_snapshot.device_serial=u.device_serial
       AND u.last_seen_snapshot=active_snapshot.last_snapshot_id
    WHERE NOT EXISTS (SELECT 1 FROM sport_center.x904_user_commands q
      WHERE q.device_serial='TDBD234200545' AND q.user_pin=s.pin AND q.state IN ('queued','claimed'))
   ), batch AS (
    INSERT INTO sport_center.x904_delete_batches(batch_id,device_serial,requested_by,idempotency_key)
    SELECT ${batchId}::uuid,'TDBD234200545',${actor.userId},${idempotencyKey}
    WHERE (SELECT count(*) FROM verified)=${targets.length}
    RETURNING batch_id
   ), commands AS (
    INSERT INTO sport_center.x904_user_commands
     (device_serial,command_type,user_pin,payload,requested_by,idempotency_key,batch_id,batch_order)
    SELECT 'TDBD234200545','DELETE_USER',v.pin,
     jsonb_build_object('name',NULL,'expectedUid',v.uid,'expectedName',v.display_name),
     ${actor.userId},(${batchId}::text||':'||v.sequence::text),b.batch_id,v.sequence
    FROM verified v CROSS JOIN batch b ORDER BY v.sequence RETURNING command_id
   )
   SELECT (SELECT batch_id FROM batch) AS batch_id,(SELECT count(*) FROM commands) AS command_count`);
  const row=result.rows[0] as {batch_id?:string;command_count?:number|string}|undefined;
  if(!row?.batch_id||Number(row.command_count)!==targets.length)
    return res.status(409).json({error:"TARGET_CHANGED_OR_PENDING_COMMAND"});
  return res.status(202).json({batchId:row.batch_id,state:"queued",count:targets.length});
 }catch(error){
  // A database failure is not the same as an idempotency conflict. Preserve
  // the DB diagnostic server-side without exposing SQL, names or PINs to clients.
  const code=typeof (error as {code?:unknown})?.code==="string" ? (error as {code:string}).code : "UNKNOWN";
  console.error("[X904_BATCH_DELETE_INSERT_FAILED]", {dbCode:code});
  return res.status(503).json({error:"BATCH_QUEUE_UNAVAILABLE"});
 }
});

router.get("/admin/gym-x904/delete-batches",adminMiddleware,async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 const actor=(req as any).user;
 if(!actor||!["owner","super_admin"].includes(actor.role))return res.status(403).json({error:"OWNER_OR_SUPER_ADMIN_REQUIRED"});
 try{
  const batches=await db.execute(sql`SELECT batch_id AS "batchId",created_at AS "createdAt"
    FROM sport_center.x904_delete_batches
    WHERE requested_by=${actor.userId} AND device_serial='TDBD234200545'
    ORDER BY created_at DESC LIMIT 5`);
  const ids=batches.rows.map((r:any)=>r.batchId);
  if(!ids.length)return res.json({batches:[]});
  const commands=await db.execute(sql`SELECT batch_id AS "batchId",user_pin AS "userPin",
    payload->>'expectedName' AS "name",payload->>'expectedUid' AS "uid",
    batch_order AS "order",
    CASE WHEN state='claimed' AND leased_until<=now() THEN 'needs_review' ELSE state END AS state,result
    FROM sport_center.x904_user_commands
    WHERE batch_id IN (SELECT batch_id FROM sport_center.x904_delete_batches
      WHERE requested_by=${actor.userId} AND device_serial='TDBD234200545'
      ORDER BY created_at DESC LIMIT 5)
    ORDER BY batch_id,batch_order`);
  return res.json({batches:batches.rows.map((b:any)=>({
    ...b,commands:commands.rows.filter((c:any)=>c.batchId===b.batchId)
  }))});
 }catch{return res.status(503).json({error:"BATCH_HISTORY_UNAVAILABLE"});}
});

router.get("/admin/gym-x904/delete-batches/:batchId",adminMiddleware,async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 const actor=(req as any).user;
 if(!actor||!["owner","super_admin"].includes(actor.role))return res.status(403).json({error:"OWNER_OR_SUPER_ADMIN_REQUIRED"});
 const batchId=String(req.params.batchId??"");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId))
   return res.status(400).json({error:"INVALID_BATCH_ID"});
 try{
  const r=await db.execute(sql`SELECT q.user_pin AS "userPin",q.payload->>'expectedName' AS "name",
    q.payload->>'expectedUid' AS "uid",q.batch_order AS "order",
    CASE WHEN q.state='claimed' AND q.leased_until<=now() THEN 'needs_review' ELSE q.state END AS state,
    q.created_at AS "createdAt",
    q.completed_at AS "completedAt",q.result
    FROM sport_center.x904_delete_batches b
    JOIN sport_center.x904_user_commands q ON q.batch_id=b.batch_id
    WHERE b.batch_id=${batchId}::uuid AND b.requested_by=${actor.userId}
    ORDER BY q.batch_order`);
  if(!r.rows.length)return res.status(404).json({error:"BATCH_NOT_FOUND"});
  const commands=r.rows as Array<{state:string}>;
  const state=commands.every(x=>x.state==="completed")?"completed":
    commands.some(x=>x.state==="failed"||x.state==="cancelled"||x.state==="needs_review")?"stopped":
    commands.some(x=>x.state==="claimed")?"processing":"queued";
  return res.json({batchId,state,commands});
 }catch{return res.status(503).json({error:"BATCH_STATUS_UNAVAILABLE"});}
});

// Expose feature readiness without exposing connector credentials or permitting writes.
router.get("/admin/gym-x904/user-command/capabilities",adminMiddleware,(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const role=(req as any).user?.role;
  const allowed=role==="owner" || role==="super_admin";
  return res.json({allowed,enabled:allowed && process.env.GYM_X904_USER_WRITE_ENABLED==="true",
    deviceSerial:"TDBD234200545",manualAccessEnabled:allowed && process.env.GYM_X904_MANUAL_ACCESS_ENABLED==="true" && process.env.GYM_X904_USER_WRITE_ENABLED==="true",manualAccessReason:process.env.GYM_X904_MANUAL_ACCESS_ENABLED==="true" ? null : "VMSC_GROUP_EXECUTOR_NOT_READY",manualAccessAllEnabled:allowed && process.env.GYM_X904_MANUAL_ACCESS_ALL_ENABLED==="true" && process.env.GYM_X904_MANUAL_ACCESS_ENABLED==="true" && process.env.GYM_X904_USER_WRITE_ENABLED==="true",durableBulkEnabled:allowed && process.env.GYM_X904_DURABLE_BULK_ENABLED==="true" && process.env.GYM_X904_USER_WRITE_ENABLED==="true" && process.env.GYM_X904_USER_DELETE_ENABLED==="true",operations:(allowed && process.env.GYM_X904_MANUAL_ACCESS_ENABLED==="true" && process.env.GYM_X904_USER_WRITE_ENABLED==="true" ? ["SUSPEND_USER","ACTIVATE_USER"] : []).concat(process.env.GYM_X904_NAME_EDIT_ALL_ENABLED==="true" ? (process.env.GYM_X904_USER_DELETE_ENABLED==="true" ? ["UPDATE_USER","DELETE_USER"] : ["UPDATE_USER"]) : process.env.GYM_X904_USER_WRITE_TEST_PIN ? ["UPDATE_USER","DELETE_USER"] : ["CREATE_USER","UPDATE_USER","DELETE_USER"]),testPin:process.env.GYM_X904_USER_WRITE_TEST_PIN||null});
});

// Read-only census from authenticated VMSC SDK; never infer state from old command ACK.
router.get("/admin/gym-x904/live-access-status",adminMiddleware,async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const actor=(req as any).user;
  if(!actor||!["owner","super_admin"].includes(actor.role))
    return res.status(403).json({error:"OWNER_OR_SUPER_ADMIN_REQUIRED"});
  try{
    const snapshots=await db.execute(sql`SELECT snapshot_id,observed_at,user_count,users
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545'
      ORDER BY observed_at DESC,snapshot_id DESC LIMIT 1`);
    const lan=await db.execute(sql`SELECT user_pin,device_uid,display_name,device_role
      FROM sport_center.gym_x904_lan_users WHERE device_serial='TDBD234200545'`);
    if(!snapshots.rows.length)
      return res.json({source:"device_sdk_snapshot",available:false,machineCount:null,appCount:lan.rows.length,observedAt:null,users:[]});
    const snap=snapshots.rows[0];
    const raw=Array.isArray(snap.users)?snap.users:[];
    const appByPin=new Map(lan.rows.map(x=>[String(x.user_pin),x]));
    const machinePins=new Set(raw.map((x:any)=>String(x.pin)));
    const users=raw.map((x:any)=>{
      const pin=String(x.pin);
      const app=appByPin.get(pin);
      const matches=!!app && String(app.display_name)===String(x.name) &&
        Number(app.device_role)===Number(x.role);
      return {user_pin:pin,display_name:String(x.name),device_group:Number(x.group),
        enabled:x.enabled===true,device_role:Number(x.role),
        device_uid:matches?Number(app!.device_uid):null,
        identityMatched:matches};
    });
    return res.json({source:"device_sdk_snapshot",available:true,observedAt:snap.observed_at,
      machineCount:Number(snap.user_count),appCount:lan.rows.length,
      missingInMachine:lan.rows.filter(x=>!machinePins.has(String(x.user_pin))).length,
      unmatchedIdentity:users.filter((x:any)=>!x.identityMatched).length,users});
  }catch{
    return res.status(503).json({error:"LIVE_ACCESS_SNAPSHOT_UNAVAILABLE"});
  }
});

// Last confirmed group mutation, not a live device snapshot. Unknown until a verified ACK exists.
router.get("/admin/gym-x904/manual-access-status",adminMiddleware,async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const actor=(req as any).user;
  if(!actor||!["owner","super_admin"].includes(actor.role)) return res.status(403).json({error:"OWNER_OR_SUPER_ADMIN_REQUIRED"});
  try{
    const r=await db.execute(sql`SELECT DISTINCT ON (user_pin) user_pin,command_type,completed_at,
      (result->>'deviceUid')::integer AS device_uid,
      (result->>'afterGroup')::integer AS device_group
      FROM sport_center.x904_user_commands
      WHERE device_serial='TDBD234200545' AND state='completed'
        AND command_type IN ('SUSPEND_USER','ACTIVATE_USER')
        AND result->>'readBackConfirmed'='true'
      ORDER BY user_pin,completed_at DESC`);
    return res.json({source:"last_verified_command_ack",users:r.rows});
  }catch{return res.status(503).json({error:"MANUAL_ACCESS_STATUS_UNAVAILABLE"});}
});

// VMSC claims and receipts use scoped database SECURITY DEFINER functions.
// No public HTTP path can claim or complete a machine mutation.
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

router.get("/internal/gym-x904/diagnostics/command/:commandId", async (req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const secret=process.env.X904_OC_DIAGNOSTICS_HMAC_SECRET ?? "";
  if(process.env.X904_OC_DIAGNOSTICS_ENABLED!=="true" || secret.length<48)
    return res.status(404).json({error:"DIAGNOSTICS_DISABLED"});
  const timestamp=String(req.header("x-x904-timestamp")??"");
  const nonce=String(req.header("x-x904-nonce")??"");
  const signature=String(req.header("x-x904-signature")??"");
  const commandId=String(req.params.commandId??"");
  if(!/^[0-9a-f-]{36}$/i.test(commandId) || !/^\d{13}$/.test(timestamp) ||
     !/^[a-zA-Z0-9_-]{16,96}$/.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature))
    return res.status(400).json({error:"INVALID_DIAGNOSTIC_REQUEST"});
  if(Math.abs(Date.now()-Number(timestamp))>60_000)
    return res.status(401).json({error:"DIAGNOSTIC_TIMESTAMP_EXPIRED"});
  const msg=["GET","/internal/gym-x904/diagnostics/command/"+commandId,timestamp,nonce].join("\n");
  const expected=createHmac("sha256",secret).update(msg).digest("hex");
  if(!timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(signature,"hex")))
    return res.status(401).json({error:"DIAGNOSTIC_AUTH_FAILED"});
  const nonceHash=createHash("sha256").update(nonce).digest("hex");
  const requestId=randomUUID();
  try{
    const audit=await db.execute(sql`INSERT INTO sport_center.x904_diagnostic_audit
      (request_id,nonce_hash,command_id,action,result)
      VALUES (${requestId}::uuid,${nonceHash},${commandId}::uuid,'command_status','accepted')
      ON CONFLICT (nonce_hash) DO NOTHING RETURNING request_id`);
    if(!audit.rows.length)return res.status(409).json({error:"DIAGNOSTIC_REPLAY"});
    const rows=await db.execute(sql`SELECT command_id,command_type,user_pin,state,created_at,
      completed_at,result->>'errorCode' AS error_code,
      result->>'readBackConfirmed' AS readback_confirmed,
      result->>'beforeGroup' AS before_group,result->>'afterGroup' AS after_group
      FROM sport_center.x904_user_commands
      WHERE command_id=${commandId}::uuid AND device_serial='TDBD234200545'
      AND command_type IN ('SUSPEND_USER','ACTIVATE_USER')`);
    if(!rows.rows.length)return res.status(404).json({error:"COMMAND_NOT_FOUND",requestId});
    const cmd=rows.rows[0];
    const snap=await db.execute(sql`SELECT snapshot_id,observed_at,
       (SELECT jsonb_build_object('group',u->>'group','enabled',u->>'enabled','role',u->>'role')
        FROM jsonb_array_elements(users) u WHERE u->>'pin'=${String(cmd.user_pin)} LIMIT 1) AS observed
       FROM sport_center.gym_x904_access_snapshots
       WHERE device_serial='TDBD234200545'
       ORDER BY snapshot_id DESC LIMIT 1`);
    return res.json({requestId,source:"x904_read_only_diagnostic",command:cmd,snapshot:snap.rows[0]??null});
  }catch{return res.status(503).json({error:"DIAGNOSTIC_AUDIT_OR_QUERY_UNAVAILABLE"});}
});

export default router;
