export const INACTIVE_BOOKING_STATUSES = [
  "cancelled",
  "expired",
  "rejected",
  "refunded",
] as const;

export interface SlotBooking {
  startTime: string;
  endTime: string;
  status?: string | null;
}

export interface SlotWindow {
  startTime: string;
  endTime: string;
}

/**
 * Switch the selected facility without resetting the rest of a booking draft.
 * Availability is validated by the caller for the target facility.
 */
export function switchBookingFacility<T extends { facilityId: number | null }>(
  draft: T,
  facilityId: number,
): T {
  return { ...draft, facilityId };
}

export type AlternativeBookingChoice = "facility" | "date" | "duration" | null;

export type AlternativeBookingDraftPatch = {
  bookingDate?: null;
  durationMinutes?: null;
  startTime?: null;
};

/**
 * Parse the explicit alternative menu and the natural-language replies Mina
 * commonly receives after showing a full slot.
 */
export function parseAlternativeBookingChoice(
  message: string,
  alternativeFacilityNames: string[] = [],
  options: { allowNumericMenu?: boolean } = {},
): AlternativeBookingChoice {
  const lower = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (options.allowNumericMenu) {
    if (lower === "1") return "facility";
    if (lower === "2") return "date";
    if (lower === "3") return "duration";
  }

  if (/(?:ganti|ubah|pindah|pilih).*(?:tanggal|hari)|tanggal\s+lain|hari\s+lain/.test(lower)) {
    return "date";
  }
  if (/(?:ganti|ubah|pilih).*(?:durasi|lama)|durasi\s+lain|waktu\s+sewa/.test(lower)) {
    return "duration";
  }

  const mentionsAlternativeFacility =
    alternativeFacilityNames.some((name) => lower.includes(name.toLowerCase())) ||
    /court\s*[a-z]\b|lapangan\s+(?:lain|[a-z]\b)|fasilitas\s+(?:lain|sejenis)/.test(lower) ||
    /ada\s+(?:court|lapangan|fasilitas)\s+lain|yang\s+lain/.test(lower) ||
    /^(?:tidak|nggak|ngga|gak|ga|belum)\s+(?:cocok|pas|mau|setuju)/.test(lower);
  return mentionsAlternativeFacility ? "facility" : null;
}

export function formatAlternativeFacilityOptions(
  alternativeFacilityNames: string[],
): string {
  const label = alternativeFacilityNames.length > 0
    ? `Lihat slot ${alternativeFacilityNames.join(" atau ")}`
    : "Lihat fasilitas sejenis lainnya";
  return [
    `1. ${label}`,
    "2. Ganti tanggal",
    "3. Ganti durasi",
  ].join("\n");
}

export function getAlternativeBookingDraftPatch(
  choice: AlternativeBookingChoice,
): AlternativeBookingDraftPatch {
  if (choice === "date") return { bookingDate: null, startTime: null };
  if (choice === "duration") return { durationMinutes: null, startTime: null };
  return {};
}

export function isRecentMessageDuplicate(
  seen: Map<string, number>,
  key: string,
  now: number,
  ttlMs = 8_000,
): boolean {
  const previous = seen.get(key);
  if (previous !== undefined && now - previous < ttlMs) return true;
  seen.set(key, now);
  return false;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function overlaps(
  startMinutes: number,
  endMinutes: number,
  window: SlotWindow,
): boolean {
  return (
    startMinutes < timeToMinutes(window.endTime) &&
    endMinutes > timeToMinutes(window.startTime)
  );
}

export function hasSlotConflict(params: {
  startTime: string;
  endTime: string;
  bookings: SlotBooking[];
  blockedSchedules: SlotWindow[];
}): boolean {
  const start = timeToMinutes(params.startTime);
  const end = timeToMinutes(params.endTime);
  const activeBookings = params.bookings.filter(
    (booking) =>
      !booking.status ||
      !INACTIVE_BOOKING_STATUSES.includes(
        booking.status as (typeof INACTIVE_BOOKING_STATUSES)[number],
      ),
  );
  return (
    activeBookings.some((booking) => overlaps(start, end, booking)) ||
    params.blockedSchedules.some((schedule) => overlaps(start, end, schedule))
  );
}

/**
 * Returns the closest available hourly starts for a requested duration.
 * Bookings with inactive lifecycle statuses and blocked schedules are both
 * excluded, matching the canonical availability/conflict rules.
 */
export function getNearestAvailableSlots(params: {
  requestedStartTime: string;
  durationMinutes: number;
  openTime: string;
  closeTime: string;
  bookings: SlotBooking[];
  blockedSchedules: SlotWindow[];
  limit?: number;
}): string[] {
  const requestedStart = timeToMinutes(params.requestedStartTime);
  const open = timeToMinutes(params.openTime);
  const close = timeToMinutes(params.closeTime);
  const limit = params.limit ?? 3;
  const activeBookings = params.bookings.filter(
    (booking) =>
      !booking.status ||
      !INACTIVE_BOOKING_STATUSES.includes(
        booking.status as (typeof INACTIVE_BOOKING_STATUSES)[number],
      ),
  );
  const candidates: number[] = [];

  for (
    let start = open;
    start + params.durationMinutes <= close;
    start += 60
  ) {
    if (start !== requestedStart) candidates.push(start);
  }

  candidates.sort(
    (left, right) =>
      Math.abs(left - requestedStart) - Math.abs(right - requestedStart),
  );

  const available: string[] = [];
  for (const start of candidates) {
    const end = start + params.durationMinutes;
    const hasConflict = hasSlotConflict({
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
      bookings: activeBookings,
      blockedSchedules: params.blockedSchedules,
    });
    if (!hasConflict) {
      available.push(`${minutesToTime(start)}–${minutesToTime(end)}`);
      if (available.length >= limit) break;
    }
  }
  return available;
}