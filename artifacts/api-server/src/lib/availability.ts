import { db, bookingsTable, blockedSchedulesTable, facilitiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTimeStr(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// All hourly-booking facilities are available through midnight. Treat 00:00
// as the end of the same booking day rather than as an earlier time than the
// opening hour.
export function getEffectiveCloseTime(facility: {
  name?: string | null;
  category?: string | null;
  closeTime: string;
}): string {
  return "00:00";
}

export function closeTimeToMinutes(closeTime: string): number {
  const minutes = timeToMinutes(closeTime);
  return minutes === 0 ? 24 * 60 : minutes;
}

export async function getAvailableSlotsForDay(
  facilityId: number,
  date: string,
  openTime: string,
  closeTime: string
): Promise<string[]> {
  const bookings = await db
    .select({ startTime: bookingsTable.startTime, endTime: bookingsTable.endTime, status: bookingsTable.status })
    .from(bookingsTable)
    .where(and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, date)));
  const active = bookings.filter((b) => !INACTIVE_STATUSES.includes(b.status));

  const blocked = await db
    .select({ startTime: blockedSchedulesTable.startTime, endTime: blockedSchedulesTable.endTime })
    .from(blockedSchedulesTable)
    .where(and(eq(blockedSchedulesTable.facilityId, facilityId), eq(blockedSchedulesTable.date, date)));

  const openMin = timeToMinutes(openTime);
  const closeMin = closeTimeToMinutes(closeTime);
  const available: string[] = [];

  for (let t = openMin; t < closeMin; t += 60) {
    const slotEnd = t + 60;
    const busy =
      active.some((b) => {
        const bS = timeToMinutes(b.startTime);
        const bE = timeToMinutes(b.endTime);
        return t < bE && slotEnd > bS;
      }) ||
      blocked.some((b) => {
        const bS = timeToMinutes(b.startTime);
        const bE = timeToMinutes(b.endTime);
        return t < bE && slotEnd > bS;
      });
    if (!busy) available.push(minutesToTimeStr(t));
  }
  return available;
}

export async function checkSlotAvailable(
  facilityId: number,
  date: string,
  startTime: string,
  durationHours: number
): Promise<boolean> {
  const startMin = timeToMinutes(startTime);
  const endMin = startMin + durationHours * 60;
  const endTime = minutesToTimeStr(endMin);

  const existing = await db
    .select({ startTime: bookingsTable.startTime, endTime: bookingsTable.endTime, status: bookingsTable.status })
    .from(bookingsTable)
    .where(and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, date)));
  const sMin = timeToMinutes(startTime);
  const eMin = timeToMinutes(endTime);
  const conflict = existing
    .filter((b) => !INACTIVE_STATUSES.includes(b.status))
    .some((b) => {
      const bS = timeToMinutes(b.startTime);
      const bE = timeToMinutes(b.endTime);
      return sMin < bE && eMin > bS;
    });
  if (conflict) return false;

  const blocked = await db
    .select({ startTime: blockedSchedulesTable.startTime, endTime: blockedSchedulesTable.endTime })
    .from(blockedSchedulesTable)
    .where(and(eq(blockedSchedulesTable.facilityId, facilityId), eq(blockedSchedulesTable.date, date)));

  return !blocked.some((b) => {
    const bS = timeToMinutes(b.startTime);
    const bE = timeToMinutes(b.endTime);
    return sMin < bE && eMin > bS;
  });
}

// Alias olahraga → nama/kategori fasilitas di DB
// Lapangan Multiguna melayani Basket, Futsal, dan Voli dalam satu lapangan fisik
const FACILITY_ALIASES: Record<string, string> = {
  basket:    "multiguna",
  basketball: "multiguna",
  futsal:    "multiguna",
  voli:      "multiguna",
  volley:    "multiguna",
  volleyball: "multiguna",
  "bola voli": "multiguna",
  "bola basket": "multiguna",
};

export async function getFacilityByName(
  name: string
): Promise<typeof facilitiesTable.$inferSelect | null> {
  const all = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));
  const lower = name.toLowerCase().trim();
  // Resolusi alias dulu (basket/futsal/volley → multiguna)
  const resolved = FACILITY_ALIASES[lower] ?? lower;
  return (
    all.find(
      (f) =>
        f.name.toLowerCase() === resolved ||
        f.name.toLowerCase().includes(resolved) ||
        f.category.toLowerCase() === resolved ||
        f.category.toLowerCase().includes(resolved) ||
        // Fallback ke nama asli jika alias tidak cocok
        f.name.toLowerCase() === lower ||
        f.name.toLowerCase().includes(lower) ||
        f.category.toLowerCase() === lower ||
        f.category.toLowerCase().includes(lower)
    ) ?? null
  );
}
