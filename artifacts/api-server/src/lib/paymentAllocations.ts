import { db, paymentAllocationsTable, paymentsTable } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { calculateExactFinalAllocations } from "./groupFinalAllocation";

type GroupBookingAmount = {
  id: number;
  grandTotal?: string | number | null;
  totalPrice?: string | number | null;
};

/**
 * Split one group payment into display-only invoice allocations. Rounding is
 * assigned to the final booking so the allocation sum always equals the
 * canonical payment amount.
 */
export function calculateGroupPaymentAllocations(
  bookings: GroupBookingAmount[],
  paymentAmount: number,
): Array<{ bookingId: number; amount: string }> {
  if (bookings.length === 0) return [];
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error("GROUP_PAYMENT_ALLOCATION_AMOUNT_INVALID");
  }

  const bases = bookings.map((booking) => Math.max(
    0,
    Number(booking.grandTotal ?? booking.totalPrice ?? 0),
  ));
  const baseTotal = bases.reduce((sum, amount) => sum + amount, 0);
  if (baseTotal <= 0) throw new Error("GROUP_PAYMENT_ALLOCATION_BASE_INVALID");

  let remaining = Math.round(paymentAmount);
  return bookings.map((booking, index) => {
    const amount = index === bookings.length - 1
      ? remaining
      : Math.round(paymentAmount * (bases[index] / baseTotal));
    remaining -= amount;
    return { bookingId: booking.id, amount: String(amount) };
  });
}

export async function insertGroupPaymentAllocations(
  paymentId: number,
  bookings: GroupBookingAmount[],
  paymentAmount: number,
  paymentType?: string,
): Promise<void> {
  let allocations = calculateGroupPaymentAllocations(bookings, paymentAmount);
  if (paymentType === "pelunasan" && bookings.length > 0) {
    const previousConfirmed = await db
      .select({
        bookingId: paymentAllocationsTable.bookingId,
        amount: paymentAllocationsTable.amount,
      })
      .from(paymentAllocationsTable)
      .innerJoin(paymentsTable, eq(paymentAllocationsTable.paymentId, paymentsTable.id))
      .where(and(
        inArray(paymentAllocationsTable.bookingId, bookings.map((b) => b.id)),
        eq(paymentsTable.status, "confirmed"),
        ne(paymentsTable.id, paymentId),
      ));
    const exact = calculateExactFinalAllocations(bookings, previousConfirmed, Math.round(paymentAmount));
    if (exact) allocations = exact;
  }
  if (allocations.length === 0) return;
  await db.insert(paymentAllocationsTable).values(
    allocations.map((allocation) => ({
      paymentId,
      bookingId: allocation.bookingId,
      amount: allocation.amount,
    })),
  ).onConflictDoNothing();
}