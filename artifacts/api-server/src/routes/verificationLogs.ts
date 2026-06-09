import { Router } from "express";
import { db, verificationLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/verification-logs", adminMiddleware, async (req, res) => {
  try {
    const bookingId = req.query.bookingId ? parseInt(String(req.query.bookingId)) : undefined;
    const limit = Math.min(parseInt(String(req.query.limit || "100")), 500);

    let rows = await db
      .select()
      .from(verificationLogsTable)
      .orderBy(desc(verificationLogsTable.createdAt))
      .limit(limit);

    if (bookingId) {
      rows = rows.filter((r) => r.bookingId === bookingId);
    }

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "List verification logs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
