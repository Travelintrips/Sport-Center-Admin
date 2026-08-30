import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const BOOKING_ORDER_SEQUENCE = "sport_center.booking_order_no_seq";

/**
 * Allocate a booking number from a database sequence.
 *
 * The sequence is initialized from existing SC-* rows while holding a
 * transaction-scoped advisory lock. This avoids the old session-scoped lock
 * problem with pooled connections and keeps concurrent requests unique.
 */
export async function generateBookingOrderNumber(): Promise<string> {
  const value = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(42003)`);
    await tx.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${BOOKING_ORDER_SEQUENCE}`));
    await tx.execute(sql.raw(`
      SELECT setval(
        '${BOOKING_ORDER_SEQUENCE}',
        GREATEST(
          COALESCE((
            SELECT MAX(substring(order_number FROM 4)::bigint)
            FROM sport_center.sport_bookings
            WHERE order_number ~ '^SC-[0-9]+$'
          ), 0),
          (SELECT last_value FROM ${BOOKING_ORDER_SEQUENCE})
        ),
        true
      )
    `));
    const result = await tx.execute(
      sql.raw(`SELECT nextval('${BOOKING_ORDER_SEQUENCE}') AS value`),
    );
    return Number(result.rows[0]?.value);
  });

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("BOOKING_ORDER_SEQUENCE_INVALID");
  }
  return `SC-${String(value).padStart(4, "0")}`;
}