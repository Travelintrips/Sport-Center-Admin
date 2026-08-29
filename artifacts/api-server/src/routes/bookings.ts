import { Router } from "express";
import { db, bookingsTable, facilitiesTable, paymentsTable, promosTable, discountSettingsTable, apMembersTable, bookingHistoryTable, usersTable, verificationLogsTable, companyUsersTable, bookingGroupsTable, settingsTable, waActionTokensTable, waNotifLogsTable, paylabsSettingsTable } from "@workspace/db";
import { eq, and, sql, or, ilike, desc, inArray, notExists, gte } from "drizzle-orm";
import { adminMiddleware, authMiddleware, verifyToken } from "../lib/auth";
import { broadcastAvailabilityChange } from "../lib/supabase";
import { checkSlotAvailable, closeTimeToMinutes, getEffectiveCloseTime } from "../lib/availability";
import { checkInBooking, completeBooking, hasBookingSessionEnded } from "../lib/bookingLifecycle";
import { calculateEventDiscount } from "../lib/bookingPricing";

import {
  notifyBookingCreated,
  notifyPaymentConfirmed,
  notifyBookingCancelled,
  notifyCompanyBookingCreated,
  notifyDpPaid,
  notifyWaAdminNewBooking,
  notifyRecurringBookingGroupCreated,
  notifyAdminBookingApprovalRequest,
  notifyPaymentProofUploaded,
} from "../lib/notifications";
import { sendInvoiceToCustomer, sendGroupInvoiceToCustomer } from "../lib/invoiceDelivery";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { createWaToken } from "../lib/waTokens";

import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { syncBookingToBizportal, syncStatusToBizportal, deleteBookingFromBizportal, pushConfirmedPaymentAsBankMutation } from "../lib/bizportalSync";
import { getBaseUrl } from "../lib/appUrl";
import { calculateTax, recordTaxTransaction, reverseTaxTransaction } from "../lib/tax";
import { reverseJournalEntry, reversePublicAccountingEntry } from "../lib/accounting";

const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];
const AP_MULTIGUNA_HOURLY_PRICE = 300000;

const PAYLABS_METHOD_LABELS: Record<string, string> = {
  qris: "Paylabs - QRIS",
  bri: "Paylabs - BRI Virtual Account",
  bca: "Paylabs - BCA Virtual Account",
  bni: "Paylabs - BNI VA",
  mandiri: "Paylabs - Mandiri VA",
  permata: "Paylabs - Permata VA",
  cimb: "Paylabs - CIMB VA",
  btn: "Paylabs - BTN VA",
  danamon: "Paylabs - Danamon VA",
  maybank: "Paylabs - Maybank VA",
  bsi: "Paylabs - BSI VA",
  muamalat: "Paylabs - Muamalat Virtual Account",
  sinarmas: "Paylabs - Sinarmas VA",
  ina: "Paylabs - INA VA",
};

function resolvePaylabsDisplayLabel(
  rawMethod: unknown,
  configuredMethods: Array<{ id?: unknown; name?: unknown }>,
): string | undefined {
  const code = String(rawMethod ?? "").trim().toLowerCase();
  if (!code) return undefined;
  const configured = configuredMethods.find(
    (method) =>
      String(method.id ?? "").trim().toLowerCase() === code &&
      typeof method.name === "string" &&
      method.name.trim(),
  );
  return configured?.name?.toString().trim() || PAYLABS_METHOD_LABELS[code];
}

// Helper: kirim rekap hanya jika tanggal booking = hari ini (WIB)
function todayWIB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function triggerRekapIfToday(bookingDate: string): void {
  if (bookingDate === todayWIB()) {
    sendRekapPemakaianToAdmin(bookingDate).catch((err) =>
      logger.error({ err }, "[REKAP] Gagal kirim rekap pemakaian (bookings)"),
    );
  }
}

const router = Router();

function isMultigunaFacility(facility: { name?: string | null; category?: string | null }): boolean {
  const normalized = `${facility.name ?? ""} ${facility.category ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return normalized.includes("multiguna");
}

function isGymFacility(facility: {
  name?: string | null;
  category?: string | null;
  bookingMode?: string | null;
}): boolean {
  return (
    facility.bookingMode === "walk_in" ||
    /gym|fitness/i.test(facility.name ?? "") ||
    /gym|fitness/i.test(facility.category ?? "")
  );
}

function getApDiscount(basePrice: number, setting: {
  discountPercentage?: number | null;
  discountAmount?: number | null;
}, isMultiguna: boolean, durationHours: number): { amount: number; percentage: number; finalPrice: number } {
  if (isMultiguna) {
    const finalPrice = Math.min(basePrice, AP_MULTIGUNA_HOURLY_PRICE * durationHours);
    const amount = Math.max(0, basePrice - finalPrice);
    return {
      amount,
      finalPrice,
      percentage: basePrice > 0 ? Number(((amount / basePrice) * 100).toFixed(2)) : 0,
    };
  }

  const fixedAmount = Number(setting.discountAmount ?? 0);
  const percentage = Number(setting.discountPercentage ?? 0);
  const amount = fixedAmount > 0
    ? Math.min(Math.round(fixedAmount), Math.max(0, basePrice))
    : Math.min(Math.round((basePrice * percentage) / 100), Math.max(0, basePrice));
  return {
    amount,
    finalPrice: Math.max(0, basePrice - amount),
    percentage: basePrice > 0 ? Number(((amount / basePrice) * 100).toFixed(2)) : 0,
  };
}

// ─── POST /bookings/track-payer-selection — log when customer toggles payer type ──
router.post("/bookings/track-payer-selection", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
    const payload = verifyToken(authHeader.slice(7));
    if (!payload?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { selection } = req.body; // 'personal' | 'corporate'
    if (!["personal", "corporate"].includes(String(selection))) { res.status(400).json({ error: "Invalid selection" }); return; }
    logAudit({
      userId: payload.userId,
      userName: (payload as any).name ?? null,
      userRole: payload.role ?? null,
      action: selection === "corporate" ? "CUSTOMER_SELECTED_CORPORATE" : "CUSTOMER_SELECTED_PERSONAL",
      entity: "booking_form",
      ...getClientInfo(req),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

async function generateOrderNumber(): Promise<string> {
  // Advisory lock (bigint namespace) serializes order number generation across concurrent requests
  await db.execute(sql`SELECT pg_advisory_lock(42001)`);
  try {
    const rows = await db.select({ orderNumber: bookingsTable.orderNumber }).from(bookingsTable);
    let maxNum = 0;
    for (const row of rows) {
      const match = row.orderNumber.match(/^SC-(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    const next = maxNum + 1;
    return `SC-${String(next).padStart(4, "0")}`;
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(42001)`);
  }
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMinutes = h * 60 + (m || 0) + hours * 60;
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}

async function getBookingWithPayment(id: number) {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
  if (!booking) return null;
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const allPayments = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, id));
  allPayments.sort((a, b) => a.id - b.id);
  const payment =
    allPayments.find((p) => p.status === "pending" || p.status === "confirmed") ??
    allPayments[allPayments.length - 1] ??
    null;

  // Jika booking bagian dari grup recurring, ambil info grup
  let groupInfo: { groupTotalPayment: number; groupSessionCount: number; groupRef: string } | null = null;
  if (booking.groupRef) {
    const [group] = await db.select().from(bookingGroupsTable)
      .where(eq(bookingGroupsTable.groupRef, booking.groupRef)).limit(1);
    const groupBookings = await db.select({ id: bookingsTable.id })
      .from(bookingsTable).where(eq(bookingsTable.groupRef, booking.groupRef));
    if (group) {
      groupInfo = {
        groupRef: booking.groupRef,
        groupTotalPayment: Number(group.totalPayment),
        groupSessionCount: groupBookings.length,
      };
    }
  }

  const payableTotal = groupInfo?.groupTotalPayment ?? (
    booking.grandTotal != null ? Number(booking.grandTotal) : Number(booking.totalPrice)
  );

  // idCardNumber adalah PII — jangan ekspos di endpoint publik (customer invoice).
  const { idCardNumber: _redacted, ...rest } = booking;
  return {
    ...rest,
    idCardNumber: null,
    totalPrice: Number(booking.totalPrice),
    discountAmount: Number(booking.discountAmount),
    basePrice: booking.basePrice == null ? null : Number(booking.basePrice),
    apDiscountAmount: Number(booking.apDiscountAmount),
    facilityName: facility?.name ?? "",
    facilityCategory: facility?.category ?? "",
    facilityPricePerHour: facility ? Number(facility.pricePerHour) : null,
    facilityCloseTime: facility?.closeTime ?? null,
    ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
    dpp: booking.dpp == null ? null : Number(booking.dpp),
    ppnAmount: booking.ppnAmount == null ? null : Number(booking.ppnAmount),
    grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
    downPayment: Number(booking.downPayment ?? 0),
    isDpPaid: booking.isDpPaid ?? false,
    payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
    payments: allPayments.map((p) => ({ ...p, amount: Number(p.amount) })),
    remainingAmount: (() => {
      const total = payableTotal;

      const confirmedDp = allPayments
        .filter((p) => p.paymentType === "dp" && p.status === "confirmed")
        .reduce((s, p) => s + Number(p.amount), 0);
      const dpAmt = Number(booking.downPayment ?? 0);
      return Math.max(0, total - (confirmedDp > 0 ? confirmedDp : dpAmt));
    })(),
    groupInfo,
  };
}

