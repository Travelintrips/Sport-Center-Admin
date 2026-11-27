/** Strict WIB court admission window. No walk-in or overnight extension. */
export function x904CourtAccessWindow(date: string, start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parse = (s: string) => {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
    const value = `${date}T${s.length === 5 ? s + ':00' : s}`;
    const instant = new Date(value + '+07:00');
    if (!Number.isFinite(instant.getTime()) || new Date(instant.getTime() + 7 * 3600000).toISOString().slice(0,19) !== value) return null;
    return instant;
  };
  const from = parse(start), until = parse(end);
  if (!from || !until || until <= from || start < '06:00' || end > '23:00:00') return null;
  return { from, until };
}
export function x904CourtAdmissionAllowed(input: { date: string; start: string; end: string; now: Date; confirmedAt: Date | null; paymentStatus: string; bookingStatus: string; verified: boolean }) {
  const window = x904CourtAccessWindow(input.date, input.start, input.end);
  const now = input.now.getTime(), paid = input.confirmedAt?.getTime();
  return !!window && input.verified && input.paymentStatus === 'confirmed' && input.bookingStatus === 'confirmed' && paid !== undefined && Number.isFinite(paid) && now >= paid && now >= window.from.getTime() && now < window.until.getTime();
}
