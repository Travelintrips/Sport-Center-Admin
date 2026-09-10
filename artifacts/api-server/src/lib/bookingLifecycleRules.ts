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