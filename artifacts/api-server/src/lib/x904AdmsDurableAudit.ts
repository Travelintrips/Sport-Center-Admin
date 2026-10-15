import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Never store device serial, IP, User-Agent, URL, PIN, body, card or biometrics.
export type X904AdmsKind = "handshake" | "poll" | "device_options" | "attendance";
export type X904AdmsOutcome =
  | "configuration_sent" | "poll_ack" | "device_options_ack"
  | "attendance_untrusted" | "attendance_invalid" | "attendance_stored"
  | "attendance_storage_failed" | "attendance_not_imported";
export type X904ClientHint =
  | "automation-like" | "browser-like" | "unknown-client" | "no-user-agent";
export type X904AuditInput = {
  kind: X904AdmsKind;
  outcome: X904AdmsOutcome;
  method: "GET" | "POST";
  clientHint: X904ClientHint;
  bodyBytes?: number;
  rows?: number;
  connectorAuthorized?: boolean;
};
const allowedOutcomes: Record<X904AdmsKind, X904AdmsOutcome[]> = {
  handshake: ["configuration_sent"],
  poll: ["poll_ack"],
  device_options: ["device_options_ack"],
  attendance: [
    "attendance_untrusted", "attendance_invalid", "attendance_stored",
    "attendance_storage_failed", "attendance_not_imported",
  ],
};
const lastWritten = new Map<string, number>();
let failedAuditWrites = 0;
let acceptedAuditWrites = 0;

export const x904AdmsAuditCounters = () => ({
  failedAuditWrites, acceptedAuditWrites,
});

export async function persistX904AdmsAudit(event: X904AuditInput): Promise<boolean> {
  if (!allowedOutcomes[event.kind]?.includes(event.outcome)) return false;
  const bodyBytes = Number.isSafeInteger(event.bodyBytes) && event.bodyBytes! >= 0
    ? Math.min(event.bodyBytes!, 32768) : 0;
  const rows = Number.isSafeInteger(event.rows) && event.rows! >= 0
    ? Math.min(event.rows!, 1000) : 0;
  const clientHint: X904ClientHint =
    (["automation-like","browser-like","unknown-client","no-user-agent"] as string[])
      .includes(event.clientHint) ? event.clientHint : "unknown-client";
  const interval = event.kind === "attendance" ? 10_000 : 60_000;
  const now = Date.now();
  const key = [event.kind, event.outcome, clientHint].join(":");
  if (now - (lastWritten.get(key) ?? 0) < interval) return false;
  // Rate-limit writes triggered by untrusted clients claiming a public serial.
  if (lastWritten.size > 64) {
    for (const [k, t] of lastWritten) if (now - t > 120_000) lastWritten.delete(k);
  }
  lastWritten.set(key, now);
  try {
    await db.execute(sql`
      INSERT INTO sport_center.gym_x904_adms_audit
        (kind, outcome, method, client_hint, body_bytes, row_count,
         connector_authorized, device_identity_verified)
      VALUES (
        ${event.kind}, ${event.outcome}, ${event.method}, ${clientHint},
        ${bodyBytes}, ${rows}, ${event.connectorAuthorized === true}, false
      )
    `);
    acceptedAuditWrites += 1;
    return true;
  } catch {
    failedAuditWrites += 1;
    console.warn(JSON.stringify({
      event: "x904_adms_audit", outcome: "storage_failed", kind: event.kind,
    }));
    return false;
  }
}
