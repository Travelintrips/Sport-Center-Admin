import { Router } from "express";
import { db, bookingsTable, bookingCancellationsTable, bookingHistoryTable, facilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware, authMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { notifyBookingCancelled } from "../lib/notifications";
import { syncStatusToBizportal } from "../lib/bizportalSync";

const router = Router();

// POST /bookings/:id/cancel — customer or admin cancels a booking
router.post("/bookings/:id/cancel", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { reason, cancelledBy } = req.body;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id))
      .limit(1);

    if (!booking) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }

    const cancellableStatuses = ["pending_payment", "waiting_confirmation", "paid", "confirmed"];
    if (!cancellableStatuses.includes(booking.status)) {
      res.status(400).json({ error: `Booking dengan status '${booking.status}' tidak dapat dibatalkan` });
      return;
    }

    await db.update(bookingsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(bookingsTable.id, id));

    await db.insert(bookingCancellationsTable).values({
      bookingId: id,
      cancelledBy: cancelledBy || "customer",
      reason: reason || null,
      refundAmount: "0",
      refundStatus: "none",
    }).onConflictDoNothing();

    await db.insert(bookingHistoryTable).values({
      bookingId: id,
      fromStatus: booking.status,
      toStatus: "cancelled",
      changedByName: cancelledBy || "customer",
      note: reason || null,
    });

    const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    notifyBookingCancelled({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      reason: reason || "Tidak ada alasan",
    });

    syncStatusToBizportal(booking.orderNumber, "cancelled").catch(() => {});

    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);
    await logAudit({
      ...userInfo,
      action: "cancel_booking",
      entity: "booking",
      entityId: id,
      before: { status: booking.status },
      after: { status: "cancelled", reason },
      ...clientInfo,
    });

    res.json({ success: true, message: "Booking berhasil dibatalkan" });
  } catch (err) {
    req.log.error({ err }, "Cancel booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /bookings/:id/cancellation — get cancellation detail
router.get("/bookings/:id/cancellation", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [cancellation] = await db
      .select()
      .from(bookingCancellationsTable)
      .where(eq(bookingCancellationsTable.bookingId, id))
      .limit(1);
    if (!cancellation) {
      res.status(404).json({ error: "No cancellation record" });
      return;
    }
    res.json({ ...cancellation, refundAmount: Number(cancellation.refundAmount) });
  } catch (err) {
    req.log.error({ err }, "Get cancellation error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
