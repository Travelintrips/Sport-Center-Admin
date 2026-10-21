import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** X904 automatic attendance is gated at ingress; only trusted, verified, current-day ADMS events qualify. */
export type X904EventInput = { eventId: string; deviceSerial: string; userPin: string };
export type X904Outcome = "processed" | "already_processed" | "review_required";
export async function processX904Event(event: X904EventInput,
  options: { failBeforeCommit?: boolean } = {}): Promise<X904Outcome> {
  if (!/^[a-f0-9]{64}$/.test(event.eventId) || !event.deviceSerial || !/^\d+$/.test(event.userPin)) {
    throw new Error("Invalid X904 event identity");
  }
  return db.transaction(async (tx) => {
    const raw = await tx.execute(sql`SELECT event_id,device_serial,user_pin,device_time,attendance_status,verification_type
      FROM sport_center.gym_x904_raw_events WHERE event_id=${event.eventId} FOR UPDATE`);
    if (raw.rows.length !== 1 || raw.rows[0]?.device_serial !== event.deviceSerial ||
        raw.rows[0]?.user_pin !== event.userPin) throw new Error("Raw event missing or identity mismatch");

    const ledger = await tx.execute(sql`SELECT status FROM sport_center.gym_x904_processed_events
      WHERE event_id=${event.eventId}`);
    if (ledger.rows.length) return "already_processed";

    const mapping = await tx.execute(sql`SELECT membership_id,status
      FROM sport_center.gym_x904_member_mapping
      WHERE device_serial=${event.deviceSerial} AND user_pin=${event.userPin} FOR UPDATE`);
    const membershipId = Number(mapping.rows[0]?.membership_id);
    // A device administrator must never be converted into a gym member check-in.
    // The role comes from the synchronized enrolled-user list, not name similarity.
    const enrolled = await tx.execute(sql`SELECT device_role FROM sport_center.gym_x904_lan_users
      WHERE device_serial=${event.deviceSerial} AND user_pin=${event.userPin}`);
    const ordinaryDeviceUser = enrolled.rows.length === 1 && Number(enrolled.rows[0]?.device_role) === 0;
    // Approved after controlled X904 tests: fingerprint=1, card=4, face=15.
    // The trusted ADMS ingress and verified membership mapping remain mandatory.
    const approvedCodes = [1, 4, 15];
    // Raw verification codes alone do not prove that a LAN read is authorized.
    // Only separately attested evidence explicitly verified by the trusted ingress can authorize check-in.
    const attestation = await tx.execute(sql`SELECT 1 FROM sport_center.gym_x904_verification_evidence
      WHERE source_event_id=${event.eventId} AND device_serial=${event.deviceSerial}
        AND user_pin=${event.userPin} AND evidence_status='protocol_verified'
        AND capture_source='trusted_adms_ingress'
        AND verification_code=CAST(${raw.rows[0]?.verification_type ?? -1} AS integer)
        AND verification_method=CASE CAST(${raw.rows[0]?.verification_type ?? -1} AS integer)
          WHEN 1 THEN 'fingerprint' WHEN 4 THEN 'card' WHEN 15 THEN 'face'
          ELSE 'invalid' END LIMIT 1`);
    const hasIndependentTrustedEvidence = attestation.rows.length === 1;
    const hasVerifiedAdmsPayload = Number(raw.rows[0]?.attendance_status) === 0 &&
      raw.rows[0]?.attendance_status !== null &&
      raw.rows[0]?.verification_type !== null &&
      raw.rows[0]?.verification_type !== undefined &&
      approvedCodes.includes(Number(raw.rows[0]?.verification_type));
    let status: "success" | "review_required" = "review_required";
    // A different event on the same day is a review case, not a replay of this event ID.
    if (ordinaryDeviceUser && hasVerifiedAdmsPayload && hasIndependentTrustedEvidence && mapping.rows[0]?.status === "verified" && Number.isSafeInteger(membershipId) && membershipId > 0) {
      const member = await tx.execute(sql`SELECT id,name,email,phone,start_date,end_date,status
        FROM sport_center.sport_memberships WHERE id=${membershipId} FOR UPDATE`);
      const m = member.rows[0];
      const deviceTimestamp = String(raw.rows[0]?.device_time ?? "");
      const day = deviceTimestamp.slice(0,10);
      // X904 stores local wall-clock time. Interpret it explicitly as WIB
      // instead of using the later server processing time as arrival time.
      // Do not accept impossible timestamps or clocks in the future.
      const scanOccurredAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(deviceTimestamp)
        ? new Date(deviceTimestamp.replace(" ", "T") + "+07:00")
        : new Date(NaN);
      const timestampTrusted = Number.isFinite(scanOccurredAt.getTime()) &&
        scanOccurredAt.getTime() <= Date.now() + 120000 &&
        new Date(scanOccurredAt.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0,10) === day;
      const parts = new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
      const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
      const todayWib = `${part("year")}-${part("month")}-${part("day")}`;
      if (!timestampTrusted || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day !== todayWib) {
        // Out-of-day or malformed device events need manual review.
      } else if (m?.status === "active" && String(m.start_date) <= day && String(m.end_date) >= day) {
        // Active status alone is not proof that the current month's fee was paid.
        // Fail closed if there is no confirmed payment covering the scan date.
        const paid = await tx.execute(sql`SELECT id FROM sport_center.sport_membership_payments
          WHERE membership_id=${membershipId} AND status='confirmed'
            AND period_start<=${day} AND period_end>=${day} LIMIT 1`);
        if (paid.rows.length === 0) {
          // Unpaid or pending membership is a review case, not free admission.
        } else {
        // A member row lock serializes concurrent X904 events for this membership.
        // Existing manual check-ins are also respected; historical duplicate dates remain untouched.
        const existing = await tx.execute(sql`SELECT id FROM sport_center.gym_checkins
          WHERE membership_id=${membershipId} AND checkin_date=${day}::date LIMIT 1`);
        if (existing.rows.length) {
          // Every independently verified physical scan is a valid entry event,
          // even when this member has already checked in today. Keep the original
          // check-in (including manual ones), but acknowledge this distinct scan
          // in the per-event ledger without inserting a second attendance.
          status = "success";
        } else {
          // A membership attendance is not a new sale or booking. Keep existing bookings and payments intact.
          // The membership row lock protects against concurrent events for the same member/day.
          await tx.execute(sql`INSERT INTO sport_center.gym_checkins
            (membership_id,checkin_date,checked_in_at,notes,x904_event_id)
            VALUES (${membershipId},${day}::date,${scanOccurredAt},${`X904 event ${event.eventId}`},${event.eventId})`);
          status = "success";
        }
        }
      }
    }
    // Every accepted event has its own ledger row; only the first scan inserts a check-in.
    await tx.execute(sql`INSERT INTO sport_center.gym_x904_processed_events
      (event_id,device_serial,user_pin,status)
      VALUES (${event.eventId},${event.deviceSerial},${event.userPin},${status})`);
    if (options.failBeforeCommit) throw new Error("X904_TEST_ROLLBACK_BEFORE_COMMIT");
    return status === "success" ? "processed" : "review_required";
  });
}
