import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { adminMiddleware } from "../lib/auth";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getX904ReceiverState } from "./x904AdmsGate";

/** Volatile evidence only: never treat unauthenticated ADMS handshakes as machine proof. */
const router = Router();
const HEARTBEAT_TTL_MS = 90_000;
let lastConnectorProof: null | {at: number; users: number; logs: number; serial: string} = null;
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
router.post("/internal/gym-x904/connector-heartbeat", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!heartbeatEnabled()) return res.status(404).json({error:"Not found"});
  const key = req.headers["x-gym-ingress-key"];
  const serial = req.body?.serial;
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
  lastConnectorProof = {at: Date.now(), users, logs, serial};
  return res.json({ok:true,acceptedAt:new Date(lastConnectorProof.at).toISOString()});
});

/** VMSC-only gateway heartbeat. A dedicated key prevents ALMANO or anonymous ADMS
 * traffic from being mistaken for the primary Windows gateway. The heartbeat
 * attests the connector, NOT the physical X904 or any member attendance event.
 */
const VMSC_TTL_MS = 300_000;
const vmscConfigured = () => (process.env.GYM_VMSC_HEARTBEAT_KEY ?? "").length >= 32 &&
  (process.env.GYM_X904_DEVICE_SERIAL ?? "").length >= 4;
router.post("/internal/gym-x904/vmsc-heartbeat", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!vmscConfigured()) return res.status(404).json({ error: "Not found" });
  const provided = req.headers["x-vmsc-heartbeat-key"];
  if (typeof provided !== "string" ||
      !equal(provided, process.env.GYM_VMSC_HEARTBEAT_KEY ?? "") ||
      req.body?.source !== "VMSC" ||
      typeof req.body?.serial !== "string" ||
      !equal(req.body.serial, process.env.GYM_X904_DEVICE_SERIAL ?? "")) {
    return res.status(403).json({ error: "Unauthorized gateway" });
  }
  try {
    const result = await db.execute(sql`INSERT INTO sport_center.vmsc_heartbeats
      (device_id, device_serial, last_seen_at, device_status)
      VALUES ('VMSC', ${req.body.serial}, now(), 'online')
      ON CONFLICT (device_id) DO UPDATE SET
        device_serial = EXCLUDED.device_serial,
        last_seen_at = now(),
        device_status = 'online'
      RETURNING last_seen_at`);
    return res.json({ ok: true, acceptedAt: result.rows[0]?.last_seen_at });
  } catch {
    return res.status(503).json({ error: "VMSC heartbeat persistence unavailable" });
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
  const recent = heartbeatEnabled() && lastConnectorProof !== null &&
    Date.now() - lastConnectorProof.at < HEARTBEAT_TTL_MS &&
    lastConnectorProof.serial === process.env.GYM_X904_DEVICE_SERIAL;
  let vmscLastSeenAt: string | null = null;
  // Read the canonical heartbeat ledger already written by the VMSC Supabase
  // Edge Function. Do not infer availability from ADMS contacts or ALMANO.
  if ((process.env.GYM_X904_DEVICE_SERIAL ?? "").length >= 4) {
    try {
      const status = await db.execute(sql`SELECT (extract(epoch FROM last_seen) * 1000)::bigint AS heartbeat_ms
        FROM sport_center.gym_x904_connector_heartbeats
        WHERE device_serial = ${process.env.GYM_X904_DEVICE_SERIAL ?? ""}
          AND connector_id = 'VMSC' AND read_authenticated = true`);
      const millis = Number(status.rows[0]?.heartbeat_ms);
      if (Number.isFinite(millis) && millis > 0 && millis <= Date.now()) {
        vmscLastSeenAt = new Date(millis).toISOString();
      }
    } catch { /* Missing table or DB unavailable: fail closed. */ }
  }
  res.json({
    vmscSource: vmscLastSeenAt ? "VMSC" : null,
    vmscHeartbeatVerified: Boolean(vmscLastSeenAt),
    vmscHeartbeatAt: vmscLastSeenAt,
    vmscOnline: Boolean(vmscLastSeenAt && Date.now() - Date.parse(vmscLastSeenAt) >= 0 && Date.now() - Date.parse(vmscLastSeenAt) < VMSC_TTL_MS),
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
    connectorHeartbeatEnabled: heartbeatEnabled(),
    trustedAdmsIngestAt: receiverState.lastTrustedIngestAt,
    eventReadEnabled: process.env.GYM_X904_LOG_READ_ENABLED === "true",
    doorControl: "device-local",
    connectionTestedAt: recent && lastConnectorProof ? new Date(lastConnectorProof.at).toISOString() : null,
    lastDeviceEventAt: receiverState.lastTrustedIngestAt,
    note: recent && lastConnectorProof
      ? `Konektor tepercaya melaporkan pembacaan X904: ${lastConnectorProof.users} pengguna dan ${lastConnectorProof.logs} log. Ini bukan bukti sinkronisasi data ke database.`
      : receiverState.lastTrustedIngestAt && storedEventCount !== null && storedEventCount > 0 && lastStoredEventAt
        ? `Log ADMS terautentikasi sudah diterima dan ${storedEventCount} event tersimpan. Status online fisik belum dibuktikan.`
        : storedEventCount !== null && storedEventCount > 0
        ? `Ada ${storedEventCount} log ADMS tersimpan pada database, tetapi identitas perangkat belum terautentikasi. Tidak membuktikan mesin online.`
        : receiverState.ready
        ? "Receiver diagnostik aktif. Belum ada heartbeat konektor terautentikasi yang masih berlaku; absensi X904 belum diimpor."
        : "Receiver diagnostik belum siap. Data check-in yang tampil berasal dari SC.",
  });
});
export default router;
