import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { onConfirmedMembershipPaymentX904 } from "./x904MembershipPaymentHook";

/**
 * Opt-in, bounded repair sweep for missed confirmed-payment receipts.
 * This function only creates review outbox records; it cannot mutate X904,
 * membership status, payment records or identity mappings.
 * Call from an explicitly authorized DEV maintenance job, never a request poll.
 */
export async function replayMissedX904MembershipPayments(options: {
  today: string;
  limit?: number;
  afterMembershipId?: number;
}): Promise<{ scanned: number; created: number; duplicate: number; held: number; nextCursor: number | null; disabled: boolean }> {
  if (process.env.GYM_X904_MEMBERSHIP_RECONCILIATION_ENABLED !== "true")
    return { scanned: 0, created: 0, duplicate: 0, held: 0, nextCursor: null, disabled: true };
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(options.today))
    throw new Error("INVALID_REPLAY_DAY");
  const limit = Math.max(1, Math.min(50, options.limit ?? 25));
  const afterMembershipId = options.afterMembershipId ?? 0;
  if (!Number.isSafeInteger(afterMembershipId) || afterMembershipId < 0)
    throw new Error("INVALID_REPLAY_CURSOR");
  const found = await db.execute(sql`
    SELECT DISTINCT m.id, m.start_date, m.end_date, m.status::text AS status
      FROM sport_center.sport_memberships m
      JOIN sport_center.sport_membership_payments p ON p.membership_id=m.id
     WHERE m.id > ${afterMembershipId} AND p.status='confirmed' AND p.amount>0
       AND p.confirmed_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM sport_center.sport_bookings b
          WHERE b.membership_payment_id=p.id
       )
     ORDER BY m.id LIMIT ${limit}
  `);
  let created=0, duplicate=0, held=0;
  for (const row of found.rows) {
    const result = await onConfirmedMembershipPaymentX904({
      membershipId: Number(row.id),
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      membershipStatus: String(row.status),
      today: options.today,
    });
    if (result==="created") created++;
    else if (result==="duplicate") duplicate++;
    else held++;
  }
  return { scanned: found.rows.length, created, duplicate, held,
    nextCursor: found.rows.length === limit ? Number(found.rows[found.rows.length-1].id) : null,
    disabled: false };
}
