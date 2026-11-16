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
  const rows = await store.execute(sql`SELECT b.id booking_id,b.order_number,b.source,
      CASE WHEN a.access_id IS NULL THEN 'PAID_NO_GRANT'
           WHEN a.access_state='review_required' THEN 'PAID_HELD_GRANT'
           ELSE NULL END issue
    FROM sport_center.sport_bookings b
    JOIN sport_center.sport_payments p ON p.booking_id=b.id
    LEFT JOIN sport_center.x904_nonmember_daily_access a ON a.booking_id=b.id
    WHERE b.facility_id=6 AND b.source IN ('gym_public_guest','admin')
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
      AND (a.access_id IS NULL OR a.access_state='review_required')
    ORDER BY p.confirmed_at,b.id LIMIT 30`);
  let count=0;
  const nowMs=now.getTime();
  for (const raw of rows.rows as any[]) {
    if (raw.issue !== 'PAID_NO_GRANT' && raw.issue !== 'PAID_HELD_GRANT') continue;
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
