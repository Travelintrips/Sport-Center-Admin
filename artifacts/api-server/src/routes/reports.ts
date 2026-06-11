import { Router } from "express";
import { db, bookingsTable, facilitiesTable, paymentsTable, gymMembershipsTable, taxTransactionsTable } from "@workspace/db";
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

    const PAID_MEMBERSHIP_STATUSES = ["active", "expired"];
    let paidMemberships = allMemberships.filter((m) => PAID_MEMBERSHIP_STATUSES.includes(m.status));
    if (startDate) paidMemberships = paidMemberships.filter((m) => m.startDate >= (startDate as string));
    if (endDate) paidMemberships = paidMemberships.filter((m) => m.startDate <= (endDate as string));

    const completed = bookings.filter((b) => !["cancelled", "expired", "rejected"].includes(b.status));
    const facilityMap: Record<number, { name: string; category: string }> = {};
    for (const f of facilities) facilityMap[f.id] = { name: f.name, category: f.category };

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

    const revenueByStatus: Record<string, { status: string; count: number; revenue: number }> = {};
    for (const b of bookings) {
      if (!revenueByStatus[b.status]) revenueByStatus[b.status] = { status: b.status, count: 0, revenue: 0 };
      revenueByStatus[b.status].count++;
      revenueByStatus[b.status].revenue += Number(b.totalPrice);
    }

    const paymentMethod = { transfer: 0, qris: 0, pending: 0 };
    for (const b of bookings) {
      if (b.status === "confirmed" || b.status === "completed") paymentMethod.transfer++;
      else if (b.status === "pending_payment") paymentMethod.pending++;
    }

    const bookingRevenue = completed.reduce((s, b) => s + Number(b.totalPrice), 0);
    const membershipRevenue = paidMemberships.reduce((s, m) => s + Number(m.totalPrice), 0);
    const totalRevenue = bookingRevenue + membershipRevenue;
    const totalBookings = bookings.length;
    const completedCount = completed.length;
    const cancelledCount = bookings.filter((b) => b.status === "cancelled").length;
    const expiredCount = bookings.filter((b) => b.status === "expired").length;

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

// ─── ENHANCED TAX REPORT ────────────────────────────────────────────────────

