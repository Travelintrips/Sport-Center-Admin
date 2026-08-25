import { Router } from "express";
import { db, promosTable, promoRegistrationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

function serializePromo(p: typeof promosTable.$inferSelect) {
  return {
    ...p,
    discountPercent: p.discountPercent ? Number(p.discountPercent) : null,
    discountAmount: p.discountAmount ? Number(p.discountAmount) : null,
    minPurchase: p.minPurchase ? Number(p.minPurchase) : null,
  };
}

router.get("/promos", async (req, res) => {
  try {
    const { activeOnly } = req.query;
    let promos = await db.select().from(promosTable);
    if (activeOnly === "true") promos = promos.filter((p) => p.isActive);
    res.json(promos.map(serializePromo));
  } catch (err) {
    req.log.error({ err }, "List promos error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /promos/validate-code — validate a coupon code against a purchase amount
router.post("/promos/validate-code", async (req, res) => {
  try {
    const { code, purchaseAmount } = req.body;
    if (!code) { res.status(400).json({ error: "Kode kupon diperlukan" }); return; }

    const [promo] = await db.select().from(promosTable)
      .where(eq(promosTable.code, String(code).toUpperCase()))
      .limit(1);

    if (!promo) { res.status(404).json({ error: "Kode kupon tidak ditemukan" }); return; }
    if (!promo.isActive) { res.status(400).json({ error: "Kode kupon sudah tidak aktif" }); return; }

    const today = new Date().toISOString().split("T")[0];
    if (promo.startDate && today < promo.startDate) {
      res.status(400).json({ error: "Kode kupon belum berlaku" }); return;
    }
    if (promo.endDate && today > promo.endDate) {
      res.status(400).json({ error: "Kode kupon sudah kadaluarsa" }); return;
    }
    if (promo.maxUses !== null && promo.maxUses !== undefined && promo.usedCount >= promo.maxUses) {
      res.status(400).json({ error: "Kode kupon sudah mencapai batas penggunaan" }); return;
    }

    const amount = Number(purchaseAmount) || 0;
    const minPurchase = promo.minPurchase ? Number(promo.minPurchase) : 0;
    if (minPurchase > 0 && amount < minPurchase) {
      res.status(400).json({
        error: `Minimal pembelian ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(minPurchase)} untuk kupon ini`,
      }); return;
    }

    let discountAmount = 0;
    if (promo.discountType === "percent") {
      const pct = promo.discountPercent ? Number(promo.discountPercent) : 0;
      discountAmount = Math.round(amount * pct / 100);
    } else {
      discountAmount = promo.discountAmount ? Number(promo.discountAmount) : 0;
    }
    discountAmount = Math.min(discountAmount, amount);

    res.json({
      valid: true,
      promoId: promo.id,
      code: promo.code,
      title: promo.title,
      discountType: promo.discountType,
      discountPercent: promo.discountPercent ? Number(promo.discountPercent) : null,
      discountAmount,
      finalAmount: amount - discountAmount,
    });
  } catch (err) {
    req.log.error({ err }, "Validate coupon error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/promos", adminMiddleware, async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.discountPercent !== undefined) data.discountPercent = String(data.discountPercent);
    if (data.discountAmount !== undefined) data.discountAmount = String(data.discountAmount);
    if (data.code) data.code = String(data.code).toUpperCase();
    const [promo] = await db.insert(promosTable).values(data).returning();
    res.status(201).json(serializePromo(promo));
  } catch (err) {
    req.log.error({ err }, "Create promo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/promos/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const data = { ...req.body };
    if (data.discountPercent !== undefined) data.discountPercent = String(data.discountPercent);
    if (data.discountAmount !== undefined) data.discountAmount = String(data.discountAmount);
    if (data.code) data.code = String(data.code).toUpperCase();
    await db.update(promosTable).set(data).where(eq(promosTable.id, id));
    const [promo] = await db.select().from(promosTable).where(eq(promosTable.id, id)).limit(1);
    if (!promo) { res.status(404).json({ error: "Not found" }); return; }
    res.json(serializePromo(promo));
  } catch (err) {
    req.log.error({ err }, "Update promo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/promos/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
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
