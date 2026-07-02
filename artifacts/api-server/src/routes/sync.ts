import { Router, Request, Response, NextFunction } from "express";
import { db, bookingsTable, facilitiesTable, paymentsTable, usersTable, gymMembershipsTable } from "@workspace/db";
import { desc, gte, and, lte, eq, inArray } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { syncBookingToBizportal, syncMembershipToBizportal, bizportalSyncConfigured } from "../lib/bizportalSync";

const router = Router();

const SYNC_API_KEY_CONFIGURED = Boolean(process.env.BIZPORTAL_SYNC_API_KEY);

function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-api-key"] || req.query.api_key;
  const validKey = process.env.BIZPORTAL_SYNC_API_KEY;
  if (!validKey) {
    res.status(503).json({ error: "Sync API not configured — BIZPORTAL_SYNC_API_KEY not set" });
    return;
  }
  if (!key || key !== validKey) {
    req.log?.warn({ path: req.path, ip: req.ip }, "[sync] Unauthorized API key attempt");
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }
  next();
}

/**
 * GET /api/sync/health
 * Public health check — shows sync configuration status WITHOUT exposing keys.
 */
router.get("/sync/health", (_req, res) => {
  res.json({
    ok: true,
    syncedAt: new Date().toISOString(),
    source: "sport-center",
    pull: {
      configured: SYNC_API_KEY_CONFIGURED,
      endpoints: ["/api/sync/bookings", "/api/sync/facilities", "/api/sync/memberships", "/api/sync/stats"],
      auth: "X-API-Key header required",
    },
    push: {
      configured: bizportalSyncConfigured,
      note: "Sport Center pushes booking/membership events to BizPortal automatically",
    },
  });
});

/**
 * GET /api/sync/bookings
 * Endpoint untuk Bizportal mengambil data booking Sport Center.
 *
 * Query params:
 *   - from        : tanggal mulai (YYYY-MM-DD), default 30 hari lalu
 *   - to          : tanggal akhir (YYYY-MM-DD), default hari ini
 *   - status      : filter status (comma-separated), misal: confirmed,completed
 *   - facilityId  : filter per fasilitas
 *   - limit       : max records (default 500, max 1000)
 *   - offset      : untuk pagination (default 0)
 */
