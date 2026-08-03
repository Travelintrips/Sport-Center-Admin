import { Router } from "express";
import { db, paylabsSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

async function getOrCreate() {
  const [existing] = await db
    .select()
    .from(paylabsSettingsTable)
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(paylabsSettingsTable)
    .values({})
    .returning();
  return created;
}

// GET /api/admin/paylabs/settings
router.get("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const config = await getOrCreate();
    res.json(config);
  } catch (err) {
    req.log.error({ err }, "GET paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/paylabs/settings
router.patch("/admin/paylabs/settings", adminMiddleware, async (req, res) => {
  try {
    const current = await getOrCreate();

    const ALLOWED = [
      "title",
      "description",
      "sendInvoice",
      "chargeCustomer",
      "newOrderStatus",
      "debugMode",
      "sandboxMode",
      "storeId",
      "sandboxPublicKey",
      "sandboxPrivateKey",
      "sandboxMerchantId",
      "prodPublicKey",
      "prodPrivateKey",
      "prodMerchantId",
      "paymentMethodsConfig",
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in req.body) patch[key] = req.body[key];
    }

    const [updated] = await db
      .update(paylabsSettingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(paylabsSettingsTable.id, current.id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH paylabs settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