router.get("/admin/tax-report", adminMiddleware, async (req, res) => {
  try {
    const {
      startDate, endDate,
      facilityId, customerType, paymentStatus, company,
      groupBy = "month",
    } = req.query;

    const [allTransactions, allBookings, facilities] = await Promise.all([
      db.select().from(taxTransactionsTable),
      db.select().from(bookingsTable),
      db.select().from(facilitiesTable),
    ]);

    const facilityMap: Record<number, { name: string; category: string }> = {};
    for (const f of facilities) facilityMap[f.id] = { name: f.name, category: f.category };

    const bookingMap: Record<number, typeof allBookings[0]> = {};
    for (const b of allBookings) bookingMap[b.id] = b;

    let transactions = allTransactions;
    if (startDate) transactions = transactions.filter((t) => t.transactionDate >= (startDate as string));
    if (endDate) transactions = transactions.filter((t) => t.transactionDate <= (endDate as string));

    // Build enriched list
    let enriched = transactions.map((t) => {
      const booking = t.referenceType === "booking" ? (bookingMap[t.referenceId] ?? null) : null;
      const facility = booking ? (facilityMap[booking.facilityId] ?? null) : null;
      const dpp = Number(t.dpp);
      const taxAmount = Number(t.taxAmount);
      return {
        id: t.id,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        referenceNumber: t.referenceNumber,
        taxCode: t.taxCode,
        taxRate: Number(t.taxRate),
        dpp,
        taxAmount,
        grandTotal: dpp + taxAmount,
        transactionDate: t.transactionDate,
        status: t.status ?? "posted",
        transactionType: t.transactionType ?? "original",
        reversalOfId: t.reversalOfId ?? null,
        createdAt: t.createdAt,
        // Booking fields
        customerName: booking?.customerName ?? null,
        customerEmail: booking?.customerEmail ?? null,
        customerPhone: booking?.customerPhone ?? null,
        customerType: booking?.customerType ?? null,
        payerType: booking?.payerType ?? "personal",
        paymentStatus: booking?.status ?? null,
        bookingDate: booking?.bookingDate ?? null,
        facilityId: booking?.facilityId ?? null,
        facilityName: facility?.name ?? null,
        facilityCategory: facility?.category ?? null,
        companyName: booking?.payerType === "company" ? (booking?.bookedForName ?? booking?.customerName ?? null) : null,
        npwp: null as string | null,
        npwpKeterangan: booking?.payerType === "company"
          ? "Perusahaan"
          : "Retail/Non-NPWP",
      };
    });

    // Apply booking-level filters
    if (facilityId && facilityId !== "all") {
      enriched = enriched.filter((t) => t.facilityId === Number(facilityId));
    }
    if (customerType && customerType !== "all") {
      enriched = enriched.filter((t) => t.customerType === customerType);
    }
    if (paymentStatus && paymentStatus !== "all") {
      enriched = enriched.filter((t) => t.paymentStatus === paymentStatus);
    }
    if (company === "true") {
      enriched = enriched.filter((t) => t.payerType === "company");
    }

    // Only count non-reversed originals for summary
    const activeOriginals = enriched.filter(
      (t) => t.transactionType === "original" && t.status !== "reversed"
    );
    const totalDpp = activeOriginals.reduce((s, t) => s + t.dpp, 0);
    const totalTaxAmount = activeOriginals.reduce((s, t) => s + t.taxAmount, 0);

    // By period
    const byPeriodMap: Record<string, {
      period: string; dpp: number; taxAmount: number; grandTotal: number; count: number;
    }> = {};
    for (const t of activeOriginals) {
      let period = t.transactionDate;
      if (groupBy === "month") period = t.transactionDate.slice(0, 7);
      else if (groupBy === "year") period = t.transactionDate.slice(0, 4);
      if (!byPeriodMap[period]) byPeriodMap[period] = { period, dpp: 0, taxAmount: 0, grandTotal: 0, count: 0 };
      byPeriodMap[period].dpp += t.dpp;
      byPeriodMap[period].taxAmount += t.taxAmount;
      byPeriodMap[period].grandTotal += t.dpp + t.taxAmount;
      byPeriodMap[period].count++;
    }

    // SPT Masa PPN — grouped by YYYY-MM
    const sptByMasa: Record<string, {
      masaPajak: string; dpp: number; ppnKeluaran: number; count: number;
      items: {
        nomorInvoice: string; tanggalPajak: string;
        customer: string; npwp: string | null; npwpKeterangan: string;
        dpp: number; ppnKeluaran: number; taxCode: string;
      }[];
    }> = {};
    for (const t of activeOriginals) {
      const masaPajak = t.transactionDate.slice(0, 7);
      if (!sptByMasa[masaPajak]) {
        sptByMasa[masaPajak] = { masaPajak, dpp: 0, ppnKeluaran: 0, count: 0, items: [] };
      }
      sptByMasa[masaPajak].dpp += t.dpp;
      sptByMasa[masaPajak].ppnKeluaran += t.taxAmount;
      sptByMasa[masaPajak].count++;
      sptByMasa[masaPajak].items.push({
        nomorInvoice: t.referenceNumber,
        tanggalPajak: t.transactionDate,
        customer: t.customerName ?? "-",
        npwp: t.npwp,
        npwpKeterangan: t.npwpKeterangan,
        dpp: t.dpp,
        ppnKeluaran: t.taxAmount,
        taxCode: t.taxCode,
      });
    }

    res.json({
      summary: {
        totalDpp,
        totalTaxAmount,
        totalGrandTotal: totalDpp + totalTaxAmount,
        totalTransactions: activeOriginals.length,
      },
      byPeriod: Object.values(byPeriodMap).sort((a, b) => a.period.localeCompare(b.period)),
      sptMasa: Object.values(sptByMasa).sort((a, b) => a.masaPajak.localeCompare(b.masaPajak)),
      transactions: enriched
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    });
  } catch (err) {
    req.log.error({ err }, "Tax report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// CSV export for tax report
router.get("/admin/tax-report/export/csv", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, facilityId, customerType, paymentStatus, company } = req.query;

    const [allTransactions, allBookings, facilities] = await Promise.all([
      db.select().from(taxTransactionsTable),
      db.select().from(bookingsTable),
      db.select().from(facilitiesTable),
    ]);

    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;
    const bookingMap: Record<number, typeof allBookings[0]> = {};
    for (const b of allBookings) bookingMap[b.id] = b;

    let transactions = allTransactions;
    if (startDate) transactions = transactions.filter((t) => t.transactionDate >= (startDate as string));
    if (endDate) transactions = transactions.filter((t) => t.transactionDate <= (endDate as string));

    let enriched = transactions.map((t) => {
      const booking = t.referenceType === "booking" ? (bookingMap[t.referenceId] ?? null) : null;
      return {
        ...t,
        dpp: Number(t.dpp),
        taxAmount: Number(t.taxAmount),
        booking,
        facilityName: booking ? (facilityMap[booking.facilityId] ?? "") : "",
      };
    });

    if (facilityId && facilityId !== "all") enriched = enriched.filter((t) => t.booking?.facilityId === Number(facilityId));
    if (customerType && customerType !== "all") enriched = enriched.filter((t) => t.booking?.customerType === customerType);
    if (paymentStatus && paymentStatus !== "all") enriched = enriched.filter((t) => t.booking?.status === paymentStatus);
    if (company === "true") enriched = enriched.filter((t) => t.booking?.payerType === "company");

    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "No", "Nomor Invoice", "Tipe", "Customer", "Fasilitas", "Tipe Customer",
      "Tipe Pembayar", "Status Pembayaran", "Kode Pajak", "Tarif PPN (%)",
      "DPP (Rp)", "PPN (Rp)", "Grand Total (Rp)", "Tanggal Transaksi",
      "Status Pajak", "Tipe Transaksi", "NPWP/Keterangan",
    ].map(escape).join(",");

    const rows = enriched
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((t, i) => [
        i + 1,
        t.referenceNumber,
        t.referenceType,
        t.booking?.customerName ?? "",
        t.facilityName,
        t.booking?.customerType ?? "",
        t.booking?.payerType ?? "personal",
        t.booking?.status ?? "",
        t.taxCode,
        Number(t.taxRate),
        t.dpp,
        t.taxAmount,
        t.dpp + t.taxAmount,
        t.transactionDate,
        t.status ?? "posted",
        t.transactionType ?? "original",
        t.booking?.payerType === "company" ? "Perusahaan" : "Retail/Non-NPWP",
      ].map(escape).join(",")).join("\n");

    const filename = `laporan-ppn-${startDate ?? "all"}-${endDate ?? "all"}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + header + "\n" + rows);
  } catch (err) {
    req.log.error({ err }, "Tax CSV export error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// CSV export for SPT Masa PPN
router.get("/admin/tax-report/export/spt-masa", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, facilityId, customerType, paymentStatus, company } = req.query;

    const [allTransactions, allBookings, facilities] = await Promise.all([
      db.select().from(taxTransactionsTable),
      db.select().from(bookingsTable),
      db.select().from(facilitiesTable),
    ]);

    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;
    const bookingMap: Record<number, typeof allBookings[0]> = {};
    for (const b of allBookings) bookingMap[b.id] = b;

    let transactions = allTransactions.filter(
      (t) => (t.transactionType ?? "original") === "original" && (t.status ?? "posted") !== "reversed"
    );
    if (startDate) transactions = transactions.filter((t) => t.transactionDate >= (startDate as string));
    if (endDate) transactions = transactions.filter((t) => t.transactionDate <= (endDate as string));

    let enriched = transactions.map((t) => {
      const booking = t.referenceType === "booking" ? (bookingMap[t.referenceId] ?? null) : null;
      return { ...t, dpp: Number(t.dpp), taxAmount: Number(t.taxAmount), booking, facilityName: booking ? (facilityMap[booking.facilityId] ?? "") : "" };
    });

    if (facilityId && facilityId !== "all") enriched = enriched.filter((t) => t.booking?.facilityId === Number(facilityId));
    if (customerType && customerType !== "all") enriched = enriched.filter((t) => t.booking?.customerType === customerType);
    if (paymentStatus && paymentStatus !== "all") enriched = enriched.filter((t) => t.booking?.status === paymentStatus);
    if (company === "true") enriched = enriched.filter((t) => t.booking?.payerType === "company");

    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Masa Pajak", "Nomor Invoice", "Tanggal", "Customer",
      "NPWP", "Keterangan NPWP", "DPP (Rp)", "PPN Keluaran (Rp)", "Kode Pajak",
    ].map(escape).join(",");

    const sorted = enriched.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
    const rows = sorted.map((t) => [
      t.transactionDate.slice(0, 7),
      t.referenceNumber,
      t.transactionDate,
      t.booking?.customerName ?? "",
      "",
      t.booking?.payerType === "company" ? "Perusahaan" : "Retail/Non-NPWP",
      t.dpp,
      t.taxAmount,
      t.taxCode,
    ].map(escape).join(",")).join("\n");

    const filename = `spt-masa-ppn-${startDate ?? "all"}-${endDate ?? "all"}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + header + "\n" + rows);
  } catch (err) {
    req.log.error({ err }, "SPT Masa export error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
