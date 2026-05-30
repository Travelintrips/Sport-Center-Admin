import { Router } from "express";
import { db, bookingsTable, facilitiesTable, paymentsTable } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/admin/reports", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, facilityId, groupBy = "month" } = req.query;

    let bookings = await db.select().from(bookingsTable);
    let payments = await db.select().from(paymentsTable);
    const facilities = await db.select().from(facilitiesTable);

    if (startDate) bookings = bookings.filter((b) => b.bookingDate >= (startDate as string));
    if (endDate) bookings = bookings.filter((b) => b.bookingDate <= (endDate as string));
    if (facilityId) bookings = bookings.filter((b) => b.facilityId === Number(facilityId));

    const completed = bookings.filter((b) => !["cancelled", "expired", "rejected"].includes(b.status));
    const facilityMap: Record<number, { name: string; category: string }> = {};
    for (const f of facilities) facilityMap[f.id] = { name: f.name, category: f.category };

    // Revenue by period
    const revenueByPeriod: Record<string, { period: string; revenue: number; bookings: number; avgTicket: number }> = {};
    for (const b of completed) {
      let period = "";
      if (groupBy === "day") period = b.bookingDate;
      else if (groupBy === "week") {
        const d = new Date(b.bookingDate);
        const week = Math.ceil(d.getDate() / 7);
        period = `${b.bookingDate.slice(0, 7)}-W${week}`;
      } else if (groupBy === "year") period = b.bookingDate.slice(0, 4);
      else period = b.bookingDate.slice(0, 7);

      if (!revenueByPeriod[period]) revenueByPeriod[period] = { period, revenue: 0, bookings: 0, avgTicket: 0 };
      revenueByPeriod[period].revenue += Number(b.totalPrice);
      revenueByPeriod[period].bookings++;
    }
    const revenueData = Object.values(revenueByPeriod)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((d) => ({ ...d, avgTicket: d.bookings > 0 ? Math.round(d.revenue / d.bookings) : 0 }));

    // Revenue by facility
    const revenueByFacility: Record<number, { facilityId: number; facilityName: string; category: string; revenue: number; bookings: number }> = {};
    for (const b of completed) {
      if (!revenueByFacility[b.facilityId]) {
        revenueByFacility[b.facilityId] = {
          facilityId: b.facilityId,
          facilityName: facilityMap[b.facilityId]?.name ?? "",
          category: facilityMap[b.facilityId]?.category ?? "",
          revenue: 0,
          bookings: 0,
        };
      }
      revenueByFacility[b.facilityId].revenue += Number(b.totalPrice);
      revenueByFacility[b.facilityId].bookings++;
    }

    // Revenue by status
    const revenueByStatus: Record<string, { status: string; count: number; revenue: number }> = {};
    for (const b of bookings) {
      if (!revenueByStatus[b.status]) revenueByStatus[b.status] = { status: b.status, count: 0, revenue: 0 };
      revenueByStatus[b.status].count++;
      revenueByStatus[b.status].revenue += Number(b.totalPrice);
    }

    // Payment method breakdown (manual transfer vs QRIS)
    const paymentMethod = { transfer: 0, qris: 0, pending: 0 };
    for (const b of bookings) {
      if (b.status === "confirmed" || b.status === "completed") paymentMethod.transfer++;
      else if (b.status === "pending_payment") paymentMethod.pending++;
    }

    // Summary
    const totalRevenue = completed.reduce((s, b) => s + Number(b.totalPrice), 0);
    const totalBookings = bookings.length;
    const completedCount = completed.length;
    const cancelledCount = bookings.filter((b) => b.status === "cancelled").length;
    const expiredCount = bookings.filter((b) => b.status === "expired").length;

    res.json({
      summary: {
        totalRevenue,
        totalBookings,
        completedBookings: completedCount,
        cancelledBookings: cancelledCount,
        expiredBookings: expiredCount,
        avgTicketSize: completedCount > 0 ? Math.round(totalRevenue / completedCount) : 0,
      },
      revenueByPeriod: revenueData,
      revenueByFacility: Object.values(revenueByFacility).sort((a, b) => b.revenue - a.revenue),
      revenueByStatus: Object.values(revenueByStatus),
      paymentMethod,
    });
  } catch (err) {
    req.log.error({ err }, "Reports error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/reports/export — export CSV
router.get("/admin/reports/export", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let bookings = await db.select().from(bookingsTable);
    const facilities = await db.select().from(facilitiesTable);
    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;

    if (startDate) bookings = bookings.filter((b) => b.bookingDate >= (startDate as string));
    if (endDate) bookings = bookings.filter((b) => b.bookingDate <= (endDate as string));

    const header = "Order Number,Customer,Email,Phone,Facility,Date,Start,End,Duration,Base Price,Discount,Total Price,Status,Customer Type,Created At\n";
    const rows = bookings.map((b) => [
      b.orderNumber, b.customerName, b.customerEmail, b.customerPhone,
      facilityMap[b.facilityId] ?? "", b.bookingDate, b.startTime, b.endTime,
      b.durationHours, b.basePrice ?? b.totalPrice, b.discountAmount, b.totalPrice,
      b.status, b.customerType, new Date(b.createdAt).toISOString(),
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=report_${new Date().toISOString().split("T")[0]}.csv`);
    res.send(header + rows);
  } catch (err) {
    req.log.error({ err }, "Export report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
