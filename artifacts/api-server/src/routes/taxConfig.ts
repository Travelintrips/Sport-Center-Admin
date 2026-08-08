import { Router } from "express";
import { db, taxSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { getPpnConfig } from "../lib/tax";

const router = Router();

/**
 * GET /admin/tax-config/ppn
 * Returns current PPN settings for admin display.
 */
router.get("/admin/tax-config/ppn", adminMiddleware, async (req, res) => {
  try {
    const config = await getPpnConfig();
    res.json(config);
  } catch (err) {
    req.log.error({ err }, "Get PPN config error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /admin/tax-config/ppn
 * Update PPN settings: enabled, taxRate, effectiveDate.
 *
 * Body: { enabled?: boolean, taxRate?: number, effectiveDate?: string | null }
 *
 * Backward-compatibility contract:
 * - Setting effectiveDate means PPN is only applied to bookings on/after that date.
 * - Setting effectiveDate to null/empty removes the restriction.
 * - Disabling (enabled=false) disables PPN for ALL new bookings.
 * - Historical data (existing bookings + tax_transactions) is NEVER modified.
 */
router.patch("/admin/tax-config/ppn", adminMiddleware, async (req, res) => {
  try {
    const { enabled, taxRate, effectiveDate } = req.body as {
      enabled?: boolean;
      taxRate?: number;
      effectiveDate?: string | null;
    };

    // Find the existing sport_booking tax setting
    const [existing] = await db
      .select()
      .from(taxSettingsTable)
      .where(eq(taxSettingsTable.appliesTo, "sport_booking"))
      .limit(1);

    const patch: Record<string, unknown> = {};

    if (typeof enabled === "boolean") patch.isActive = enabled;

    if (taxRate !== undefined) {
      const rate = Number(taxRate);
      if (Number.isNaN(rate) || rate < 0 || rate > 100) {
        res.status(400).json({ error: "taxRate harus 0–100" });
        return;
      }
      patch.taxRate = String(rate);
    }

    if (effectiveDate !== undefined) {
      // Validate format YYYY-MM-DD if provided
      if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        res.status(400).json({ error: "effectiveDate harus format YYYY-MM-DD" });
        return;
      }
      patch.effectiveDate = effectiveDate || null;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Tidak ada field yang diupdate" });
      return;
    }

    if (existing) {
      await db
        .update(taxSettingsTable)
        .set(patch)
        .where(eq(taxSettingsTable.id, existing.id));
    } else {
      // Auto-seed the row if it doesn't exist yet
      await db.insert(taxSettingsTable).values({
        taxCode: "PPN_OUT_11",
        taxName: "PPN Keluaran 11%",
        taxRate: String(taxRate ?? 11),
        taxType: "output_vat",
        appliesTo: "sport_booking",
        isActive: typeof enabled === "boolean" ? enabled : true,
        effectiveDate: effectiveDate || null,
      });
    }

    const config = await getPpnConfig();
    res.json(config);
  } catch (err) {
    req.log.error({ err }, "Update PPN config error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
