export const CONFIRMABLE_BOOKING_STATUSES = [
  "pending_payment",
  "waiting_confirmation",
  "waiting_admin_approval",
  "paid",
] as const;

export function isBookingConfirmableStatus(status: string | null | undefined): boolean {
  return status != null && (CONFIRMABLE_BOOKING_STATUSES as readonly string[]).includes(status);
}

export function hasBookingSessionEnded(
  bookingDate: string,
  endTime: string,
  now: Date = new Date(),
): boolean {
  const normalizedEndTime = String(endTime || "").slice(0, 5);
  const end = new Date(`${bookingDate}T${normalizedEndTime}:00+07:00`);
  if (Number.isNaN(end.getTime())) return false;

  if (normalizedEndTime === "00:00") {
    end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return now.getTime() >= end.getTime();
}

export function hasBookingSessionStarted(
  bookingDate: string,
  startTime: string,
  now: Date = new Date(),
): boolean {
  const normalizedStartTime = String(startTime || "").slice(0, 5);
  const start = new Date(`${bookingDate}T${normalizedStartTime}:00+07:00`);
  if (Number.isNaN(start.getTime())) return false;
  return now.getTime() >= start.getTime();
}
/** An admin may close an ended booking without recording a fictitious check-in.
 * The reason is a mandatory audit statement, not attendance evidence. */
export function normalizeBookingCompletionExceptionReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 12 || normalized.length > 1000) return null;
  return normalized;
}

/**
 * X904 device timestamps are local WIB without a timezone suffix.
 * A door event is usage evidence only inside the booked session, never merely
 * because the access grant was activated or later suspended.
 */
export function isX904UsageWithinBookingSession(
  bookingDate: string,
  startTime: string,
  endTime: string,
  deviceTime: string,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) ||
      !/^\d{2}:\d{2}(?::\d{2})?$/.test(startTime) ||
      !/^\d{2}:\d{2}(?::\d{2})?$/.test(endTime) ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(deviceTime)) return false;
  const start = new Date(`${bookingDate}T${startTime.slice(0,5)}:00+07:00`);
  const end = new Date(`${bookingDate}T${endTime.slice(0,5)}:00+07:00`);
  const event = new Date(`${deviceTime.replace(" ", "T")}+07:00`);
  if (endTime.slice(0,5) === "00:00" || end.getTime() <= start.getTime())
    end.setTime(end.getTime() + 86_400_000);
  return [start,end,event].every(t=>Number.isFinite(t.getTime())) &&
    event.getTime() >= start.getTime() && event.getTime() < end.getTime();
}
