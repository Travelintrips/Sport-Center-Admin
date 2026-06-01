import { Router } from "express";
import { db, pricingRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { calculatePrice } from "../lib/pricing";

const router = Router();

router.get("/pricing-rules", adminMiddleware, async (req, res) => {
  try {
    const { facilityId } = req.query;
    let rules = await db.select().from(pricingRulesTable);
    if (facilityId) rules = rules.filter((r) => r.facilityId === Number(facilityId));
    res.json(rules.map((r) => ({
      ...r,
      priceOverride: r.priceOverride ? Number(r.priceOverride) : null,
      priceAddon: r.priceAddon ? Number(r.priceAddon) : null,
      priceMultiplier: r.priceMultiplier ? Number(r.priceMultiplier) : null,
    })));
  } catch (err) {
    req.log.error({ err }, "List pricing rules error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pricing-rules", adminMiddleware, async (req, res) => {
  try {
    const { facilityId, name, ruleType, dayType, peakStartTime, peakEndTime, priceOverride, priceAddon, priceMultiplier, priority } = req.body;
    const [rule] = await db.insert(pricingRulesTable).values({
      facilityId: facilityId ? Number(facilityId) : null,
      name,
      ruleType,
      dayType: dayType || null,
      peakStartTime: peakStartTime || null,
      peakEndTime: peakEndTime || null,
      priceOverride: priceOverride != null ? String(priceOverride) : null,
      priceAddon: priceAddon != null ? String(priceAddon) : null,
      priceMultiplier: priceMultiplier != null ? String(priceMultiplier) : null,
      priority: priority || 0,
    }).returning();

    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);
    await logAudit({ ...userInfo, action: "create_pricing_rule", entity: "pricing_rule", entityId: rule.id, after: rule, ...clientInfo });

    res.status(201).json(rule);
  } catch (err) {
    req.log.error({ err }, "Create pricing rule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/pricing-rules/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [before] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: "Not found" }); return; }

    const { name, ruleType, dayType, peakStartTime, peakEndTime, priceOverride, priceAddon, priceMultiplier, priority, isActive } = req.body;
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (ruleType !== undefined) updateData.ruleType = ruleType;
    if (dayType !== undefined) updateData.dayType = dayType;
    if (peakStartTime !== undefined) updateData.peakStartTime = peakStartTime;
    if (peakEndTime !== undefined) updateData.peakEndTime = peakEndTime;
    if (priceOverride !== undefined) updateData.priceOverride = priceOverride != null ? String(priceOverride) : null;
    if (priceAddon !== undefined) updateData.priceAddon = priceAddon != null ? String(priceAddon) : null;
    if (priceMultiplier !== undefined) updateData.priceMultiplier = priceMultiplier != null ? String(priceMultiplier) : null;
    if (priority !== undefined) updateData.priority = priority;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updated] = await db.update(pricingRulesTable).set(updateData).where(eq(pricingRulesTable.id, id)).returning();

    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);
    await logAudit({ ...userInfo, action: "update_pricing_rule", entity: "pricing_rule", entityId: id, before, after: updated, ...clientInfo });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update pricing rule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/pricing-rules/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    await db.delete(pricingRulesTable).where(eq(pricingRulesTable.id, id));
    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);
    await logAudit({ ...userInfo, action: "delete_pricing_rule", entity: "pricing_rule", entityId: id, ...clientInfo });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete pricing rule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /pricing/calculate — preview price calculation
router.post("/pricing/calculate", async (req, res) => {
  try {
    const { facilityId, bookingDate, startTime, endTime, durationHours } = req.body;
    const result = await calculatePrice(Number(facilityId), bookingDate, startTime, endTime, Number(durationHours));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Calculate price error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
