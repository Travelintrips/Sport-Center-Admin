import { Router } from "express";
import { db, notificationTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

router.get("/notification-templates", adminMiddleware, async (req, res) => {
  try {
    const templates = await db.select().from(notificationTemplatesTable);
    res.json(templates);
  } catch (err) {
    req.log.error({ err }, "List notification templates error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/notification-templates/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [before] = await db.select().from(notificationTemplatesTable).where(eq(notificationTemplatesTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: "Not found" }); return; }

    const { name, body, subject, isActive } = req.body;
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (body !== undefined) updateData.body = body;
    if (subject !== undefined) updateData.subject = subject;
    if (isActive !== undefined) updateData.isActive = isActive;
    updateData.updatedAt = new Date();

    const [updated] = await db.update(notificationTemplatesTable).set(updateData).where(eq(notificationTemplatesTable.id, id)).returning();

    await logAudit({
      ...getUserFromReq(req),
      action: "update_notification_template",
      entity: "notification_template",
      entityId: id,
      before,
      after: updated,
      ...getClientInfo(req),
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update notification template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
