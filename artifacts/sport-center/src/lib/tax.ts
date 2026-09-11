export interface InclusiveInvoiceTaxBreakdown {
  dpp: number;
  dppNilaiLain: number;
  ppnAmount: number;
  grandTotal: number;
}

export interface BookingWithholdingTaxInput {
  grossAmount: number;
  dpp: number;
  pphRate?: number | string | null;
  pphAmount?: number | string | null;
  netAmount?: number | string | null;
  ppnCollectedByCustomer?: boolean;
  ppnTreatment?: string | null;
}

/**
 * Use the booking tax snapshot for display, but recalculate an enabled PPh
 * from DPP so historical snapshots cannot show a stale amount.
 */
export function calculateBookingWithholdingTax(input: BookingWithholdingTaxInput) {
  const grossAmount = Math.max(0, Math.round(Number(input.grossAmount) || 0));
  const dpp = Math.max(0, Math.round(Number(input.dpp) || 0));
  const configuredRate = Math.max(0, Number(input.pphRate ?? 0) || 0);
  const storedAmount = Math.max(0, Math.round(Number(input.pphAmount ?? 0) || 0));
  const enabled = configuredRate > 0 || storedAmount > 0;
  const rate = configuredRate > 0
    ? configuredRate
    : (storedAmount > 0 && dpp > 0 ? Math.round((storedAmount / dpp) * 100) : 0);
  const amount = configuredRate > 0
    ? Math.round(dpp * configuredRate / 100)
    : storedAmount;
  const cashGross = input.ppnCollectedByCustomer || input.ppnTreatment === "collected_by_customer"
    ? dpp
    : grossAmount;
  const storedNet = input.netAmount == null ? null : Number(input.netAmount);
  const netAmount = enabled
    ? Math.max(0, Math.round(cashGross - amount))
    : (storedNet != null && Number.isFinite(storedNet)
      ? Math.max(0, Math.round(storedNet))
      : cashGross);

  return { enabled, rate, amount, grossAmount, dpp, cashGross, netAmount };
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