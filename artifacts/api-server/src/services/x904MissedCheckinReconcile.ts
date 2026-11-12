import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { checkInBooking } from "../lib/bookingLifecycle";
import { isX904UsageWithinBookingSession } from "../lib/bookingLifecycleRules";

/**
 * Repair late LAN ingestion or a membership renewal that replaced the current
 * membership dates. Strictly bounded to today/yesterday, verified identities,
 * confirmed paid/grace coverage and existing device logs. Never invent scan events.
 * The canonical SQL function owns serialization and exactly-once attendance.
 */
export async function reconcileX904MissedPaidCheckins(): Promise<void> {
  const candidates = await db.execute(sql`
    SELECT DISTINCT ON (l.user_pin, left(l.device_time,10)) l.event_id
    FROM sport_center.gym_x904_lan_logs l
    JOIN sport_center.gym_x904_member_mapping mp
      ON mp.device_serial=l.device_serial AND mp.user_pin=l.user_pin AND mp.status='verified'
    JOIN sport_center.sport_memberships m ON m.id=mp.membership_id AND m.status='active'
    JOIN sport_center.gym_x904_lan_users u
      ON u.device_serial=l.device_serial AND u.user_pin=l.user_pin AND u.device_role=0
    WHERE l.device_serial='TDBD234200545'
      AND left(l.device_time,10) IN (
        (now() AT TIME ZONE 'Asia/Jakarta')::date::text,
        ((now() AT TIME ZONE 'Asia/Jakarta')::date-1)::text)
      AND EXISTS (SELECT 1 FROM sport_center.sport_membership_payments p
        WHERE p.membership_id=m.id AND p.status='confirmed' AND p.amount>0
          AND (
            (p.period_start<=left(l.device_time,10)
              AND p.period_end>=left(l.device_time,10))
            OR
            (m.start_date<=left(l.device_time,10)
              AND m.end_date<left(l.device_time,10)
              AND left(l.device_time,10)::date<=m.end_date::date+7
              AND p.period_start<=m.end_date AND p.period_end>=m.end_date)
          ))
      AND NOT EXISTS (SELECT 1 FROM sport_center.gym_checkins c
        WHERE c.membership_id=m.id AND c.checkin_date=left(l.device_time,10)::date)
    ORDER BY l.user_pin,left(l.device_time,10),l.device_time,l.event_index
    LIMIT 30`);
  for (const row of candidates.rows) {
    const eventId=String(row.event_id);
    const result=await db.execute(sql`SELECT sport_center.x904_apply_first_daily_checkin(${eventId}) as result`);
    const outcome=String(result.rows[0]?.result??'');
    if (outcome === 'error_nonblocking') logger.error({eventId}, '[x904] auto checkin reconciliation error');
  }
  await reconcileX904MissedNonmemberBookingCheckins();
}


