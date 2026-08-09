import { Router, Request, Response, NextFunction } from "express";
import {
  db,
  bookingsTable,
  facilitiesTable,
  paymentsTable,
  usersTable,
  gymMembershipsTable,
  facilityCompanyMappingsTable,
} from "@workspace/db";

import { desc, gte, and, lte, eq, inArray, isNotNull, sql, asc } from "drizzle-orm";
import { extractBookingDpp } from "../lib/accounting";
import { adminMiddleware, financeMiddleware, superAdminMiddleware } from "../lib/auth";
import { logAudit } from "../lib/auditLog";
import {
  syncBookingToBizportal,
  syncMembershipToBizportal,
  bizportalSyncConfigured,
  bulkPushPaymentsToBizportal,
  countPendingPaymentMirrors,
  auditLegacySportCenterPayments,
  reconcileLegacySportCenterPaymentLinks,
  auditSportCenterPayment,
  dryRunConfirmedPaymentAccounting,
  dryRunSpecificSportCenterPayments,
  dryRunHistoricalOwnership,
  type BulkPaymentPushResult,
} from "../lib/bizportalSync";

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

    // Hitung total revenue — konsisten dengan dashboard.ts:
    // Pribadi: confirmed/completed; Perusahaan: billingStatus=paid
    const totalRevenue = allBookings
      .filter((b) =>
        b.payerType === "company"
          ? b.billingStatus === "paid"
          : ["confirmed", "completed"].includes(b.status),
      )
      .reduce((sum, b) => sum + (b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice)), 0);

    const facilityIds = [...new Set(paged.map((b) => b.facilityId))];
    const facilities = facilityIds.length
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category }).from(facilitiesTable)
      : [];

    const bookingIds = paged.map((b) => b.id);
    const payments = bookingIds.length
      ? await db.select().from(paymentsTable).where(inArray(paymentsTable.bookingId, bookingIds))
      : [];

    // Hitung group total per group_ref dari allBookings (sudah ada di memori, tidak perlu query baru)
    const groupTotalMap: Record<string, number> = {};
    for (const b of allBookings) {
      const ref = (b as any).groupRef as string | null | undefined;
      if (ref) {
        groupTotalMap[ref] = (groupTotalMap[ref] ?? 0) + Number(b.totalPrice);
      }
    }

    const customerIds = [...new Set(paged.map((b) => b.customerId).filter(Boolean))] as number[];
    const users = customerIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.id, customerIds))
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
        // Booking gabungan
        groupRef: (b as any).groupRef ?? null,
        groupTotal: (b as any).groupRef ? (groupTotalMap[(b as any).groupRef] ?? null) : null,
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
              paidAt: payment.paidAt ?? payment.confirmedAt,
              confirmedAt: payment.confirmedAt,
              paymentProvider: payment.paymentProvider,
              providerReference: payment.providerReference,
              merchantTradeNo: payment.merchantTradeNo,
              providerTradeNo: payment.providerTradeNo,
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
        totalRevenue,
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

    // Filter konsisten dengan dashboard.ts: pribadi=confirmed/completed, perusahaan=billingStatus paid
    const isPaidBooking = (b: typeof allBookings[number]) =>
      b.payerType === "company"
        ? b.billingStatus === "paid"
        : ["confirmed", "completed"].includes(b.status);

    const totalRevenue = allBookings
      .filter(isPaidBooking)
      .reduce((sum, b) => sum + (b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice)), 0);

    const monthRevenue = monthBookings
      .filter(isPaidBooking)
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

// In-memory status untuk full re-sync (booking & membership) supaya
// endpoint trigger tidak perlu menunggu (menghindari HTTP timeout untuk
// dataset besar) dan progress-nya bisa dipantau lewat endpoint /status.
type BulkSyncStatus = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  synced: number;
  failed: number;
  errors: string[];
};

function freshStatus(): BulkSyncStatus {
  return { running: false, startedAt: null, finishedAt: null, total: 0, processed: 0, synced: 0, failed: 0, errors: [] };
}

const bulkSyncStatus = {
  bookings: freshStatus(),
  memberships: freshStatus(),
};

