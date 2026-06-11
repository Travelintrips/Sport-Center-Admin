import { Router } from "express";
import { db, bookingsTable, facilitiesTable, paymentsTable, gymMembershipsTable } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/admin/reports", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, facilityId, groupBy = "month" } = req.query;

    const [allBookings, payments, facilities, allMemberships] = await Promise.all([
      db.select().from(bookingsTable),
      db.select().from(paymentsTable),
      db.select().from(facilitiesTable),
      db.select().from(gymMembershipsTable),
    ]);

    let bookings = allBookings;
    if (startDate) bookings = bookings.filter((b) => b.bookingDate >= (startDate as string));
    if (endDate) bookings = bookings.filter((b) => b.bookingDate <= (endDate as string));
    if (facilityId) bookings = bookings.filter((b) => b.facilityId === Number(facilityId));

    // Membership yang sudah terbayar (active = dikonfirmasi admin, expired = sudah berakhir tapi pernah aktif)
    const PAID_MEMBERSHIP_STATUSES = ["active", "expired"];
    let paidMemberships = allMemberships.filter((m) => PAID_MEMBERSHIP_STATUSES.includes(m.status));
    if (startDate) paidMemberships = paidMemberships.filter((m) => m.startDate >= (startDate as string));
    if (endDate) paidMemberships = paidMemberships.filter((m) => m.startDate <= (endDate as string));

    const completed = bookings.filter((b) => !["cancelled", "expired", "rejected"].includes(b.status));
    const facilityMap: Record<number, { name: string; category: string }> = {};
    for (const f of facilities) facilityMap[f.id] = { name: f.name, category: f.category };

    // Helper: hitung period key dari tanggal
    function getPeriodKey(dateStr: string): string {
      if (groupBy === "day") return dateStr;
      if (groupBy === "week") {
        const d = new Date(dateStr);
        const week = Math.ceil(d.getDate() / 7);
        return `${dateStr.slice(0, 7)}-W${week}`;
      }
      if (groupBy === "year") return dateStr.slice(0, 4);
      return dateStr.slice(0, 7);
    }

    // Revenue by period (booking + membership digabung)
    const revenueByPeriod: Record<string, { period: string; revenue: number; bookings: number; membershipRevenue: number; avgTicket: number }> = {};
    for (const b of completed) {
      const period = getPeriodKey(b.bookingDate);
      if (!revenueByPeriod[period]) revenueByPeriod[period] = { period, revenue: 0, bookings: 0, membershipRevenue: 0, avgTicket: 0 };
      revenueByPeriod[period].revenue += Number(b.totalPrice);
      revenueByPeriod[period].bookings++;
    }
    for (const m of paidMemberships) {
      const period = getPeriodKey(m.startDate);
      if (!revenueByPeriod[period]) revenueByPeriod[period] = { period, revenue: 0, bookings: 0, membershipRevenue: 0, avgTicket: 0 };
      revenueByPeriod[period].revenue += Number(m.totalPrice);
      revenueByPeriod[period].membershipRevenue += Number(m.totalPrice);
    }
    const revenueData = Object.values(revenueByPeriod)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((d) => ({ ...d, avgTicket: d.bookings > 0 ? Math.round((d.revenue - d.membershipRevenue) / d.bookings) : 0 }));

    // Revenue by facility (hanya dari booking)
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

    // Revenue by status (booking)
    const revenueByStatus: Record<string, { status: string; count: number; revenue: number }> = {};
    for (const b of bookings) {
      if (!revenueByStatus[b.status]) revenueByStatus[b.status] = { status: b.status, count: 0, revenue: 0 };
      revenueByStatus[b.status].count++;
      revenueByStatus[b.status].revenue += Number(b.totalPrice);
    }

    // Payment method breakdown
    const paymentMethod = { transfer: 0, qris: 0, pending: 0 };
    for (const b of bookings) {
      if (b.status === "confirmed" || b.status === "completed") paymentMethod.transfer++;
      else if (b.status === "pending_payment") paymentMethod.pending++;
    }

    // Summary — gabung booking + membership
    const bookingRevenue = completed.reduce((s, b) => s + Number(b.totalPrice), 0);
    const membershipRevenue = paidMemberships.reduce((s, m) => s + Number(m.totalPrice), 0);
    const totalRevenue = bookingRevenue + membershipRevenue;
    const totalBookings = bookings.length;
    const completedCount = completed.length;
    const cancelledCount = bookings.filter((b) => b.status === "cancelled").length;
    const expiredCount = bookings.filter((b) => b.status === "expired").length;

    // Membership summary
    const membershipSummary = {
      totalMemberships: allMemberships.length,
      activeMemberships: allMemberships.filter((m) => m.status === "active").length,
      pendingMemberships: allMemberships.filter((m) => m.status === "waiting_confirmation").length,
      expiredMemberships: allMemberships.filter((m) => m.status === "expired").length,
      membershipRevenue,
    };

    res.json({
      summary: {
        totalRevenue,
        bookingRevenue,
        membershipRevenue,
        totalBookings,
        completedBookings: completedCount,
        cancelledBookings: cancelledCount,
        expiredBookings: expiredCount,
        avgTicketSize: completedCount > 0 ? Math.round(bookingRevenue / completedCount) : 0,
      },
      membershipSummary,
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
