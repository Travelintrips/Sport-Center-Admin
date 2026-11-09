/**
 * A new *additional* payment can be recorded against a booking whose first
 * payment was confirmed before its price grew (e.g. extra booking hours).
 * Public booking-payment creation must not be allowed to reopen a confirmed
 * booking; a verified Sport Center operator session is required.
 */
export function canRecordConfirmedBookingOutstandingPayment(input: {
  bookingStatus: string;
  confirmedAmount: number;
  billedAmount: number;
  actorRole: string | null;
  hasUnconfirmedPayment: boolean;
}): boolean {
  return input.bookingStatus === "confirmed" &&
    ["owner", "super_admin", "admin", "finance", "admin_booking", "staff"].includes(input.actorRole ?? "") &&
    Number.isFinite(input.confirmedAmount) &&
    Number.isFinite(input.billedAmount) &&
    input.confirmedAmount > 0 &&
    input.billedAmount > input.confirmedAmount &&
    !input.hasUnconfirmedPayment;
}