export async function reconcileX904MissedNonmemberBookingCheckins(
  store: Pick<typeof db, "execute"> = db,
  evaluationTime: Date = new Date(),
): Promise<number> {
  if (process.env.GYM_X904_NONMEMBER_BOOKING_CHECKIN_ENABLED !== "true") return 0;
  const rows = await store.execute(sql`
    SELECT DISTINCT ON (a.booking_id) a.booking_id,b.booking_date,b.start_time,b.end_time,l.event_id,l.device_time
    FROM sport_center.x904_nonmember_daily_access a
    JOIN sport_center.sport_bookings b ON b.id=a.booking_id
    JOIN sport_center.sport_payments p
      ON p.id=a.payment_id AND p.booking_id=a.booking_id
      AND p.status='confirmed' AND p.confirmed_at IS NOT NULL
      AND p.amount > 0
    JOIN sport_center.x904_verified_nonmember_identities v
      ON v.device_serial=a.device_serial AND v.user_pin=a.user_pin
      AND v.device_uid=a.device_uid
      AND v.verification_state='verified' AND v.revoked_at IS NULL
      AND upper(trim(v.display_name))=upper(trim(a.verified_name))
    JOIN sport_center.gym_x904_lan_users u
      ON u.device_serial=a.device_serial AND u.user_pin=a.user_pin
      AND u.device_uid=a.device_uid AND u.device_role=0
      AND upper(trim(u.display_name))=upper(trim(a.verified_name))
    JOIN sport_center.gym_x904_lan_logs l ON l.device_serial=a.device_serial
      AND l.user_pin=a.user_pin
    -- The historical LAN device_uid stores an SDK event sequence, not roster UID.
    -- Signed VMSC proof is required for a verified booking scan.
    JOIN sport_center.gym_x904_verification_evidence e
      ON e.device_serial=l.device_serial AND e.event_index=l.event_index
      AND e.user_pin=l.user_pin AND e.source_event_id=l.event_id
      AND e.capture_source='trusted_vmsc_ingress'
      AND e.evidence_status='protocol_verified'
      AND e.verification_code IN (1,4,15)
      AND e.raw_hex ~ '^[0-9a-f]{80}$'
      AND get_byte(decode(substr(e.raw_hex,53,2),'hex'),0)=e.verification_code
      -- 255 is the device's valid undefined Punch State, NOT a user UID.
      -- It only qualifies after a signed, same-event VMSC attestation.
      AND get_byte(decode(substr(e.raw_hex,63,2),'hex'),0) IN (0,255)
    JOIN sport_center.gym_x904_raw_events r
      ON r.event_id=l.event_id AND r.device_serial=l.device_serial
      AND r.user_pin=l.user_pin AND r.device_time=l.device_time
      AND r.attendance_status=get_byte(decode(substr(e.raw_hex,63,2),'hex'),0)
      AND r.verification_type=e.verification_code
    WHERE a.device_serial='TDBD234200545' AND a.verification_state='verified'
      AND (l.device_uid=a.device_uid OR l.device_uid=l.event_index+1)
      AND a.identity_type='pin' -- VIS cards retain their established handover/check-in workflow
      AND a.confirmed_at IS NOT NULL
      AND a.access_state IN ('active','expired')
      AND a.activated_at IS NOT NULL AND a.expires_at IS NOT NULL
      AND b.status='confirmed' AND b.checked_in_at IS NULL
      AND b.booking_date IN ((${evaluationTime}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date::text,
        ((${evaluationTime}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date - 1)::text)
      AND l.device_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
      AND l.device_time >= b.booking_date || ' ' || left(b.start_time,5) || ':00'
      AND l.device_time < (CASE WHEN left(b.end_time,5) <= left(b.start_time,5)
        THEN to_char(b.booking_date::date + 1,'YYYY-MM-DD') ELSE b.booking_date END
        || ' ' || left(b.end_time,5) || ':00')
      AND l.device_time >= to_char(a.activated_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI:SS')
      AND l.device_time < to_char(a.expires_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI:SS')
      AND l.device_time <= to_char(${evaluationTime}::timestamptz AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI:SS')
    ORDER BY a.booking_id,l.device_time,l.event_id LIMIT 30`);
  let checkedIn = 0;
  for (const row of rows.rows as any[]) {
    const eventTime = String(row.device_time);
    if (!isX904UsageWithinBookingSession(
      String(row.booking_date), String(row.start_time),
      String(row.end_time), eventTime)) continue;
    const observed = new Date(eventTime.replace(" ", "T") + "+07:00");
    if (!Number.isFinite(observed.getTime())) continue;
    // checkInBooking validates current status, session, pending reschedule and
    // records an audit entry; the normal scheduler later calls completeBooking.
    const result = await checkInBooking(Number(row.booking_id), {
      userName: `X904 verified scan ${String(row.event_id)}`, userRole: "system",
    }, observed);
    if (result.ok) checkedIn++;
    else logger.info({ bookingId: row.booking_id, reason: result.reason },
      "[x904] nonmember booking check-in held");
  }
  return checkedIn;
}
