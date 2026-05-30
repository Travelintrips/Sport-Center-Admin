import { Router } from "express";
import { db, bookingsTable, facilitiesTable, blockedSchedulesTable, maintenanceSchedulesTable, paymentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "#FBBF24",
  waiting_confirmation: "#F97316",
  paid: "#3B82F6",
  confirmed: "#22C55E",
  completed: "#6B7280",
  cancelled: "#EF4444",
  rejected: "#DC2626",
  expired: "#9CA3AF",
  refunded: "#8B5CF6",
  blocked: "#EF4444",
  maintenance: "#8B5CF6",
};

router.get("/admin/calendar", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, facilityId } = req.query;

    let bookings = await db.select().from(bookingsTable);
    if (startDate) bookings = bookings.filter((b) => b.bookingDate >= (startDate as string));
    if (endDate) bookings = bookings.filter((b) => b.bookingDate <= (endDate as string));
    if (facilityId) bookings = bookings.filter((b) => b.facilityId === Number(facilityId));

    let blocked = await db.select().from(blockedSchedulesTable);
    if (startDate) blocked = blocked.filter((b) => b.date >= (startDate as string));
    if (endDate) blocked = blocked.filter((b) => b.date <= (endDate as string));
    if (facilityId) blocked = blocked.filter((b) => b.facilityId === Number(facilityId));

    let maintenance: any[] = [];
    try {
      const allMaintenance = await db.select().from(maintenanceSchedulesTable);
      maintenance = allMaintenance.filter((m) => m.isActive);
      if (facilityId) maintenance = maintenance.filter((m) => m.facilityId === Number(facilityId));
    } catch {
      maintenance = [];
    }

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category }).from(facilitiesTable);
    const facilityMap: Record<number, { name: string; category: string }> = {};
    for (const f of facilities) facilityMap[f.id] = { name: f.name, category: f.category };

    const payments = await db.select().from(paymentsTable);
    const paymentMap: Record<number, { status: string; proofUrl: string | null }> = {};
    for (const p of payments) paymentMap[p.bookingId] = { status: p.status, proofUrl: p.proofUrl };

    const events = [
      ...bookings.map((b) => ({
        id: `booking-${b.id}`,
        type: "booking",
        title: `${b.customerName} – ${facilityMap[b.facilityId]?.name ?? ""}`,
        start: `${b.bookingDate}T${b.startTime}`,
        end: `${b.bookingDate}T${b.endTime}`,
        date: b.bookingDate,
        status: b.status,
        color: STATUS_COLORS[b.status] ?? "#6B7280",
        facilityId: b.facilityId,
        facilityName: facilityMap[b.facilityId]?.name ?? "",
        facilityCategory: facilityMap[b.facilityId]?.category ?? "",
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        orderNumber: b.orderNumber,
        totalPrice: Number(b.totalPrice),
        payment: paymentMap[b.id] ?? null,
      })),
      ...blocked.map((b) => ({
        id: `blocked-${b.id}`,
        type: "blocked",
        title: `[Blokir] ${facilityMap[b.facilityId]?.name ?? ""}: ${b.reason}`,
        start: `${b.date}T${b.startTime}`,
        end: `${b.date}T${b.endTime}`,
        date: b.date,
        status: "blocked",
        color: STATUS_COLORS.blocked,
        facilityId: b.facilityId,
        facilityName: facilityMap[b.facilityId]?.name ?? "",
        reason: b.reason,
      })),
      ...maintenance.map((m) => ({
        id: `maintenance-${m.id}`,
        type: "maintenance",
        title: `[Maintenance] ${facilityMap[m.facilityId]?.name ?? ""}: ${m.title}`,
        start: m.allDay ? m.startDate : `${m.startDate}T${m.startTime ?? "00:00"}`,
        end: m.allDay ? m.endDate : `${m.endDate}T${m.endTime ?? "23:59"}`,
        date: m.startDate,
        status: "maintenance",
        color: STATUS_COLORS.maintenance,
        facilityId: m.facilityId,
        facilityName: facilityMap[m.facilityId]?.name ?? "",
        allDay: m.allDay,
        reason: m.reason,
      })),
    ];

    res.json({ events, facilities });
  } catch (err) {
    req.log.error({ err }, "Calendar error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
