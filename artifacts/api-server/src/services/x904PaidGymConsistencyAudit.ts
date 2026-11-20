import type { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { x904NonmemberOpeningHours } from "./x904NonmemberAccessPolicy";

// Runtime audit is read-only. PASS in CI does not prove a paid real-world
// booking has a physical-device entitlement. Never log PIN/phone/proof/name.
const lastPaidGymAnomalyLog = new Map<string, number>();
const PAID_GYM_ANOMALY_LOG_INTERVAL_MS = 15 * 60_000;

export async function auditPaidGymEntitlementConsistency(
  store: Pick<typeof db, "execute">, now = new Date(),
  log: (event: string) => void = (event) => console.error(event),
): Promise<number> {
  if (!x904NonmemberOpeningHours(now)) return 0;
  const rows = await store.execute(sql`SELECT booking_id,order_number,source,issue FROM (
    SELECT b.id booking_id,b.order_number,b.source,p.confirmed_at,
      CASE WHEN a.access_id IS NULL THEN 'PAID_NO_GRANT'
           WHEN a.access_state='review_required' THEN 'PAID_HELD_GRANT'
           WHEN a.access_state='pending' AND a.verification_state='verified'
             AND a.activated_at IS NULL AND a.payment_id=p.id
             -- Public VIS can be ready before collection. Match the existing
             -- reservation gate; never invent or record a physical handover.
             AND (NOT (b.source='gym_public_guest' AND a.identity_type='card'
                       AND COALESCE(b.notes,'') LIKE '%Kartu VIS001–VIS006 menunggu pilihan%')
                  OR vis.ready_at IS NOT NULL)
             -- Normal ACK reconciliation waits for a newer ~3-minute snapshot.
             -- Count five minutes only after this grant is eligible, including
             -- opening time, a newly ready VIS, and a late PIN attestation.
             AND GREATEST(p.confirmed_at,a.created_at,
                   (b.booking_date::date + time '06:00') AT TIME ZONE 'Asia/Jakarta',
                   vis.ready_at,eligibility.verified_at) <= ${now}::timestamptz - interval '5 minutes'
             THEN 'PAID_PENDING_GRANT'
           ELSE NULL END issue
    FROM sport_center.sport_bookings b
    JOIN sport_center.sport_payments p ON p.booking_id=b.id
    LEFT JOIN sport_center.x904_nonmember_daily_access a ON a.booking_id=b.id
    LEFT JOIN LATERAL (
      SELECT max(CASE WHEN r.state='collected' THEN r.collected_at
                      ELSE GREATEST(r.reserved_at,r.funds_verified_at) END) ready_at
      FROM sport_center.gym_vis_card_reservations r
      WHERE b.source='gym_public_guest' AND a.identity_type='card'
        AND COALESCE(b.notes,'') LIKE '%Kartu VIS001–VIS006 menunggu pilihan%'
        AND r.booking_id=b.id AND r.payment_id=p.id AND r.payment_id=a.payment_id
        AND r.device_serial=a.device_serial AND r.card_code=a.identity_label
        AND r.user_pin=a.user_pin AND r.device_uid=a.device_uid
        AND ((r.state='collected' AND r.collected_at IS NOT NULL)
             OR (r.state='reserved' AND r.collected_at IS NULL
                 AND r.funds_verified_at IS NOT NULL))
    ) vis ON true
    LEFT JOIN LATERAL (
      SELECT max(l.created_at) verified_at
      FROM sport_center.audit_logs l
      WHERE a.identity_type='pin' AND l.entity='booking' AND l.entity_id=b.id
        AND l.action IN ('x904_guest_pin_staff_attestation',
                         'x904_guest_pin_payment_auto_authorized',
                         'x904_guest_pin_payment_auto_recovered',
                         'x904_guest_pin_post_enrollment_auto_recovered')
        AND l."after"->>'accessId'=a.access_id::text
        AND l."after"->>'paymentId'=p.id::text
        AND l."after"->>'accessState'='pending'
        AND l.created_at<=${now}::timestamptz
    ) eligibility ON true
    WHERE b.facility_id=6 AND b.source IN ('gym_public_guest','admin')
      AND b.membership_id IS NULL AND b.membership_payment_id IS NULL
      AND p.source_membership_payment_id IS NULL
      AND b.status::text IN ('confirmed','completed')
      AND b.booking_date::date=(${now}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
      AND p.status::text='confirmed' AND p.confirmed_at IS NOT NULL
      AND p.confirmed_at <= ${now}::timestamptz - interval '2 minutes'
      -- A confirmed payment with a missing proof is still a paid booking
      -- that must not silently lose its X904 entitlement.
      AND p.amount>=COALESCE(b.grand_total,b.total_price)
      AND COALESCE(b.grand_total,b.total_price)>0
      AND (b.source='gym_public_guest' OR
           (b.source='admin' AND
             (a.access_id IS NOT NULL OR b.notes ILIKE '%X904%')))
      AND (a.access_id IS NULL OR a.access_state IN ('review_required','pending'))
    ) anomalies WHERE issue IS NOT NULL
    ORDER BY confirmed_at,booking_id LIMIT 30`);
  let count=0;
  const nowMs=now.getTime();
  for (const raw of rows.rows as any[]) {
    if (!['PAID_NO_GRANT','PAID_HELD_GRANT','PAID_PENDING_GRANT'].includes(raw.issue)) continue;
    const bookingId=Number(raw.booking_id);
    if (!Number.isSafeInteger(bookingId) || bookingId<=0) continue;
    count++;
    const key=String(raw.issue)+':'+bookingId;
    if (nowMs-(lastPaidGymAnomalyLog.get(key)??-Infinity) < PAID_GYM_ANOMALY_LOG_INTERVAL_MS) continue;
    lastPaidGymAnomalyLog.set(key,nowMs);
    log('[gym-x904-consistency] '+JSON.stringify({
      issue:raw.issue,bookingId,orderNumber:String(raw.order_number),
      source:String(raw.source),paymentConfirmed:true,action:'review_existing_booking_no_new_payment',
    }));
  }
  if (lastPaidGymAnomalyLog.size>250) {
    for (const [key,at] of lastPaidGymAnomalyLog) {
      if (nowMs-at>PAID_GYM_ANOMALY_LOG_INTERVAL_MS) lastPaidGymAnomalyLog.delete(key);
    }
  }
  return count;
}
