import { db, bookingsTable, bookingHistoryTable, rescheduleRequestsTable, usageProofsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logAudit } from "./auditLog";
export {
  CONFIRMABLE_BOOKING_STATUSES,
  hasBookingSessionEnded,
  hasBookingSessionStarted,
  isBookingConfirmableStatus,
} from "./bookingLifecycleRules";
import {
  hasBookingSessionEnded,
  hasBookingSessionStarted,
  normalizeBookingCompletionExceptionReason,
  isX904GymDayUsage,
} from "./bookingLifecycleRules";

export type BookingLifecycleActor = {
  userId?: number | null;
  userName?: string | null;
  userRole?: string | null;
};

export type LifecycleResult =
  | { ok: true; bookingId: number; alreadyCompleted: boolean; withoutCheckin?: boolean }
  | { ok: false; reason: string };

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
  options: { withoutCheckInReason?: unknown } = {},
): Promise<LifecycleResult> {
  const exceptionReason = normalizeBookingCompletionExceptionReason(options.withoutCheckInReason);
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
    // Reuse the existing administrative completion path for future, paid and
    // verified public Gym guests. Ending a session is NOT evidence of attendance.
    // Keep historical bookings, event photo proof, reschedules, and non-Gym
    // exception requirements unchanged.
    let completionReason = exceptionReason;
    if (!booking.checkedInAt && !completionReason &&
        booking.source === "gym_public_guest" &&
        booking.bookingDate >= "2026-11-13" &&
        hasBookingSessionEnded(booking.bookingDate, booking.endTime, now)) {
      const entitlement = await tx.execute(sql`
        SELECT 1 FROM sport_center.x904_nonmember_daily_access a
        JOIN sport_center.sport_payments p
          ON p.id=a.payment_id AND p.booking_id=a.booking_id
        WHERE a.booking_id=${bookingId}
          AND a.device_serial='TDBD234200545'
          AND a.verification_state='verified'
          AND a.identity_type IN ('pin','card')
          AND a.activated_at IS NOT NULL
          AND p.status='confirmed' AND p.confirmed_at IS NOT NULL AND p.amount>0
        LIMIT 1`);
      if (entitlement.rows.length===1)
        completionReason = "Sesi Gym mandiri sudah berakhir; check-in tidak tercatat otomatis";
    }
    if (!booking.checkedInAt && !completionReason) {
      return { ok: false, reason: "Booking belum check-in. Gunakan Selesaikan tanpa check-in dengan alasan minimal 12 karakter." };
    }
    if (booking.bookingType === "event") {
      const [proof] = await tx.select({ id: usageProofsTable.id }).from(usageProofsTable)
        .where(eq(usageProofsTable.bookingId, bookingId)).limit(1);
      if (!proof) return { ok: false, reason: "Event wajib memiliki photo proof sebelum selesai" };
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
      note: booking.checkedInAt
        ? "Booking completed setelah check-in dan waktu sesi berakhir"
        : `Selesai administratif tanpa check-in (bukan bukti kehadiran): ${completionReason}`,
    });
    return { ok: true, bookingId, alreadyCompleted: false, withoutCheckin: !booking.checkedInAt };
  });

  if (result.ok && !result.alreadyCompleted) {
    await logAudit({
      ...actor,
      action: "BOOKING_COMPLETED",
      entity: "booking",
      entityId: bookingId,
      before: { status: "confirmed" },
      after: { status: "completed", completedAt: now.toISOString(),
        reason: result.withoutCheckin ? "admin_close_without_checkin" : "checked_in_and_session_ended",
        withoutCheckInReason: result.withoutCheckin ? (exceptionReason ?? "Sesi Gym mandiri sudah berakhir; check-in tidak tercatat otomatis") : undefined,
        checkedInAtUntouched: true },
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
  options: { x904GymScanEventId?: string } = {},
): Promise<LifecycleResult> {
  const result = await db.transaction(async (tx): Promise<LifecycleResult> => {
    const [booking] = await tx
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);
    if (!booking) return { ok: false, reason: "Booking tidak ditemukan" };
    if (booking.checkedInAt) return { ok: false, reason: "Booking sudah check-in" };
    // Only the existing authenticated X904 LAN reconciliation may opt in.
    // Courts, manual attendance and historical bookings retain their rules.
    const x904DayAdmission =
      Boolean(options.x904GymScanEventId) &&
      actor.userRole === "system" &&
      String(actor.userName ?? "").startsWith("X904 ") &&
      booking.facilityId === 6 &&
      ["admin","gym_public_guest"].includes(String(booking.source)) &&
      booking.bookingDate >= "2026-11-17";
    if (options.x904GymScanEventId && !x904DayAdmission)
      return { ok: false, reason: "X904 day admission not authorized" };
    if (booking.status !== "confirmed" &&
        !(x904DayAdmission && booking.status === "completed")) {
      return { ok: false, reason: "Check-in hanya bisa dilakukan untuk booking yang sudah dikonfirmasi" };
    }
    if (booking.bookingDate !== todayJakarta(now)) {
      return { ok: false, reason: "Check-in hanya bisa dilakukan pada hari H booking" };
    }
    if (x904DayAdmission) {
      const scanTime = now.toLocaleString("sv-SE", {
        timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit",
        hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,
      });
      if (!isX904GymDayUsage(booking.bookingDate,scanTime))
        return { ok:false, reason:"X904 scan di luar jam Gym" };
      // Re-read the exact grant, payment and LAN record under the booking
      // transaction; do not trust a caller-supplied event ID alone.
      const evidence = await tx.execute(sql`SELECT a.access_id
        FROM sport_center.x904_nonmember_daily_access a
        JOIN sport_center.sport_bookings paid_booking ON paid_booking.id=a.booking_id
        JOIN sport_center.sport_payments p
          ON p.id=a.payment_id AND p.booking_id=a.booking_id
        JOIN sport_center.gym_x904_lan_logs l
          ON l.device_serial=a.device_serial AND l.user_pin=a.user_pin
          AND l.event_id=${String(options.x904GymScanEventId)}
        WHERE a.booking_id=${bookingId}
          AND a.device_serial='TDBD234200545'
          AND a.verification_state='verified'
          AND a.identity_type IN ('pin','card')
          AND a.access_state IN ('active','expired')
          AND a.activated_at IS NOT NULL AND a.expires_at IS NOT NULL
          AND a.activated_at<=${now} AND a.expires_at>${now}
          AND p.status::text='confirmed' AND p.confirmed_at IS NOT NULL
          AND p.amount>=COALESCE(paid_booking.grand_total,paid_booking.total_price)
          AND COALESCE(paid_booking.grand_total,paid_booking.total_price)>0
          AND (l.device_uid=a.device_uid OR l.device_uid=l.event_index+1)
          AND l.device_time=${scanTime}
          AND (
            a.identity_type='pin'
            OR ${booking.source === "admin"}
            OR EXISTS (SELECT 1 FROM sport_center.gym_vis_card_reservations v
              WHERE v.booking_id=a.booking_id AND v.payment_id=a.payment_id
                AND v.user_pin=a.user_pin AND v.device_uid=a.device_uid
                AND v.card_code=a.identity_label
                AND v.state IN ('collected','returned')
                AND v.collected_at IS NOT NULL
                AND l.device_time>=to_char(v.collected_at AT TIME ZONE 'Asia/Jakarta',
                  'YYYY-MM-DD HH24:MI:SS'))
          )
        LIMIT 2`);
      if (evidence.rows.length!==1)
        return { ok:false, reason:"Bukti X904/Gym/payment tidak valid" };
    } else {
      if (!hasBookingSessionStarted(booking.bookingDate, booking.startTime, now)) {
        return { ok: false, reason: "Check-in belum dibuka sampai waktu mulai sesi" };
      }
      if (hasBookingSessionEnded(booking.bookingDate, booking.endTime, now)) {
        return { ok: false, reason: "Sesi booking sudah berakhir dan tidak dapat check-in" };
      }
    }
    if (await hasPendingReschedule(tx, bookingId)) {
      return { ok: false, reason: "Booking memiliki reschedule yang masih menunggu persetujuan" };
    }

    const [updated] = await tx
      .update(bookingsTable)
      .set({ checkedInAt: now, updatedAt: now })
      .where(and(
        eq(bookingsTable.id, bookingId),
        x904DayAdmission
          ? sql`${bookingsTable.status} IN ('confirmed','completed')`
          : eq(bookingsTable.status, "confirmed"),
        isNull(bookingsTable.checkedInAt),
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