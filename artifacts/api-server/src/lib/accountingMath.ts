export type BookingTaxAmounts = {
  totalPrice: string | number | null;
  dpp?: string | number | null;
  ppnAmount?: string | number | null;
  grandTotal?: string | number | null;
};

/**
 * Extract the pre-tax DPP from a booking whose customer-facing price is
 * inclusive of PPN.
 */
export function extractBookingDpp(booking: BookingTaxAmounts): {
  dpp: number;
  ppnAmount: number;
} {
  const ppnAmount = booking.ppnAmount != null ? Number(booking.ppnAmount) : 0;
  const grandTotalAmt =
    booking.grandTotal != null
      ? Number(booking.grandTotal)
      : Number(booking.totalPrice);
  const dpp =
    booking.dpp != null && Number(booking.dpp) > 0
      ? Number(booking.dpp)
      : ppnAmount > 0
        ? grandTotalAmt - ppnAmount
        : grandTotalAmt;
  return { dpp, ppnAmount };
}