router.get("/sync/bookings", apiKeyMiddleware, async (req, res) => {
  try {
    const { from, to, status, facilityId, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr || "500"), 1000);
    const offset = parseInt(offsetStr || "0");

    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const fromDate = from || thirtyDaysAgo;
    const toDate = to || today;

    const conditions = [
      gte(bookingsTable.bookingDate, fromDate),
      lte(bookingsTable.bookingDate, toDate),
    ];

    let allBookings = await db
      .select()
      .from(bookingsTable)
      .where(and(...conditions))
      .orderBy(desc(bookingsTable.createdAt));

    if (status) {
      const statuses = status.split(",").map((s) => s.trim());
      allBookings = allBookings.filter((b) => statuses.includes(b.status));
    }

    if (facilityId) {
      const fid = parseInt(facilityId);
      allBookings = allBookings.filter((b) => b.facilityId === fid);
    }

    const total = allBookings.length;
    const paged = allBookings.slice(offset, offset + limit);

    const facilityIds = [...new Set(paged.map((b) => b.facilityId))];
    const facilities = facilityIds.length
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category }).from(facilitiesTable)
      : [];

    const bookingIds = paged.map((b) => b.id);
    const payments = bookingIds.length
      ? await db.select().from(paymentsTable).where(inArray(paymentsTable.bookingId, bookingIds))
      : [];

    const customerIds = [...new Set(paged.map((b) => b.customerId).filter(Boolean))] as number[];
    const users = customerIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable)
      : [];

    const result = paged.map((b) => {
      const facility = facilities.find((f) => f.id === b.facilityId);
      const payment = payments.find((p) => p.bookingId === b.id);
      const user = users.find((u) => u.id === b.customerId);

      // Hitung rincian pajak
      const ppnRate    = b.ppnRate    != null ? Number(b.ppnRate)    : null;
      const ppnAmount  = b.ppnAmount  != null ? Math.round(Number(b.ppnAmount))  : null;
      const grandTotal = b.grandTotal != null ? Math.round(Number(b.grandTotal)) : null;
      const dpp        = (ppnAmount != null && grandTotal != null) ? grandTotal - ppnAmount : null;
      const dppNilaiLain = dpp != null ? Math.round(dpp * 11 / 12) : null;

      return {
        id: b.id,
        orderNumber: b.orderNumber,
        status: b.status,
        bookingDate: b.bookingDate,
        startTime: b.startTime,
        endTime: b.endTime,
        durationHours: b.durationHours,
        customerName: b.customerName,
        customerEmail: b.customerEmail,
        customerPhone: b.customerPhone,
        customerType: b.customerType,
        facilityId: b.facilityId,
        facilityName: facility?.name ?? "",
        facilityCategory: facility?.category ?? "",
        totalPrice: Number(b.totalPrice),
        discountAmount: Number(b.discountAmount),
        basePrice: b.basePrice == null ? null : Number(b.basePrice),
        apDiscountAmount: Number(b.apDiscountAmount),
        promoCode: b.promoCode,
        activityType: b.activityType,
        numberOfPeople: b.numberOfPeople,
        notes: b.notes,
        paymentDeadline: b.paymentDeadline,
        checkedInAt: b.checkedInAt,
        completedAt: b.completedAt,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        // Rincian pajak (PPN)
        ppnRate,
        ppnAmount,
        grandTotal,
        dpp,
        dppNilaiLain,
        registeredUser: user ? { id: user.id, name: user.name, email: user.email } : null,
        payment: payment
          ? {
              id: payment.id,
              amount: Number(payment.amount),
              method: payment.paymentMethod,
              status: payment.status,
              proofUrl: payment.proofUrl,
              paidAt: payment.confirmedAt,
              confirmedAt: payment.confirmedAt,
            }
          : null,
      };
    });

    res.json({
      meta: {
        total,
        limit,
        offset,
        from: fromDate,
        to: toDate,
        syncedAt: new Date().toISOString(),
        source: "sport-center",
      },
      data: result,
    });
  } catch (err) {
    req.log.error({ err }, "Sync bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sync/facilities
 * Daftar fasilitas aktif untuk referensi Bizportal.
 */
router.get("/sync/facilities", apiKeyMiddleware, async (req, res) => {
  try {
    const facilities = await db.select().from(facilitiesTable);
    res.json({
      meta: { total: facilities.length, syncedAt: new Date().toISOString(), source: "sport-center" },
      data: facilities.map((f) => ({
        id: f.id,
        name: f.name,
        category: f.category,
        description: f.description,
        pricePerHour: Number(f.pricePerHour),
        openTime: f.openTime,
        closeTime: f.closeTime,
        minDuration: f.minDuration,
        maxDuration: f.maxDuration,
        capacity: f.capacity,
        bookingMode: f.bookingMode,
        isActive: f.isActive,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Sync facilities error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sync/memberships
 * Endpoint untuk Bizportal mengambil data member gym Sport Center.
 *
 * Query params:
 *   - status  : filter status (comma-separated)
 *   - limit   : max records (default 500, max 1000)
 *   - offset  : untuk pagination (default 0)
 */
router.get("/sync/memberships", apiKeyMiddleware, async (req, res) => {
  try {
    const { status, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr || "500"), 1000);
    const offset = parseInt(offsetStr || "0");

    let memberships = await db
      .select()
      .from(gymMembershipsTable)
      .orderBy(desc(gymMembershipsTable.createdAt));

    if (status) {
      const statuses = status.split(",").map((s) => s.trim());
      memberships = memberships.filter((m) => statuses.includes(m.status));
    }

    const total = memberships.length;
    const paged = memberships.slice(offset, offset + limit);

    res.json({
      meta: {
        total,
        limit,
        offset,
        syncedAt: new Date().toISOString(),
        source: "sport-center",
      },
      data: paged.map((m) => ({ ...m, totalPrice: Number(m.totalPrice) })),
    });
  } catch (err) {
    req.log.error({ err }, "Sync memberships error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sync/stats
 * Statistik ringkas harian untuk Bizportal dashboard.
 */
router.get("/sync/stats", apiKeyMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const thisMonth = today.slice(0, 7);

    const allBookings = await db.select().from(bookingsTable);

    const todayBookings = allBookings.filter((b) => b.bookingDate === today);
    const monthBookings = allBookings.filter((b) => b.bookingDate.startsWith(thisMonth));

    const confirmedStatuses = ["confirmed", "completed", "waiting_confirmation", "paid"];

    const totalRevenue = allBookings
      .filter((b) => confirmedStatuses.includes(b.status))
      .reduce((sum, b) => sum + (b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice)), 0);

    const monthRevenue = monthBookings
      .filter((b) => confirmedStatuses.includes(b.status))
      .reduce((sum, b) => sum + (b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice)), 0);

    const byStatus = allBookings.reduce<Record<string, number>>((acc, b) => {
      acc[b.status] = (acc[b.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      syncedAt: new Date().toISOString(),
      source: "sport-center",
      stats: {
        totalBookings: allBookings.length,
        todayBookings: todayBookings.length,
        monthBookings: monthBookings.length,
        totalRevenue,
        monthRevenue,
        byStatus,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Sync stats error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/admin/sync-bizportal
 * Trigger manual full re-sync semua booking ke PROD Bizportal.
 * Hanya bisa diakses oleh admin yang sudah login.
 */
router.post("/admin/sync-bizportal", adminMiddleware, async (req, res) => {
  try {
    const allBookings = await db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt));

    const facilityIds = [...new Set(allBookings.map((b) => b.facilityId))];
    const facilities = facilityIds.length
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category }).from(facilitiesTable)
      : [];

    const facilityMap = new Map(facilities.map((f) => [f.id, { name: f.name, category: f.category }]));

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const booking of allBookings) {
      const facilityInfo = facilityMap.get(booking.facilityId);
      const facilityName = facilityInfo?.name ?? "Unknown";
      const facilityCategory = facilityInfo?.category ?? null;
      try {
        await syncBookingToBizportal({ booking, facilityName, facilityCategory });
        synced++;
      } catch (err: any) {
        failed++;
        errors.push(`${booking.orderNumber}: ${err?.message}`);
      }
    }

    res.json({
      success: true,
      synced,
      failed,
      total: allBookings.length,
      errors: errors.slice(0, 10),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Manual Bizportal sync error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/admin/sync-bizportal-memberships
 * Trigger manual full re-sync semua member gym ke PROD Bizportal.
 */
router.post("/admin/sync-bizportal-memberships", adminMiddleware, async (req, res) => {
  try {
    const allMemberships = await db.select().from(gymMembershipsTable).orderBy(desc(gymMembershipsTable.createdAt));

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const membership of allMemberships) {
      try {
        await syncMembershipToBizportal(membership);
        synced++;
      } catch (err: any) {
        failed++;
        errors.push(`ID ${membership.id}: ${err?.message}`);
      }
    }

    res.json({
      success: true,
      synced,
      failed,
      total: allMemberships.length,
      errors: errors.slice(0, 10),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Manual Bizportal memberships sync error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