/**
 * POST /api/admin/sync-bizportal
 * Trigger manual full re-sync semua booking ke PROD Bizportal.
 * Berjalan di background (tidak menunggu selesai) supaya tidak timeout untuk
 * dataset besar — pantau progress via GET /api/admin/sync-bizportal/status.
 * Hanya bisa diakses oleh admin yang sudah login.
 */
router.post("/admin/sync-bizportal", adminMiddleware, async (req, res) => {
  if (bulkSyncStatus.bookings.running) {
    res.status(409).json({ error: "Resync booking sedang berjalan, tunggu sampai selesai." });
    return;
  }

  try {
    const allBookings = await db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt));

    const facilityIds = [...new Set(allBookings.map((b) => b.facilityId))];
    const facilities = facilityIds.length
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category }).from(facilitiesTable)
      : [];
    const facilityMap = new Map(facilities.map((f) => [f.id, { name: f.name, category: f.category }]));

    bulkSyncStatus.bookings = {
      ...freshStatus(),
      running: true,
      startedAt: new Date().toISOString(),
      total: allBookings.length,
    };

    // Respond immediately — sync jalan di background.
    res.json({ success: true, started: true, total: allBookings.length, statusUrl: "/api/admin/sync-bizportal/status" });

    // Hitung group total untuk setiap groupRef agar BizPortal tidak double-count:
    // - Booking primary dalam grup → total_price = sum semua sesi dalam grup
    // - Booking sibling → total_price = 0
    // Primary ditentukan berdasarkan id terkecil dalam grup (booking pertama dibuat).
    const groupTotals = new Map<string, number>(); // groupRef → total DPP + PPN
    const groupPrimaryIds = new Map<string, number>(); // groupRef → id booking primary

    for (const b of allBookings) {
      if (!b.groupRef) continue;
      const { dpp, ppnAmount } = extractBookingDpp(b);
      groupTotals.set(b.groupRef, (groupTotals.get(b.groupRef) ?? 0) + dpp + ppnAmount);
      const currentPrimary = groupPrimaryIds.get(b.groupRef);
      if (currentPrimary === undefined || b.id < currentPrimary) {
        groupPrimaryIds.set(b.groupRef, b.id);

      }
    }

    // Sync paralel per-batch (bukan satu-satu) supaya cepat selesai untuk
    // dataset besar. Batch kecil menjaga jumlah koneksi simultan ke Supabase
    // tetap wajar (lihat pool `max` di bizportalSync.ts).
    const CONCURRENCY = 8;
    for (let i = 0; i < allBookings.length; i += CONCURRENCY) {
      const batch = allBookings.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((booking) => {
          const facilityInfo = facilityMap.get(booking.facilityId);
          const facilityName = facilityInfo?.name ?? "Unknown";
          const facilityCategory = facilityInfo?.category ?? null;

          // Untuk booking dalam grup: override totalPrice agar tidak double-count di BizPortal
          let bookingToSync = booking;
          if (booking.groupRef) {
            const isPrimary = groupPrimaryIds.get(booking.groupRef) === booking.id;
            if (isPrimary) {
              // Primary menanggung total seluruh grup
              const groupTotal = groupTotals.get(booking.groupRef) ?? Number(booking.totalPrice);
              bookingToSync = { ...booking, totalPrice: String(groupTotal), grandTotal: String(groupTotal) } as any;
            } else {
              // Sibling: total_price = 0 supaya tidak menambah nominal di BizPortal
              bookingToSync = { ...booking, totalPrice: "0", grandTotal: null, dpp: null, ppnAmount: null } as any;
            }
          }

          return syncBookingToBizportal({ booking: bookingToSync, facilityName, facilityCategory });
        }),
      );
      results.forEach((result, idx) => {
        bulkSyncStatus.bookings.processed++;
        if (result.status === "fulfilled") {
          bulkSyncStatus.bookings.synced++;
        } else {
          bulkSyncStatus.bookings.failed++;
          bulkSyncStatus.bookings.errors.push(
            `${batch[idx]!.orderNumber}: ${(result.reason as any)?.message ?? "unknown error"}`,
          );
        }
      });
    }

    bulkSyncStatus.bookings.running = false;
    bulkSyncStatus.bookings.finishedAt = new Date().toISOString();
    bulkSyncStatus.bookings.errors = bulkSyncStatus.bookings.errors.slice(0, 20);
    req.log.info(
      { synced: bulkSyncStatus.bookings.synced, failed: bulkSyncStatus.bookings.failed, total: allBookings.length },
      "[sync] Full booking resync finished",
    );
  } catch (err) {
    bulkSyncStatus.bookings.running = false;
    bulkSyncStatus.bookings.finishedAt = new Date().toISOString();
    req.log.error({ err }, "Manual Bizportal sync error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * GET /api/admin/sync-bizportal/status
 * Cek progress full re-sync booking terakhir (mulai/berjalan/selesai + error).
 */
router.get("/admin/sync-bizportal/status", adminMiddleware, (_req, res) => {
  res.json(bulkSyncStatus.bookings);
});

/**
 * POST /api/admin/sync-bizportal-memberships
 * Trigger manual full re-sync semua member gym ke PROD Bizportal.
 * Sama seperti booking resync — berjalan di background dan bisa dipantau
 * lewat GET /api/admin/sync-bizportal-memberships/status.
 */
router.post("/admin/sync-bizportal-memberships", adminMiddleware, async (req, res) => {
  if (bulkSyncStatus.memberships.running) {
    res.status(409).json({ error: "Resync membership sedang berjalan, tunggu sampai selesai." });
    return;
  }

  try {
    const allMemberships = await db.select().from(gymMembershipsTable).orderBy(desc(gymMembershipsTable.createdAt));

    bulkSyncStatus.memberships = {
      ...freshStatus(),
      running: true,
      startedAt: new Date().toISOString(),
      total: allMemberships.length,
    };

    res.json({
      success: true,
      started: true,
      total: allMemberships.length,
      statusUrl: "/api/admin/sync-bizportal-memberships/status",
    });

    const CONCURRENCY = 8;
    for (let i = 0; i < allMemberships.length; i += CONCURRENCY) {
      const batch = allMemberships.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map((membership) => syncMembershipToBizportal(membership)));
      results.forEach((result, idx) => {
        bulkSyncStatus.memberships.processed++;
        if (result.status === "fulfilled") {
          bulkSyncStatus.memberships.synced++;
        } else {
          bulkSyncStatus.memberships.failed++;
          bulkSyncStatus.memberships.errors.push(
            `ID ${batch[idx]!.id}: ${(result.reason as any)?.message ?? "unknown error"}`,
          );
        }
      });
    }

    bulkSyncStatus.memberships.running = false;
    bulkSyncStatus.memberships.finishedAt = new Date().toISOString();
    bulkSyncStatus.memberships.errors = bulkSyncStatus.memberships.errors.slice(0, 20);
  } catch (err) {
    bulkSyncStatus.memberships.running = false;
    bulkSyncStatus.memberships.finishedAt = new Date().toISOString();
    req.log.error({ err }, "Manual Bizportal memberships sync error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * GET /api/admin/sync-bizportal-memberships/status
 * Cek progress full re-sync membership terakhir.
 */
router.get("/admin/sync-bizportal-memberships/status", adminMiddleware, (_req, res) => {
  res.json(bulkSyncStatus.memberships);
});

// In-memory status untuk payment sync
type PaymentSyncStatus = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  pushed: number;
  skipped: number;
  failed: number;
  errors: string[];
};

let paymentSyncStatus: PaymentSyncStatus = {
  running: false, startedAt: null, finishedAt: null,
  total: 0, pushed: 0, skipped: 0, failed: 0, errors: [],
};

/**
 * POST /api/admin/sync-bizportal-payments
 * Push semua SC payment confirmed ke public.sport_payments BizPortal.
 * Berjalan di background — pantau lewat GET /api/admin/sync-bizportal-payments/status.
 */
router.post("/admin/sync-bizportal-payments", adminMiddleware, async (req, res) => {
  if (paymentSyncStatus.running) {
    res.status(409).json({ error: "Sync payment sedang berjalan, tunggu sampai selesai." });
    return;
  }

  paymentSyncStatus = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0, pushed: 0, skipped: 0, failed: 0, errors: [],
  };

  res.json({ success: true, started: true, statusUrl: "/api/admin/sync-bizportal-payments/status" });

  try {
    const result = await bulkPushPaymentsToBizportal();
    paymentSyncStatus = {
      ...paymentSyncStatus,
      running: false,
      finishedAt: new Date().toISOString(),
      ...result,
      errors: result.errors.slice(0, 20),
    };
    req.log.info(
      { pushed: result.pushed, skipped: result.skipped, failed: result.failed, total: result.total },
      "[sync] Payment sync to BizPortal finished",
    );
  } catch (err: any) {
    paymentSyncStatus.running = false;
    paymentSyncStatus.finishedAt = new Date().toISOString();
    paymentSyncStatus.errors.push(`Fatal: ${err?.message}`);
    req.log.error({ err }, "Payment sync to BizPortal error");
  }
});

/**
 * GET /api/admin/sync-bizportal-payments/status
 * Cek progress payment sync terakhir.
 */
router.get("/admin/sync-bizportal-payments/status", adminMiddleware, (_req, res) => {
  res.json(paymentSyncStatus);
});

/**
 * GET /api/admin/sync-bizportal-payments/pending
 * Rekonsiliasi: hitung berapa confirmed SC payments yang belum ada di BizPortal.
 * Dipakai UI untuk menampilkan badge "X pending" di tombol Sync Bizportal.
 */
router.get("/admin/sync-bizportal-payments/pending", adminMiddleware, async (_req, res) => {
  try {
    const { getProdPool } = await import("../lib/bizportalSync");
    const pool = getProdPool();
    if (!pool) {
      res.json({ pending: 0, configured: false });
      return;
    }

    const pending = await countPendingPaymentMirrors(pool);
    res.json({ pending, configured: true });
  } catch (err: any) {
    res.json({ pending: 0, configured: true, error: err.message });
  }
});

/**
 * GET /api/admin/audit-bizportal-payment-links
 * Audit non-destruktif untuk stream legacy public.accounting_payments.
 * Tidak menghapus accounting_payments, accounting_entries, atau sport_payments.
 */
router.get("/admin/audit-bizportal-payment-links", financeMiddleware, async (_req, res) => {
  try {
    const audit = await auditLegacySportCenterPayments();
    res.json({
      success: true,
      mode: "dry_run",
      policy: "Only unique ref+amount links are eligible; no rows are deleted or voided.",
      ...audit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Legacy payment audit failed" });
  }
});

/**
 * POST /api/admin/reconcile-bizportal-payment-links
 * Dry-run secara default. Kirim { "apply": true } untuk mengisi hanya
 * public.sport_payments.accounting_payment_id pada pasangan deterministik.
 */
router.post("/admin/reconcile-bizportal-payment-links", financeMiddleware, async (req, res) => {
  const apply = req.body?.apply === true;
  try {
    const result = await reconcileLegacySportCenterPaymentLinks({ apply });
    if (apply && result.linkedRows > 0) {
      await logAudit({
        action: "RECONCILE_LEGACY_SPORT_CENTER_PAYMENT_LINKS",
        entity: "sport_payments",
        after: {
          linkedRows: result.linkedRows,
          appliedCandidateCount: result.appliedCandidateCount,
          appliedCandidateAmount: result.appliedCandidateAmount,
          appliedAt: new Date().toISOString(),
          policy: "No payment, accounting entry, or audit row deleted/voided.",
        },
      });
    }
    res.json({
      success: true,
      mode: result.applied ? "apply_safe_links" : "dry_run",
      policy: "Only unique ref+amount links are eligible; no rows are deleted or voided.",
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Legacy payment reconciliation failed" });
  }
});

/**
 * GET /api/admin/audit-sport-center-payment/:sourcePaymentId
 * Read-only validator for source payment → mirror → accounting → GL → tax.
 */
router.get("/admin/audit-sport-center-payment/:sourcePaymentId", financeMiddleware, async (req, res) => {
  const sourcePaymentId = Number(req.params.sourcePaymentId);
  if (!Number.isSafeInteger(sourcePaymentId) || sourcePaymentId <= 0) {
    res.status(400).json({ error: "sourcePaymentId harus berupa integer positif" });
    return;
  }
  try {
    res.json(await auditSportCenterPayment(sourcePaymentId));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Sport Center payment audit failed" });
  }
});

/**
 * GET /api/admin/facility-company-mappings
 * Admin-only ownership configuration surface. This is never public.
 */
router.get("/admin/facility-company-mappings", financeMiddleware, async (req, res) => {
  try {
    const facilityId = req.query.facilityId == null ? null : Number(req.query.facilityId);
    const mappings = await db
      .select({
        id: facilityCompanyMappingsTable.id,
        facilityId: facilityCompanyMappingsTable.facilityId,
        facilityName: facilitiesTable.name,
        companyId: facilityCompanyMappingsTable.companyId,
        companyName: usersTable.companyName,
        companyUserName: usersTable.name,
        effectiveFrom: facilityCompanyMappingsTable.effectiveFrom,
        effectiveUntil: facilityCompanyMappingsTable.effectiveUntil,
        isActive: facilityCompanyMappingsTable.isActive,
        source: facilityCompanyMappingsTable.source,
        notes: facilityCompanyMappingsTable.notes,
        createdBy: facilityCompanyMappingsTable.createdBy,
        updatedBy: facilityCompanyMappingsTable.updatedBy,
        createdAt: facilityCompanyMappingsTable.createdAt,
        updatedAt: facilityCompanyMappingsTable.updatedAt,
      })
      .from(facilityCompanyMappingsTable)
      .innerJoin(facilitiesTable, eq(facilityCompanyMappingsTable.facilityId, facilitiesTable.id))
      .innerJoin(usersTable, eq(facilityCompanyMappingsTable.companyId, usersTable.id))
      .where(facilityId != null ? eq(facilityCompanyMappingsTable.facilityId, facilityId) : undefined)
      .orderBy(asc(facilityCompanyMappingsTable.facilityId), desc(facilityCompanyMappingsTable.effectiveFrom));
    res.json({ readOnly: true, data: mappings });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Ownership mappings failed" });
  }
});

/**
 * POST /api/admin/facility-company-mappings
 * Create one effective-dated mapping. Database FK/trigger/exclusion rules
 * reject unknown companies and overlapping active ownership.
 */
router.post("/admin/facility-company-mappings", superAdminMiddleware, async (req, res) => {
  const body = req.body ?? {};
  const facilityId = Number(body.facilityId);
  const companyId = Number(body.companyId);
  const effectiveFrom = String(body.effectiveFrom ?? "");
  const effectiveUntil = body.effectiveUntil == null || body.effectiveUntil === ""
    ? null
    : String(body.effectiveUntil);
  if (
    !Number.isSafeInteger(facilityId) || facilityId <= 0 ||
    !Number.isSafeInteger(companyId) || companyId <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) ||
    (effectiveUntil != null && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveUntil))
  ) {
    res.status(400).json({ error: "facilityId, companyId, effectiveFrom, effectiveUntil tidak valid" });
    return;
  }
  try {
    const user = (req as any).user ?? {};
    const [mapping] = await db.insert(facilityCompanyMappingsTable).values({
      facilityId,
      companyId,
      effectiveFrom,
      effectiveUntil,
      isActive: body.isActive !== false,
      source: typeof body.source === "string" && body.source.trim() ? body.source.trim() : "admin_config",
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
      createdBy: Number.isSafeInteger(user.userId) ? user.userId : null,
      updatedBy: Number.isSafeInteger(user.userId) ? user.userId : null,
    }).returning();
    await logAudit({
      userId: user.userId,
      userRole: user.role,
      action: "FACILITY_COMPANY_MAPPING_CREATED",
      entity: "facility_company_mapping",
      entityId: mapping?.id ?? null,
      after: mapping,
    });
    res.status(201).json(mapping);
  } catch (err: any) {
    const status = err?.code === "23P01" || err?.code === "23514" || err?.code === "23503" ? 409 : 500;
    res.status(status).json({
      error: err?.code === "23P01"
        ? "OWNERSHIP_MAPPING_OVERLAP"
        : err?.message ?? "Ownership mapping create failed",
    });
  }
});

/**
 * PATCH /api/admin/facility-company-mappings/:id
 * Deactivate or supersede a mapping. Ownership history is retained.
 */
router.patch("/admin/facility-company-mappings/:id", superAdminMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "mapping id tidak valid" });
    return;
  }
  const body = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (body.isActive !== undefined) updates.isActive = body.isActive === true;
  if (body.effectiveUntil !== undefined) {
    updates.effectiveUntil = body.effectiveUntil == null || body.effectiveUntil === "" ? null : String(body.effectiveUntil);
  }
  if (body.notes !== undefined) updates.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Tidak ada perubahan mapping" });
    return;
  }
  try {
    const [before] = await db.select().from(facilityCompanyMappingsTable)
      .where(eq(facilityCompanyMappingsTable.id, id)).limit(1);
    if (!before) {
      res.status(404).json({ error: "Mapping tidak ditemukan" });
      return;
    }
    const user = (req as any).user ?? {};
    const [after] = await db.update(facilityCompanyMappingsTable)
      .set({
        ...updates,
        updatedBy: Number.isSafeInteger(user.userId) ? user.userId : null,
        updatedAt: new Date(),
      } as any)
      .where(eq(facilityCompanyMappingsTable.id, id))
      .returning();
    await logAudit({
      userId: user.userId,
      userRole: user.role,
      action: "FACILITY_COMPANY_MAPPING_UPDATED",
      entity: "facility_company_mapping",
      entityId: id,
      before,
      after,
    });
    res.json(after);
  } catch (err: any) {
    res.status(err?.code === "23P01" || err?.code === "23514" ? 409 : 500).json({
      error: err?.code === "23P01" ? "OWNERSHIP_MAPPING_OVERLAP" : err?.message ?? "Ownership mapping update failed",
    });
  }
});

