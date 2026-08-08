import { Router } from "express";
import { db, bookingsTable, rescheduleRequestsTable, bookingHistoryTable, facilitiesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { notifyRescheduleApproved, notifyRescheduleRejected } from "../lib/notifications";

const router = Router();

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

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

    // Check availability for new slot
    const conflicts = await db.select().from(bookingsTable).where(
      and(eq(bookingsTable.facilityId, booking.facilityId), eq(bookingsTable.bookingDate, newDate))
    );
    const active = conflicts.filter((b) => b.id !== bookingId && !["cancelled", "expired", "rejected"].includes(b.status));
    const sMin = timeToMinutes(newStartTime);
    const eMin = timeToMinutes(newEndTime);
    const conflict = active.some((b) => {
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);
      return sMin < bEnd && eMin > bStart;
    });
    if (conflict) {
      res.status(409).json({ error: "Slot baru sudah dipesan. Pilih waktu lain." });
      return;
    }

    const [existing] = await db.select().from(rescheduleRequestsTable)
      .where(and(eq(rescheduleRequestsTable.bookingId, bookingId), eq(rescheduleRequestsTable.status, "pending")))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "Sudah ada permintaan reschedule yang menunggu persetujuan" });
      return;
    }

    const [request] = await db.insert(rescheduleRequestsTable).values({
      bookingId,
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

    if (action === "approve") {
      await db.update(bookingsTable).set({
        bookingDate: request.newDate,
        startTime: request.newStartTime,
        endTime: request.newEndTime,
        updatedAt: new Date(),
      }).where(eq(bookingsTable.id, request.bookingId));

      await db.insert(bookingHistoryTable).values({
        bookingId: request.bookingId,
        fromStatus: booking.status,
        toStatus: booking.status,
        changedByName: userInfo.userName || "admin",
        note: `Reschedule disetujui: ${booking.bookingDate} ${booking.startTime}-${booking.endTime} → ${request.newDate} ${request.newStartTime}-${request.newEndTime}`,
      });
    }

    await db.update(rescheduleRequestsTable).set({
      status: action === "approve" ? "approved" : "rejected",
      reviewNote: reviewNote || null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(rescheduleRequestsTable.id, id));

    await logAudit({
      ...userInfo,
      action: `reschedule_${action}`,
      entity: "reschedule_request",
      entityId: id,
      after: { action, reviewNote },
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
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
