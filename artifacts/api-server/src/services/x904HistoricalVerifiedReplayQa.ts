import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Explicit legacy Gym scan recovery only. Never called by the scheduler.
 * Not a substitute for payment approval or a live X904 activation.
 */
export async function replayVerifiedHistoricalGymScanQa(input: {
  bookingId: number;
  eventId: string;
  reviewReference: string;
}): Promise<{ status: "recovered" | "already_checked_in" | "held"; reason: string }> {
  const url = process.env.SUPABASE_DATABASE_URL_DEV ?? "";
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.APP_ENV !== "development" ||
    process.env.SPORT_CENTER_QA_HISTORICAL_REPLAY !== "true" ||
    process.env.SPORT_CENTER_QA_NO_EXTERNAL !== "true" ||
    process.env.GYM_X904_AUTOMATIC_COMMANDS_ENABLED !== "false" ||
    Boolean(process.env.SUPABASE_DATABASE_URL) ||
    !/^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:55444\/sc_runtime_dev_qa$/.test(url)
  ) {
    throw new Error("HISTORICAL_REPLAY_QA_ISOLATION_REQUIRED");
  }
  if (!Number.isSafeInteger(input.bookingId) || input.bookingId <= 0 ||
    !/^[a-f0-9]{64}$/.test(input.eventId) ||
    !/^QA-REVIEW-[A-Z0-9-]{8,60}$/.test(input.reviewReference)) {
    return { status: "held", reason: "INVALID_REPLAY_INPUT" };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(904333, ${input.bookingId})`);
    const rows = await tx.execute(sql`
      SELECT b.id AS booking_id, b.checked_in_at, b.status::text AS booking_status,
        b.source, b.booking_date, b.facility_id, a.identity_type,
        l.event_id, l.device_time
      FROM sport_center.sport_bookings b
      JOIN sport_center.x904_nonmember_daily_access a ON a.booking_id=b.id
      JOIN sport_center.sport_payments p
        ON p.id=a.payment_id AND p.booking_id=b.id
      JOIN sport_center.gym_x904_lan_logs l
        ON l.device_serial=a.device_serial AND l.user_pin=a.user_pin
        AND l.event_id=${input.eventId}
      JOIN sport_center.gym_x904_verification_evidence e
        ON e.device_serial=l.device_serial AND e.user_pin=l.user_pin
        AND e.event_index=l.event_index AND e.source_event_id=l.event_id
      JOIN sport_center.gym_x904_raw_events r
        ON r.event_id=l.event_id AND r.device_serial=l.device_serial
        AND r.user_pin=l.user_pin AND r.device_time=l.device_time
      WHERE b.id=${input.bookingId}
        AND b.facility_id=6
        AND b.source IN ('admin','gym_public_guest')
        AND b.booking_date BETWEEN '2026-11-10' AND '2026-11-16'
        AND b.status::text IN ('confirmed','completed')
        AND a.device_serial='TDBD234200545'
        AND a.identity_type IN ('pin','card')
        AND a.verification_state='verified'
        AND a.access_state IN ('expired','active')
        AND a.activated_at IS NOT NULL AND a.expires_at IS NOT NULL
        AND p.status::text='confirmed'
        AND p.confirmed_at IS NOT NULL
        AND NULLIF(BTRIM(p.proof_url),'') IS NOT NULL
        AND EXISTS (SELECT 1 FROM sport_center.audit_logs approved
          WHERE approved.entity='payment' AND approved.entity_id=p.id
            AND approved.action='FINAL_PAYMENT_APPROVED'
            AND approved.user_role='owner'
            AND approved."after"->>'status'='confirmed')
        AND p.amount>=COALESCE(b.grand_total,b.total_price)
        AND COALESCE(b.grand_total,b.total_price)>0
        AND (l.device_uid=a.device_uid OR l.device_uid=l.event_index+1)
        AND l.device_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
        AND left(l.device_time,10)=b.booking_date
        AND substring(l.device_time from 12) >= '06:00:00'
        AND substring(l.device_time from 12) < '23:00:00'
        AND l.device_time>=to_char(a.activated_at AT TIME ZONE 'Asia/Jakarta',
          'YYYY-MM-DD HH24:MI:SS')
        AND l.device_time<to_char(a.expires_at AT TIME ZONE 'Asia/Jakarta',
          'YYYY-MM-DD HH24:MI:SS')
        AND e.capture_source='trusted_vmsc_ingress'
        AND e.evidence_status='protocol_verified'
        AND e.verification_code IN (1,4,15)
        AND e.raw_hex ~ '^[0-9a-f]{80}$'
        AND get_byte(decode(substr(e.raw_hex,53,2),'hex'),0)=e.verification_code
        AND get_byte(decode(substr(e.raw_hex,63,2),'hex'),0) IN (0,255)
        AND r.attendance_status=get_byte(decode(substr(e.raw_hex,63,2),'hex'),0)
        AND r.verification_type=e.verification_code
        AND EXISTS (SELECT 1 FROM sport_center.x904_user_commands c
          WHERE c.device_serial=a.device_serial AND c.user_pin=a.user_pin
            AND c.command_type='ACTIVATE_USER' AND c.state='completed'
            AND c.payload->>'accessId'=a.access_id::text
            AND c.result->>'readBackConfirmed'='true'
            AND (c.result->>'deviceUid')::int=a.device_uid
            AND (c.result->>'afterGroup')::int=1
            AND c.completed_at<=a.activated_at)
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.x904_nonmember_daily_access other
          JOIN sport_center.sport_bookings ob ON ob.id=other.booking_id
          WHERE other.booking_id<>b.id AND other.device_serial=a.device_serial
            AND other.user_pin=a.user_pin AND ob.booking_date=b.booking_date
            AND ob.status::text IN ('confirmed','completed')
            AND ob.start_time<b.end_time AND ob.end_time>b.start_time)
        AND (
          a.identity_type='pin' AND EXISTS (
            SELECT 1 FROM sport_center.x904_verified_nonmember_identities v
            WHERE v.device_serial=a.device_serial AND v.user_pin=a.user_pin
              AND v.device_uid=a.device_uid
              AND v.verification_state='verified' AND v.revoked_at IS NULL
              AND upper(trim(v.display_name))=upper(trim(a.verified_name))
          )
          OR
          a.identity_type='card' AND a.identity_label IN
            ('VIS001','VIS002','VIS003','VIS004','VIS005','VIS006')
          AND (
            b.source='admin'
            OR EXISTS (SELECT 1 FROM sport_center.gym_vis_card_reservations v
              WHERE v.booking_id=b.id AND v.payment_id=p.id
                AND v.device_serial=a.device_serial
                AND v.user_pin=a.user_pin AND v.device_uid=a.device_uid
                AND v.card_code=a.identity_label
                AND v.funds_verified_at IS NOT NULL
                AND (
                  (v.state IN ('collected','returned') AND v.collected_at IS NOT NULL
                    AND l.device_time>=to_char(v.collected_at AT TIME ZONE 'Asia/Jakarta',
                      'YYYY-MM-DD HH24:MI:SS'))
                  OR (v.state='reserved' AND v.collected_at IS NULL
                    AND e.evidence_status='protocol_verified')
                ))
          )
        )
      LIMIT 2`);
    if (rows.rows.length !== 1) {
      return { status: "held" as const, reason: "NO_EXACT_VERIFIED_HISTORICAL_SCAN" };
    }
    const row=rows.rows[0] as { booking_id:number; checked_in_at:Date|null; device_time:string };
    if (row.checked_in_at) {
      return { status: "already_checked_in" as const, reason: "ALREADY_RECORDED" };
    }
    const scanTime = new Date(String(row.device_time).replace(" ","T")+"+07:00");
    if (!Number.isFinite(scanTime.getTime())) {
      return { status: "held" as const, reason: "INVALID_SCAN_TIME" };
    }
    const changed=await tx.execute(sql`
      UPDATE sport_center.sport_bookings SET checked_in_at=${scanTime},
        updated_at=now()
      WHERE id=${input.bookingId} AND checked_in_at IS NULL
        AND status::text IN ('confirmed','completed')
      RETURNING id`);
    if (changed.rows.length !== 1) {
      return { status: "held" as const, reason: "CONCURRENT_CHANGE" };
    }
    await tx.execute(sql`
      INSERT INTO sport_center.booking_history
        (booking_id,from_status,to_status,changed_by_name,note)
      SELECT b.id,b.status::text,b.status::text,'QA historical X904 replay',
        ${'Historical verified X904 scan '+input.eventId+' / '+input.reviewReference}
      FROM sport_center.sport_bookings b WHERE b.id=${input.bookingId}`);
    await tx.execute(sql`
      INSERT INTO sport_center.audit_logs
        (action,entity,entity_id,user_role,"after")
      VALUES('X904_HISTORICAL_VERIFIED_CHECKIN_QA','booking',
        ${input.bookingId},'system',
        ${JSON.stringify({eventId:input.eventId,reviewReference:input.reviewReference,
          scanTime:scanTime.toISOString(),source:'verified_protocol_replay_qa'})}::jsonb)`);
    return { status: "recovered" as const, reason: "VERIFIED_SCAN_AND_ACK" };
  });
}