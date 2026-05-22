import { Router } from "express";
import { db, promosTable, promoRegistrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/promos", async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let promos = await db.select().from(promosTable);
    if (activeOnly === "true") promos = promos.filter((p) => p.isActive);
    res.json(promos.map((p) => ({ ...p, discountPercent: p.discountPercent ? Number(p.discountPercent) : null })));
  } catch (err) {
    req.log.error({ err }, "List promos error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/promos", adminMiddleware, async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.discountPercent !== undefined) data.discountPercent = String(data.discountPercent);
    const [promo] = await db.insert(promosTable).values(data).returning();
    res.status(201).json({ ...promo, discountPercent: promo.discountPercent ? Number(promo.discountPercent) : null });
  } catch (err) {
    req.log.error({ err }, "Create promo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/promos/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = { ...req.body };
    if (data.discountPercent !== undefined) data.discountPercent = String(data.discountPercent);
    await db.update(promosTable).set(data).where(eq(promosTable.id, id));
    const [promo] = await db.select().from(promosTable).where(eq(promosTable.id, id)).limit(1);
    if (!promo) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...promo, discountPercent: promo.discountPercent ? Number(promo.discountPercent) : null });
  } catch (err) {
    req.log.error({ err }, "Update promo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/promos/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(promosTable).where(eq(promosTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete promo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/promos/register", async (req, res) => {
  try {
    const { promoId, name, email, phone, message } = req.body;
    const [reg] = await db.insert(promoRegistrationsTable).values({ promoId: Number(promoId), name, email, phone, message }).returning();
    res.status(201).json(reg);
  } catch (err) {
    req.log.error({ err }, "Register promo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
