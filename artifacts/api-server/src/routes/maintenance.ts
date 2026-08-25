import { Router } from "express";
import { db, maintenanceSchedulesTable, facilitiesTable, blockedSchedulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

router.get("/maintenance-schedules", adminMiddleware, async (req, res) => {
  try {
    const { facilityId } = req.query;
    let schedules = await db.select().from(maintenanceSchedulesTable);
    if (facilityId) schedules = schedules.filter((s) => s.facilityId === Number(facilityId));

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const result = schedules.map((s) => ({
      ...s,
      facilityName: facilities.find((f) => f.id === s.facilityId)?.name ?? "",
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List maintenance schedules error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/maintenance-schedules", adminMiddleware, async (req, res) => {
  try {
    const { facilityId, title, maintenanceType, startDate, endDate, startTime, endTime, allDay, reason } = req.body;
    const userInfo = getUserFromReq(req);

    const [schedule] = await db.insert(maintenanceSchedulesTable).values({
      facilityId: Number(facilityId),
      title,
      maintenanceType: maintenanceType || "maintenance",
      startDate,
      endDate,
      startTime: startTime || null,
      endTime: endTime || null,
      allDay: allDay ?? false,
      reason: reason || null,
      createdBy: userInfo.userId || null,
    }).returning();

    // Auto-block schedule in blocked_schedules for availability check
    if (!allDay && startTime && endTime) {
      let currentDate = startDate;
      while (currentDate <= endDate) {
        await db.insert(blockedSchedulesTable).values({
          facilityId: Number(facilityId),
          date: currentDate,
          startTime,
          endTime,
          reason: `[Maintenance] ${title}`,
        }).onConflictDoNothing?.();
        // Advance one day
        const next = new Date(currentDate);
        next.setDate(next.getDate() + 1);
        currentDate = next.toISOString().split("T")[0];
      }
    }

    await logAudit({ ...userInfo, action: "create_maintenance", entity: "maintenance_schedule", entityId: schedule.id, after: schedule, ...getClientInfo(req) });

    res.status(201).json(schedule);
  } catch (err) {
    req.log.error({ err }, "Create maintenance schedule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/maintenance-schedules/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { isActive, title, reason } = req.body;
    const updateData: Record<string, unknown> = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (title !== undefined) updateData.title = title;
    if (reason !== undefined) updateData.reason = reason;

    const [updated] = await db.update(maintenanceSchedulesTable).set(updateData).where(eq(maintenanceSchedulesTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update maintenance schedule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/maintenance-schedules/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    await db.delete(maintenanceSchedulesTable).where(eq(maintenanceSchedulesTable.id, id));
    await logAudit({ ...getUserFromReq(req), action: "delete_maintenance", entity: "maintenance_schedule", entityId: id, ...getClientInfo(req) });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete maintenance schedule error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
