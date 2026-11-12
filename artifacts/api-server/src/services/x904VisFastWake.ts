import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { wakeX904PaidGymAfterConfirmation } from "./x904PaidGymFastWake";

type VisReadStore = Pick<typeof db, "execute">;

/** Wake the same guarded nonmember worker after witnessed VIS card collection.
 * The handover service has already committed the grant as verified. The
 * worker still requires confirmed payment/booking, matching UID, and a fresh
 * snapshot before issuing any machine command.
 */
export function wakeX904CollectedVisAfterHandover(
  collectionCommitted: boolean,
  wake: (eligible: boolean) => boolean = wakeX904PaidGymAfterConfirmation,
): boolean {
  if (!collectionCommitted) return false;
  return wake(true);
}

/** Existing admin VIS grants may already be verified without the newer
 * reservation/handover workflow. Wake only if a newly confirmed payment is
 * tied to a verified, pending VIS card grant. No grant/booking writes here.
 */
export async function wakeX904AdminVisAfterPayment(
  bookingId: number,
  paymentId: number,
  store: VisReadStore = db,
  wake: (eligible: boolean) => boolean = wakeX904PaidGymAfterConfirmation,
): Promise<boolean> {
  if (process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED !== "true" ||
      !Number.isSafeInteger(bookingId) || bookingId <= 0 ||
      !Number.isSafeInteger(paymentId) || paymentId <= 0) return false;
  const found = await store.execute(sql`
    SELECT 1 FROM sport_center.x904_nonmember_daily_access a
    JOIN sport_center.sport_bookings b ON b.id=a.booking_id
    JOIN sport_center.sport_payments p ON p.id=a.payment_id AND p.booking_id=b.id
    WHERE a.booking_id=${bookingId} AND a.payment_id=${paymentId}
      AND a.device_serial='TDBD234200545'
      AND a.identity_type='card'
      AND a.identity_label IN ('VIS001','VIS002','VIS003','VIS004','VIS005','VIS006')
      AND a.verification_state='verified' AND a.access_state='pending'
      AND a.activated_at IS NULL
      AND b.source='admin' AND b.status='confirmed'
      AND p.status='confirmed' AND p.confirmed_at IS NOT NULL
    LIMIT 1`);
  return found.rows.length === 1 ? wake(true) : false;
}
