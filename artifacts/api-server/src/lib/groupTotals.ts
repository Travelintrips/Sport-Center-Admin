import { db, bookingGroupsTable, bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Keep a group's effective gross total in sync with its sessions unless the
 * group has an explicit invoice total override. The override is intentionally
 * stored separately from totalPayment so later session edits cannot erase an
 * agreed invoice amount.
 */
export async function syncBookingGroupTotal(groupRef: string): Promise<number | null> {
  const [group] = await db
    .select({
      totalPaymentOverride: bookingGroupsTable.totalPaymentOverride,
    })
    .from(bookingGroupsTable)
    .where(eq(bookingGroupsTable.groupRef, groupRef))
    .limit(1);

  if (!group) return null;

  const total = group.totalPaymentOverride != null
    ? Number(group.totalPaymentOverride)
    : (
      await db
        .select({
          totalPrice: bookingsTable.totalPrice,
          grandTotal: bookingsTable.grandTotal,
        })
        .from(bookingsTable)
        .where(eq(bookingsTable.groupRef, groupRef))
    ).reduce(
      // totalPrice is the canonical PPN-inclusive selling price. Some legacy
      // rows still have grandTotal = totalPrice + ppnAmount, so preferring
      // grandTotal would double-count PPN at group level.
      (sum, row) => sum + Number(row.totalPrice ?? row.grandTotal ?? 0),
      0,
    );

  await db
    .update(bookingGroupsTable)
    .set({ totalPayment: String(Math.max(0, Math.round(total))), updatedAt: new Date() })
    .where(eq(bookingGroupsTable.groupRef, groupRef));

  return Math.max(0, Math.round(total));
}