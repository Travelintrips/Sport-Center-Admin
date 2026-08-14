import { Router } from "express";
import { db, facilitiesTable, bookingsTable, blockedSchedulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { verifyToken } from "../lib/auth";

const router = Router();

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const min = (m % 60).toString().padStart(2, "0");
  return `${h}:${min}`;
}

function getTodayWIB(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().split("T")[0];
}

function getCurrentMinutesWIB(): number {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

// The generated client uses /api/availability. Keep the older
// /api/bookings/availability path as an alias so already-open browser tabs
// and cached bundles do not turn an available day into a misleading empty
// state while they transition to the current contract.
router.get(["/availability", "/bookings/availability"], async (req, res) => {
  try {
    const facilityId = parseInt(req.query.facilityId as string);
    const date = req.query.date as string;

    if (!facilityId || !date) {
      res.status(400).json({ error: "facilityId and date required" });
      return;
    }

    // Cek apakah request dari admin/operator — boleh lihat/booking slot lewat
    let isAdminOverride = false;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const payload = verifyToken(authHeader.slice(7));
      if (payload?.role && payload.role !== "customer") {
        isAdminOverride = true;
      }
    }

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, facilityId)).limit(1);
    if (!facility) {
      res.status(404).json({ error: "Facility not found" });
      return;
    }

    // Gym has no hourly slots. Keep the name/category fallback for legacy
    // rows that were created before booking_mode was corrected to walk_in.
    const isGymFacility =
      /gym|fitness/i.test(facility.name ?? "") ||
      /gym|fitness/i.test(facility.category ?? "");
    if (facility.bookingMode === "walk_in" || isGymFacility) {
      res.json([]);
      return;
    }

    const bookings = await db.select().from(bookingsTable).where(
      and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, date))
    );
    const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];
    const activeBookings = bookings.filter((b) => !INACTIVE_STATUSES.includes(b.status));

    const blocked = await db.select().from(blockedSchedulesTable).where(
      and(eq(blockedSchedulesTable.facilityId, facilityId), eq(blockedSchedulesTable.date, date))
    );

    const openMinutes = timeToMinutes(facility.openTime);
    const closeMinutes = timeToMinutes(facility.closeTime);
    const slots: { time: string; available: boolean; reason: string | null }[] = [];

    const isToday = date === getTodayWIB();
    const nowMinutes = isToday ? getCurrentMinutesWIB() : -1;

    for (let t = openMinutes; t < closeMinutes; t += 60) {
      const timeStr = minutesToTime(t);
      const slotEnd = t + 60;

      // Hide/disable slots that have already passed today (dilewati untuk admin/operator)
      if (!isAdminOverride && isToday && t <= nowMinutes) {
        slots.push({ time: timeStr, available: false, reason: "Slot sudah lewat" });
        continue;
      }

      const bookedSlot = activeBookings.find((b) => {
        const bStart = timeToMinutes(b.startTime);
        const bEnd = timeToMinutes(b.endTime);
        return t < bEnd && slotEnd > bStart;
      });

      const blockedSlot = blocked.find((bl) => {
        const bStart = timeToMinutes(bl.startTime);
        const bEnd = timeToMinutes(bl.endTime);
        return t < bEnd && slotEnd > bStart;
      });

      slots.push({
        time: timeStr,
        available: !bookedSlot && !blockedSlot,
        reason: bookedSlot ? "Booked" : blockedSlot ? blockedSlot.reason : null,
      });
    }

    res.json(slots);
  } catch (err) {
    req.log.error({ err }, "Check availability error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
