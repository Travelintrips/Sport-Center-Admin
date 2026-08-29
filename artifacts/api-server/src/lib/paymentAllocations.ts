import { db, paymentAllocationsTable } from "@workspace/db";

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
): Promise<void> {
  const allocations = calculateGroupPaymentAllocations(bookings, paymentAmount);
  if (allocations.length === 0) return;
  await db.insert(paymentAllocationsTable).values(
    allocations.map((allocation) => ({
      paymentId,
      bookingId: allocation.bookingId,
      amount: allocation.amount,
    })),
  ).onConflictDoNothing();
}