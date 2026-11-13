/** Display-only resolution gate: never issues X904 commands or financial changes. */
export function x904BookedGymDayClosed(bookingDate: unknown, now = new Date()): boolean {
  const day = typeof bookingDate === "string" ? bookingDate.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(now.getTime())) return false;
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const today = wib.toISOString().slice(0, 10);
  if (day < today) return true;
  if (day > today) return false;
  return wib.getUTCHours() >= 23;
}
export function x904PaidPinNeedsResolution(input: {
  bookingDate: unknown; identityType: unknown; paymentStatus: unknown; activatedAt: unknown;
}, now = new Date()): boolean {
  return input.identityType === "pin" && input.paymentStatus === "confirmed" &&
    !input.activatedAt && x904BookedGymDayClosed(input.bookingDate, now);
}
