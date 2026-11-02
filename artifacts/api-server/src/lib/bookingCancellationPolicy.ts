export type BookingCancellationDecision =
  | { allowed: true }
  | { allowed: false; kind: "terminal_status" }
  | { allowed: false; kind: "payment_confirmed" }
  | { allowed: false; kind: "payment_pending" }
  | { allowed: false; kind: "membership_payment" }
  | { allowed: false; kind: "company_invoice" };

/**
 * Cancellation is only a no-payment administrative action.
 * Any confirmed/active payment must use the refund flow; linked invoices
 * and membership payment records must be resolved in their own workflows.
 */
export function evaluateBookingCancellation(input: {
  bookingStatuses: string[];
  paymentStatuses: string[];
  membershipPaymentStatuses: string[];
  invoiceNumbers: string[];
  groupStatus?: string | null;
}): BookingCancellationDecision {
  if (input.bookingStatuses.some((status) =>
    ["completed", "refunded", "expired", "rejected"].includes(status),
  )) {
    return { allowed: false, kind: "terminal_status" };
  }

  if (input.groupStatus === "paid" || input.paymentStatuses.includes("confirmed")) {
    return { allowed: false, kind: "payment_confirmed" };
  }

  if (input.paymentStatuses.some((status) =>
    ["pending", "waiting_confirmation", "processing"].includes(status),
  )) {
    return { allowed: false, kind: "payment_pending" };
  }

  if (input.bookingStatuses.some((status) =>
    ["paid", "confirmed", "waiting_confirmation"].includes(status),
  )) {
    return { allowed: false, kind: "terminal_status" };
  }

  if (input.membershipPaymentStatuses.some((status) => status !== "cancelled")) {
    return { allowed: false, kind: "membership_payment" };
  }

  if (input.invoiceNumbers.length > 0) {
    return { allowed: false, kind: "company_invoice" };
  }

  return { allowed: true };
}
