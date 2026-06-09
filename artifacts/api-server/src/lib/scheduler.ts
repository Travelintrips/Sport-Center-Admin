import { db, bookingsTable, facilitiesTable, paymentsTable } from "@workspace/db";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { notifyBookingExpired, notifyReminderH1, notifyWaDayReminder, notifyWaStaffCheckin } from "./notifications";
import { createWaToken } from "./waTokens";

const APP_URL = process.env.APP_URL ?? "";

function getWIBNow(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function getTomorrowWIB(): string {
  const d = getWIBNow();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function getTodayWIB(): string {
  return getWIBNow().toISOString().split("T")[0];
}

async function expireOverdueBookings(): Promise<void> {
  try {
    const now = new Date();
    const overdue = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.status, "pending_payment"),
          isNotNull(bookingsTable.paymentDeadline),
          lt(bookingsTable.paymentDeadline, now)
        )
      );

    for (const booking of overdue) {
      await db
        .update(bookingsTable)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));

      const [facility] = await db
        .select({ name: facilitiesTable.name })
        .from(facilitiesTable)
        .where(eq(facilitiesTable.id, booking.facilityId))
        .limit(1);

      await notifyBookingExpired({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber,
        facilityName: facility?.name ?? "",
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      });

      console.log(`[scheduler] Expired booking ${booking.orderNumber}`);
    }
  } catch (err) {
    console.error("[scheduler] expireOverdueBookings error:", err);
  }
}

async function sendReminderH1(): Promise<void> {
  try {
    const tomorrow = getTomorrowWIB();
    const now = getWIBNow();
    const hour = now.getUTCHours();

    // Only send between 08:00-10:00 WIB (01:00-03:00 UTC)
    if (hour < 1 || hour > 3) return;

    const confirmed = await db
      .select()
      .from(bookingsTable)
      .where(and(eq(bookingsTable.bookingDate, tomorrow), eq(bookingsTable.status, "confirmed")));

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;

    for (const booking of confirmed) {
      await notifyReminderH1({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber,
        facilityName: facilityMap[booking.facilityId] ?? "",
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      });
    }
  } catch (err) {
    console.error("[scheduler] sendReminderH1 error:", err);
  }
}

// Day-of reminder: sent at 07:00-08:00 WIB (00:00-01:00 UTC) to confirmed bookings today
const dayReminderSentToday = new Set<number>();

async function sendDayOfReminder(): Promise<void> {
  try {
    const now = getWIBNow();
    const hour = now.getUTCHours();
    // 07:00-08:00 WIB = 00:00-01:00 UTC
    if (hour !== 0) return;

    const today = getTodayWIB();
    const confirmed = await db
      .select()
      .from(bookingsTable)
      .where(and(eq(bookingsTable.bookingDate, today), eq(bookingsTable.status, "confirmed")));

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;

    for (const booking of confirmed) {
      if (dayReminderSentToday.has(booking.id)) continue;
      dayReminderSentToday.add(booking.id);

      const statusUrl = `${APP_URL}/wa/status/${booking.orderNumber}`;
      const facilityName = facilityMap[booking.facilityId] ?? "";

      // Customer reminder
      await notifyWaDayReminder({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber,
        facilityName,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
        statusUrl,
      });

      // Staff checkin/finish links
      if (booking.source === "whatsapp") {
        const checkinToken = await createWaToken(booking.id, "checkin", 2);
        const finishToken = await createWaToken(booking.id, "finish", 2);
        await notifyWaStaffCheckin({
          orderNumber: booking.orderNumber,
          customerName: booking.customerName,
          facilityName,
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          checkinUrl: `${APP_URL}/wa/action/${checkinToken}`,
          finishUrl: `${APP_URL}/wa/action/${finishToken}`,
        });
      }
    }
  } catch (err) {
    console.error("[scheduler] sendDayOfReminder error:", err);
  }
}

async function autoCompleteBookings(): Promise<void> {
  try {
    const wibNow = getWIBNow();
    const todayWIB = wibNow.toISOString().split("T")[0];
    const nowHour = wibNow.getUTCHours();
    const nowMin = wibNow.getUTCMinutes();
    const nowMinutes = nowHour * 60 + nowMin;

    const confirmed = await db
      .select()
      .from(bookingsTable)
      .where(and(eq(bookingsTable.status, "confirmed"), eq(bookingsTable.bookingDate, todayWIB)));

    for (const booking of confirmed) {
      const [endH, endM] = booking.endTime.split(":").map(Number);
      const endMinutes = endH * 60 + endM;
      if (nowMinutes >= endMinutes) {
        await db
          .update(bookingsTable)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(bookingsTable.id, booking.id));
        console.log(`[scheduler] Auto-completed booking ${booking.orderNumber}`);
      }
    }
  } catch (err) {
    console.error("[scheduler] autoCompleteBookings error:", err);
  }
}

export function startScheduler(): void {
  console.log("[scheduler] Starting background scheduler...");

  // Run immediately on startup
  expireOverdueBookings();

  // Every 5 minutes: expire overdue bookings + auto-complete + reminders
  setInterval(async () => {
    await expireOverdueBookings();
    await autoCompleteBookings();
    await sendReminderH1();
    await sendDayOfReminder();
  }, 5 * 60 * 1000);
}
