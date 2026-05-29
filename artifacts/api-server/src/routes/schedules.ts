import { Router } from "express";
import { db, blockedSchedulesTable, facilitiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { broadcastAvailabilityChange } from "../lib/supabase";

const router = Router();

router.get("/blocked-schedules", async (req, res) => {
  try {
    const { facilityId, date } = req.query;
    let schedules = await db.select({
      id: blockedSchedulesTable.id,
      facilityId: blockedSchedulesTable.facilityId,
      date: blockedSchedulesTable.date,
      startTime: blockedSchedulesTable.startTime,
      endTime: blockedSchedulesTable.endTime,
      reason: blockedSchedulesTable.reason,
      facilityName: facilitiesTable.name,
    }).from(blockedSchedulesTable)
      .leftJoin(facilitiesTable, eq(blockedSchedulesTable.facilityId, facilitiesTable.id));

    if (facilityId) schedules = schedules.filter((s) => s.facilityId === Number(facilityId));
    if (date) schedules = schedules.filter((s) => s.date === date);
    res.json(schedules);
  } catch (err) {
    req.log.error({ err }, "List blocked schedules error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/blocked-schedules", adminMiddleware, async (req, res) => {
  try {
    const { facilityId, date, startTime, endTime, reason } = req.body;
    const [schedule] = await db.insert(blockedSchedulesTable).values({
      facilityId: Number(facilityId), date, startTime, endTime, reason,
    }).returning();
    broadcastAvailabilityChange(Number(facilityId), date);
    res.status(201).json({ ...schedule, facilityName: null });
  } catch (err) {
    req.log.error({ err }, "Create blocked schedule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/blocked-schedules/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [deleted] = await db.delete(blockedSchedulesTable)
      .where(eq(blockedSchedulesTable.id, id))
      .returning();
    if (deleted) broadcastAvailabilityChange(deleted.facilityId, deleted.date);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete blocked schedule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
