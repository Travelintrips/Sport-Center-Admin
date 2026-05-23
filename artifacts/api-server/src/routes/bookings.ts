import { Router } from "express";
import { db, bookingsTable, facilitiesTable, paymentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { broadcastAvailabilityChange } from "../lib/supabase";

const router = Router();

async function generateOrderNumber(): Promise<string> {
  const rows = await db.select({ orderNumber: bookingsTable.orderNumber }).from(bookingsTable);
  let maxNum = 0;
  for (const row of rows) {
    const match = row.orderNumber.match(/^SC-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = maxNum + 1;
  return `SC-${String(next).padStart(4, "0")}`;
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMinutes = h * 60 + (m || 0) + hours * 60;
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}

async function getBookingWithPayment(id: number) {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
  if (!booking) return null;
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, id)).limit(1);
  return {
    ...booking,
    totalPrice: Number(booking.totalPrice),
    facilityName: facility?.name ?? "",
    facilityCategory: facility?.category ?? "",
    payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
  };
}

router.get("/bookings", async (req, res) => {
  try {
    const { status, date, facilityId, customerId } = req.query;
    let bookings = await db.select().from(bookingsTable);
    if (status) bookings = bookings.filter((b) => b.status === status);
    if (date) bookings = bookings.filter((b) => b.bookingDate === date);
    if (facilityId) bookings = bookings.filter((b) => b.facilityId === Number(facilityId));
    if (customerId) bookings = bookings.filter((b) => b.customerId === Number(customerId));

    const facilityIds = [...new Set(bookings.map((b) => b.facilityId))];
    const facilities = facilityIds.length > 0
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category })
          .from(facilitiesTable)
      : [];

    const bookingIds = bookings.map((b) => b.id);
    const payments = bookingIds.length > 0 ? await db.select().from(paymentsTable) : [];

    const result = bookings.map((b) => {
      const facility = facilities.find((f) => f.id === b.facilityId);
      const payment = payments.find((p) => p.bookingId === b.id);
      return {
        ...b,
        totalPrice: Number(b.totalPrice),
        facilityName: facility?.name ?? "",
        facilityCategory: facility?.category ?? "",
        payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bookings", async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, facilityId, bookingDate, startTime, durationHours, notes } = req.body;

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, Number(facilityId))).limit(1);
    if (!facility) {
      res.status(404).json({ error: "Facility not found" });
      return;
    }

    const endTime = addHours(startTime, durationHours);
    const conflicting = await db.select().from(bookingsTable).where(
      and(eq(bookingsTable.facilityId, Number(facilityId)), eq(bookingsTable.bookingDate, bookingDate))
    );
    const active = conflicting.filter((b) => b.status !== "cancelled");
    const conflict = active.some((b) => {
      const bStartMin = b.startTime.split(":").reduce((h, m, i) => i === 0 ? parseInt(h as unknown as string) * 60 : parseInt(h as unknown as string) + parseInt(m), 0 as unknown as number) as unknown as number;
      const bEndMin = b.endTime.split(":").reduce((h, m, i) => i === 0 ? parseInt(h as unknown as string) * 60 : parseInt(h as unknown as string) + parseInt(m), 0 as unknown as number) as unknown as number;
      const sMin = startTime.split(":").map(Number).reduce((a: number, v: number, i: number) => i === 0 ? v * 60 : a + v, 0);
      const eMin = endTime.split(":").map(Number).reduce((a: number, v: number, i: number) => i === 0 ? v * 60 : a + v, 0);
      return sMin < bEndMin && eMin > bStartMin;
    });

    if (conflict) {
      res.status(409).json({ error: "This time slot is already booked" });
      return;
    }

    const totalPrice = Number(facility.pricePerHour) * durationHours;
    const orderNumber = await generateOrderNumber();

    const [booking] = await db.insert(bookingsTable).values({
      orderNumber,
      customerName,
      customerEmail,
      customerPhone,
      facilityId: Number(facilityId),
      bookingDate,
      startTime,
      endTime,
      durationHours,
      totalPrice: String(totalPrice),
      notes,
    }).returning();

    broadcastAvailabilityChange(Number(facilityId), bookingDate);

    res.status(201).json({
      ...booking,
      totalPrice: Number(booking.totalPrice),
      facilityName: facility.name,
      facilityCategory: facility.category,
      payment: null,
    });
  } catch (err) {
    req.log.error({ err }, "Create booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/order/:orderNumber", async (req, res) => {
  try {
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, req.params.orderNumber)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const result = await getBookingWithPayment(booking.id);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get booking by order error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await getBookingWithPayment(id);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/bookings/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db.delete(paymentsTable).where(eq(paymentsTable.bookingId, id));
    await db.delete(bookingsTable).where(eq(bookingsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const ADMIN_ONLY_STATUSES = ["completed", "cancelled", "refunded"] as const;

router.patch("/bookings/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, adminNotes } = req.body;

    const validStatuses = ["pending_payment", "paid", "confirmed", "completed", "cancelled", "refunded"];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status: ${status}` });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    await db.update(bookingsTable).set(updateData).where(eq(bookingsTable.id, id));
    const result = await getBookingWithPayment(id);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Update booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