/**
 * GET /api/admin/audit-sport-center-payments/dry-run
 * Read-only historical gap scan for all confirmed Sport Center payments.
 */
router.get("/admin/audit-sport-center-payments/dry-run", financeMiddleware, async (_req, res) => {
  try {
    res.json({
      success: true,
      mode: "dry_run",
      policy: "No historical payment, mirror, accounting entry, GL line, or tax row is mutated.",
      ...(await dryRunConfirmedPaymentAccounting()),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Sport Center payment dry-run failed" });
  }
});

/**
 * GET /api/admin/audit-sport-center-payments/13-14-dry-run
 * Explicit read-only repair readiness report for the two historical payments.
 */
router.get("/admin/audit-sport-center-payments/13-14-dry-run", financeMiddleware, async (_req, res) => {
  try {
    res.json({
      success: true,
      mode: "dry_run",
      policy: "No UPDATE/INSERT/DELETE is executed.",
      ...(await dryRunSpecificSportCenterPayments([13, 14])),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Specific payment dry-run failed" });
  }
});

/**
 * GET /api/admin/audit-sport-center-ownership/dry-run
 * Read-only classifier for confirmed payments without source company.
 */
router.get("/admin/audit-sport-center-ownership/dry-run", financeMiddleware, async (_req, res) => {
  try {
    res.json(await dryRunHistoricalOwnership());
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Historical ownership dry-run failed" });
  }
});

/**
 * GET /api/sync/payment-groups
 * Endpoint BizPortal: daftar pembayaran yang dikelompokkan per group_ref.
 * - Booking grup → satu baris dengan total_group_amount + child_bookings
 * - Booking individual → satu baris per booking seperti biasa
 *
 * Query params: from, to, status, limit, offset
 */
router.get("/sync/payment-groups", apiKeyMiddleware, async (req, res) => {
  try {
    const { from, to, status, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;
    const limit  = Math.min(parseInt(limitStr  || "500"), 1000);
    const offset = parseInt(offsetStr || "0");
    const today        = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const fromDate = from || thirtyDaysAgo;
    const toDate   = to   || today;

    let allBookings = await db
      .select()
      .from(bookingsTable)
      .where(and(gte(bookingsTable.bookingDate, fromDate), lte(bookingsTable.bookingDate, toDate)))
      .orderBy(desc(bookingsTable.createdAt));

    if (status) {
      const statuses = status.split(",").map((s) => s.trim());
      allBookings = allBookings.filter((b) => statuses.includes(b.status));
    }

    const facilityIds = [...new Set(allBookings.map((b) => b.facilityId))];
    const facilities = facilityIds.length
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category }).from(facilitiesTable)
      : [];
    const facilityMap = new Map(facilities.map((f) => [f.id, f]));

    const bookingIds = allBookings.map((b) => b.id);
    const payments = bookingIds.length
      ? await db.select().from(paymentsTable).where(inArray(paymentsTable.bookingId, bookingIds))
      : [];
    const paymentByBookingId = new Map(payments.map((p) => [p.bookingId, p]));

    // Group by group_ref; individual bookings get their own entry
    const groupMap = new Map<string, typeof allBookings>();
    const individual: typeof allBookings = [];
    for (const b of allBookings) {
      const gRef = (b as any).groupRef as string | null;
      if (gRef) {
        const arr = groupMap.get(gRef) ?? [];
        arr.push(b);
        groupMap.set(gRef, arr);
      } else {
        individual.push(b);
      }
    }

    const groupEntries = [...groupMap.entries()].map(([gRef, members]) => {
      const rep  = members[0]!;
      const totalGroupAmount = members.reduce((s, b) => s + Number(b.totalPrice), 0);
      const payment = paymentByBookingId.get(rep.id);
      return {
        type: "group",
        groupBookingId: gRef,
        groupRef: gRef,
        bookingCount: members.length,
        totalGroupAmount,
        customerName: rep.customerName,
        customerPhone: rep.customerPhone,
        customerEmail: rep.customerEmail,
        status: rep.status,
        firstBookingDate: members.map((b) => b.bookingDate).sort()[0],
        lastBookingDate:  members.map((b) => b.bookingDate).sort().at(-1),
        createdAt: rep.createdAt,
        updatedAt: rep.updatedAt,
        childBookings: members.map((b) => ({
          orderNumber: b.orderNumber,
          facilityName: facilityMap.get(b.facilityId)?.name ?? "",
          bookingDate: b.bookingDate,
          startTime: b.startTime,
          endTime: b.endTime,
          amount: Number(b.totalPrice),
          status: b.status,
        })),
        payment: payment ? {
          id: payment.id,
          amount: Number(payment.amount),
          method: payment.paymentMethod,
          status: payment.status,
          proofUrl: payment.proofUrl,
          confirmedAt: payment.confirmedAt,
           paidAt: payment.paidAt ?? payment.confirmedAt,
           paymentProvider: payment.paymentProvider,
           providerName: payment.providerName,
           providerId: payment.providerId,
           providerOrderId: payment.providerOrderId,
           bankAccountId: payment.bankAccountId,
           providerReference: payment.providerReference,
           merchantTradeNo: payment.merchantTradeNo,
           providerTradeNo: payment.providerTradeNo,
        } : null,
      };
    });

    const individualEntries = individual.map((b) => {
      const facility = facilityMap.get(b.facilityId);
      const payment  = paymentByBookingId.get(b.id);
      return {
        type: "individual",
        groupBookingId: null,
        groupRef: null,
        bookingCount: 1,
        totalGroupAmount: Number(b.totalPrice),
        orderNumber: b.orderNumber,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        customerEmail: b.customerEmail,
        facilityName: facility?.name ?? "",
        bookingDate: b.bookingDate,
        startTime: b.startTime,
        endTime: b.endTime,
        status: b.status,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        payment: payment ? {
          id: payment.id,
          amount: Number(payment.amount),
          method: payment.paymentMethod,
          status: payment.status,
          proofUrl: payment.proofUrl,
          confirmedAt: payment.confirmedAt,
           paidAt: payment.paidAt ?? payment.confirmedAt,
           paymentProvider: payment.paymentProvider,
           providerName: payment.providerName,
           providerId: payment.providerId,
           providerOrderId: payment.providerOrderId,
           bankAccountId: payment.bankAccountId,
           providerReference: payment.providerReference,
           merchantTradeNo: payment.merchantTradeNo,
           providerTradeNo: payment.providerTradeNo,
        } : null,
      };
    });

    const allEntries = [...groupEntries, ...individualEntries]
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const total  = allEntries.length;
    const paged  = allEntries.slice(offset, offset + limit);

    res.json({
      meta: { total, limit, offset, from: fromDate, to: toDate, syncedAt: new Date().toISOString(), source: "sport-center" },
      data: paged,
    });
  } catch (err) {
    req.log.error({ err }, "Sync payment-groups error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
