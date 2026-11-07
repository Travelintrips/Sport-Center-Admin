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
  const pending = history.some((payment) => payment.status === "pending");
  const total = booking.groupRef && Number(booking.groupNetTotalPayment ?? booking.groupTotalPayment) > 0
    ? Number(booking.groupNetTotalPayment ?? booking.groupTotalPayment)
    : Number(booking.grandTotal ?? booking.totalPrice ?? 0);
  const remaining = Math.max(0, Math.round(total - confirmedAmount));
  const configuredDp = Math.max(0, Number(booking.downPayment ?? 0));
  const paymentType = hasConfirmedDp ? "pelunasan" : configuredDp > 0 ? "dp" : "full_payment";
  const amount = hasConfirmedDp ? remaining : configuredDp > 0 ? configuredDp : total;
  const canRecord =
    groupHistoryReady && Number.isFinite(amount) && amount > 0 && remaining > 0 && !pending &&
    ((confirmed.length === 0 && ["pending_payment", "expired"].includes(booking.status ?? "")) ||
      (hasConfirmedDp && ["pending_payment", "expired", "confirmed"].includes(booking.status ?? "")));
  return { canRecord, paymentType, amount, total, remaining, confirmedAmount, hasConfirmedDp, pending };
}
