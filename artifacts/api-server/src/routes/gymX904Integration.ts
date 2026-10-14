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

router.get("/admin/gym-x904/integration", adminMiddleware, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const receiverState = getX904ReceiverState();
  let eventStorageReady = false;
  let storedEventCount: number | null = null;
  let lastStoredEventAt: string | null = null;
  try {
    const check = await db.execute(sql`SELECT to_regclass('sport_center.gym_x904_raw_events') IS NOT NULL AS ready`);
    eventStorageReady = check.rows[0]?.ready === true;
    if (eventStorageReady && (process.env.GYM_X904_DEVICE_SERIAL ?? "").length >= 4) {
      const summary = await db.execute(sql`SELECT count(*)::int AS total, max(received_at)::text AS latest FROM sport_center.gym_x904_raw_events WHERE device_serial = ${process.env.GYM_X904_DEVICE_SERIAL ?? ""}`);
      storedEventCount = Number(summary.rows[0]?.total ?? 0);
      lastStoredEventAt = summary.rows[0]?.latest ? String(summary.rows[0]?.latest) : null;
    }
  } catch { /* Fail closed on DB errors. */ }
  const recent = heartbeatEnabled() && lastConnectorProof !== null &&
    Date.now() - lastConnectorProof.at < HEARTBEAT_TTL_MS &&
    lastConnectorProof.serial === process.env.GYM_X904_DEVICE_SERIAL;
  res.json({
    eventStorageReady,
    storedEventCount,
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
