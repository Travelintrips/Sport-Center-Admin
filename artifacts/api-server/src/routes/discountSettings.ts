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
    const { discountPercentage, description, isActive } = req.body;
    if (discountPercentage === undefined) {
      res.status(400).json({ error: "Persentase diskon wajib diisi" });
      return;
    }
    const pct = Number(discountPercentage);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      res.status(400).json({ error: "Persentase harus 0–100" });
      return;
    }

    const customerType = String(req.params.customerType);
    const [existing] = await db.select().from(discountSettingsTable)
      .where(eq(discountSettingsTable.customerType, customerType)).limit(1);

    if (existing) {
      const patch: Record<string, unknown> = { discountPercentage: pct };
      if (description !== undefined) patch.description = description;
      if (isActive !== undefined) patch.isActive = !!isActive;
      await db.update(discountSettingsTable).set(patch)
        .where(eq(discountSettingsTable.customerType, customerType));
    } else {
      await db.insert(discountSettingsTable).values({
        customerType,
        discountPercentage: pct,
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
