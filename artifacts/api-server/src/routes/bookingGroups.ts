import { Router } from "express";
import { db, bookingsTable, bookingGroupsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

function generateGroupRef(): string {
  const n = Math.floor(Math.random() * 99999) + 1;
  return `GRP-${String(n).padStart(5, "0")}`;
}

async function uniqueGroupRef(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const ref = generateGroupRef();
    const [existing] = await db.select({ groupRef: bookingGroupsTable.groupRef })
      .from(bookingGroupsTable)
      .where(eq(bookingGroupsTable.groupRef, ref))
      .limit(1);
    if (!existing) return ref;
  }
  return `GRP-${Date.now()}`;
}

// GET /bookings/groups — list all groups with booking summaries
router.get("/bookings/groups", adminMiddleware, async (req, res) => {
  try {
    const groups = await db.select().from(bookingGroupsTable).orderBy(bookingGroupsTable.createdAt);

    // For each group, fetch associated bookings
    const result = await Promise.all(groups.map(async (g) => {
      const bookings = await db.select({
        id: bookingsTable.id,
        orderNumber: bookingsTable.orderNumber,
        facilityId: bookingsTable.facilityId,
        bookingDate: bookingsTable.bookingDate,
        startTime: bookingsTable.startTime,
        endTime: bookingsTable.endTime,
        durationHours: bookingsTable.durationHours,
        totalPrice: bookingsTable.totalPrice,
        grandTotal: bookingsTable.grandTotal,
        status: bookingsTable.status,
        customerName: bookingsTable.customerName,
        customerPhone: bookingsTable.customerPhone,
      }).from(bookingsTable).where(eq(bookingsTable.groupRef, g.groupRef));

      return {
        ...g,
        totalPayment: Number(g.totalPayment),
        bookings,
      };
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List booking groups error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /bookings/merge — create a payment group from multiple bookings
router.post("/bookings/merge", adminMiddleware, async (req, res) => {
  try {
    const { customer_phone, booking_ids, total_payment, notes } = req.body as {
      customer_phone: string;
      booking_ids: string[];       // order numbers
      total_payment?: number;
      notes?: string;
    };

    if (!customer_phone || !booking_ids?.length) {
      res.status(400).json({ error: "customer_phone dan booking_ids wajib diisi" });
      return;
    }

    // Fetch the bookings
    const bookings = await db.select().from(bookingsTable)
      .where(inArray(bookingsTable.orderNumber, booking_ids));

    if (!bookings.length) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }

    // Validate same customer phone
    const mismatch = bookings.find((b) => b.customerPhone !== customer_phone);
    if (mismatch) {
      res.status(400).json({ error: "Semua booking harus dari customer yang sama (nomor HP sama)" });
      return;
    }

    // Calculate total if not provided
    const computedTotal = total_payment ?? bookings.reduce((sum, b) => sum + Number(b.grandTotal ?? b.totalPrice), 0);

    // If any booking already in a group, dissolve that group first
    const existingGroups = [...new Set(bookings.map((b) => b.groupRef).filter(Boolean))] as string[];
    if (existingGroups.length > 0) {
      // Remove bookings from old groups
      await db.update(bookingsTable)
        .set({ groupRef: null })
        .where(inArray(bookingsTable.groupRef, existingGroups));
      // Delete old groups
      await db.delete(bookingGroupsTable)
        .where(inArray(bookingGroupsTable.groupRef, existingGroups));
    }

    const groupRef = await uniqueGroupRef();
    const customerName = bookings[0].customerName;

    // Create group
    await db.insert(bookingGroupsTable).values({
      groupRef,
      customerPhone: customer_phone,
      customerName,
      totalPayment: String(computedTotal),
      status: "pending",
      notes: notes ?? null,
    });

    // Link bookings to group
    await db.update(bookingsTable)
      .set({ groupRef })
      .where(inArray(bookingsTable.orderNumber, booking_ids));

    const created = await db.select().from(bookingGroupsTable)
      .where(eq(bookingGroupsTable.groupRef, groupRef)).limit(1);

    res.json({ ...created[0], totalPayment: Number(created[0].totalPayment), bookingIds: booking_ids });
  } catch (err) {
    req.log.error({ err }, "Merge bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /bookings/groups/:groupRef — update group status or total
router.patch("/bookings/groups/:groupRef", adminMiddleware, async (req, res) => {
  try {
    const { groupRef } = req.params;
    const { status, total_payment, notes } = req.body as {
      status?: "pending" | "paid";
      total_payment?: number;
      notes?: string;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (total_payment != null) updates.totalPayment = String(total_payment);
    if (notes !== undefined) updates.notes = notes;

    await db.update(bookingGroupsTable).set(updates as any).where(eq(bookingGroupsTable.groupRef, groupRef));

    const [updated] = await db.select().from(bookingGroupsTable)
      .where(eq(bookingGroupsTable.groupRef, groupRef)).limit(1);

    if (!updated) { res.status(404).json({ error: "Grup tidak ditemukan" }); return; }

    res.json({ ...updated, totalPayment: Number(updated.totalPayment) });
  } catch (err) {
    req.log.error({ err }, "Update booking group error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /bookings/groups/:groupRef — dissolve group (remove groupRef from all bookings)
router.delete("/bookings/groups/:groupRef", adminMiddleware, async (req, res) => {
  try {
    const { groupRef } = req.params;

    await db.update(bookingsTable).set({ groupRef: null }).where(eq(bookingsTable.groupRef, groupRef));
    await db.delete(bookingGroupsTable).where(eq(bookingGroupsTable.groupRef, groupRef));

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete booking group error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
