/**
 * Corporate group fees may be edited after booking confirmation ONLY while
 * no payment, invoice, invoice PDF, or other financial lock exists.
 * A confirmed booking is not evidence that the invoice has been paid.
 */
export type GroupChargeBookingState = {
  status: string;
  payerType: string | null;
  companyCustomerId: number | null;
  billingStatus: string | null;
  companyInvoiceId: number | null;
  invoicePdfUrl: string | null;
  membershipPaymentId: number | null;
};
export function corporateGroupChargeBlocker(
  bookings: readonly GroupChargeBookingState[],
  options: { paymentCount: number; invoiceItemCount: number; groupStatus: string | null; overrideTotal: boolean },
): string | null {
  if (!bookings.length) return "Grup booking tidak ditemukan.";
  if (bookings.some(b => b.payerType !== "company" || b.companyCustomerId == null) ||
      new Set(bookings.map(b => b.companyCustomerId)).size !== 1)
    return "Hanya grup Corporate dari satu akun perusahaan yang didukung.";
  if (options.groupStatus !== "pending" || options.overrideTotal)
    return "Total atau status grup sudah dikunci untuk penagihan.";
  if (options.paymentCount > 0) return "Sudah terdapat pembayaran pada grup.";
  if (options.invoiceItemCount > 0) return "Booking sudah masuk rincian invoice perusahaan.";
  if (bookings.some(b => b.companyInvoiceId != null ||
    (b.billingStatus !== "unbilled" && b.billingStatus != null) ||
    Boolean(b.invoicePdfUrl) || b.membershipPaymentId != null))
    return "Sebagian booking sudah ditagih, memiliki PDF invoice, atau terhubung pembayaran.";
  if (bookings.some(b => b.status !== "confirmed"))
    return "Seluruh sesi Corporate harus confirmed dan belum ditagih.";
  return null;
}
