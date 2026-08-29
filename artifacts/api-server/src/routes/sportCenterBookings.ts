import { Router } from "express";
import { db, bookingsTable, facilitiesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { generateBookingOrderNumber } from "../lib/orderNumber";

const router = Router();

router.post("/sport-center/bookings", adminMiddleware, async (req, res) => {
  try {
    const { customerId, facilityId, startTime, endTime, duration, paymentMethod } = req.body;

    if (!customerId || !facilityId || !startTime || !duration) {
      res.status(400).json({ error: "customerId, facilityId, startTime, duration wajib diisi" });
      return;
    }

    const [customer] = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phone: usersTable.phone })
      .from(usersTable)
      .where(eq(usersTable.id, Number(customerId)))
      .limit(1);

    if (!customer) {
      res.status(404).json({ error: "Customer tidak ditemukan" });
      return;
    }

    const [facility] = await db
      .select()
      .from(facilitiesTable)
      .where(eq(facilitiesTable.id, Number(facilityId)))
      .limit(1);

    if (!facility) {
      res.status(404).json({ error: "Fasilitas tidak ditemukan" });
      return;
    }

    // Parse datetime-local ("2026-06-11T09:00") → bookingDate + startTime (HH:MM)
    const dt = new Date(startTime);
    const bookingDate = startTime.split("T")[0];
    const startHH = String(dt.getHours()).padStart(2, "0");
    const startMM = String(dt.getMinutes()).padStart(2, "0");
    const startTimeFormatted = `${startHH}:${startMM}`;

    const durationHours = Number(duration);
    const totalPrice = Number(facility.pricePerHour) * durationHours;
    const orderNumber = await generateBookingOrderNumber();

    const endDt = new Date(dt.getTime() + durationHours * 60 * 60 * 1000);
    const endHH = String(endDt.getHours()).padStart(2, "0");
    const endMM = String(endDt.getMinutes()).padStart(2, "0");
    const endTimeFormatted = `${endHH}:${endMM}`;

    const [booking] = await db
      .insert(bookingsTable)
      .values({
        orderNumber,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email ?? "",
        customerPhone: customer.phone ?? "",
        facilityId: facility.id,
        bookingDate,
        startTime: startTimeFormatted,
        endTime: endTimeFormatted,
        durationHours,
        totalPrice: String(totalPrice),
        discountAmount: "0",
        apDiscountAmount: "0",
        status: "pending_payment",
        notes: req.body.notes ?? null,
      })
      .returning();

    req.log.info({ bookingId: booking.id, orderNumber }, "Admin walk-in booking created");
    res.status(201).json({ success: true, booking: { ...booking, totalPrice } });
  } catch (err) {
    req.log.error({ err }, "sport-center/bookings POST error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
