export type PaymentCaptureRow = {
  status?: string | null;
  paymentType?: string | null;
  amount?: number | string | null;
};

export type PaymentCaptureBooking = {
  groupRef?: string | null;
  groupPayments?: PaymentCaptureRow[] | null;
  groupTotalPayment?: number | string | null;
  groupNetTotalPayment?: number | string | null;
  grandTotal?: number | string | null;
  totalPrice?: number | string | null;
  downPayment?: number | string | null;
  status?: string | null;
};

export function getBookingPaymentCapture(
  booking: PaymentCaptureBooking,
  ownPayments: PaymentCaptureRow[],
) {
  // A group DP might belong to a different booking; use the entire group ledger.
  const groupHistoryReady = !booking.groupRef || Array.isArray(booking.groupPayments);
  const history = booking.groupRef ? booking.groupPayments ?? [] : ownPayments;
  const confirmed = history.filter((payment) => payment.status === "confirmed");
  const confirmedAmount = confirmed.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const hasConfirmedDp = confirmed.some((payment) => payment.paymentType === "dp");
  const pending = history.some((payment) => ["pending", "pending_payment", "waiting_confirmation"].includes(payment.status ?? ""));
  const total = booking.groupRef && Number(booking.groupNetTotalPayment ?? booking.groupTotalPayment) > 0
    ? Number(booking.groupNetTotalPayment ?? booking.groupTotalPayment)
    : Number(booking.grandTotal ?? booking.totalPrice ?? 0);
  const remaining = Math.max(0, Math.round(total - confirmedAmount));
  const configuredDp = Math.max(0, Number(booking.downPayment ?? 0));
  // A booking can become partially paid after an extension or price increase,
  // even when its first confirmed transaction was labelled "full_payment".
  // Never re-charge the original amount; collect only the verified shortfall.
  const hasConfirmedPartial = confirmedAmount > 0 && remaining > 0;
  const isSubsequentPayment = hasConfirmedPartial;
  const paymentType = isSubsequentPayment ? "pelunasan" : configuredDp > 0 ? "dp" : "full_payment";
  const amount = isSubsequentPayment ? remaining : configuredDp > 0 ? configuredDp : total;
  const allowedBookingStatus = ["pending_payment", "waiting_confirmation", "paid", "confirmed", "expired"].includes(booking.status ?? "");
  const canRecord =
    groupHistoryReady && Number.isFinite(total) && total > 0 &&
    Number.isFinite(confirmedAmount) && confirmedAmount >= 0 &&
    Number.isFinite(amount) && amount > 0 && remaining > 0 && !pending &&
    (hasConfirmedPartial ? allowedBookingStatus :
      confirmed.length === 0 && ["pending_payment", "expired"].includes(booking.status ?? ""));
  return { canRecord, paymentType, amount, total, remaining, confirmedAmount, hasConfirmedDp, hasConfirmedPartial, pending };
}
