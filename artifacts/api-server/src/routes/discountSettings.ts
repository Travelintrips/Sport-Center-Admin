import { Router } from "express";
import { db, discountSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/discount-settings", async (req, res) => {
  try {
    const rows = await db.select().from(discountSettingsTable).orderBy(discountSettingsTable.customerType);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "List discount settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/discount-settings/:customerType", async (req, res) => {
  try {
    const [row] = await db.select().from(discountSettingsTable)
      .where(eq(discountSettingsTable.customerType, String(req.params.customerType))).limit(1);
    if (!row) { res.status(404).json({ error: "Pengaturan tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Get discount setting error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/discount-settings/:customerType", adminMiddleware, async (req, res) => {
  try {
    const { discountPercentage, discountAmount, description, isActive } = req.body;
    if (discountPercentage === undefined && discountAmount === undefined) {
      res.status(400).json({ error: "Persentase atau nominal diskon wajib diisi" });
      return;
    }
    const pct = discountPercentage === undefined ? 0 : Number(discountPercentage);
    const amount = discountAmount === undefined || discountAmount === null || discountAmount === ""
      ? null
      : Number(discountAmount);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      res.status(400).json({ error: "Persentase harus 0–100" });
      return;
    }
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount))) {
      res.status(400).json({ error: "Nominal diskon harus berupa angka bulat 0 atau lebih" });
      return;
    }

    const customerType = String(req.params.customerType);
    const [existing] = await db.select().from(discountSettingsTable)
      .where(eq(discountSettingsTable.customerType, customerType)).limit(1);

    if (existing) {
      const patch: Record<string, unknown> = { discountPercentage: pct, discountAmount: amount };
      if (description !== undefined) patch.description = description;
      if (isActive !== undefined) patch.isActive = !!isActive;
      await db.update(discountSettingsTable).set(patch)
        .where(eq(discountSettingsTable.customerType, customerType));
    } else {
      await db.insert(discountSettingsTable).values({
        customerType,
        discountPercentage: pct,
        discountAmount: amount,
        description: description ?? null,
        isActive: isActive === undefined ? true : !!isActive,
      });
    }

    const [updated] = await db.select().from(discountSettingsTable)
      .where(eq(discountSettingsTable.customerType, customerType)).limit(1);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update discount setting error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
