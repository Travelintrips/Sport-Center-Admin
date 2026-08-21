export function hasBookingSessionEnded(
  bookingDate: string,
  endTime: string,
  now: Date = new Date(),
): boolean {
  const normalizedEndTime = String(endTime || "").slice(0, 5);
  const end = new Date(`${bookingDate}T${normalizedEndTime}:00+07:00`);
  if (Number.isNaN(end.getTime())) return false;

  // The application represents midnight close as 00:00 on the booking day,
  // but that means the end of that day, not its beginning.
  if (normalizedEndTime === "00:00") {
    end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return now.getTime() >= end.getTime();
}