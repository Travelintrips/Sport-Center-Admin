import { Router } from "express";
import { db, bookingsTable, bookingExtensionRequestsTable, facilitiesTable, bookingHistoryTable, paymentsTable, usersTable } from "@workspace/db";
import { eq, and, not, inArray } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function addHours(time: string, hours: number): string {
  const [h] = time.split(":").map(Number);
  return `${String(h + hours).padStart(2, "0")}:00`;
}

// POST /bookings/:id/extend — customer requests time extension
router.post("/bookings/:id/extend", async (req, res) => {
  try {
    const bookingId = parseInt(String(req.params.id));
    const { extraHours, reason } = req.body;

    if (!extraHours || typeof extraHours !== "number" || extraHours < 1 || extraHours > 4) {
      res.status(400).json({ error: "extraHours harus antara 1–4" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    if (!["confirmed", "paid", "waiting_confirmation"].includes(booking.status)) {
      res.status(400).json({ error: `Booking berstatus '${booking.status}' tidak dapat diperpanjang` });
      return;
    }

    // Check existing pending extension request
    const existingPending = await db.select().from(bookingExtensionRequestsTable)
      .where(and(eq(bookingExtensionRequestsTable.bookingId, bookingId), eq(bookingExtensionRequestsTable.status, "pending")))
      .limit(1);
    if (existingPending.length > 0) {
      res.status(400).json({ error: "Sudah ada permintaan perpanjangan yang menunggu persetujuan" });
      return;
    }

    // Get facility for pricing + hours check
    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
    if (!facility) { res.status(404).json({ error: "Fasilitas tidak ditemukan" }); return; }

    const newEndTime = addHours(booking.endTime, extraHours);
    const newEndMinutes = timeToMinutes(newEndTime);
    const closeMinutes = timeToMinutes(facility.closeTime);

    if (newEndMinutes > closeMinutes) {
      res.status(400).json({ error: `Perpanjangan melebihi jam tutup fasilitas (${facility.closeTime})` });
      return;
    }

    // Check slot conflicts
    const existingBookings = await db.select().from(bookingsTable)
      .where(and(
        eq(bookingsTable.facilityId, booking.facilityId),
        eq(bookingsTable.bookingDate, booking.bookingDate),
        not(inArray(bookingsTable.status, INACTIVE_STATUSES)),
        not(eq(bookingsTable.id, bookingId)),
      ));

    const reqStart = timeToMinutes(booking.endTime);
    const reqEnd = timeToMinutes(newEndTime);
    const conflict = existingBookings.find((b) => {
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);
      return reqStart < bEnd && reqEnd > bStart;
    });
    if (conflict) {
      res.status(409).json({ error: "Slot waktu perpanjangan sudah terisi booking lain" });
      return;
    }

    const additionalPrice = Number(facility.pricePerHour) * extraHours;

    const [created] = await db.insert(bookingExtensionRequestsTable).values({
      bookingId,
      extraHours,
      additionalPrice: String(additionalPrice),
      reason: reason || null,
      status: "pending",
    }).returning();

    res.status(201).json({
      ...created,
      newEndTime,
      additionalPrice,
    });
  } catch (err) {
    req.log.error({ err }, "Request extension error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /extension-requests — admin list
router.get("/extension-requests", adminMiddleware, async (req, res) => {
  try {
    const requests = await db.select().from(bookingExtensionRequestsTable)
      .orderBy(bookingExtensionRequestsTable.createdAt);

    const bookingIds = [...new Set(requests.map((r) => r.bookingId))];
    const bookings = bookingIds.length > 0
      ? await db.select().from(bookingsTable).where(inArray(bookingsTable.id, bookingIds))
      : [];
    const facilityIds = [...new Set(bookings.map((b) => b.facilityId))];
    const facilities = facilityIds.length > 0
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable).where(inArray(facilitiesTable.id, facilityIds))
      : [];

    const result = requests.map((r) => {
      const booking = bookings.find((b) => b.id === r.bookingId);
      const facility = facilities.find((f) => f.id === booking?.facilityId);
      return {
        ...r,
        additionalPrice: Number(r.additionalPrice),
        newEndTime: booking ? addHours(booking.endTime, r.extraHours) : null,
        booking: booking ? {
          orderNumber: booking.orderNumber,
          customerName: booking.customerName,
          customerPhone: booking.customerPhone,
          facilityName: facility?.name ?? "",
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          status: booking.status,
          totalPrice: Number(booking.totalPrice),
        } : null,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List extension requests error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /extension-requests/:id — admin approve/reject
router.patch("/extension-requests/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { action, adminNote } = req.body;

    if (!["approve", "reject"].includes(action)) {
      res.status(400).json({ error: "action harus 'approve' atau 'reject'" });
      return;
    }

    const [request] = await db.select().from(bookingExtensionRequestsTable).where(eq(bookingExtensionRequestsTable.id, id)).limit(1);
    if (!request) { res.status(404).json({ error: "Permintaan tidak ditemukan" }); return; }
    if (request.status !== "pending") {
      res.status(400).json({ error: "Permintaan sudah diproses" });
      return;
    }

    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);

    if (action === "approve") {
      const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, request.bookingId)).limit(1);
      if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

      const newEndTime = addHours(booking.endTime, request.extraHours);
      const newDuration = booking.durationHours + request.extraHours;
      const newTotal = Number(booking.totalPrice) + Number(request.additionalPrice);

      await db.update(bookingsTable).set({
        endTime: newEndTime,
        durationHours: newDuration,
        totalPrice: String(newTotal),
        updatedAt: new Date(),
      }).where(eq(bookingsTable.id, request.bookingId));

      await db.insert(bookingHistoryTable).values({
        bookingId: request.bookingId,
        fromStatus: booking.status,
        toStatus: booking.status,
        changedByName: userInfo.userName || "admin",
        note: `Perpanjangan disetujui: +${request.extraHours} jam (${booking.endTime} → ${newEndTime}), tambahan Rp ${Number(request.additionalPrice).toLocaleString("id-ID")}`,
      });
    }

    await db.update(bookingExtensionRequestsTable).set({
      status: action === "approve" ? "approved" : "rejected",
      adminNote: adminNote || null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(bookingExtensionRequestsTable.id, id));

    await logAudit({
      ...userInfo,
      action: `extension_${action}`,
      entity: "booking_extension_request",
      entityId: id,
      after: { action, adminNote },
      ...clientInfo,
    });

    res.json({ success: true, action });
  } catch (err) {
    req.log.error({ err }, "Review extension error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
