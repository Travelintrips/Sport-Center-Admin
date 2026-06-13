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
  const closeMin = timeToMinutes(closeTime);
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

export async function getFacilityByName(
  name: string
): Promise<typeof facilitiesTable.$inferSelect | null> {
  const all = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));
  const lower = name.toLowerCase().trim();
  return (
    all.find(
      (f) =>
        f.name.toLowerCase() === lower ||
        f.name.toLowerCase().includes(lower) ||
        f.category.toLowerCase() === lower ||
        f.category.toLowerCase().includes(lower)
    ) ?? null
  );
}
