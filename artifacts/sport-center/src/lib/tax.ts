export interface InclusiveInvoiceTaxBreakdown {
  dpp: number;
  dppNilaiLain: number;
  ppnAmount: number;
  grandTotal: number;
}

/**
 * Harga pemakaian sudah termasuk PPN efektif 11%.
 * Invoice menampilkan PPN sebagai DPP Nilai Lain × 12%.
 */
export function calculateInclusiveInvoiceTax(
  totalAmountInclusive: number,
): InclusiveInvoiceTaxBreakdown {
  const grandTotal = Math.max(0, Math.round(Number(totalAmountInclusive) || 0));
  const dpp = Math.round(grandTotal / 1.11);
  const dppNilaiLain = Math.round(dpp * 11 / 12);
  const ppnAmount = Math.round(dppNilaiLain * 0.12);
  return { dpp, dppNilaiLain, ppnAmount, grandTotal };
}

export function isAdditiveLegacyTaxSnapshot(booking: {
  totalPrice?: number | string | null;
  grandTotal?: number | string | null;
  ppnAmount?: number | string | null;
}) {
  const totalPrice = Math.max(0, Math.round(Number(booking.totalPrice ?? 0)));
  const grandTotal = Math.round(Number(booking.grandTotal ?? totalPrice));
  const ppnAmount = Math.max(0, Math.round(Number(booking.ppnAmount ?? 0)));
  return (
    totalPrice > 0 &&
    ppnAmount > 0 &&
    grandTotal > totalPrice &&
    Math.abs(grandTotal - totalPrice - ppnAmount) <= 1
  );
}