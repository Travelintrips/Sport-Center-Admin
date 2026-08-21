import { Router } from "express";
import { db, bookingsTable, rescheduleRequestsTable, bookingHistoryTable, facilitiesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { checkSlotAvailable, closeTimeToMinutes, getEffectiveCloseTime, timeToMinutes } from "../lib/availability";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { notifyRescheduleApproved, notifyRescheduleRejected } from "../lib/notifications";

const router = Router();

// POST /bookings/:id/reschedule — customer requests reschedule
router.post("/bookings/:id/reschedule", async (req, res) => {
  try {
    const bookingId = parseInt(String(req.params.id));
    const { newDate, newStartTime, newEndTime, reason } = req.body;

    if (!newDate || !newStartTime || !newEndTime) {
      res.status(400).json({ error: "newDate, newStartTime, newEndTime are required" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    if (!["pending_payment", "paid", "confirmed", "waiting_confirmation"].includes(booking.status)) {
      res.status(400).json({ error: `Booking berstatus '${booking.status}' tidak dapat direschedule` });
      return;
    }

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
    if (!facility) { res.status(404).json({ error: "Fasilitas tidak ditemukan" }); return; }
    const newDurationHours = (timeToMinutes(newEndTime) - timeToMinutes(newStartTime)) / 60;
    const todayWib = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(newDate)) || newDate < todayWib) {
      res.status(400).json({ error: "Tanggal reschedule tidak valid atau sudah lewat" }); return;
    }
    if (!Number.isInteger(newDurationHours) || newDurationHours < 1) {
      res.status(400).json({ error: "Durasi reschedule tidak valid" }); return;
    }
    const startMin = timeToMinutes(newStartTime);
    const endMin = timeToMinutes(newEndTime);
    const closeMin = closeTimeToMinutes(getEffectiveCloseTime(facility));
    if (startMin < timeToMinutes(facility.openTime) || endMin > closeMin || endMin <= startMin) {
      res.status(400).json({ error: `Jadwal harus dalam jam operasional ${facility.openTime}–${getEffectiveCloseTime(facility)}` }); return;
    }

    // Check availability for new slot, including blocked schedules.
    const conflicts = await db.select().from(bookingsTable).where(
      and(eq(bookingsTable.facilityId, booking.facilityId), eq(bookingsTable.bookingDate, newDate))
    );
    const active = conflicts.filter((b) => b.id !== bookingId && !["cancelled", "expired", "rejected", "refunded"].includes(b.status));
    const sMin = startMin;
    const eMin = endMin;
    const conflict = active.some((b) => {
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);
      return sMin < bEnd && eMin > bStart;
    });
    if (conflict) {
      res.status(409).json({ error: "Slot baru sudah dipesan. Pilih waktu lain." });
      return;
    }
    if (!(await checkSlotAvailable(booking.facilityId, newDate, newStartTime, newDurationHours))) {
      res.status(409).json({ error: "Slot baru sedang diblokir atau tidak tersedia." });
      return;
    }

    const [existing] = await db.select().from(rescheduleRequestsTable)
      .where(and(eq(rescheduleRequestsTable.bookingId, bookingId), eq(rescheduleRequestsTable.status, "pending")))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Sudah ada permintaan reschedule yang menunggu persetujuan" });
      return;
    }

    const userInfo = getUserFromReq(req);
    const [request] = await db.insert(rescheduleRequestsTable).values({
      bookingId,
      requestedBy: userInfo.userId ?? null,
      newDate,
      newStartTime,
      newEndTime,
      reason: reason || null,
      status: "pending",
    }).returning();

    res.status(201).json(request);
  } catch (err) {
    req.log.error({ err }, "Request reschedule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /reschedule-requests — admin: list all pending
router.get("/reschedule-requests", adminMiddleware, async (req, res) => {
  try {
    const requests = await db.select().from(rescheduleRequestsTable);
    const bookingIds = [...new Set(requests.map((r) => r.bookingId))];
    const bookings = bookingIds.length > 0 ? await db.select().from(bookingsTable) : [];
    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);

    const result = requests.map((r) => {
      const booking = bookings.find((b) => b.id === r.bookingId);
      const facility = facilities.find((f) => f.id === booking?.facilityId);
      return { ...r, booking: booking ? { ...booking, facilityName: facility?.name ?? "" } : null };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List reschedule requests error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /reschedule-requests/:id — admin: approve or reject
router.patch("/reschedule-requests/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { action, reviewNote } = req.body;

    if (!["approve", "reject"].includes(action)) {
      res.status(400).json({ error: "action must be 'approve' or 'reject'" });
      return;
    }

    const [request] = await db.select().from(rescheduleRequestsTable).where(eq(rescheduleRequestsTable.id, id)).limit(1);
    if (!request) { res.status(404).json({ error: "Request tidak ditemukan" }); return; }
    if (request.status !== "pending") { res.status(400).json({ error: "Request sudah diproses" }); return; }

    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, request.bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    // Resolve customer phone: from booking.customerPhone or linked user
    let customerPhone = booking.customerPhone ?? "";
    if (!customerPhone && booking.customerId) {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, booking.customerId)).limit(1);
      customerPhone = user?.phone ?? "";
    }

    const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    await db.transaction(async (tx) => {
      const [lockedRequest] = await tx.select().from(rescheduleRequestsTable)
        .where(and(eq(rescheduleRequestsTable.id, id), eq(rescheduleRequestsTable.status, "pending")))
        .limit(1);
      if (!lockedRequest) throw new Error("RESCHEDULE_ALREADY_PROCESSED");
      const [currentBooking] = await tx.select().from(bookingsTable)
        .where(eq(bookingsTable.id, request.bookingId)).limit(1);
      if (!currentBooking) throw new Error("BOOKING_NOT_FOUND");

      const reviewedAt = new Date();
      if (action === "approve") {
        // Re-check inside the transaction so two approvals cannot reserve
        // the same slot after the initial request-time check.
        const competingBookings = await tx.select({
          id: bookingsTable.id,
          startTime: bookingsTable.startTime,
          endTime: bookingsTable.endTime,
          status: bookingsTable.status,
        }).from(bookingsTable).where(and(
          eq(bookingsTable.facilityId, currentBooking.facilityId),
          eq(bookingsTable.bookingDate, lockedRequest.newDate),
        ));
        const hasConflict = competingBookings
          .filter((candidate) => candidate.id !== currentBooking.id)
          .filter((candidate) => !["cancelled", "expired", "rejected", "refunded"].includes(candidate.status))
          .some((candidate) =>
            timeToMinutes(lockedRequest.newStartTime) < timeToMinutes(candidate.endTime) &&
            timeToMinutes(lockedRequest.newEndTime) > timeToMinutes(candidate.startTime),
          );
        if (hasConflict) throw new Error("RESCHEDULE_SLOT_UNAVAILABLE");

        await tx.update(bookingsTable).set({
          bookingDate: lockedRequest.newDate,
          startTime: lockedRequest.newStartTime,
          endTime: lockedRequest.newEndTime,
           // A rescheduled session must be checked in again at its new time.
           checkedInAt: null,
           completedAt: null,
          updatedAt: reviewedAt,
        }).where(eq(bookingsTable.id, request.bookingId));
        await tx.insert(bookingHistoryTable).values({
          bookingId: request.bookingId,
          fromStatus: currentBooking.status,
          toStatus: currentBooking.status,
          changedBy: userInfo.userId ?? null,
          changedByName: userInfo.userName || "admin",
          note: `Reschedule disetujui: ${currentBooking.bookingDate} ${currentBooking.startTime}-${currentBooking.endTime} → ${lockedRequest.newDate} ${lockedRequest.newStartTime}-${lockedRequest.newEndTime}`,
        });
      }
      await tx.update(rescheduleRequestsTable).set({
        status: action === "approve" ? "approved" : "rejected",
        reviewNote: reviewNote || null,
        reviewedAt,
        updatedAt: reviewedAt,
      }).where(and(eq(rescheduleRequestsTable.id, id), eq(rescheduleRequestsTable.status, "pending")));
    });

    await logAudit({
      ...userInfo,
      action: action === "approve" ? "RESCHEDULE_APPROVED" : "BOOKING_RESCHEDULE_REJECTED",
      entity: "reschedule_request",
      entityId: id,
      before: action === "approve" ? {
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
      } : { status: "pending" },
      after: action === "approve" ? {
        bookingDate: request.newDate,
        startTime: request.newStartTime,
        endTime: request.newEndTime,
        reason: request.reason,
        reviewNote,
      } : { action, reviewNote },
      ...clientInfo,
    });

    // Send WA notification to customer (non-blocking)
    const notifData = {
      customerName: booking.customerName,
      customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      newDate: request.newDate,
      newStartTime: request.newStartTime,
      newEndTime: request.newEndTime,
      reviewNote: reviewNote || undefined,
    };
    if (action === "approve") {
      notifyRescheduleApproved(notifData).catch(() => {});
    } else {
      notifyRescheduleRejected(notifData).catch(() => {});
    }

    res.json({ success: true, action });
  } catch (err) {
    req.log.error({ err }, "Review reschedule error");
    if (err instanceof Error && err.message === "RESCHEDULE_SLOT_UNAVAILABLE") {
      res.status(409).json({ error: "Slot baru sudah tidak tersedia. Pilih jadwal lain." });
      return;
    }
    if (err instanceof Error && err.message === "RESCHEDULE_ALREADY_PROCESSED") {
      res.status(409).json({ error: "Request reschedule sudah diproses." });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
