import { Router } from "express";
import { db, paymentsTable, bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/payments", async (req, res) => {
  try {
    const { bookingId } = req.query;
    let payments = await db.select().from(paymentsTable);
    if (bookingId) payments = payments.filter((p) => p.bookingId === Number(bookingId));
    res.json(payments.map((p) => ({ ...p, amount: Number(p.amount) })));
  } catch (err) {
    req.log.error({ err }, "List payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/payments", async (req, res) => {
  try {
    const { bookingId, amount, proofUrl, notes } = req.body;
    const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, Number(bookingId))).limit(1);
    if (existing) {
      await db.update(paymentsTable).set({ proofUrl, notes, status: "pending" }).where(eq(paymentsTable.bookingId, Number(bookingId)));
      const [updated] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, Number(bookingId))).limit(1);
      res.status(201).json({ ...updated, amount: Number(updated.amount) });
      return;
    }
    const [payment] = await db.insert(paymentsTable).values({
      bookingId: Number(bookingId),
      amount: String(amount),
      proofUrl,
      notes,
    }).returning();
    await db.update(bookingsTable).set({ status: "paid" }).where(eq(bookingsTable.id, Number(bookingId)));
    res.status(201).json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Create payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/payments/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, notes } = req.body;
    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    await db.update(paymentsTable).set(updateData).where(eq(paymentsTable.id, id));
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
    if (!payment) { res.status(404).json({ error: "Not found" }); return; }
    if (status === "confirmed") {
      await db.update(bookingsTable).set({ status: "confirmed" }).where(eq(bookingsTable.id, payment.bookingId));
    } else if (status === "rejected") {
      await db.update(bookingsTable).set({ status: "pending_payment" }).where(eq(bookingsTable.id, payment.bookingId));
    }
    res.json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Update payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
