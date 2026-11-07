export type BookingForFinalAllocation = {
  id: number;
  grandTotal?: string | number | null;
  totalPrice?: string | number | null;
};
export type ExistingGroupAllocation = { bookingId: number; amount: string | number };

/**
 * If a final payment exactly covers the per-session remaining balances, use
 * those balances rather than a second proportional rounding pass.
 * Returns null when the group invoice has discounts/taxes not represented by
 * booking grandTotal, in which case the existing proportional method applies.
 */
export function calculateExactFinalAllocations(
  bookings: BookingForFinalAllocation[],
  previousConfirmed: ExistingGroupAllocation[],
  settlementAmount: number,
): Array<{ bookingId: number; amount: string }> | null {
  if (!Number.isSafeInteger(settlementAmount) || settlementAmount <= 0 || bookings.length === 0) return null;
  if (!previousConfirmed.length) return null;
  const paid = new Map<number, number>();
  for (const item of previousConfirmed) {
    const amount = Number(item.amount);
    if (!Number.isSafeInteger(amount) || amount < 0) return null;
    paid.set(item.bookingId, (paid.get(item.bookingId) ?? 0) + amount);
  }
  const allocations = bookings.map((booking) => {
    const due = Number(booking.grandTotal ?? booking.totalPrice ?? 0);
    if (!Number.isSafeInteger(due) || due < 0) return null;
    const remaining = due - (paid.get(booking.id) ?? 0);
    if (!Number.isSafeInteger(remaining) || remaining < 0) return null;
    return { bookingId: booking.id, amount: String(remaining) };
  });
  if (allocations.some((a) => a == null)) return null;
  const exact = allocations as Array<{ bookingId: number; amount: string }>;
  return exact.reduce((sum, a) => sum + Number(a.amount), 0) === settlementAmount ? exact : null;
}
