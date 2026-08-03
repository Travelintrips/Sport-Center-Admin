import { Router } from "express";
import { db, paylabsSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

async function getOrCreate() {
  const [row] = await db.select().from(paylabsSettingsTable).limit(1);
  if (row) return row;
  const [newRow] = await db.insert(paylabsSettingsTable).values({}).returning();
  return newRow;
}

// GET /api/admin/paylabs/settings
router.get("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreate();
    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "GET paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/paylabs/settings
router.patch("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreate();

    const ALLOWED = [
      "title", "description", "sendInvoice", "chargeCustomer",
      "newOrderStatus", "debugMode", "sandboxMode", "storeId",
      "sandboxPublicKey", "sandboxPrivateKey", "sandboxMerchantId",
      "prodPublicKey", "prodPrivateKey", "prodMerchantId",
      "paymentMethodsConfig",
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in req.body) patch[key] = req.body[key];
    }

    if (Object.keys(patch).length === 0) return res.json(settings);

    const [updated] = await db
      .update(paylabsSettingsTable)
      .set(patch)
      .where(eq(paylabsSettingsTable.id, settings.id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