router.get("/bookings", adminMiddleware, async (req, res) => {
  try {
    const { status, date, facilityId, customerId, customerPhone } = req.query;
    let bookings = await db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt));
    if (status) bookings = bookings.filter((b) => b.status === status);
    if (date) bookings = bookings.filter((b) => b.bookingDate === date);
    if (facilityId) bookings = bookings.filter((b) => b.facilityId === Number(facilityId));
    if (customerId) bookings = bookings.filter((b) => b.customerId === Number(customerId));
    if (customerPhone) bookings = bookings.filter((b) => b.customerPhone === String(customerPhone));

    const facilityIds = [...new Set(bookings.map((b) => b.facilityId))];
    const facilities = facilityIds.length > 0
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category })
          .from(facilitiesTable)
      : [];

    const bookingIds = bookings.map((b) => b.id);
    const allPayments = bookingIds.length > 0 ? await db.select().from(paymentsTable) : [];

    // Legacy Paylabs rows may have been inserted with only the provider code
    // ("bni", "bri", etc.). Resolve that code from the original transaction
    // for the admin list so old bookings show the selected VA bank too.
    const paylabsMethodByBookingId = new Map<number, string>();
    if (bookingIds.length > 0) {
      try {
        const txRows = await db.execute(sql`
          SELECT DISTINCT ON (booking_id) booking_id, payment_method
          FROM sport_center.paylabs_transactions
          WHERE booking_id IN (${sql.join(bookingIds.map((id) => sql`${id}`), sql`, `)})
          ORDER BY booking_id, created_at DESC
        `);
        const rows = (txRows as any).rows ?? txRows;
        for (const row of rows as Array<{ booking_id?: unknown; payment_method?: unknown }>) {
          if (row.booking_id != null && row.payment_method != null) {
            paylabsMethodByBookingId.set(Number(row.booking_id), String(row.payment_method));
          }
        }
      } catch (err) {
        // The transaction table is created lazily for older databases. The
        // booking list must remain available while that table is unavailable.
        req.log.warn({ err }, "Paylabs transaction lookup skipped for booking list");
      }
    }

    let paylabsLabels: Array<{ id?: unknown; name?: unknown }> = [];
    try {
      const [paylabsSettings] = await db
        .select({ paymentMethodsConfig: paylabsSettingsTable.paymentMethodsConfig })
        .from(paylabsSettingsTable)
        .limit(1);
      paylabsLabels = Array.isArray(paylabsSettings?.paymentMethodsConfig)
        ? paylabsSettings.paymentMethodsConfig as Array<{ id?: unknown; name?: unknown }>
        : [];
    } catch (err) {
      req.log.warn({ err }, "Paylabs method label lookup skipped for booking list");
    }

    // Ambil companyName dari usersTable untuk booking perusahaan
    const companyCustomerIds = [...new Set(bookings.map((b) => b.companyCustomerId).filter((id): id is number => id != null))];
    const companyUsers = companyCustomerIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name, companyName: usersTable.companyName })
          .from(usersTable)
          .where(inArray(usersTable.id, companyCustomerIds))
      : [];
    const companyNameById: Record<number, string> = {};
    for (const u of companyUsers) {
      companyNameById[u.id] = u.companyName ?? u.name ?? "";
    }

    const paymentsByBookingId: Record<number, typeof allPayments> = {};
    for (const p of allPayments) {
      if (!paymentsByBookingId[p.bookingId]) paymentsByBookingId[p.bookingId] = [];
      paymentsByBookingId[p.bookingId].push(p);
    }

    const result = bookings.map((b) => {
      const facility = facilities.find((f) => f.id === b.facilityId);
      const bPayments = paymentsByBookingId[b.id] ?? [];
      const payment =
        bPayments.find((p) => p.status === "pending" || p.status === "confirmed") ??
        bPayments[bPayments.length - 1] ??
        null;
      const transactionPaylabsCode = paylabsMethodByBookingId.get(b.id)?.trim().toLowerCase();
      const paymentMethodCode = String(payment?.paymentMethod ?? "").trim().toLowerCase();
      const configuredPaymentCode = paylabsLabels.some((method) =>
        String(method.id ?? "").trim().toLowerCase() === paymentMethodCode,
      );
      const isPaylabsQrisPayment = payment?.paymentProvider === "paylabs" &&
        (paymentMethodCode === "qris" || paymentMethodCode === "paylabs - qris");
      const isDirectQrisPayment = payment?.paymentProvider === "mandiri_direct" &&
        paymentMethodCode === "qris";
      // Some older Paylabs finalization paths wrote the selected provider code
      // directly to sport_payments without leaving a usable transaction lookup
      // in the list query. Prefer the transaction code, then use the stored
      // code when it matches a configured Paylabs method. A QRIS Direct payment
      // can still have a historical Paylabs transaction row, but that row must
      // not overwrite the corrected QRIS Direct label.
      const canUsePaylabsLegacyLabel = !isDirectQrisPayment &&
        (payment?.paymentProvider === "paylabs" || configuredPaymentCode || Boolean(transactionPaylabsCode));
      const legacyPaylabsCode = canUsePaylabsLegacyLabel
        ? (transactionPaylabsCode
          ?? (isPaylabsQrisPayment ? "qris" : undefined)
          ?? (configuredPaymentCode ? paymentMethodCode : undefined))
        : undefined;
      const selectedPaylabsLabel = legacyPaylabsCode
        ? resolvePaylabsDisplayLabel(legacyPaylabsCode, paylabsLabels)
        : undefined;
      const paymentForResponse = payment && selectedPaylabsLabel &&
        canUsePaylabsLegacyLabel
        ? { ...payment, paymentMethod: selectedPaylabsLabel }
        : payment;
      const paymentsForResponse = bPayments.map((p) => {
        const paymentCode = String(p.paymentMethod ?? "").trim().toLowerCase();
        const isPaylabsQris = p.paymentProvider === "paylabs" &&
          (paymentCode === "qris" || paymentCode === "paylabs - qris");
        const isDirectQris = p.paymentProvider === "mandiri_direct" && paymentCode === "qris";
        const isPaylabsPayment = p.paymentProvider === "paylabs"
          || paymentCode === transactionPaylabsCode
          || paylabsLabels.some((method) =>
            String(method.id ?? "").trim().toLowerCase() === paymentCode,
          );
        const label = isPaylabsPayment && !isDirectQris
          ? resolvePaylabsDisplayLabel(isPaylabsQris ? "qris" : paymentCode, paylabsLabels)
          : undefined;
        return {
          ...p,
          paymentMethod: label ?? p.paymentMethod,
          amount: Number(p.amount),
        };
      });
      const grandTotalNum = b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice);
      const dpAmt = Number(b.downPayment ?? 0);
      return {
        ...b,
        companyName: b.companyCustomerId ? (companyNameById[b.companyCustomerId] ?? "") : null,
        totalPrice: Number(b.totalPrice),
        discountAmount: Number(b.discountAmount),
        basePrice: b.basePrice == null ? null : Number(b.basePrice),
        apDiscountAmount: Number(b.apDiscountAmount),
        bookingType: b.bookingType ?? "regular",
        eventDiscountAmount: b.eventDiscountAmount == null ? null : Number(b.eventDiscountAmount),
        ppnRate: b.ppnRate == null ? null : Number(b.ppnRate),
        dpp: b.dpp == null ? null : Number(b.dpp),
        ppnAmount: b.ppnAmount == null ? null : Number(b.ppnAmount),
        grandTotal: b.grandTotal == null ? null : Number(b.grandTotal),
        downPayment: dpAmt,
        isDpPaid: b.isDpPaid ?? false,
        facilityName: facility?.name ?? "",
        facilityCategory: facility?.category ?? "",
        payment: paymentForResponse ? { ...paymentForResponse, amount: Number(paymentForResponse.amount) } : null,
        payments: paymentsForResponse,
        remainingAmount: (() => {
          const confirmedDp = bPayments
            .filter((p) => p.paymentType === "dp" && p.status === "confirmed")
            .reduce((sum, p) => sum + Number(p.amount), 0);
          return Math.max(0, grandTotalNum - (confirmedDp > 0 ? confirmedDp : dpAmt));
        })(),
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

function timeToMinutesLocal(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function normalizePhone(raw: string): string {
  let p = String(raw ?? "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (!p.startsWith("62")) p = "62" + p;
  return p;
}

async function generateCustomerCode(): Promise<string> {
  await db.execute(sql`SELECT pg_advisory_lock(42002)`);
  try {
    const rows = await db.select({ code: usersTable.customerCode }).from(usersTable);
    let max = 0;
    for (const row of rows) {
      const m = (row.code ?? "").match(/^C(\d+)$/);
      if (m) { const n = parseInt(m[1]); if (n > max) max = n; }
    }
    return `C${String(max + 1).padStart(5, "0")}`;
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(42002)`);
  }
}

function getTodayWIB(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().split("T")[0];
}

function getNowMinutesWIB(): number {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

router.post("/bookings", async (req, res) => {
  // Declared outside try so the catch block can release the advisory lock on error
  let slotLockKey: { fId: number; dInt: number } | null = null;
  try {
    const { customerName, customerEmail, facilityId, bookingDate, notes, promoCode, discountAmount, customerType } = req.body;
    const customerPhone: string = normalizePhone(String(req.body.customerPhone ?? "").trim());
    const bookingSource: string = req.body.source || "";
    const rawBookingType = req.body.bookingType;
    const bookingType: "regular" | "event" = rawBookingType === "event" ? "event" : "regular";
    const isEvent = bookingType === "event";
    let { startTime, durationHours } = req.body;

    // Deteksi user yang sedang login (opsional — tidak wajib)
    let loggedInUserId: number | null = null;
    let loggedInUser: (typeof usersTable.$inferSelect) | null = null;
    let loggedInRole: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const payload = verifyToken(authHeader.slice(7));
      if (payload?.userId) {
        loggedInUserId = payload.userId;
        loggedInRole = payload.role ?? null;
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
        if (u) loggedInUser = u;
      }
    }
    // Deteksi apakah request berasal dari admin (role selain customer)
    const isAdminRequest = !!loggedInRole && loggedInRole !== "customer";

    // Deteksi apakah company customer dengan tagihan bulanan
    // Prioritas 1: explicit companyCustomerId di body — HANYA boleh dari admin
    // Prioritas 2: customerId di body yang merujuk ke company customer — HANYA dari admin
    // Prioritas 3: loggedInUser sendiri adalah company customer (dari token customer)
    // Prioritas 4: logged-in customer memilih company billing via verifikasi karyawan
    let companyBillingUser: (typeof usersTable.$inferSelect) | null = null;
    // Pending: ada company_users link tapi belum approved/enabled → waiting_confirmation
    let pendingCompanyUser: (typeof usersTable.$inferSelect) | null = null;
    // Admin mengirim companyCustomerId dari form Perusahaan (non-admin pun bisa kirim untuk Prioritas 4)
    const explicitCompanyId = req.body.companyCustomerId ? Number(req.body.companyCustomerId) : null;
    const bodyCustomerId = isAdminRequest && req.body.customerId ? Number(req.body.customerId) : null;
    if (explicitCompanyId && isAdminRequest) {
      const [cu] = await db.select().from(usersTable).where(eq(usersTable.id, explicitCompanyId)).limit(1);
      if (cu?.accountType === "company") {
        if (cu.allowMonthlyBilling) {
          companyBillingUser = cu;
        } else {
          // Perusahaan terdaftar tapi billing belum diaktifkan → pending
          pendingCompanyUser = cu;
        }
      }
    } else if (loggedInUser?.accountType === "company" && explicitCompanyId === loggedInUserId) {
      // Prioritas 3a: akun perusahaan booking untuk dirinya sendiri (companyCustomerId = userId sendiri)
      if (loggedInUser.allowMonthlyBilling) {
        companyBillingUser = loggedInUser;
      } else {
        pendingCompanyUser = loggedInUser;
      }
    } else if (bodyCustomerId && !explicitCompanyId) {
      // Admin membooking atas nama user perusahaan — infer dari customerId
      const [cu] = await db.select().from(usersTable).where(eq(usersTable.id, bodyCustomerId)).limit(1);
      if (cu?.accountType === "company" && cu?.allowMonthlyBilling) companyBillingUser = cu;
    } else if (loggedInUser?.accountType === "company" && loggedInUser?.allowMonthlyBilling) {
      companyBillingUser = loggedInUser;
    } else if (!isAdminRequest && loggedInUserId && req.body.payerType === "company" && explicitCompanyId) {
      // Prioritas 4: customer yang sudah diverifikasi sebagai karyawan memilih tagih ke perusahaan
      const [companyUserRecord] = await db.select().from(companyUsersTable)
        .where(and(
          eq(companyUsersTable.customerId, loggedInUserId),
          eq(companyUsersTable.companyId, explicitCompanyId),
          eq(companyUsersTable.verificationStatus, "approved"),
          eq(companyUsersTable.corporateBillingEnabled, true),
        ))
        .limit(1);
      if (companyUserRecord) {
        const [companyAccount] = await db.select().from(usersTable)
          .where(eq(usersTable.id, explicitCompanyId)).limit(1);
        if (companyAccount) companyBillingUser = companyAccount;
      } else {
        // Ada company_users link tapi pending atau billing belum aktif
        const [pendingRecord] = await db.select().from(companyUsersTable)
          .where(and(
            eq(companyUsersTable.customerId, loggedInUserId),
            eq(companyUsersTable.companyId, explicitCompanyId),
          )).limit(1);
        if (pendingRecord) {
          const [companyAccount] = await db.select().from(usersTable)
            .where(eq(usersTable.id, explicitCompanyId)).limit(1);
          if (companyAccount) pendingCompanyUser = companyAccount;
        }
      }
    }
    const isCompanyBilling = !!companyBillingUser;
    const isPendingCompany = !isCompanyBilling && !!pendingCompanyUser;
    const effectiveCompanyCustomerId = companyBillingUser?.id ?? pendingCompanyUser?.id ?? null;
    const activityType = req.body.activityType || null;
    let numberOfPeople = req.body.numberOfPeople == null ? null : Number(req.body.numberOfPeople);
    const idCardNumber = String(req.body?.idCardNumber || "").trim().toUpperCase() || null;

    const isAp = customerType === "angkasa_pura";
    if (isAp && !idCardNumber) {
      res.status(400).json({ error: "Nomor ID Card wajib untuk customer Angkasa Pura" });
      return;
    }

    // ── Security: personal user TIDAK BOLEH submit payerType=company tanpa verifikasi ──
    const requestedPayerType = req.body.payerType;
    if (!isAdminRequest && requestedPayerType === "company" && !isCompanyBilling && !isPendingCompany) {
      res.status(403).json({
        error: "Booking Corporate tidak diizinkan. Anda harus menjadi karyawan terverifikasi perusahaan terlebih dahulu.",
      });
      return;
    }

    // ── Fetch settings untuk payment_deadline_hours ──────────────────────────
    const [appSettings] = await db.select({
      paymentDeadlineHours: settingsTable.paymentDeadlineHours,
    }).from(settingsTable).limit(1);
    const deadlineHours = Math.max(1, parseInt(appSettings?.paymentDeadlineHours ?? "24") || 24);

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, Number(facilityId))).limit(1);
    if (!facility) {
      res.status(404).json({ error: "Facility not found" });
      return;
    }

    // Legacy Gym records may still have booking_mode = time_slot. Gym access
    // is per visit, so identify it by name/category as a safe fallback.
    const isWalkIn = isGymFacility(facility);

    if (isWalkIn) {
      // Gym walk-in: no time slot required, flat rate per visit
      if (numberOfPeople == null) numberOfPeople = 1;
      if (!Number.isInteger(numberOfPeople) || numberOfPeople < 1 || numberOfPeople > 20) {
        res.status(400).json({ error: "Jumlah orang harus berupa bilangan bulat antara 1 dan 20" });
        return;
      }
      startTime = facility.openTime;
      durationHours = 1;
    } else {
      // Jumlah orang hanya berlaku untuk fasilitas walk-in seperti gym.
      numberOfPeople = null;
      // Time slot booking validations
      if (!startTime || !durationHours) {
        res.status(400).json({ error: "startTime and durationHours required" });
        return;
      }
      const parsedDurationHours = Number(durationHours);
      if (!Number.isInteger(parsedDurationHours) || parsedDurationHours < 1) {
        res.status(400).json({ error: "durationHours harus berupa bilangan bulat minimal 1 jam" });
        return;
      }
      durationHours = parsedDurationHours;

      // Validate slot is not in the past (dilewati untuk admin/operator)
      if (!isAdminRequest) {
        const todayWIB = getTodayWIB();
        if (bookingDate < todayWIB) {
          res.status(400).json({ error: "Tidak dapat booking tanggal yang sudah lewat" });
          return;
        }
        if (bookingDate === todayWIB) {
          const slotMinutes = timeToMinutesLocal(startTime);
          const nowMinutes = getNowMinutesWIB();
          if (slotMinutes <= nowMinutes) {
            res.status(400).json({ error: "Tidak dapat booking slot yang sudah lewat" });
            return;
          }
        }
      }

      // Validate within operating hours
      const openMin = timeToMinutesLocal(facility.openTime);
      const effectiveCloseTime = getEffectiveCloseTime(facility);
      const closeMin = closeTimeToMinutes(effectiveCloseTime);
      const startMin = timeToMinutesLocal(startTime);
      const endMin = startMin + durationHours * 60;
      if (startMin < openMin || endMin > closeMin) {
        res.status(400).json({ error: `Booking harus dalam jam operasional ${facility.openTime}–${effectiveCloseTime}` });
        return;
      }

      // Conflict check — advisory lock 2-param per (facilityId, date) cegah double booking
      const endTime = addHours(startTime, durationHours);
      const _slotFId = Number(facilityId);
      const _slotDInt = parseInt(bookingDate.replace(/-/g, ""), 10);
      await db.execute(sql`SELECT pg_advisory_lock(${_slotFId}, ${_slotDInt})`);
      slotLockKey = { fId: _slotFId, dInt: _slotDInt };
      const conflicting = await db.select().from(bookingsTable).where(
        and(eq(bookingsTable.facilityId, _slotFId), eq(bookingsTable.bookingDate, bookingDate))
      );
      const active = conflicting.filter((b) => !INACTIVE_STATUSES.includes(b.status));
      const conflict = active.some((b) => {
        const bStart = timeToMinutesLocal(b.startTime);
        const bEnd = timeToMinutesLocal(b.endTime);
        const sMin = timeToMinutesLocal(startTime);
        const eMin = timeToMinutesLocal(endTime);
        return sMin < bEnd && eMin > bStart;
      });
      if (conflict) {
        await db.execute(sql`SELECT pg_advisory_unlock(${slotLockKey.fId}, ${slotLockKey.dInt})`);
        slotLockKey = null;
        res.status(409).json({ error: "Slot waktu ini sudah dipesan. Pilih jam lain." });
        return;
      }
    }

    const endTime = addHours(startTime, durationHours);
    // Gym/walk-in pricing is per person; time-slot facilities remain per duration.
    const basePrice = Number(facility.pricePerHour) * (isWalkIn ? numberOfPeople! : durationHours);

    // ── Auto-verifikasi & diskon member AP2 ─────────────────────────────────
    // Jika customer adalah angkasa_pura dan ID card ditemukan di ap_members (aktif),
    // diskon langsung diterapkan saat booking dibuat (verificationStatus → "verified").
    // Jika tidak ditemukan → tetap "pending" untuk verifikasi manual admin.
    let apAutoVerified = false;
    let apAutoDiscountAmount = 0;
    if (isAp && idCardNumber) {
      const [apMember] = await db.select().from(apMembersTable)
        .where(and(eq(apMembersTable.idCardNumber, idCardNumber), eq(apMembersTable.isActive, true)))
        .limit(1);
      if (apMember) {
        const [apSetting] = await db.select().from(discountSettingsTable)
          .where(and(eq(discountSettingsTable.customerType, "angkasa_pura"), eq(discountSettingsTable.isActive, true)))
          .limit(1);
        if (apSetting && (Number(apSetting.discountAmount ?? 0) > 0 || apSetting.discountPercentage > 0)) {
          // AP Multiguna memakai harga khusus Rp300.000/jam, bukan diskon
          // persentase umum AP. Ini juga harus berlaku pada auto-verifikasi;
          // booking yang auto-verified tidak akan melewati endpoint /verify.
          apAutoDiscountAmount = getApDiscount(
            basePrice,
            apSetting,
            isMultigunaFacility(facility),
            durationHours,
          ).amount;
          apAutoVerified = true;
        } else {
          // Member valid tapi diskon nonaktif → tetap auto-verified
          apAutoVerified = true;
        }
      }
    }

    // ── Diskon Event 21,4% ───────────────────────────────────────────────────
    const eventDiscountAmountCalc = isEvent ? calculateEventDiscount(basePrice) : 0;

    const discount = isAp
      ? apAutoDiscountAmount
      : isEvent
        ? eventDiscountAmountCalc
        : Math.min(Number(discountAmount) || 0, basePrice);
    const totalPrice = basePrice - discount;
    const taxCalc = await calculateTax(totalPrice, "sport_booking", bookingDate);
    const orderNumber = await generateOrderNumber();

    // customerId: admin → bodyCustomerId atau null; admin_booking/customer → bodyCustomerId atau loggedInUserId
    const effectiveCustomerId = bodyCustomerId ?? (loggedInRole !== "admin" ? loggedInUserId : null);

    // groupRef dari cart checkout (frontend kirim saat multi-lapangan)
    const incomingGroupRef: string | null = req.body.groupRef
      ? String(req.body.groupRef).trim().slice(0, 64) || null
      : null;

    // Upsert booking_groups jika ada groupRef dari cart — HARUS sebelum insert booking
    // karena kolom bookings.group_ref punya FK ke booking_groups.group_ref (baris induk harus ada dulu)
    if (incomingGroupRef) {
      // Payable amount: pakai grandTotal bila ada PPN, fallback ke totalPrice
      const payableAmount = taxCalc.taxAmount > 0 ? taxCalc.grandTotal : totalPrice;

      const [existingGroup] = await db.select().from(bookingGroupsTable)
        .where(eq(bookingGroupsTable.groupRef, incomingGroupRef)).limit(1);

      if (existingGroup) {
        // Validasi kepemilikan: phone harus cocok (cart selalu kirim phone yang sama)
        const ownerPhone = normalizePhone(String(customerPhone));
        if (existingGroup.customerPhone && existingGroup.customerPhone !== ownerPhone) {
          // Biarkan booking tetap dibuat, tapi jangan update grup orang lain
          req.log.warn({ groupRef: incomingGroupRef }, "groupRef ownership mismatch — skipping group upsert");
        } else {
          // Akumulasi pakai grandTotal (bukan totalPrice) supaya PPN masuk
          await db.update(bookingGroupsTable)
            .set({
              totalPayment: String(Number(existingGroup.totalPayment) + payableAmount),
              updatedAt: new Date(),
            })
            .where(eq(bookingGroupsTable.groupRef, incomingGroupRef));
        }
      } else {
        // Buat grup baru
        await db.insert(bookingGroupsTable).values({
          groupRef: incomingGroupRef,
          customerName: String(customerName),
          customerPhone: normalizePhone(String(customerPhone)),
          totalPayment: String(payableAmount),
          status: "pending",
          notes: `Dari keranjang booking`,
        });
      }
    }

    const [booking] = await db.insert(bookingsTable).values({
      orderNumber,
      customerId: effectiveCustomerId,
      bookedByUserId: loggedInUserId,
      customerName,
      customerEmail: customerEmail || "",
      customerPhone,
      facilityId: Number(facilityId),
      bookingDate,
      startTime,
      endTime,
      durationHours: isWalkIn ? 1 : durationHours,
      totalPrice: String(totalPrice),
      promoCode: isAp || isEvent ? null : (promoCode || null),
      discountAmount: String(discount),
      apDiscountAmount: isAp ? String(apAutoDiscountAmount) : "0",
      bookingType,
      eventDiscountAmount: isEvent ? String(eventDiscountAmountCalc) : null,
      customerType: isAp ? "angkasa_pura" : "umum",
      idCardNumber: idCardNumber || null,
      verificationStatus: isAp ? (apAutoVerified ? "verified" : "pending") : "not_required",
      basePrice: String(basePrice),
      activityType,
      numberOfPeople,
      notes,
      groupRef: incomingGroupRef,
      // Company billing: auto-confirm KECUALI company punya requirePerBookingApproval = true
      // Pending company: waiting_confirmation (menunggu verifikasi admin perusahaan)
      status: isCompanyBilling
        ? (companyBillingUser?.requirePerBookingApproval ? "waiting_confirmation" : "confirmed")
        : (isPendingCompany ? "waiting_confirmation" : "pending_payment"),
      payerType: (isCompanyBilling || isPendingCompany) ? "company" : "personal",
      companyCustomerId: effectiveCompanyCustomerId,
      paymentRequiredNow: !isCompanyBilling && !isPendingCompany,
      billingStatus: isCompanyBilling ? "unbilled" : null,
      paymentDeadline: (isCompanyBilling || isPendingCompany) ? null : (() => {
        // Deadline = 7 hari setelah tanggal bermain (end of day WIB)
        const d = new Date(bookingDate + "T23:59:59+07:00");
        d.setDate(d.getDate() + 7);
        return d;
      })(),
      bookedForName: (isCompanyBilling || isPendingCompany) ? (req.body.bookedForName?.trim() || customerName) : null,
      bookedForPhone: (isCompanyBilling || isPendingCompany) ? (req.body.bookedForPhone?.trim() || customerPhone) : null,
      ppnRate: taxCalc.taxRate > 0 ? String(taxCalc.taxRate) : null,
      dpp: taxCalc.taxAmount > 0 ? String(taxCalc.dpp) : null,
      ppnAmount: taxCalc.taxAmount > 0 ? String(taxCalc.taxAmount) : null,
      grandTotal: taxCalc.taxAmount > 0 ? String(taxCalc.grandTotal) : null,
      vendorId: req.body.vendorId ? Number(req.body.vendorId) : null,
    }).returning();

    // Release slot advisory lock setelah INSERT berhasil
    if (slotLockKey) {
      await db.execute(sql`SELECT pg_advisory_unlock(${slotLockKey.fId}, ${slotLockKey.dInt})`).catch(() => {});
      slotLockKey = null;
    }

    if (promoCode && !isAp) {
      await db.update(promosTable)
        .set({ usedCount: sql`${promosTable.usedCount} + 1` })
        .where(eq(promosTable.code, String(promoCode).toUpperCase()));
    }

    // ── Auto find-or-create customer from phone ───────────────────────
    let customerAutoCreated = false;
    let customerReused = false;
    const rawPhone = String(customerPhone ?? "").trim();
    const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;

    if (customerName && !booking.customerId) {
      try {
        // Cari existing user by phone atau by email
        let existingUser: typeof usersTable.$inferSelect | undefined;
        if (normalizedPhone) {
          [existingUser] = await db.select().from(usersTable)
            .where(eq(usersTable.phone, normalizedPhone)).limit(1);
        }
        if (!existingUser && customerEmail) {
          [existingUser] = await db.select().from(usersTable)
            .where(eq(usersTable.email, String(customerEmail))).limit(1);
        }

        if (existingUser) {
          await db.update(bookingsTable).set({ customerId: existingUser.id }).where(eq(bookingsTable.id, booking.id));
          (booking as any).customerId = existingUser.id;
          customerReused = true;
          logAudit({ action: "CUSTOMER_REUSED_FROM_PHONE", entity: "booking", entityId: booking.id, after: { customerId: existingUser.id, phone: normalizedPhone }, ...getClientInfo(req) });
        } else {
          const code = await generateCustomerCode();
          const [newUser] = await db.insert(usersTable).values({
            name: String(customerName),
            phone: normalizedPhone ?? null,
            email: customerEmail ? String(customerEmail) : null,
            role: "customer",
            accountType: "personal",
            accountStatus: "active",
            registrationSource: "booking_form",
            customerCode: code,
          }).returning();
          await db.update(bookingsTable).set({ customerId: newUser.id }).where(eq(bookingsTable.id, booking.id));
          (booking as any).customerId = newUser.id;
          customerAutoCreated = true;
          logAudit({ action: "CUSTOMER_AUTO_CREATED_FROM_BOOKING", entity: "user", entityId: newUser.id, after: { name: customerName, phone: normalizedPhone, email: customerEmail }, ...getClientInfo(req) });
        }
      } catch (autoErr) {
        req.log.warn({ autoErr }, "Auto-create customer failed (non-critical)");
      }
    }

    const auditAction = isEvent
      ? "EVENT_BOOKING_CREATED"
      : isAp
        ? "ANGKASAPURA_BOOKING_CREATED"
        : isCompanyBilling
          ? "CORPORATE_BOOKING_CREATED"
          : isPendingCompany
            ? "CORPORATE_BOOKING_PENDING_CREATED"
            : "PERSONAL_BOOKING_CREATED";
    logAudit({
      action: auditAction,
      entity: "booking",
      entityId: booking.id,
      after: {
        orderNumber: booking.orderNumber,
        customerName,
        facilityId,
        bookingDate,
        payerType: booking.payerType ?? "personal",
        companyCustomerId: booking.companyCustomerId ?? null,
        status: booking.status,
      },
      ...getClientInfo(req),
    });

    // Record history
    await db.insert(bookingHistoryTable).values({
      bookingId: booking.id,
      fromStatus: null,
      toStatus: booking.status,
      changedByName: customerName,
      note: isCompanyBilling ? "Booking dibuat (Company Customer — tagihan bulanan)" : "Booking dibuat",
    });

    broadcastAvailabilityChange(Number(facilityId), bookingDate);

    // Record tax transaction (non-blocking)
    if (taxCalc.taxCode) {
      recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, bookingDate).catch(() => {});
    }

    // Sync to Bizportal (non-blocking)
    syncBookingToBizportal({ booking, facilityName: facility.name, facilityCategory: facility.category }).catch(() => {});

    // Send WA notification (non-blocking)
    if (isCompanyBilling) {
      // Notify customer (confirmed) + admin (new company booking)
      const bookingMonth = bookingDate.slice(0, 7);
      notifyCompanyBookingCreated({
        customerName,
        customerPhone,
        orderNumber: booking.orderNumber,
        facilityName: facility.name,
        bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: totalPrice.toLocaleString("id-ID"),
        companyName: companyBillingUser!.companyName ?? companyBillingUser!.name ?? "",
        periodMonth: bookingMonth,
        picPhone: companyBillingUser!.picPhone ?? undefined,
      }).catch(() => {});
    } else {
      // Deadline = 7 hari setelah tanggal bermain (end of day WIB)
      const deadline = new Date(bookingDate + "T23:59:59+07:00");
      deadline.setDate(deadline.getDate() + 7);
      const deadlineStr = deadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
      const appUrl = await getBaseUrl();

      // Buat proof token agar customer dapat link upload bukti langsung dari WA
      let proofUrl = "";
      let statusUrl = "";
      try {
        if (booking.status === "pending_payment") {
          const proofToken = await createWaToken(booking.id, "upload_proof", 7);
          proofUrl = appUrl ? `${appUrl}/bukti/${proofToken}` : "";
          statusUrl = appUrl ? `${appUrl}/status/${booking.orderNumber}` : "";
        }
      } catch (err) {
        console.error("[WA] Gagal buat proof token:", err);
      }

      notifyBookingCreated({
        customerName,
        customerPhone,
        orderNumber: booking.orderNumber,
        facilityName: facility.name,
        bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: totalPrice.toLocaleString("id-ID"),
        paymentDeadline: deadlineStr,
        uploadProofUrl: proofUrl || undefined,
        statusUrl: statusUrl || undefined,
        groupRef: incomingGroupRef,
      }).catch((err) => console.error("[WA] notifyBookingCreated error:", err));

      // Notifikasi admin jika booking berasal dari link Mina AI
      if (bookingSource === "mina") {
        const bookingDow = new Date(bookingDate + "T00:00:00+07:00").getDay();
        const isWeekend = bookingDow === 0 || bookingDow === 6;
        notifyWaAdminNewBooking({
          orderNumber: booking.orderNumber,
          customerName,
          customerPhone,
          facilityName: facility.name,
          bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          durationHours: Number(durationHours),
          totalPrice: totalPrice.toLocaleString("id-ID"),
          isWeekend,
          appliedRules: "🤖 Booking dari Mina AI",
          statusUrl: `${appUrl}/status/${booking.orderNumber}`,
        }).catch(() => {});
      }

      // ─── Kirim WA approval link ke semua admin untuk setiap booking baru ──────
      try {
        if (appUrl) {
          const approvalToken = await createWaToken(booking.id, "approve_booking", 1);
          notifyAdminBookingApprovalRequest({
            orderNumber: booking.orderNumber,
            customerName,
            customerPhone,
            facilityName: facility.name,
            bookingDate,
            startTime: booking.startTime,
            endTime: booking.endTime,
            durationHours: Number(durationHours),
            totalPrice: totalPrice.toLocaleString("id-ID"),
            approvalUrl: `${appUrl}/wa/booking-approval/${approvalToken}`,
            source: bookingSource ?? "portal",
          }).catch(() => {});
        }
      } catch {}
    }

    // ─── Kirim rekap hanya jika booking hari ini (hindari spam untuk advance booking) ──
    triggerRekapIfToday(bookingDate);

    res.status(201).json({
      ...booking,
      totalPrice: Number(booking.totalPrice),
      discountAmount: Number(booking.discountAmount),
      basePrice: booking.basePrice == null ? null : Number(booking.basePrice),
      apDiscountAmount: Number(booking.apDiscountAmount),
      ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
      dpp: booking.dpp == null ? null : Number(booking.dpp),
      ppnAmount: booking.ppnAmount == null ? null : Number(booking.ppnAmount),
      grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
      facilityName: facility.name,
      facilityCategory: facility.category,
      payment: null,
      customerAutoCreated,
      customerReused,
    });
  } catch (err) {
    // Pastikan advisory lock dilepas jika terjadi error setelah lock diacquire
    if (slotLockKey) {
      await db.execute(sql`SELECT pg_advisory_unlock(${slotLockKey.fId}, ${slotLockKey.dInt})`).catch(() => {});
    }
    req.log.error({ err }, "Create booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- RECURRING BOOKING HELPERS ---

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function generateRecurringDates(
  startDate: string,
  repeatType: "weekly" | "monthly",
  repeatCount: number
): string[] {
  const dates: string[] = [];
  const base = new Date(startDate);
  for (let i = 0; i < repeatCount; i++) {
    const d = new Date(base);
    if (repeatType === "weekly") {
      d.setDate(d.getDate() + i * 7);
    } else {
      d.setMonth(d.getMonth() + i);
    }
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

async function checkSlotConflict(
  facilityId: number,
  bookingDate: string,
  startTime: string,
  endTime: string
): Promise<boolean> {
  const existing = await db.select().from(bookingsTable).where(
    and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, bookingDate))
  );
  const active = existing.filter((b) => !["cancelled", "expired", "rejected", "refunded"].includes(b.status));
  const sMin = timeToMinutes(startTime);
  const eMin = timeToMinutes(endTime);
  return active.some((b) => {
    const bStart = timeToMinutes(b.startTime);
    const bEnd = timeToMinutes(b.endTime);
    return sMin < bEnd && eMin > bStart;
  });
}

function recurringScheduleError(
  facility: typeof facilitiesTable.$inferSelect,
  bookingDate: string,
  startTime: string,
  durationHours: number,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bookingDate))) return "Tanggal booking tidak valid";
  const parsedDate = new Date(`${bookingDate}T00:00:00+07:00`);
  if (Number.isNaN(parsedDate.getTime())) return "Tanggal booking tidak valid";
  const today = todayWIB();
  if (bookingDate < today) return "Tanggal booking sudah lewat";
  if (!/^\d{2}:\d{2}$/.test(String(startTime))) return "Jam mulai tidak valid";

  const startMin = timeToMinutes(startTime);
  const openMin = timeToMinutes(facility.openTime);
  const closeMin = closeTimeToMinutes(getEffectiveCloseTime(facility));
  if (startMin < openMin || startMin >= 24 * 60) return "Jam mulai tidak valid";
  if (!Number.isInteger(durationHours) || durationHours < 1) return "Durasi booking minimal 1 jam";
  if (startMin + durationHours * 60 > closeMin) {
    return `Booking harus dalam jam operasional ${facility.openTime}–${getEffectiveCloseTime(facility)}`;
  }
  if (bookingDate === today) {
    const nowWib = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    if (startMin <= nowWib.getHours() * 60 + nowWib.getMinutes()) return "Slot hari ini sudah lewat";
  }
  return null;
}

// POST /bookings/recurring/check
router.post("/bookings/recurring/check", async (req, res) => {
  try {
    const { facilityId, startDate, startTime, durationHours, repeatType, repeatCount } = req.body;

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, Number(facilityId))).limit(1);
    if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }

    const scheduleError = recurringScheduleError(facility, String(startDate), String(startTime), Number(durationHours));
    if (scheduleError) {
      res.json({ dates: [{ date: String(startDate), available: false, reason: scheduleError }], pricePerSession: 0, validCount: 0, totalPrice: 0 });
      return;
    }
    const endTime = addHours(startTime, durationHours);
    const dates = generateRecurringDates(startDate, repeatType, repeatCount);

    const results = await Promise.all(
      dates.map(async (date) => {
        const conflict = await checkSlotConflict(Number(facilityId), date, startTime, endTime);
        const available = !conflict && await checkSlotAvailable(Number(facilityId), date, startTime, durationHours);
        return { date, available, reason: available ? null : "Slot tidak tersedia atau terblokir" };
      })
    );

    const pricePerSession = Number(facility.pricePerHour) * durationHours;
    const validCount = results.filter((r) => r.available).length;

    res.json({
      dates: results,
      pricePerSession,
      validCount,
      totalPrice: pricePerSession * validCount,
    });
  } catch (err) {
    req.log.error({ err }, "Check recurring error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /bookings/recurring — create all valid (non-conflicting) bookings
router.post("/bookings/recurring", async (req, res) => {
  try {
    const {
      customerName, customerEmail, facilityId, startDate, startTime, durationHours,
      notes, repeatType, repeatCount, specificDates, promoCode, discountAmountPerSession,

      downPaymentAmount,

      // AP2 / customer type


      // Company billing fields (optional)
      payerType, companyCustomerId, customerId: bodyCustomerId, bookedForName, bookedForPhone,
      // AP2 employee fields (optional)
      customerType: rawCustomerType, idCardNumber: rawIdCardNumber,
      bookingType: rawBookingTypeR,
      // External groupRef dari cart checkout (agar semua lapangan + sesi repeat masuk 1 grup)
      groupRef: externalGroupRefRaw,
    } = req.body;
    const externalGroupRef: string | null = externalGroupRefRaw
      ? String(externalGroupRefRaw).trim().slice(0, 64) || null
      : null;
    const bookingTypeR: "regular" | "event" = rawBookingTypeR === "event" ? "event" : "regular";
    const isEventR = bookingTypeR === "event";
    const customerPhone: string = normalizePhone(String(req.body.customerPhone ?? "").trim());
    const customerType: "umum" | "angkasa_pura" = rawCustomerType === "angkasa_pura" ? "angkasa_pura" : "umum";
    const idCardNumber: string | null = customerType === "angkasa_pura"
      ? (String(rawIdCardNumber || "").trim().toUpperCase() || null)
      : null;
    const isAp = customerType === "angkasa_pura";
    if (isAp && !idCardNumber) {
      res.status(400).json({ error: "Nomor ID Card wajib untuk customer Angkasa Pura" });
      return;
    }

    // Deteksi user yang sedang login (opsional) — sama seperti POST /bookings
    let loggedInUserId: number | null = null;
    let loggedInUser: (typeof usersTable.$inferSelect) | null = null;
    let loggedInRole: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const payload = verifyToken(authHeader.slice(7));
      if (payload?.userId) {
        loggedInUserId = payload.userId;
        loggedInRole = payload.role ?? null;
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
        if (u) loggedInUser = u;
      }
    }
    const isAdminRequest = !!loggedInRole && loggedInRole !== "customer";

    // customerId hanya boleh dipercaya dari body ketika request datang dari admin/operator.
    const effectiveCustomerId = (isAdminRequest && bodyCustomerId) ? Number(bodyCustomerId) : loggedInUserId;

    // ── Verifikasi company billing (mirror logika di POST /bookings) ──
    const explicitCompanyId = companyCustomerId ? Number(companyCustomerId) : null;
    let companyBillingUser: (typeof usersTable.$inferSelect) | null = null;
    if (explicitCompanyId && isAdminRequest) {
      const [cu] = await db.select().from(usersTable).where(eq(usersTable.id, explicitCompanyId)).limit(1);
      if (cu?.accountType === "company" && cu.allowMonthlyBilling) companyBillingUser = cu;
    } else if (explicitCompanyId && !isAdminRequest && loggedInUserId) {
      const [companyUserRecord] = await db.select().from(companyUsersTable)
        .where(and(
          eq(companyUsersTable.customerId, loggedInUserId),
          eq(companyUsersTable.companyId, explicitCompanyId),
          eq(companyUsersTable.verificationStatus, "approved"),
          eq(companyUsersTable.corporateBillingEnabled, true),
        ))
        .limit(1);
      if (companyUserRecord) {
        const [companyAccount] = await db.select().from(usersTable).where(eq(usersTable.id, explicitCompanyId)).limit(1);
        if (companyAccount) companyBillingUser = companyAccount;
      }
    }
    // ── Security: hanya admin/operator atau karyawan terverifikasi yang boleh payerType=company ──
    if (payerType === "company" && !companyBillingUser) {
      res.status(403).json({
        error: "Booking Corporate tidak diizinkan. Anda harus menjadi karyawan terverifikasi perusahaan terlebih dahulu.",
      });
      return;
    }
    const isCompanyPayer = payerType === "company" && !!companyBillingUser;
    const verifiedCompanyCustomerId = companyBillingUser?.id ?? null;

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, Number(facilityId))).limit(1);
    if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }

    const endTime = addHours(startTime, durationHours);
    const dates: string[] = Array.isArray(specificDates) && specificDates.length > 0
      ? specificDates
      : generateRecurringDates(startDate, repeatType, repeatCount);
    const uniqueDates = [...new Set(dates.map((date) => String(date)))];
    if (uniqueDates.length !== dates.length) {
      res.status(400).json({ error: "Tanggal recurring tidak boleh duplikat" });
      return;
    }
    const scheduleErrors = uniqueDates
      .map((date) => recurringScheduleError(facility, date, String(startTime), Number(durationHours)))
      .filter(Boolean);
    if (scheduleErrors.length > 0) {
      res.status(400).json({ error: scheduleErrors[0] });
      return;
    }
    const basePrice = Number(facility.pricePerHour) * durationHours;

    // ── Diskon Event 21,4% (recurring) ──────────────────────────────────────
    const eventDiscountAmountCalcR = isEventR ? calculateEventDiscount(basePrice) : 0;

    // ── Auto-verifikasi & diskon member AP2 (recurring) ─────────────────────
    let apAutoVerifiedR = false;
    let apAutoDiscountAmountR = 0;
    if (isAp && idCardNumber) {
      const [apMemberR] = await db.select().from(apMembersTable)
        .where(and(eq(apMembersTable.idCardNumber, idCardNumber), eq(apMembersTable.isActive, true)))
        .limit(1);
      if (apMemberR) {
        const [apSettingR] = await db.select().from(discountSettingsTable)
          .where(and(eq(discountSettingsTable.customerType, "angkasa_pura"), eq(discountSettingsTable.isActive, true)))
          .limit(1);
        if (apSettingR && (Number(apSettingR.discountAmount ?? 0) > 0 || apSettingR.discountPercentage > 0)) {
          apAutoDiscountAmountR = getApDiscount(
            basePrice,
            apSettingR,
            isMultigunaFacility(facility),
            durationHours,
          ).amount;
          apAutoVerifiedR = true;
        } else {
          apAutoVerifiedR = true;
        }
      }
    }

    const discount = isAp
      ? apAutoDiscountAmountR
      : isEventR
        ? eventDiscountAmountCalcR
        : Math.min(Number(discountAmountPerSession) || 0, basePrice);
    const totalPrice = basePrice - discount;
    const requestedDownPayment =
      downPaymentAmount == null || downPaymentAmount === ""
        ? null
        : Number(downPaymentAmount);
    if (
      requestedDownPayment != null &&
      (!Number.isFinite(requestedDownPayment) || requestedDownPayment <= 0)
    ) {
      res.status(400).json({ error: "Jumlah DP tidak valid" });
      return;
    }

    // DP recurring adalah DP untuk seluruh grup, bukan untuk satu sesi.
    // Hitung total projected semua tanggal sebelum insert agar DP seperti
    // Rp100.000 tetap valid untuk 4 sesi @ Rp80.000 (total Rp320.000).
    const taxByDate = new Map<string, Awaited<ReturnType<typeof calculateTax>>>();
    let projectedGrandTotal = 0;
    for (const bookingDate of dates) {
      const taxCalc = await calculateTax(totalPrice, "sport_booking", bookingDate);
      taxByDate.set(bookingDate, taxCalc);
      projectedGrandTotal += taxCalc.grandTotal;
    }
    if (
      requestedDownPayment != null &&
      requestedDownPayment >= projectedGrandTotal
    ) {
      res.status(400).json({
        error: `DP grup (${requestedDownPayment}) harus lebih kecil dari total seluruh sesi (${projectedGrandTotal})`,
      });
      return;
    }

    const created: any[] = [];
    const skipped: string[] = [];
    for (const bookingDate of dates) {
      // Advisory lock per (facilityId, date) cegah double booking pada recurring
      const recFId = Number(facilityId);
      const recDInt = parseInt(bookingDate.replace(/-/g, ""), 10);
      await db.execute(sql`SELECT pg_advisory_lock(${recFId}, ${recDInt})`);
      const conflict = await checkSlotConflict(recFId, bookingDate, startTime, endTime);
      if (conflict) {
        await db.execute(sql`SELECT pg_advisory_unlock(${recFId}, ${recDInt})`);
        skipped.push(bookingDate);
        continue;
      }
      // Per-date tax calc: respects effectiveDate backward-compat rule
      const taxCalc = taxByDate.get(bookingDate)!;
      const orderNumber = await generateOrderNumber();
      const [booking] = await db.insert(bookingsTable).values({
        orderNumber,
        customerId: effectiveCustomerId,
        bookedByUserId: loggedInUserId,
        customerName,
        customerEmail: customerEmail || "",
        customerPhone,
        facilityId: Number(facilityId),
        bookingDate,
        startTime,
        endTime,
        durationHours,
        totalPrice: String(totalPrice),
        promoCode: isAp || isEventR ? null : (promoCode || null),
        discountAmount: String(discount),
        apDiscountAmount: isAp ? String(apAutoDiscountAmountR) : "0",
        bookingType: bookingTypeR,
        eventDiscountAmount: isEventR ? String(eventDiscountAmountCalcR) : null,
        basePrice: String(basePrice),
        customerType,
        idCardNumber: idCardNumber || null,
        verificationStatus: isAp ? (apAutoVerifiedR ? "verified" : "pending") : "not_required",
        notes,
        ppnRate: taxCalc.taxRate > 0 ? String(taxCalc.taxRate) : null,
        dpp: taxCalc.taxAmount > 0 ? String(taxCalc.dpp) : null,
        ppnAmount: taxCalc.taxAmount > 0 ? String(taxCalc.taxAmount) : null,
        grandTotal: taxCalc.taxAmount > 0 ? String(taxCalc.grandTotal) : null,
        ...(requestedDownPayment != null
          ? {
              // downPayment is the configured amount, not proof that the DP
              // has already been paid. isDpPaid becomes true only after an
              // admin confirms a payment with paymentType="dp".
              downPayment: String(requestedDownPayment),
              isDpPaid: false,
            }
          : {}),
        ...(isCompanyPayer ? {
          payerType: "company",
          companyCustomerId: verifiedCompanyCustomerId as number,
          bookedForName: bookedForName || customerName,
          bookedForPhone: bookedForPhone || customerPhone,
          paymentRequiredNow: false,
          paymentDeadline: null,
          billingStatus: "unbilled",
          status: companyBillingUser?.requirePerBookingApproval ? "waiting_confirmation" : "confirmed",
        } : {}),
      }).returning();
      // Release advisory lock untuk tanggal ini setelah INSERT berhasil
      await db.execute(sql`SELECT pg_advisory_unlock(${recFId}, ${recDInt})`).catch(() => {});
      broadcastAvailabilityChange(Number(facilityId), bookingDate);
      if (taxCalc.taxCode) {
        recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, bookingDate).catch(() => {});
      }

      created.push({
        ...booking,
        totalPrice: Number(booking.totalPrice),
        discountAmount: Number(booking.discountAmount),
        ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
        dpp: booking.dpp == null ? null : Number(booking.dpp),
        ppnAmount: booking.ppnAmount == null ? null : Number(booking.ppnAmount),
        grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
        facilityName: facility.name,
        facilityCategory: facility.category,
        payment: null,
      });
    }

    if (promoCode && created.length > 0) {
      await db.update(promosTable)
        .set({ usedCount: sql`${promosTable.usedCount} + ${created.length}` })
        .where(eq(promosTable.code, String(promoCode).toUpperCase()));
    }


    // Hitung dari sum actual booking values
    const grandTotalAmount = created.reduce((sum: number, b: any) => sum + Number(b.grandTotal ?? b.totalPrice), 0);
    const totalDpp = created.reduce((sum: number, b: any) => sum + Number(b.dpp ?? b.totalPrice), 0);
    const totalPpn = created.reduce((sum: number, b: any) => sum + Number(b.ppnAmount ?? 0), 0);

    // ── Grouping logic ──────────────────────────────────────────────────────
    // Prioritas: gunakan externalGroupRef dari cart (agar multi-lapangan + repeat → 1 grup invoice).
    // Fallback: auto-generate groupRef jika ada 2+ sesi (satu lapangan berulang).
    let groupRef: string | null = null;

    if (created.length >= 1) {
      if (externalGroupRef) {
        // Cart meneruskan groupRef bersama — gabungkan semua sesi ke grup yang sama
        const ownerPhone = normalizePhone(String(customerPhone));
        const [existingGroup] = await db.select()
          .from(bookingGroupsTable).where(eq(bookingGroupsTable.groupRef, externalGroupRef)).limit(1);

        if (existingGroup) {
          // Validasi kepemilikan: phone harus cocok, jangan attach ke grup orang lain
          if (existingGroup.customerPhone && existingGroup.customerPhone !== ownerPhone) {
            req.log.warn({ groupRef: externalGroupRef }, "groupRef ownership mismatch pada recurring — skipping external groupRef");
            // groupRef tetap null, booking dibuat tanpa grup
          } else {
            // Grup sudah ada (lapangan lain dari keranjang yang sama) — akumulasi totalPayment
            await db.update(bookingGroupsTable)
              .set({
                totalPayment: String(Number(existingGroup.totalPayment) + grandTotalAmount),
                notes: `Dari keranjang booking (multi-fasilitas)`,
                updatedAt: new Date(),
              })
              .where(eq(bookingGroupsTable.groupRef, externalGroupRef));
            groupRef = externalGroupRef;
          }
        } else {
          // Buat grup baru dengan groupRef dari cart
          await db.insert(bookingGroupsTable).values({
            groupRef: externalGroupRef,
            customerPhone: ownerPhone,
            customerName: String(customerName),
            totalPayment: String(grandTotalAmount),
            status: "pending",
            notes: `Dari keranjang booking (${created.length} sesi berulang)`,
          });
          groupRef = externalGroupRef;
        }
      } else if (created.length >= 2) {
        // Tanpa groupRef eksternal: auto-generate untuk sesi berulang satu lapangan
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = `GRP-${String(Math.floor(Math.random() * 99999) + 1).padStart(5, "0")}`;
          const existing = await db.select({ groupRef: bookingGroupsTable.groupRef })
            .from(bookingGroupsTable).where(eq(bookingGroupsTable.groupRef, candidate)).limit(1);
          if (!existing.length) { groupRef = candidate; break; }
        }
        if (!groupRef) groupRef = `GRP-${Date.now()}`;

        await db.insert(bookingGroupsTable).values({
          groupRef,
          customerPhone: String(customerPhone),
          customerName: String(customerName),
          totalPayment: String(grandTotalAmount),
          status: "pending",
          notes: `Auto-dibuat dari booking berulang (${created.length} sesi)`,
        });
      }

      if (groupRef) {
        const orderNumbers = created.map((b: any) => b.orderNumber as string);
        await db.update(bookingsTable)
          .set({ groupRef })
          .where(inArray(bookingsTable.orderNumber, orderNumbers));

        // Update created array dengan groupRef
        for (const b of created) b.groupRef = groupRef;
      }
    }

    // Rekap otomatis jika ada booking yang jatuh hari ini
    const today = todayWIB();
    if (created.some((b: any) => b.bookingDate === today)) {
      triggerRekapIfToday(today);
    }

    // Endpoint recurring membuat beberapa booking sekaligus, jadi kirim satu
    // notifikasi admin yang merangkum semua sesi agar tidak terpecah/hilang.
    notifyRecurringBookingGroupCreated({
      customerName: String(customerName),
      customerPhone,
      groupRef,
      totalPayment: grandTotalAmount,
      sessions: created.map((b: any) => ({
        orderNumber: String(b.orderNumber),
        facilityName: String(b.facilityName ?? facility.name),
        bookingDate: String(b.bookingDate),
        startTime: String(b.startTime),
        endTime: String(b.endTime),
        durationHours: Number(b.durationHours),
        totalPrice: Number(b.grandTotal ?? b.totalPrice),
      })),
      skippedDates: skipped,
    }).catch((err) => console.error("[WA] notifyRecurringBookingGroupCreated error:", err));

    res.status(201).json({ created, skipped, totalBookings: created.length, grandTotal: grandTotalAmount, totalDpp, totalPpnAmount: totalPpn, groupRef });
  } catch (err) {
    req.log.error({ err }, "Create recurring booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/my", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId as number;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Cocokkan via customerId ATAU bookedByUserId (siapa yang buat) ATAU customerEmail (lama/guest)
    const bookings = await db.select().from(bookingsTable)
      .where(or(
        eq(bookingsTable.customerId, userId),
        eq(bookingsTable.bookedByUserId, userId),
        user.email ? ilike(bookingsTable.customerEmail, user.email) : undefined,
      ));

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category }).from(facilitiesTable);
    const payments = await db.select().from(paymentsTable);

    const result = bookings.map((b) => {
      const facility = facilities.find((f) => f.id === b.facilityId);
      const payment = payments.filter((p) => p.bookingId === b.id).at(-1);
      return {
        ...b,
        facilityName: facility?.name ?? "",
        facilityCategory: facility?.category ?? "",
        paymentStatus: payment?.status ?? null,
        paymentProofUrl: payment?.proofUrl ?? null,
      };
    }).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get my bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /bookings/claim — user mengklaim booking lama via nomor order
router.post("/bookings/claim", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.userId as number;
    const { orderNumber } = req.body;
    if (!orderNumber) {
      res.status(400).json({ error: "Nomor order wajib diisi" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, String(orderNumber).trim().toUpperCase())).limit(1);

    if (!booking) {
      res.status(404).json({ error: "Booking tidak ditemukan. Periksa kembali nomor order Anda." });
      return;
    }

    // Sudah milik akun lain
    if (booking.customerId && booking.customerId !== userId) {
      res.status(409).json({ error: "Booking ini sudah terhubung ke akun lain." });
      return;
    }

    // Sudah milik akun sendiri
    if (booking.customerId === userId || booking.bookedByUserId === userId) {
      res.status(409).json({ error: "Booking ini sudah ada di riwayat Anda." });
      return;
    }

    await db.update(bookingsTable)
      .set({ customerId: userId, bookedByUserId: userId })
      .where(eq(bookingsTable.id, booking.id));

    res.json({ success: true, orderNumber: booking.orderNumber, facilityId: booking.facilityId });
  } catch (err) {
    req.log.error({ err }, "Claim booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/order/:orderNumber", async (req, res) => {
  try {
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, req.params.orderNumber)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const result = await getBookingWithPayment(booking.id);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get booking by order error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/:id", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const result = await getBookingWithPayment(id);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/bookings/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const orderNumber = booking.orderNumber;
    await db.delete(paymentsTable).where(eq(paymentsTable.bookingId, id));
    await db.delete(bookingsTable).where(eq(bookingsTable.id, id));
    // Hapus juga dari BizPortal agar data tetap sinkron
    deleteBookingFromBizportal(orderNumber).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /bookings/:id/dp — customer/admin mencatat pembayaran DP
router.patch("/bookings/:id/dp", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { downPaymentAmount } = req.body;

    if (downPaymentAmount == null || isNaN(Number(downPaymentAmount)) || Number(downPaymentAmount) < 0) {
      res.status(400).json({ error: "Jumlah DP tidak valid" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }


    // Recurring bookings are stored as separate rows but are paid through one
    // booking group. Validate the DP against the group total, not the price
    // of the individual session row.

    let grandTotal = Number(booking.grandTotal ?? booking.totalPrice);
    if (booking.groupRef) {
      const [group] = await db.select({ totalPayment: bookingGroupsTable.totalPayment })
        .from(bookingGroupsTable)
        .where(eq(bookingGroupsTable.groupRef, booking.groupRef))
        .limit(1);
      if (group) grandTotal = Number(group.totalPayment);
    }
    const dp = Number(downPaymentAmount);

    if (dp > grandTotal) {
      res.status(400).json({ error: `DP (${dp}) tidak boleh melebihi Grand Total (${grandTotal})` });
      return;
    }

    // Hanya simpan nominal DP — isDpPaid baru di-set true saat pembayaran DP
    // dikonfirmasi admin. Untuk recurring/group booking, DP adalah nominal
    // grup, jadi semua sesi harus membawa konfigurasi yang sama. Sebelumnya
    // hanya sesi yang sedang dibuka yang ter-update, sehingga sesi pertama
    // bisa mendeteksi DP sementara sesi lain mengirim full_payment.
    if (booking.groupRef) {
      await db.update(bookingsTable)
        .set({ downPayment: String(dp), isDpPaid: false, updatedAt: new Date() })
        .where(eq(bookingsTable.groupRef, booking.groupRef));
    } else {
      await db.update(bookingsTable)
        .set({ downPayment: String(dp), isDpPaid: false, updatedAt: new Date() })
        .where(eq(bookingsTable.id, id));
    }

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
    const remaining = grandTotal - dp;

    // Kirim notifikasi WA ke customer dan admin
    notifyDpPaid({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      dpAmount: dp.toLocaleString("id-ID"),
      remainingAmount: remaining.toLocaleString("id-ID"),
      paymentDeadline: booking.paymentDeadline ? new Date(booking.paymentDeadline).toLocaleDateString("id-ID") : undefined,
    }).catch(() => {});

    const result = await getBookingWithPayment(id);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Pay DP error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const ADMIN_ONLY_STATUSES = ["completed", "cancelled", "refunded"] as const;

router.patch("/bookings/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { status, adminNotes } = req.body;

    const validStatuses = ["pending_payment", "paid", "confirmed", "completed", "cancelled", "refunded"];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status: ${status}` });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (status && status !== "completed") updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    const [beforeUpdate] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (status === "completed" && beforeUpdate && beforeUpdate.status !== "completed") {
      const completion = await completeBooking(id, getUserFromReq(req));
      if (!completion.ok) {
        res.status(400).json({ error: completion.reason });
        return;
      }
    }
    if (Object.keys(updateData).length > 0) {
      await db.update(bookingsTable).set(updateData).where(eq(bookingsTable.id, id));
    }
    const result = await getBookingWithPayment(id);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }

    if (status && beforeUpdate) {
      const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, id)).limit(1);
      syncStatusToBizportal(beforeUpdate.orderNumber, status, payment?.proofUrl, status === "confirmed" ? new Date() : null, beforeUpdate).catch(() => {});
      // Push bank mutation saat admin langsung override status ke "confirmed" (idempotent via mutationKey)
      if (status === "confirmed" && !["confirmed", "completed"].includes(beforeUpdate.status ?? "")) {
        pushConfirmedPaymentAsBankMutation(beforeUpdate, new Date()).catch(() => {});
      }

      // Kirim WA notification ke customer saat status berubah ke confirmed ATAU langsung ke completed
      const isConfirming =
        (status === "confirmed" && beforeUpdate.status !== "confirmed") ||
        (status === "completed" && !["confirmed", "completed"].includes(beforeUpdate.status ?? ""));
      if (isConfirming) {
        const [facility] = await db
          .select({ name: facilitiesTable.name })
          .from(facilitiesTable)
          .where(eq(facilitiesTable.id, beforeUpdate.facilityId))
          .limit(1);
        logger.info({ orderNumber: beforeUpdate.orderNumber, phone: beforeUpdate.customerPhone, toStatus: status }, "[WA] Mengirim notif konfirmasi pembayaran ke customer");
        notifyPaymentConfirmed({
          customerName: beforeUpdate.customerName,
          customerPhone: beforeUpdate.customerPhone,
          orderNumber: beforeUpdate.orderNumber,
          facilityName: facility?.name ?? "",
          bookingDate: beforeUpdate.bookingDate,
          startTime: beforeUpdate.startTime,
          endTime: beforeUpdate.endTime,
          totalPrice: Number(beforeUpdate.totalPrice).toLocaleString("id-ID"),
          bookingId: beforeUpdate.id,
          groupRef: beforeUpdate.groupRef,
        }).catch((err) => logger.error({ err, orderNumber: beforeUpdate.orderNumber, phone: beforeUpdate.customerPhone }, "[WA] notifyPaymentConfirmed (direct) error"));

        // Kirim invoice PDF ke customer via email & WA (fire-and-forget)
        // Jika booking bagian dari grup, kirim invoice gabungan
        if (beforeUpdate.groupRef) {
          sendGroupInvoiceToCustomer(beforeUpdate.groupRef, { userName: "admin-direct" })
            .catch((err) => logger.error({ err, groupRef: beforeUpdate.groupRef }, "[InvoiceDelivery] Gagal kirim invoice grup setelah admin confirm"));
        } else {
          sendInvoiceToCustomer(beforeUpdate.orderNumber, { userName: "admin-direct" })
            .catch((err) => logger.error({ err, orderNumber: beforeUpdate.orderNumber }, "[InvoiceDelivery] Gagal kirim invoice PDF setelah admin confirm"));
        }
      }

      // Kirim WA notification ke customer saat booking dibatalkan
      if (status === "cancelled" && beforeUpdate.status !== "cancelled") {
        const [facility] = await db
          .select({ name: facilitiesTable.name })
          .from(facilitiesTable)
          .where(eq(facilitiesTable.id, beforeUpdate.facilityId))
          .limit(1);
        notifyBookingCancelled({
          customerName: beforeUpdate.customerName,
          customerPhone: beforeUpdate.customerPhone,
          orderNumber: beforeUpdate.orderNumber,
          facilityName: facility?.name ?? "",
          bookingDate: beforeUpdate.bookingDate,
          startTime: beforeUpdate.startTime,
          endTime: beforeUpdate.endTime,
          totalPrice: Number(beforeUpdate.totalPrice).toLocaleString("id-ID"),
          reason: adminNotes,
        }).catch((err) => logger.error({ err, orderNumber: beforeUpdate.orderNumber }, "[WA] notifyBookingCancelled (direct) error"));
      }

      // FASE 4 & 5: Reversal pajak + jurnal akuntansi saat dibatalkan/refund
      const REVERSAL_STATUSES = ["cancelled", "refunded", "rejected"];
      if (REVERSAL_STATUSES.includes(status)) {
        const today = new Date().toISOString().split("T")[0];
        const reason = `Booking ${beforeUpdate.orderNumber} — status diubah ke ${status}`;
        reverseTaxTransaction(beforeUpdate.id, beforeUpdate.orderNumber, today).catch(() => {});
        reverseJournalEntry(beforeUpdate.id, beforeUpdate.orderNumber, reason, today).catch(() => {});
        reversePublicAccountingEntry(beforeUpdate.orderNumber, reason, today).catch(() => {});
      }
    }

    // Rekap otomatis hanya jika status BENAR-BENAR berubah & booking hari ini
    if (status && beforeUpdate && beforeUpdate.status !== status) {
      triggerRekapIfToday(beforeUpdate.bookingDate);
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Update booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Koreksi tanggal administratif: tidak mengubah nominal maupun status.
// Tanggal pembayaran disimpan pada payment dan booking agar seluruh tampilan
// memakai tanggal pembayaran yang sama.
router.patch("/bookings/:id/dates", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID booking tidak valid" });
      return;
    }

    const bookingDate =
      req.body?.bookingDate === undefined ? undefined : String(req.body.bookingDate);
    const paymentDate =
      req.body?.paymentDate === undefined || req.body?.paymentDate === null || req.body?.paymentDate === ""
        ? undefined
        : String(req.body.paymentDate);
    const startTime =
      req.body?.startTime === undefined ? undefined : String(req.body.startTime);
    const endTime =
      req.body?.endTime === undefined ? undefined : String(req.body.endTime);

    const validateDate = (value: string | undefined, label: string) => {
      if (value === undefined) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label} tidak valid`;
      const [year, month, day] = value.split("-").map(Number);
      const calendarDate = new Date(Date.UTC(year, month - 1, day));
      if (
        Number.isNaN(calendarDate.getTime()) ||
        calendarDate.getUTCFullYear() !== year ||
        calendarDate.getUTCMonth() !== month - 1 ||
        calendarDate.getUTCDate() !== day
      ) {
        return `${label} tidak valid`;
      }
      return null;
    };
    const validateTime = (value: string | undefined, label: string) => {
      if (value === undefined) return null;
      if (!/^\d{2}:\d{2}$/.test(value)) return `${label} tidak valid`;
      const [hour, minute] = value.split(":").map(Number);
      if (hour > 23 || minute > 59) return `${label} tidak valid`;
      return null;
    };
    const dateError =
      validateDate(bookingDate, "Tanggal booking") ??
      validateDate(paymentDate, "Tanggal pembayaran") ??
      validateTime(startTime, "Jam mulai") ??
      validateTime(endTime, "Jam selesai");
    if (dateError) {
      res.status(400).json({ error: dateError });
      return;
    }
    if (startTime !== undefined && endTime !== undefined && startTime >= endTime) {
      res.status(400).json({ error: "Jam selesai harus lebih besar dari jam mulai" });
      return;
    }
    if (bookingDate === undefined && paymentDate === undefined && startTime === undefined && endTime === undefined) {
      res.status(400).json({ error: "Tidak ada tanggal atau jam yang diubah" });
      return;
    }

    const [before] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!before) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }
    const nextStartTime = startTime ?? before.startTime;
    const nextEndTime = endTime ?? before.endTime;
    if (nextStartTime >= nextEndTime) {
      res.status(400).json({ error: "Jam selesai harus lebih besar dari jam mulai" });
      return;
    }

    const [facility] = await db
      .select()
      .from(facilitiesTable)
      .where(eq(facilitiesTable.id, before.facilityId))
      .limit(1);
    if (!facility) {
      res.status(404).json({ error: "Fasilitas booking tidak ditemukan" });
      return;
    }

    // Gym/walk-in tidak memakai slot jam. Booking lama mungkin masih
    // menyimpan 06:00–07:00, tetapi tanggalnya tetap boleh dikoreksi tanpa
    // dibandingkan dengan interval booking lain.
    if (
      bookingDate !== undefined &&
      bookingDate !== before.bookingDate &&
      !isGymFacility(facility)
    ) {
      const conflict = await checkSlotConflict(
        before.facilityId,
        bookingDate,
        before.startTime,
        before.endTime,
      );
      if (conflict) {
        res.status(409).json({ error: "Tanggal baru bentrok dengan booking lain pada jam yang sama" });
        return;
      }
    }
    // Koreksi tanggal administratif adalah perbaikan data historis untuk admin.
    // Jangan menerapkan aturan ketersediaan di sini: tanggal baru boleh
    // bertepatan dengan booking lain karena slot tersebut bukan booking baru.

    const updated = await db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.bookingId, id))
        .orderBy(desc(paymentsTable.createdAt))
        .limit(1);

      if (paymentDate !== undefined && !payment) {
        throw new Error("PAYMENT_NOT_FOUND");
      }

      if (paymentDate !== undefined) {
        // TEMPORARY CORRECTION MODE: during the approved historical correction
        // window, allow this admin transaction to update the canonical payment
        // date without rewriting posted public accounting evidence. The setting
        // is transaction-local and automatically returns to "off" afterward.
        await tx.execute(sql`
          SELECT set_config(
            'sport_center.allow_posted_payment_metadata_correction',
            'on',
            true
          )
        `);
      }

      const paymentTimestamp = paymentDate
        ? new Date(`${paymentDate}T12:00:00+07:00`)
        : undefined;
      const durationHours = Math.round(
        (timeToMinutes(nextEndTime) - timeToMinutes(nextStartTime)) / 60,
      );
      const [booking] = await tx
        .update(bookingsTable)
        .set({
          ...(bookingDate !== undefined ? { bookingDate } : {}),
          ...(startTime !== undefined ? { startTime } : {}),
          ...(endTime !== undefined ? { endTime } : {}),
          ...(startTime !== undefined || endTime !== undefined ? { durationHours } : {}),
          ...(paymentTimestamp ? { paidAt: paymentTimestamp } : {}),
          updatedAt: new Date(),
        })
        .where(eq(bookingsTable.id, id))
        .returning();

      if (payment && paymentTimestamp) {
        await tx
          .update(paymentsTable)
          .set({
            paidAt: paymentTimestamp,
            confirmedAt: paymentTimestamp,
            updatedAt: new Date(),
          })
          .where(eq(paymentsTable.id, payment.id));
      }
      return { booking, payment: paymentTimestamp ? { ...payment, paidAt: paymentTimestamp, confirmedAt: paymentTimestamp } : payment };
    });

    await logAudit({
      ...getUserFromReq(req),
      action: "BOOKING_DATES_UPDATED",
      entity: "booking",
      entityId: id,
      before: {
        bookingDate: before.bookingDate,
        paymentDate: before.paidAt,
        paymentConfirmedAt: before.paidAt,
        startTime: before.startTime,
        endTime: before.endTime,
      },
      after: {
        bookingDate: updated.booking.bookingDate,
        paymentDate: updated.payment?.paidAt ?? before.paidAt,
        paymentConfirmedAt: updated.payment?.confirmedAt ?? before.paidAt,
        startTime: updated.booking.startTime,
        endTime: updated.booking.endTime,
      },
      ...getClientInfo(req),
    });

    const result = await getBookingWithPayment(id);
    res.json(result);
  } catch (err: any) {
    if (String(err?.message) === "PAYMENT_NOT_FOUND") {
      res.status(400).json({ error: "Booking ini belum memiliki pembayaran yang dapat dikoreksi" });
      return;
    }
    const message = `${String(err?.message ?? "")} ${String(err?.cause?.message ?? "")}`;
    if (
      message.includes("PUBLIC_PAYMENT_ACCOUNTING_ENTRY_MISSING") ||
      message.includes("REVERSED_PUBLIC_ACCOUNTING_ENTRY_IS_IMMUTABLE") ||
      message.includes("POSTED_ACCOUNTING_JOURNAL_FINANCIAL_FIELDS_IMMUTABLE")
    ) {
      res.status(409).json({
        error:
          "Tanggal pembayaran belum dapat dikoreksi karena jurnal akuntansi pembayaran ini belum lengkap atau sudah dikunci. Rekonsiliasi pembayaran terlebih dahulu, lalu coba kembali.",
      });
      return;
    }
    req.log.error({ err }, "Update booking dates error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /bookings/:id/fix-gym-people — koreksi jumlah orang dan harga walk-in Gym (admin)
router.post("/bookings/:id/fix-gym-people", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const numberOfPeople = Number(req.body?.numberOfPeople);
    if (!Number.isInteger(numberOfPeople) || numberOfPeople < 1 || numberOfPeople > 20) {
      res.status(400).json({ error: "Jumlah orang harus berupa bilangan bulat antara 1 dan 20" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }
    if (INACTIVE_STATUSES.includes(booking.status ?? "")) {
      res.status(400).json({ error: "Booking yang sudah tidak aktif tidak dapat dikoreksi" });
      return;
    }

    const [facility] = await db.select().from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId))
      .limit(1);
    if (!facility || (facility.category ?? "").toLowerCase() !== "fitness") {
      res.status(400).json({ error: "Koreksi jumlah orang ini hanya untuk booking Gym/Fitness" });
      return;
    }

    const unitPrice = Number(facility.pricePerHour);
    const basePrice = unitPrice * numberOfPeople;
    const discountAmount = 0;
    const totalPrice = basePrice;
    const taxCalc = await calculateTax(totalPrice, "sport_booking", booking.bookingDate);

    await db.update(bookingsTable).set({
      numberOfPeople,
      basePrice: String(basePrice),
      discountAmount: String(discountAmount),
      apDiscountAmount: String(discountAmount),
      totalPrice: String(totalPrice),
      dpp: String(taxCalc.dpp),
      ppnRate: taxCalc.taxRate > 0 ? String(taxCalc.taxRate) : null,
      ppnAmount: taxCalc.taxAmount > 0 ? String(taxCalc.taxAmount) : null,
      grandTotal: String(taxCalc.grandTotal),
    }).where(eq(bookingsTable.id, id));

    await reverseTaxTransaction(booking.id, booking.orderNumber, booking.bookingDate);
    if (taxCalc.taxCode) {
      await recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, booking.bookingDate);
    }

    if (booking.groupRef) {
      const groupBookings = await db
        .select({ totalPrice: bookingsTable.totalPrice, grandTotal: bookingsTable.grandTotal })
        .from(bookingsTable)
        .where(eq(bookingsTable.groupRef, booking.groupRef));
      const groupTotal = groupBookings.reduce(
        (sum, item) => sum + (item.grandTotal != null ? Number(item.grandTotal) : Number(item.totalPrice)),
        0,
      );
      await db.update(bookingGroupsTable)
        .set({ totalPayment: String(groupTotal), updatedAt: new Date() })
        .where(eq(bookingGroupsTable.groupRef, booking.groupRef));
    }

    const [updatedBooking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, id))
      .limit(1);
    if (updatedBooking) {
      syncBookingToBizportal({
        booking: updatedBooking,
        facilityName: facility.name,
        facilityCategory: facility.category,
      }).catch(() => {});
    }

    const { userId, userName, userRole } = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    await logAudit({
      userId,
      userName,
      userRole,
      action: "ADMIN_FIXED_GYM_NUMBER_OF_PEOPLE",
      entity: "booking",
      entityId: id,
      before: {
        numberOfPeople: booking.numberOfPeople,
        basePrice: Number(booking.basePrice ?? booking.totalPrice),
        totalPrice: Number(booking.totalPrice),
        grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
      },
      after: {
        numberOfPeople,
        basePrice,
        totalPrice,
        grandTotal: taxCalc.grandTotal,
      },
      ipAddress,
      userAgent,
    });

    const result = await getBookingWithPayment(id);
    res.json({
      success: true,
      message: `Koreksi Gym berhasil. ${numberOfPeople} orang, total Rp ${taxCalc.grandTotal.toLocaleString("id-ID")}.`,
      booking: result,
    });
  } catch (err) {
    req.log.error({ err }, "Fix Gym number of people error");
    res.status(500).json({ error: "Gagal mengoreksi jumlah orang Gym" });
  }
});

// POST /bookings/:id/check-in — tandai booking sudah check-in (admin)
router.post("/bookings/:id/check-in", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    const checkIn = await checkInBooking(id, getUserFromReq(req));
    if (!checkIn.ok) { res.status(400).json({ error: checkIn.reason }); return; }
    // Check-in selalu hari ini (divalidasi di atas) — trigger rekap otomatis
    triggerRekapIfToday(booking.bookingDate);
    const result = await getBookingWithPayment(id);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Check-in error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Shared helper: run AP2 ID card verification logic
async function runApVerification(
  bookingId: number,
  idCardNumber: string,
  opts: { verifiedByUserId?: number; ipAddress?: string; orderNumber?: string },
) {
  const normalizedIdCardNumber = idCardNumber.trim().toUpperCase();
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId)).limit(1);
  if (!booking) return { notFound: true } as const;

  // A rejected booking can be tried again with a corrected or newly activated
  // AP card. A verified booking remains immutable.
  const canVerify = booking.customerType === "angkasa_pura"
    && (booking.verificationStatus === "pending" || booking.verificationStatus === "rejected");
  if (!canVerify) {
    await db.insert(verificationLogsTable).values({
      bookingId,
      orderNumber: opts.orderNumber ?? booking.orderNumber,
      verifiedByUserId: opts.verifiedByUserId ?? null,
      idCardNumberInput: normalizedIdCardNumber,
      status: "failed",
      notes: `Booking status: ${booking.verificationStatus} / type: ${booking.customerType}`,
      ipAddress: opts.ipAddress ?? null,
    });
    return {
      success: false, result: "not_pending" as const,
      message: `Booking sudah berstatus '${booking.verificationStatus}', tidak perlu verifikasi.`,
    };
  }

  // Pending bookings keep the original-card mismatch guard. After a
  // rejection, allow the admin to correct a typo or replace an old card.
  const isRetryAfterRejection = booking.verificationStatus === "rejected";
  const savedIdCardNumber = booking.idCardNumber?.trim().toUpperCase();
  if (!isRetryAfterRejection && savedIdCardNumber && savedIdCardNumber !== normalizedIdCardNumber) {
    await db.insert(verificationLogsTable).values({
      bookingId,
      orderNumber: opts.orderNumber ?? booking.orderNumber,
      verifiedByUserId: opts.verifiedByUserId ?? null,
      idCardNumberInput: normalizedIdCardNumber,
      status: "mismatch",
      notes: `Expected: ${savedIdCardNumber}, got: ${normalizedIdCardNumber}`,
      ipAddress: opts.ipAddress ?? null,
    });
    return {
      success: false, result: "mismatch" as const,
      message: `ID Card hasil scan (${normalizedIdCardNumber}) tidak cocok dengan data booking (${savedIdCardNumber}).`,
    };
  }

  const [member] = await db.select().from(apMembersTable)
    .where(and(eq(apMembersTable.idCardNumber, normalizedIdCardNumber), eq(apMembersTable.isActive, true)))
    .limit(1);

  if (!member) {
    await db.update(bookingsTable).set({ verificationStatus: "rejected" }).where(eq(bookingsTable.id, bookingId));
    await db.insert(verificationLogsTable).values({
      bookingId,
      orderNumber: opts.orderNumber ?? booking.orderNumber,
      verifiedByUserId: opts.verifiedByUserId ?? null,
      idCardNumberInput: normalizedIdCardNumber,
      status: "failed",
      notes: "ID Card tidak ditemukan di database AP2",
      ipAddress: opts.ipAddress ?? null,
    });
    return {
      success: false, result: "invalid_card" as const,
      message: "ID Card tidak valid atau bukan member Angkasa Pura aktif.",
    };
  }

  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId))
    .limit(1);
  const [setting] = await db.select().from(discountSettingsTable)
    .where(eq(discountSettingsTable.customerType, "angkasa_pura")).limit(1);
  const discountEnabled = !!setting && setting.isActive;
  const basePrice = booking.basePrice == null ? Number(booking.totalPrice) : Number(booking.basePrice);
  const durationHours = Math.max(1, Number(booking.durationHours) || 1);
  const specialMultigunaPrice = AP_MULTIGUNA_HOURLY_PRICE * durationHours;
  const isSpecialMultiguna = isMultigunaFacility(facility ?? {});

  let discountPct = 0;
  let discountAmount = 0;
  let finalPrice = basePrice;
  if (discountEnabled) {
    if (isSpecialMultiguna) {
      // Harga khusus AP Multiguna: Rp300.000/jam (Rp350.000 → Rp300.000).
      // Gunakan harga tetap agar hasil tidak menjadi Rp299.985 akibat pembulatan 14,29%.
      finalPrice = Math.min(basePrice, specialMultigunaPrice);
      discountAmount = Math.max(0, basePrice - finalPrice);
      discountPct = basePrice > 0
        ? Number(((discountAmount / basePrice) * 100).toFixed(2))
        : 0;
    } else {
      const apDiscount = getApDiscount(basePrice, setting, false, durationHours);
      discountPct = apDiscount.percentage;
      discountAmount = apDiscount.amount;
      finalPrice = apDiscount.finalPrice;
    }
  }
  const taxCalc = await calculateTax(finalPrice, "sport_booking", booking.bookingDate);

  // Recalculate tax on finalPrice (tax is inclusive — grandTotal = finalPrice)
  const finalTaxCalc = await calculateTax(finalPrice, "sport_booking", booking.bookingDate ?? undefined);

  // Terapkan diskon ke booking utama
  await db.update(bookingsTable).set({
    verificationStatus: "verified",
    idCardNumber: normalizedIdCardNumber,
    apDiscountAmount: String(discountAmount),
    discountAmount: String(discountAmount),
    totalPrice: String(finalPrice),

    ppnRate: finalTaxCalc.taxRate > 0 ? String(finalTaxCalc.taxRate) : null,
    ppnAmount: finalTaxCalc.taxAmount > 0 ? String(finalTaxCalc.taxAmount) : null,
    grandTotal: finalTaxCalc.taxAmount > 0 ? String(finalTaxCalc.grandTotal) : null,
    dpp: finalTaxCalc.taxAmount > 0 ? String(finalTaxCalc.dpp) : null,

  }).where(eq(bookingsTable.id, bookingId));

  // Booking awal dibuat dengan harga normal karena masih menunggu verifikasi.
  // Balikkan jurnal pajak awal lalu catat ulang berdasarkan harga AP final.
  await reverseTaxTransaction(booking.id, booking.orderNumber, booking.bookingDate);
  if (taxCalc.taxCode) {
    await recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, booking.bookingDate);
  }

  // Propagate the verified AP price to Bizportal as well.
  const [verifiedBooking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId))
    .limit(1);
  if (verifiedBooking && facility) {
    syncBookingToBizportal({
      booking: verifiedBooking,
      facilityName: facility.name,
      facilityCategory: facility.category,
    }).catch(() => {});
  }

  await db.insert(verificationLogsTable).values({
    bookingId,
    orderNumber: opts.orderNumber ?? booking.orderNumber,
    verifiedByUserId: opts.verifiedByUserId ?? null,
    idCardNumberInput: normalizedIdCardNumber,
    status: "success",
    notes: discountEnabled
      ? `${isSpecialMultiguna ? "Harga khusus AP Multiguna — " : ""}Diskon ${discountPct}% (Rp ${discountAmount.toLocaleString("id-ID")})`
      : "Terverifikasi (diskon nonaktif)",
    ipAddress: opts.ipAddress ?? null,
  });

  // Jika booking ini bagian dari grup (recurring), terapkan diskon ke semua booking grup
  let groupUpdatedCount = 0;
  if (booking.groupRef) {
    const siblings = await db.select().from(bookingsTable)
      .where(and(
        eq(bookingsTable.groupRef, booking.groupRef),
        eq(bookingsTable.customerType, "angkasa_pura"),
        // Sertakan pending DAN verified yang belum dapat diskon (apDiscountAmount null/0)
        // agar semua sesi dalam grup mendapat diskon yang sama
      ))
      .then(rows => rows.filter(s =>
        s.id !== bookingId && // jangan update booking yang sudah diproses
        (s.verificationStatus === "pending" ||
          (s.verificationStatus === "verified" && (!s.apDiscountAmount || Number(s.apDiscountAmount) === 0)))
      ));

    for (const sibling of siblings) {
      const siblingBase = sibling.basePrice == null ? Number(sibling.totalPrice) : Number(sibling.basePrice);
      const siblingDiscount = Number(setting?.discountAmount ?? 0) > 0
        ? Math.min(Number(setting.discountAmount), siblingBase)
        : Math.round((siblingBase * discountPct) / 100);
      const siblingFinal = siblingBase - siblingDiscount;
      const siblingTaxCalc = await calculateTax(siblingFinal, "sport_booking", sibling.bookingDate ?? undefined);
      await db.update(bookingsTable).set({
        verificationStatus: "verified",
        idCardNumber,
        apDiscountAmount: String(siblingDiscount),
        discountAmount: String(siblingDiscount),
        totalPrice: String(siblingFinal),
        grandTotal: siblingTaxCalc.taxAmount > 0 ? String(siblingTaxCalc.grandTotal) : null,
        dpp: siblingTaxCalc.taxAmount > 0 ? String(siblingTaxCalc.dpp) : null,
        ppnAmount: siblingTaxCalc.taxAmount > 0 ? String(siblingTaxCalc.taxAmount) : null,
      }).where(eq(bookingsTable.id, sibling.id));
      groupUpdatedCount++;
    }

    // Update totalPayment di booking_groups — selalu recalculate ketika ada groupRef,
    // termasuk ketika groupUpdatedCount=0 (booking ini adalah satu-satunya / terakhir yang pending)
    const allGroupBookings = await db.select({ totalPrice: bookingsTable.totalPrice, grandTotal: bookingsTable.grandTotal })
      .from(bookingsTable).where(eq(bookingsTable.groupRef, booking.groupRef));
    const newGroupTotal = allGroupBookings.reduce((sum, b) => sum + (b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice)), 0);
    await db.update(bookingGroupsTable)
      .set({ totalPayment: String(newGroupTotal) })
      .where(eq(bookingGroupsTable.groupRef, booking.groupRef));
  }

  return {
    success: true, result: "verified" as const,
    message: discountEnabled

      ? `Verifikasi berhasil. ${isSpecialMultiguna ? "Harga khusus AP Multiguna diterapkan. " : `Diskon ${discountPct}% diterapkan${groupUpdatedCount > 0 ? ` ke ${groupUpdatedCount + 1} booking dalam grup` : ""}. `}Harga akhir Rp ${finalPrice.toLocaleString("id-ID")}.`

      : "ID Card valid. Terverifikasi (diskon Angkasa Pura sedang nonaktif).",
    discountApplied: discountEnabled,
    discountPercentage: discountPct,
    discountAmount,
    finalPrice,
    memberName: member.name,
    bookingId,
    groupUpdatedCount,
  };
}

// POST /bookings/:id/fix-discount — admin menerapkan harga AP secara manual
// tanpa mengubah status verifikasi ID Card.
router.post("/bookings/:id/fix-discount", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }
    if (booking.customerType !== "angkasa_pura") {
      res.status(400).json({ error: "Fix diskon hanya tersedia untuk customer Angkasa Pura" });
      return;
    }
    if (["cancelled", "expired", "refunded"].includes(booking.status)) {
      res.status(400).json({ error: "Booking yang sudah tidak aktif tidak dapat diberi diskon" });
      return;
    }

    const [facility] = await db.select().from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId))
      .limit(1);
    if (!facility) {
      res.status(404).json({ error: "Fasilitas tidak ditemukan" });
      return;
    }

    const [setting] = await db.select().from(discountSettingsTable)
      .where(eq(discountSettingsTable.customerType, "angkasa_pura"))
      .limit(1);
    const durationHours = Math.max(1, Number(booking.durationHours) || 1);
    const basePrice = booking.basePrice == null
      ? Number(facility.pricePerHour) * durationHours
      : Number(booking.basePrice);
    const isSpecialMultiguna = isMultigunaFacility(facility);
    const specialMultigunaPrice = AP_MULTIGUNA_HOURLY_PRICE * durationHours;

    // Override admin mengikuti kebijakan AP: Multiguna Rp300.000/jam,
    // fasilitas lain 20% (atau angka yang tersimpan di pengaturan AP).
    let discountPercentage = 20;
    let discountAmount = 0;
    let finalPrice = basePrice;
    if (isSpecialMultiguna) {
      finalPrice = Math.min(basePrice, specialMultigunaPrice);
      discountAmount = Math.max(0, basePrice - finalPrice);
      discountPercentage = basePrice > 0
        ? Number(((discountAmount / basePrice) * 100).toFixed(2))
        : 0;
    } else {
      const apDiscount = getApDiscount(
        basePrice,
        setting ?? { discountPercentage: 20, discountAmount: null },
        false,
        durationHours,
      );
      discountAmount = apDiscount.amount;
      finalPrice = apDiscount.finalPrice;
      discountPercentage = apDiscount.percentage;
    }

    const taxCalc = await calculateTax(finalPrice, "sport_booking", booking.bookingDate);
    await db.update(bookingsTable).set({
      apDiscountAmount: String(discountAmount),
      discountAmount: String(discountAmount),
      totalPrice: String(finalPrice),
      ppnRate: taxCalc.taxRate > 0 ? String(taxCalc.taxRate) : null,
      ppnAmount: taxCalc.taxAmount > 0 ? String(taxCalc.taxAmount) : null,
      grandTotal: taxCalc.taxAmount > 0 ? String(taxCalc.grandTotal) : null,
    }).where(eq(bookingsTable.id, id));

    await reverseTaxTransaction(booking.id, booking.orderNumber, booking.bookingDate);
    if (taxCalc.taxCode) {
      await recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, booking.bookingDate);
    }

    // Keep a recurring/cart group total in sync when one session is corrected.
    if (booking.groupRef) {
      const groupBookings = await db
        .select({ totalPrice: bookingsTable.totalPrice, grandTotal: bookingsTable.grandTotal })
        .from(bookingsTable)
        .where(eq(bookingsTable.groupRef, booking.groupRef));
      const groupTotal = groupBookings.reduce(
        (sum, item) => sum + (item.grandTotal != null ? Number(item.grandTotal) : Number(item.totalPrice)),
        0,
      );
      await db.update(bookingGroupsTable)
        .set({ totalPayment: String(groupTotal), updatedAt: new Date() })
        .where(eq(bookingGroupsTable.groupRef, booking.groupRef));
    }

    const [updatedBooking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, id))
      .limit(1);
    if (updatedBooking) {
      syncBookingToBizportal({
        booking: updatedBooking,
        facilityName: facility.name,
        facilityCategory: facility.category,
      }).catch(() => {});
    }

    const { userId, userName, userRole } = getUserFromReq(req);
    const { ipAddress, userAgent } = getClientInfo(req);
    await logAudit({
      userId,
      userName,
      userRole,
      action: "ADMIN_FIXED_AP_DISCOUNT",
      entity: "booking",
      entityId: id,
      before: {
        totalPrice: Number(booking.totalPrice),
        grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
        verificationStatus: booking.verificationStatus,
      },
      after: {
        totalPrice: finalPrice,
        grandTotal: taxCalc.grandTotal,
        apDiscountAmount: discountAmount,
        verificationStatus: booking.verificationStatus,
        discountPercentage,
      },
      ipAddress,
      userAgent,
    });

    const result = await getBookingWithPayment(id);
    res.json({
      success: true,
      manual: true,
      message: `Fix diskon berhasil. Harga akhir Rp ${finalPrice.toLocaleString("id-ID")}. Status verifikasi ID tetap '${booking.verificationStatus}'.`,
      discountPercentage,
      discountAmount,
      finalPrice,
      booking: result,
    });
  } catch (err) {
    req.log.error({ err }, "Fix AP discount error");
    res.status(500).json({ error: "Gagal menerapkan fix diskon" });
  }
});

// POST /bookings/:id/verify — verifikasi ID Card Angkasa Pura & terapkan diskon (admin)
router.post("/bookings/:id/verify", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const idCardNumber = String(req.body?.idCardNumber || "").trim().toUpperCase();
    if (!idCardNumber) {
      res.status(400).json({ error: "Nomor ID Card wajib diisi" });
      return;
    }
    const { ipAddress } = getClientInfo(req);
    const verifiedByUserId = (req as any).user?.userId ?? undefined;
    const result = await runApVerification(id, idCardNumber, { verifiedByUserId, ipAddress });
    if ("notFound" in result) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    if (!result.success) { res.json(result); return; }

    const updated = await getBookingWithPayment(id);
    res.json({ ...result, booking: updated });
  } catch (err) {
    req.log.error({ err }, "Verify booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /bookings/groups/:groupRef/reapply-discount — paksa ulang diskon AP ke semua sesi ──
router.post("/bookings/groups/:groupRef/reapply-discount", adminMiddleware, async (req, res) => {
  try {
    const groupRef = String(req.params.groupRef);

    // Ambil semua booking dalam grup yang merupakan AP
    const allBookings = await db.select().from(bookingsTable)
      .where(and(
        eq(bookingsTable.groupRef, groupRef),
        eq(bookingsTable.customerType, "angkasa_pura"),
      ));

    if (!allBookings.length) {
      res.status(404).json({ error: "Tidak ada booking AP dalam grup ini" });
      return;
    }

    // Ambil setting diskon AP
    const [setting] = await db.select().from(discountSettingsTable)
      .where(eq(discountSettingsTable.customerType, "angkasa_pura")).limit(1);
    const discountEnabled = !!setting && setting.isActive;
    const discountPct = discountEnabled ? setting.discountPercentage : 0;
    const fixedDiscountAmount = discountEnabled ? Number(setting?.discountAmount ?? 0) : 0;

    if (!discountEnabled || (discountPct <= 0 && fixedDiscountAmount <= 0)) {
      res.status(400).json({ error: "Diskon AP sedang tidak aktif atau belum diatur" });
      return;
    }

    let updatedCount = 0;
    const details: { orderNumber: string; before: number; after: number; discount: number }[] = [];

    for (const booking of allBookings) {
      const basePrice = booking.basePrice == null ? Number(booking.totalPrice) : Number(booking.basePrice);
      const discountAmount = fixedDiscountAmount > 0
        ? Math.min(fixedDiscountAmount, basePrice)
        : Math.round((basePrice * discountPct) / 100);
      const finalPrice = basePrice - discountAmount;
      const taxCalc = await calculateTax(finalPrice, "sport_booking", booking.bookingDate ?? undefined);

      const before = Number(booking.grandTotal ?? booking.totalPrice);

      await db.update(bookingsTable).set({
        verificationStatus: "verified",
        apDiscountAmount: String(discountAmount),
        discountAmount: String(discountAmount),
        totalPrice: String(finalPrice),
        grandTotal: taxCalc.taxAmount > 0 ? String(taxCalc.grandTotal) : null,
        dpp: taxCalc.taxAmount > 0 ? String(taxCalc.dpp) : null,
        ppnAmount: taxCalc.taxAmount > 0 ? String(taxCalc.taxAmount) : null,
      }).where(eq(bookingsTable.id, booking.id));

      details.push({
        orderNumber: booking.orderNumber,
        before,
        after: taxCalc.taxAmount > 0 ? taxCalc.grandTotal : finalPrice,
        discount: discountAmount,
      });
      updatedCount++;
    }

    // Update group total
    const newGroupTotal = details.reduce((sum, d) => sum + d.after, 0);
    await db.update(bookingGroupsTable)
      .set({ totalPayment: String(newGroupTotal) })
      .where(eq(bookingGroupsTable.groupRef, String(groupRef)));

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "AP_GROUP_DISCOUNT_REAPPLIED",
      entity: "booking_group",
      after: { groupRef, discountPct, updatedCount, newGroupTotal },
      ipAddress,
      userAgent,
    });

    res.json({
      success: true,
      groupRef,
      discountPercentage: discountPct,
      updatedCount,
      newGroupTotal,
      details,
      message: `Diskon ${discountPct}% berhasil diterapkan ulang ke ${updatedCount} sesi dalam grup ${groupRef}.`,
    });
  } catch (err) {
    req.log.error({ err }, "Reapply group discount error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /admin/bookings/wa-unnotified — bookings waiting_confirmation dengan belum ada WA ────
router.get("/admin/bookings/wa-unnotified", adminMiddleware, async (req, res) => {
  try {
    const unnotified = await db
      .select({
        id: bookingsTable.id,
        orderNumber: bookingsTable.orderNumber,
        customerName: bookingsTable.customerName,
        customerPhone: bookingsTable.customerPhone,
        facilityId: bookingsTable.facilityId,
        bookingDate: bookingsTable.bookingDate,
        startTime: bookingsTable.startTime,
        endTime: bookingsTable.endTime,
        totalPrice: bookingsTable.totalPrice,
        status: bookingsTable.status,
        createdAt: bookingsTable.createdAt,
      })
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.status, "waiting_confirmation"),
          notExists(
            db
              .select({ id: waActionTokensTable.id })
              .from(waActionTokensTable)
              .where(
                and(
                  eq(waActionTokensTable.bookingId, bookingsTable.id),
                  eq(waActionTokensTable.action, "review_payment"),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(bookingsTable.createdAt));

    const facilityIds = [...new Set(unnotified.map((b) => b.facilityId))];
    const facilities =
      facilityIds.length > 0
        ? await db
            .select({ id: facilitiesTable.id, name: facilitiesTable.name })
            .from(facilitiesTable)
        : [];

    const result = unnotified.map((b) => {
      const facility = facilities.find((f) => f.id === b.facilityId);
      return {
        ...b,
        totalPrice: Number(b.totalPrice),
        facilityName: facility?.name ?? "",
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "WA unnotified list error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /admin/bookings/:id/wa-logs — riwayat pengiriman WA per booking ─────────────────────
router.get("/admin/bookings/:id/wa-logs", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const logs = await db
      .select()
      .from(waNotifLogsTable)
      .where(eq(waNotifLogsTable.bookingId, id))
      .orderBy(desc(waNotifLogsTable.sentAt));
    res.json(logs);
  } catch (err) {
    req.log.error({ err }, "WA logs fetch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /admin/bookings/:id/resend-wa — kirim ulang notifikasi WA ke admin ───────────────
router.post("/admin/bookings/:id/resend-wa", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const booking = await getBookingWithPayment(id);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const appUrl = await getBaseUrl();
    const reviewToken = await createWaToken(id, "review_payment", 7);
    const reviewUrl = `${appUrl}/ulasan/${reviewToken}`;

    await notifyPaymentProofUploaded({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: booking.facilityName,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      reviewUrl,
    });

    const actorInfo = getUserFromReq(req);
    await logAudit({
      userId: actorInfo?.userId ?? null,
      userName: actorInfo?.userName ?? null,
      userRole: actorInfo?.userRole ?? null,
      action: "WA_PROOF_NOTIFY_RESENT",
      entity: "booking",
      entityId: id,
      after: { orderNumber: booking.orderNumber, reviewUrl },
      ...getClientInfo(req),
    });

    res.json({ ok: true, reviewUrl });
  } catch (err) {
    req.log.error({ err }, "Resend WA error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /bookings/verify-by-order — self-service AP2 verification (public, by order number)
router.post("/bookings/verify-by-order", async (req, res) => {
  try {
    const orderNumber = String(req.body?.orderNumber || "").trim().toUpperCase();
    const idCardNumber = String(req.body?.idCardNumber || "").trim().toUpperCase();
    if (!orderNumber || !idCardNumber) {
      res.status(400).json({ error: "Nomor order dan nomor ID Card wajib diisi" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }

    if (booking.customerType !== "angkasa_pura") {
      res.json({
        success: false, result: "not_pending",
        message: "Booking ini bukan untuk karyawan Angkasa Pura.",
      });
      return;
    }

    const ipAddress = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "");
    const result = await runApVerification(booking.id, idCardNumber, { ipAddress, orderNumber });
    if ("notFound" in result) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    if (!result.success) { res.json(result); return; }

    // Auto-verifikasi semua booking lain dalam grup yang sama dengan ID Card yang sama
    let groupVerifiedCount = 0;
    if (booking.groupRef) {
      const siblings = await db.select().from(bookingsTable).where(
        and(
          eq(bookingsTable.groupRef, booking.groupRef),
          eq(bookingsTable.verificationStatus, "pending"),
          eq(bookingsTable.customerType, "angkasa_pura"),
        )
      );
      for (const sibling of siblings) {
        const sibResult = await runApVerification(sibling.id, idCardNumber, { ipAddress, orderNumber: sibling.orderNumber });
        if ("success" in sibResult && sibResult.success) groupVerifiedCount++;
      }

      // Recalculate group total_payment dari sum totalPrice terbaru
      const allInGroup = await db.select({ totalPrice: bookingsTable.totalPrice, grandTotal: bookingsTable.grandTotal })
        .from(bookingsTable).where(eq(bookingsTable.groupRef, booking.groupRef));
      const newGroupTotal = allInGroup.reduce((sum, b) => sum + (b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice)), 0);
      await db.update(bookingGroupsTable)
        .set({ totalPayment: String(newGroupTotal) })
        .where(eq(bookingGroupsTable.groupRef, booking.groupRef));
    }

    const updated = await getBookingWithPayment(booking.id);
    res.json({ ...result, groupVerifiedCount, booking: updated });
  } catch (err) {
    req.log.error({ err }, "Verify by order error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/bookings/groups/:groupRef/sessions — semua sesi dalam grup (untuk kwitansi gabungan)
router.get("/admin/bookings/groups/:groupRef/sessions", adminMiddleware, async (req, res) => {
  try {
    const groupRef = String(req.params.groupRef);
    const sessions = await db
      .select({
        id: bookingsTable.id,
        orderNumber: bookingsTable.orderNumber,
        bookingDate: bookingsTable.bookingDate,
        startTime: bookingsTable.startTime,
        endTime: bookingsTable.endTime,
        durationHours: bookingsTable.durationHours,
        totalPrice: bookingsTable.totalPrice,
        grandTotal: bookingsTable.grandTotal,
        ppnRate: bookingsTable.ppnRate,
        ppnAmount: bookingsTable.ppnAmount,
        dpp: bookingsTable.dpp,
        status: bookingsTable.status,
        facilityId: bookingsTable.facilityId,
      })
      .from(bookingsTable)
      .where(eq(bookingsTable.groupRef, groupRef))
      .orderBy(bookingsTable.bookingDate);

    if (!sessions.length) {
      res.status(404).json({ error: "Grup tidak ditemukan" });
      return;
    }

    // Ambil nama fasilitas per sesi (mendukung grup multi-fasilitas)
    const uniqueFacilityIds = [...new Set(sessions.map((s) => s.facilityId))];
    const facilities = await db
      .select({ id: facilitiesTable.id, name: facilitiesTable.name })
      .from(facilitiesTable)
      .where(inArray(facilitiesTable.id, uniqueFacilityIds));
    const facilityMap = Object.fromEntries(facilities.map((f) => [f.id, f.name]));

    res.json(sessions.map((s) => ({
      ...s,
      totalPrice: Number(s.totalPrice),
      grandTotal: s.grandTotal != null ? Number(s.grandTotal) : null,
      ppnRate: s.ppnRate != null ? Number(s.ppnRate) : null,
      ppnAmount: s.ppnAmount != null ? Number(s.ppnAmount) : null,
      dpp: s.dpp != null ? Number(s.dpp) : null,
      facilityName: facilityMap[s.facilityId] ?? "",
    })));
  } catch (err) {
    req.log.error({ err }, "Group sessions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
