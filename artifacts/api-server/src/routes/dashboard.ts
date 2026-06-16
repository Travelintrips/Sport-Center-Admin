import { Router } from "express";
import { db, bookingsTable, facilitiesTable, gymMembershipsTable, expensesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

router.get("/admin/dashboard", adminMiddleware, async (req, res) => {
  try {
    const [bookings, facilities, memberships, expenses] = await Promise.all([
      db.select().from(bookingsTable),
      db.select().from(facilitiesTable),
      db.select().from(gymMembershipsTable),
      db.select().from(expensesTable),
    ]);

    const today = new Date().toISOString().split("T")[0];

    // Status membership yang sudah terbayar (active = konfirmasi admin, expired = sudah berakhir tapi pernah aktif)
    const PAID_MEMBERSHIP_STATUSES = ["active", "expired"];
    const paidMemberships = memberships.filter((m) => PAID_MEMBERSHIP_STATUSES.includes(m.status));

    const totalBookings = bookings.length;
    const bookingRevenue = bookings
      .filter((b) => !["cancelled", "expired", "rejected"].includes(b.status))
      .reduce((sum, b) => sum + Number(b.totalPrice), 0);
    const membershipRevenue = paidMemberships.reduce((sum, m) => sum + Number(m.totalPrice), 0);
    const totalRevenue = bookingRevenue + membershipRevenue;

    const todayBookings = bookings.filter((b) => b.bookingDate === today).length;
    const pendingBookings = bookings.filter((b) => b.status === "pending_payment").length;
    const activeMemberships = memberships.filter((m) => m.status === "active").length;
    const pendingMemberships = memberships.filter((m) => m.status === "waiting_confirmation").length;

    const bookingsByStatus = ["pending_payment", "paid", "confirmed", "cancelled", "completed"].map((s) => ({
      status: s,
      count: bookings.filter((b) => b.status === s).length,
    }));

    const facilityStats: Record<number, { facilityId: number; facilityName: string; bookingCount: number; revenue: number }> = {};
    bookings.filter((b) => !["cancelled", "expired", "rejected"].includes(b.status)).forEach((b) => {
      if (!facilityStats[b.facilityId]) {
        const fac = facilities.find((f) => f.id === b.facilityId);
        facilityStats[b.facilityId] = { facilityId: b.facilityId, facilityName: fac?.name ?? "", bookingCount: 0, revenue: 0 };
      }
      facilityStats[b.facilityId].bookingCount++;
      facilityStats[b.facilityId].revenue += Number(b.totalPrice);
    });
    const topFacilities = Object.values(facilityStats).sort((a, b) => b.bookingCount - a.bookingCount).slice(0, 5);

    // Gabung revenue booking + membership per bulan
    const monthlyData: Record<string, { month: string; revenue: number; bookings: number; membershipRevenue: number }> = {};
    bookings.filter((b) => !["cancelled", "expired", "rejected"].includes(b.status)).forEach((b) => {
      const month = b.bookingDate.slice(0, 7);
      if (!monthlyData[month]) monthlyData[month] = { month, revenue: 0, bookings: 0, membershipRevenue: 0 };
      monthlyData[month].revenue += Number(b.totalPrice);
      monthlyData[month].bookings++;
    });
    paidMemberships.forEach((m) => {
      const month = m.startDate.slice(0, 7);
      if (!monthlyData[month]) monthlyData[month] = { month, revenue: 0, bookings: 0, membershipRevenue: 0 };
      monthlyData[month].revenue += Number(m.totalPrice);
      monthlyData[month].membershipRevenue += Number(m.totalPrice);
    });
    const revenueByMonth = Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);

    const recentBookings = bookings.slice(-5).reverse().map((b) => {
      const fac = facilities.find((f) => f.id === b.facilityId);
      return { ...b, totalPrice: Number(b.totalPrice), facilityName: fac?.name ?? "", facilityCategory: fac?.category ?? "", payment: null };
    });

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const totalExpenses = expenses
      .filter((e) => !["cancelled", "rejected", "draft"].includes(e.paymentStatus) && e.expenseDate.startsWith(thisMonth))
      .reduce((s, e) => s + Number(e.totalAmount), 0);
    const paidExpenses = expenses
      .filter((e) => e.paymentStatus === "paid" && e.expenseDate.startsWith(thisMonth))
      .reduce((s, e) => s + Number(e.totalAmount), 0);
    const netProfit = totalRevenue - totalExpenses;

    res.json({
      totalBookings,
      totalRevenue,
      bookingRevenue,
      membershipRevenue,
      totalExpenses,
      paidExpenses,
      netProfit,
      todayBookings,
      pendingBookings,
      activeMemberships,
      pendingMemberships,
      topFacilities,
      recentBookings,
      bookingsByStatus,
      revenueByMonth,
    });
  } catch (err) {
    req.log.error({ err }, "Dashboard error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/bookings/export", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let bookings = await db.select().from(bookingsTable);
    const facilities = await db.select().from(facilitiesTable);

    if (startDate) bookings = bookings.filter((b) => b.bookingDate >= (startDate as string));
    if (endDate) bookings = bookings.filter((b) => b.bookingDate <= (endDate as string));

    const header = "Order Number,Customer Name,Customer Email,Customer Phone,Facility,Date,Start Time,End Time,Duration (hours),Total Price,Status,Notes,Admin Notes,Created At\n";
    const rows = bookings.map((b) => {
      const fac = facilities.find((f) => f.id === b.facilityId);
      return [
        b.orderNumber, b.customerName, b.customerEmail, b.customerPhone,
        fac?.name ?? "", b.bookingDate, b.startTime, b.endTime, b.durationHours,
        b.totalPrice, b.status, b.notes ?? "", b.adminNotes ?? "",
        new Date(b.createdAt).toISOString(),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = header + rows.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=bookings.csv");
    res.send(csv);
  } catch (err) {
    req.log.error({ err }, "Export bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
