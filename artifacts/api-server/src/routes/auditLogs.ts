import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/admin/audit-logs", adminMiddleware, async (req, res) => {
  try {
    const { limit = "100", offset = "0", action, entity } = req.query;
    let logs = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt));

    if (action) logs = logs.filter((l) => l.action === action);
    if (entity) logs = logs.filter((l) => l.entity === entity);

    const total = logs.length;
    const paginated = logs.slice(parseInt(String(offset)), parseInt(String(offset)) + parseInt(String(limit)));

    res.json({ total, logs: paginated });
  } catch (err) {
    req.log.error({ err }, "Audit logs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
