import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Only completed paid visits with an independently recorded X904 scan qualify.
 * A machine activation alone is never check-in evidence. The source is the
 * device's append-only LAN log, not a manually edited booking status.
 */
export async function processX904GuestBookingLifecycle(store: Pick<typeof db,"execute"> = db, now = new Date()) {
  if (process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED !== "true") return;
  const result = await store.execute(sql`
    WITH eligible AS (
      SELECT b.id, min((l.device_time::timestamp AT TIME ZONE 'Asia/Jakarta')) AS scan_at
      FROM sport_center.sport_bookings b
      JOIN sport_center.x904_nonmember_daily_access a ON a.booking_id=b.id
      JOIN sport_center.sport_payments p ON p.id=a.payment_id
      JOIN sport_center.gym_x904_lan_logs l ON l.device_serial=a.device_serial
        AND l.user_pin=a.user_pin AND l.device_uid=a.device_uid
      WHERE b.source='gym_public_guest' AND b.status='confirmed'
        AND b.checked_in_at IS NULL AND b.completed_at IS NULL
        AND a.verification_state='verified' AND a.access_state='expired'
        AND a.activated_at IS NOT NULL AND a.expires_at <= ${now}
        AND p.status='confirmed'
        AND l.device_time::timestamp AT TIME ZONE 'Asia/Jakarta' >= a.activated_at
        AND l.device_time::timestamp AT TIME ZONE 'Asia/Jakarta' < a.expires_at
        AND EXISTS (SELECT 1 FROM sport_center.x904_user_commands c
          WHERE c.device_serial=a.device_serial AND c.user_pin=a.user_pin
            AND c.command_type='SUSPEND_USER' AND c.state='completed'
            AND c.result->>'readBackConfirmed'='true' AND c.result->>'afterGroup'='2'
            AND c.completed_at>=a.expires_at)
        AND (b.booking_date || ' ' || b.end_time)::timestamp AT TIME ZONE 'Asia/Jakarta' <= ${now}
      GROUP BY b.id
    )
    UPDATE sport_center.sport_bookings b SET
      checked_in_at=eligible.scan_at,completed_at=${now},status='completed'
    FROM eligible WHERE b.id=eligible.id AND b.status='confirmed'
    RETURNING b.id,b.order_number,b.checked_in_at,b.completed_at
  `);
  return result.rows;
}

export function startX904GuestBookingLifecycle() {
  if (process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED !== "true") return;
  let running=false;
  const tick=async()=>{
    if(running)return;
    running=true;
    try { await processX904GuestBookingLifecycle(); }
    catch(e) { console.error('[x904-guest-booking-lifecycle] cycle failed',e); }
    finally { running=false; }
  };
  void tick();
  const timer=setInterval(()=>void tick(),60_000);
  timer.unref();
}
