const TERMINAL_PROVIDER_PAYMENT_STATUSES = new Set(["FAILED", "CANCELLED", "EXPIRED"]);

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * A locally successful Paylabs transaction is not necessarily fully reflected
 * in the booking after a master/child sync or an interrupted old finalizer.
 * It must be repaired through the canonical finalizer before inquiry is
 * skipped.
 */
export function shouldRepairSuccessfulPaylabsBooking(
  transactionStatus: unknown,
  bookingStatus: unknown,
): boolean {
  return normalizeStatus(transactionStatus) === "SUCCESS"
    && normalizeStatus(bookingStatus) !== "CONFIRMED"
    && !["CANCELLED", "EXPIRED", "REJECTED", "REFUNDED"].includes(normalizeStatus(bookingStatus));
}

/**
 * Failed provider states are terminal for inquiry purposes. SUCCESS is
 * deliberately excluded because it can represent a locally stale booking.
 */
export function shouldSkipPaylabsInquiry(transactionStatus: unknown): boolean {
  return TERMINAL_PROVIDER_PAYMENT_STATUSES.has(normalizeStatus(transactionStatus));
}
