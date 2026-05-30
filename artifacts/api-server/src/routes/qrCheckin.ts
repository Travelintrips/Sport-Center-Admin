import { Router } from "express";
import { db, bookingsTable, bookingHistoryTable, facilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

// GET /bookings/qr/:orderNumber — get QR data for booking (used to generate QR on frontend)
router.get("/bookings/qr/:orderNumber", async (req, res) => {
  try {
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, req.params.orderNumber))
      .limit(1);

    if (!booking) { res.status(404).json({ error: "Not found" }); return; }

    const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    res.json({
      orderNumber: booking.orderNumber,
      customerName: booking.customerName,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status,
      checkedInAt: booking.checkedInAt,
    });
  } catch (err) {
    req.log.error({ err }, "Get QR data error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /bookings/checkin — admin scans QR and checks in
router.post("/bookings/checkin", adminMiddleware, async (req, res) => {
  try {
    const { orderNumber } = req.body;
    if (!orderNumber) { res.status(400).json({ error: "orderNumber is required" }); return; }

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, String(orderNumber)))
      .limit(1);

    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    if (booking.status !== "confirmed") {
      res.status(400).json({
        error: `Booking berstatus '${booking.status}'. Hanya booking 'confirmed' yang bisa check-in.`,
        status: booking.status,
      });
      return;
    }

    if (booking.checkedInAt) {
      res.json({
        success: true,
        alreadyCheckedIn: true,
        checkedInAt: booking.checkedInAt,
        message: "Customer sudah check-in sebelumnya",
        booking,
      });
      return;
    }

    const now = new Date();
    await db.update(bookingsTable).set({ checkedInAt: now, updatedAt: now }).where(eq(bookingsTable.id, booking.id));

    const userInfo = getUserFromReq(req);
    await db.insert(bookingHistoryTable).values({
      bookingId: booking.id,
      fromStatus: "confirmed",
      toStatus: "confirmed",
      changedByName: userInfo.userName || "admin",
      note: "Customer check-in",
    });

    await logAudit({
      ...userInfo,
      action: "checkin",
      entity: "booking",
      entityId: booking.id,
      after: { checkedInAt: now.toISOString() },
      ...getClientInfo(req),
    });

    const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    res.json({
      success: true,
      alreadyCheckedIn: false,
      checkedInAt: now,
      message: `Check-in berhasil untuk ${booking.customerName}`,
      booking: {
        ...booking,
        facilityName: facility?.name ?? "",
        checkedInAt: now,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Check-in error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
