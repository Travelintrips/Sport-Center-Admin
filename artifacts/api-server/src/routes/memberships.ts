import { Router } from "express";
import { db, gymMembershipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

const PRICE_PER_MONTH = 300000;

router.get("/memberships", adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let memberships = await db.select().from(gymMembershipsTable).orderBy(gymMembershipsTable.createdAt);
    if (status) memberships = memberships.filter((m) => m.status === status);
    res.json(memberships.map((m) => ({ ...m, totalPrice: Number(m.totalPrice) })));
  } catch (err) {
    req.log.error({ err }, "List memberships error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [membership] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!membership) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...membership, totalPrice: Number(membership.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Get membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/memberships", async (req, res) => {
  try {
    const { name, email, phone, startDate, months, notes } = req.body;
    const monthsNum = Number(months) || 1;
    const totalPrice = PRICE_PER_MONTH * monthsNum;

    const start = new Date(startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + monthsNum);
    const endDate = end.toISOString().split("T")[0];

    const [membership] = await db
      .insert(gymMembershipsTable)
      .values({
        name,
        email,
        phone,
        startDate,
        endDate,
        months: monthsNum,
        totalPrice: String(totalPrice),
        notes,
        status: "active",
      })
      .returning();

    res.status(201).json({ ...membership, totalPrice: Number(membership.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Create membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = { ...req.body };
    if (data.totalPrice !== undefined) data.totalPrice = String(data.totalPrice);
    await db.update(gymMembershipsTable).set(data).where(eq(gymMembershipsTable.id, id));
    const [membership] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!membership) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...membership, totalPrice: Number(membership.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Update membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(gymMembershipsTable).where(eq(gymMembershipsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
