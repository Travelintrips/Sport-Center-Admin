import { db, bookingsTable, bookingHistoryTable, rescheduleRequestsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logAudit } from "./auditLog";

export type BookingLifecycleActor = {
  userId?: number | null;
  userName?: string | null;
  userRole?: string | null;
};

export type LifecycleResult =
  | { ok: true; bookingId: number; alreadyCompleted: boolean }
  | { ok: false; reason: string };

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

function todayJakarta(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

async function hasPendingReschedule(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], bookingId: number): Promise<boolean> {
  const [request] = await tx
    .select({ id: rescheduleRequestsTable.id })
    .from(rescheduleRequestsTable)
    .where(and(
      eq(rescheduleRequestsTable.bookingId, bookingId),
      eq(rescheduleRequestsTable.status, "pending"),
    ))
    .limit(1);
  return !!request;
}

/**
 * The only write path for turning an active booking into completed.
 * Payment/billing state is intentionally not consulted here.
 */
export async function completeBooking(
  bookingId: number,
  actor: BookingLifecycleActor,
  now: Date = new Date(),
): Promise<LifecycleResult> {
  let audit: { before: string; after: string } | null = null;

  const result = await db.transaction(async (tx): Promise<LifecycleResult> => {
    const [booking] = await tx
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);

    if (!booking) return { ok: false, reason: "Booking tidak ditemukan" };
    if (booking.status === "completed") {
      return { ok: true, bookingId, alreadyCompleted: true };
    }
    if (["cancelled", "expired", "rejected", "refunded"].includes(booking.status)) {
      return { ok: false, reason: "Booking sudah tidak aktif" };
    }
    if (booking.status !== "confirmed") {
      return { ok: false, reason: "Booking harus berstatus confirmed sebelum diselesaikan" };
    }
    if (!booking.checkedInAt) {
      return { ok: false, reason: "Booking belum check-in" };
    }
    if (!hasBookingSessionEnded(booking.bookingDate, booking.endTime, now)) {
      return { ok: false, reason: "Sesi booking belum selesai" };
    }
    if (await hasPendingReschedule(tx, bookingId)) {
      return { ok: false, reason: "Booking memiliki reschedule yang masih menunggu persetujuan" };
    }

    const [updated] = await tx
      .update(bookingsTable)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.status, "confirmed")))
      .returning({ id: bookingsTable.id });
    if (!updated) return { ok: false, reason: "Booking berubah diproses oleh operator lain" };

    await tx.insert(bookingHistoryTable).values({
      bookingId,
      fromStatus: booking.status,
      toStatus: "completed",
      changedBy: actor.userId ?? null,
      changedByName: actor.userName ?? "system",
      note: "Booking completed setelah check-in dan waktu sesi berakhir",
    });
    audit = { before: booking.status, after: "completed" };
    return { ok: true, bookingId, alreadyCompleted: false };
  });

  if (result.ok && !result.alreadyCompleted && audit) {
    await logAudit({
      ...actor,
      action: "BOOKING_COMPLETED",
      entity: "booking",
      entityId: bookingId,
      before: { status: audit.before },
      after: { status: audit.after, completedAt: now.toISOString(), reason: "checked_in_and_session_ended" },
    });
  }
  return result;
}

/**
 * Shared check-in write path for admin and WhatsApp.
 * It is idempotent at the database update boundary and records the actor.
 */
export async function checkInBooking(
  bookingId: number,
  actor: BookingLifecycleActor,
  now: Date = new Date(),
): Promise<LifecycleResult> {
  const result = await db.transaction(async (tx): Promise<LifecycleResult> => {
    const [booking] = await tx
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);
    if (!booking) return { ok: false, reason: "Booking tidak ditemukan" };
    if (booking.checkedInAt) return { ok: false, reason: "Booking sudah check-in" };
    if (booking.status !== "confirmed") {
      return { ok: false, reason: "Check-in hanya bisa dilakukan untuk booking yang sudah dikonfirmasi" };
    }
    if (booking.bookingDate !== todayJakarta(now)) {
      return { ok: false, reason: "Check-in hanya bisa dilakukan pada hari H booking" };
    }
    if (await hasPendingReschedule(tx, bookingId)) {
      return { ok: false, reason: "Booking memiliki reschedule yang masih menunggu persetujuan" };
    }

    const [updated] = await tx
      .update(bookingsTable)
      .set({ checkedInAt: now, updatedAt: now })
      .where(and(
        eq(bookingsTable.id, bookingId),
        eq(bookingsTable.status, "confirmed"),
      ))
      .returning({ id: bookingsTable.id });
    if (!updated) return { ok: false, reason: "Booking berubah diproses oleh operator lain" };

    await tx.insert(bookingHistoryTable).values({
      bookingId,
      fromStatus: booking.status,
      toStatus: booking.status,
      changedBy: actor.userId ?? null,
      changedByName: actor.userName ?? "system",
      note: `Check-in pukul ${now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`,
    });
    return { ok: true, bookingId, alreadyCompleted: false };
  });

  if (result.ok) {
    await logAudit({
      ...actor,
      action: "BOOKING_CHECKED_IN",
      entity: "booking",
      entityId: bookingId,
      after: { checkedInAt: now.toISOString() },
    });
  }
  return result;
}