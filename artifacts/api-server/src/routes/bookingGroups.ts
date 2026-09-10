import { Router } from "express";
import { db, bookingsTable, bookingGroupsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import type { BookingGroup } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";

const router = Router();

function generateGroupRef(): string {
  const n = Math.floor(Math.random() * 99999) + 1;
  return `GRP-${String(n).padStart(5, "0")}`;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function uniqueGroupRef(tx: DbTransaction): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const ref = generateGroupRef();
    const [existing] = await tx.select({ groupRef: bookingGroupsTable.groupRef })
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

    if (!customer_phone || !Array.isArray(booking_ids) || booking_ids.length < 2 || booking_ids.length > 50) {
      res.status(400).json({ error: "customer_phone dan 2–50 booking_ids wajib diisi" });
      return;
    }
    const normalizedIds = booking_ids.map((id) => String(id).trim()).filter(Boolean);
    if (normalizedIds.length !== booking_ids.length || new Set(normalizedIds).size !== normalizedIds.length) {
      res.status(400).json({ error: "booking_ids harus unik dan tidak boleh kosong" });
      return;
    }

    const bookings = await db.select().from(bookingsTable)
      .where(inArray(bookingsTable.orderNumber, normalizedIds));

    if (bookings.length !== normalizedIds.length) {
      res.status(404).json({ error: "Satu atau lebih booking tidak ditemukan" });
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
    if (!Number.isFinite(Number(computedTotal)) || Number(computedTotal) < 0) {
      res.status(400).json({ error: "total_payment tidak valid" });
      return;
    }

    const created = await db.transaction(async (tx) => {
      const current = await tx.select().from(bookingsTable)
        .where(inArray(bookingsTable.orderNumber, normalizedIds));
      if (current.length !== normalizedIds.length) {
        throw new Error("BOOKINGS_CHANGED");
      }
      const existingGroups = [...new Set(current.map((b) => b.groupRef).filter(Boolean))] as string[];
      if (existingGroups.length > 0) {
        // Preserve old group rows as historical records; only detach their bookings.
        await tx.update(bookingsTable)
          .set({ groupRef: null, updatedAt: new Date() })
          .where(inArray(bookingsTable.groupRef, existingGroups));
      }

      const groupRef = await uniqueGroupRef(tx);
      await tx.insert(bookingGroupsTable).values({
        groupRef,
        customerPhone: customer_phone,
        customerName: current[0].customerName,
        totalPayment: String(computedTotal),
        status: "pending",
        notes: notes ?? null,
      });
      await tx.update(bookingsTable)
        .set({ groupRef, updatedAt: new Date() })
        .where(inArray(bookingsTable.orderNumber, normalizedIds));
      const [group] = await tx.select().from(bookingGroupsTable)
        .where(eq(bookingGroupsTable.groupRef, groupRef)).limit(1);
      return { group, groupRef };
    });

    res.json({ ...created.group, totalPayment: Number(created.group.totalPayment), bookingIds: normalizedIds });
  } catch (err) {
    req.log.error({ err }, "Merge bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /bookings/groups/:groupRef — update group status or total
router.patch("/bookings/groups/:groupRef", adminMiddleware, async (req, res) => {
  try {
    const groupRef = req.params.groupRef as string;
    const { status, total_payment, notes } = req.body as {
      status?: "pending" | "paid";
      total_payment?: number;
      notes?: string;
    };

    const setData: { updatedAt: Date; status?: "pending" | "paid"; totalPayment?: string; notes?: string | null } = { updatedAt: new Date() };
    if (status) setData.status = status;
    if (total_payment != null) setData.totalPayment = String(total_payment);
    if (notes !== undefined) setData.notes = notes ?? null;

    await db.update(bookingGroupsTable).set(setData).where(eq(bookingGroupsTable.groupRef, groupRef));

    const rows = await db.select().from(bookingGroupsTable).where(eq(bookingGroupsTable.groupRef, groupRef));
    const updated = rows[0];

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
    const groupRef = req.params.groupRef as string;

    await db.update(bookingsTable).set({ groupRef: sql`null` }).where(eq(bookingsTable.groupRef, groupRef));
    await db.delete(bookingGroupsTable).where(eq(bookingGroupsTable.groupRef, groupRef));

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete booking group error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
