import { Router } from "express";
import { db, bookingsTable, facilitiesTable, paymentsTable, promosTable, discountSettingsTable, apMembersTable, bookingHistoryTable, usersTable, verificationLogsTable, companyUsersTable, bookingGroupsTable, settingsTable, waActionTokensTable, waNotifLogsTable } from "@workspace/db";
import { eq, and, sql, or, ilike, desc, inArray, notExists } from "drizzle-orm";
import { adminMiddleware, authMiddleware, verifyToken } from "../lib/auth";
import { broadcastAvailabilityChange } from "../lib/supabase";
import { notifyBookingCreated, notifyPaymentConfirmed, notifyBookingCancelled, notifyCompanyBookingCreated, notifyDpPaid, notifyWaAdminNewBooking, notifyAdminBookingApprovalRequest, notifyPaymentProofUploaded } from "../lib/notifications";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { createWaToken } from "../lib/waTokens";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { syncBookingToBizportal, syncStatusToBizportal, deleteBookingFromBizportal, pushConfirmedPaymentAsBankMutation } from "../lib/bizportalSync";
import { getBaseUrl } from "../lib/appUrl";
import { calculateTax, recordTaxTransaction, reverseTaxTransaction } from "../lib/tax";
import { reverseJournalEntry, reversePublicAccountingEntry } from "../lib/accounting";

const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];

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
      const total =
        booking.grandTotal != null ? Number(booking.grandTotal) : Number(booking.totalPrice);
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
      const grandTotalNum = b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice);
      const dpAmt = Number(b.downPayment ?? 0);
      return {
        ...b,
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
        payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
        payments: bPayments.map((p) => ({ ...p, amount: Number(p.amount) })),
        remainingAmount: Math.max(0, grandTotalNum - dpAmt),
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
  const rows = await db.select({ code: usersTable.customerCode }).from(usersTable);
  let max = 0;
  for (const row of rows) {
    const m = (row.code ?? "").match(/^C(\d+)$/);
    if (m) { const n = parseInt(m[1]); if (n > max) max = n; }
  }
  return `C${String(max + 1).padStart(5, "0")}`;
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
  try {
    const { customerName, customerEmail, facilityId, bookingDate, notes, promoCode, discountAmount, customerType } = req.body;
    const customerPhone: string = normalizePhone(String(req.body.customerPhone ?? "").trim());
    const bookingSource: string = req.body.source || "";
    const rawBookingType = req.body.bookingType;
    const bookingType: "regular" | "event" = rawBookingType === "event" ? "event" : "regular";
    const isEvent = bookingType === "event";
    const EVENT_DISCOUNT_RATE = 3 / 14; // ≈ 21.43% — 350.000 → 275.000 tepat
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
    const numberOfPeople = req.body.numberOfPeople ? Number(req.body.numberOfPeople) : null;
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

    const isWalkIn = facility.bookingMode === "walk_in";

    if (isWalkIn) {
      // Gym walk-in: no time slot required, flat rate per visit
      startTime = facility.openTime;
      durationHours = 1;
    } else {
      // Time slot booking validations
      if (!startTime || !durationHours) {
        res.status(400).json({ error: "startTime and durationHours required" });
        return;
      }

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
      const closeMin = timeToMinutesLocal(facility.closeTime);
      const startMin = timeToMinutesLocal(startTime);
      const endMin = startMin + durationHours * 60;
      if (startMin < openMin || endMin > closeMin) {
        res.status(400).json({ error: `Booking harus dalam jam operasional ${facility.openTime}–${facility.closeTime}` });
        return;
      }

      // Conflict check
      const endTime = addHours(startTime, durationHours);
      const conflicting = await db.select().from(bookingsTable).where(
        and(eq(bookingsTable.facilityId, Number(facilityId)), eq(bookingsTable.bookingDate, bookingDate))
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
        res.status(409).json({ error: "Slot waktu ini sudah dipesan. Pilih jam lain." });
        return;
      }
    }

    const endTime = addHours(startTime, durationHours);
    const basePrice = Number(facility.pricePerHour) * (isWalkIn ? 1 : durationHours);

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
        if (apSetting && apSetting.discountPercentage > 0) {
          apAutoDiscountAmount = Math.round((basePrice * apSetting.discountPercentage) / 100);
          apAutoVerified = true;
        } else {
          // Member valid tapi diskon nonaktif → tetap auto-verified
          apAutoVerified = true;
        }
      }
    }

    // ── Diskon Event 21,4% ───────────────────────────────────────────────────
    const eventDiscountAmountCalc = isEvent ? Math.round(basePrice * EVENT_DISCOUNT_RATE) : 0;

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
      paymentDeadline: (isCompanyBilling || isPendingCompany) ? null : new Date(Date.now() + deadlineHours * 60 * 60 * 1000),
      bookedForName: (isCompanyBilling || isPendingCompany) ? (req.body.bookedForName?.trim() || customerName) : null,
      bookedForPhone: (isCompanyBilling || isPendingCompany) ? (req.body.bookedForPhone?.trim() || customerPhone) : null,
      ppnRate: taxCalc.taxRate > 0 ? String(taxCalc.taxRate) : null,
      dpp: taxCalc.taxAmount > 0 ? String(taxCalc.dpp) : null,
      ppnAmount: taxCalc.taxAmount > 0 ? String(taxCalc.taxAmount) : null,
      grandTotal: taxCalc.taxAmount > 0 ? String(taxCalc.grandTotal) : null,
      vendorId: req.body.vendorId ? Number(req.body.vendorId) : null,
    }).returning();

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
      const deadline = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);
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

    // ─── Kirim rekap pemakaian Sport Center ke grup admin ──────────────────
    (async () => {
      try {
        await sendRekapPemakaianToAdmin(bookingDate);
        console.log("[SPORT CENTER REKAP] Rekap pemakaian berhasil dikirim");
      } catch (err) {
        console.error("[SPORT CENTER REKAP] Gagal kirim rekap pemakaian", err);
      }
    })();

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

// POST /bookings/recurring/check
router.post("/bookings/recurring/check", async (req, res) => {
  try {
    const { facilityId, startDate, startTime, durationHours, repeatType, repeatCount } = req.body;

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, Number(facilityId))).limit(1);
    if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }

    const endTime = addHours(startTime, durationHours);
    const dates = generateRecurringDates(startDate, repeatType, repeatCount);

    const results = await Promise.all(
      dates.map(async (date) => {
        const conflict = await checkSlotConflict(Number(facilityId), date, startTime, endTime);
        return { date, available: !conflict, reason: conflict ? "Slot already booked" : null };
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
      // AP2 / customer type

      // Company billing fields (optional)
      payerType, companyCustomerId, customerId: bodyCustomerId, bookedForName, bookedForPhone,
      // AP2 employee fields (optional)
      customerType: rawCustomerType, idCardNumber: rawIdCardNumber,
      bookingType: rawBookingTypeR,
    } = req.body;
    const bookingTypeR: "regular" | "event" = rawBookingTypeR === "event" ? "event" : "regular";
    const isEventR = bookingTypeR === "event";
    const EVENT_DISCOUNT_RATE_R = 3 / 14; // ≈ 21.43% — 350.000 → 275.000 tepat
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
    const basePrice = Number(facility.pricePerHour) * durationHours;

    // ── Diskon Event 21,4% (recurring) ──────────────────────────────────────
    const eventDiscountAmountCalcR = isEventR ? Math.round(basePrice * EVENT_DISCOUNT_RATE_R) : 0;

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
        if (apSettingR && apSettingR.discountPercentage > 0) {
          apAutoDiscountAmountR = Math.round((basePrice * apSettingR.discountPercentage) / 100);
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

    const created: any[] = [];
    const skipped: string[] = [];
    for (const bookingDate of dates) {
      const conflict = await checkSlotConflict(Number(facilityId), bookingDate, startTime, endTime);
      if (conflict) {
        skipped.push(bookingDate);
        continue;
      }
      // Per-date tax calc: respects effectiveDate backward-compat rule
      const taxCalc = await calculateTax(totalPrice, "sport_booking", bookingDate);
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
        ...(isCompanyPayer ? {
          payerType: "company",
          companyCustomerId: verifiedCompanyCustomerId as number,
          bookedForName: bookedForName || customerName,
          bookedForPhone: bookedForPhone || customerPhone,
          paymentRequiredNow: false,
          paymentDeadline: null,
          billingStatus: "unbilled",
          status: "confirmed",
        } : {}),
      }).returning();
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

    // Auto-group: jika ada 2+ booking berhasil, gabung otomatis ke 1 grup bayar
    let groupRef: string | null = null;
    if (created.length >= 2) {
      // Generate unique groupRef
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

      const orderNumbers = created.map((b: any) => b.orderNumber as string);
      await db.update(bookingsTable)
        .set({ groupRef })
        .where(inArray(bookingsTable.orderNumber, orderNumbers));

      // Update created array dengan groupRef
      for (const b of created) b.groupRef = groupRef;
    }

    // Rekap otomatis jika ada booking yang jatuh hari ini
    const today = todayWIB();
    if (created.some((b: any) => b.bookingDate === today)) {
      triggerRekapIfToday(today);
    }

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

    const grandTotal = Number(booking.grandTotal ?? booking.totalPrice);
    const dp = Number(downPaymentAmount);

    if (dp > grandTotal) {
      res.status(400).json({ error: `DP (${dp}) tidak boleh melebihi Grand Total (${grandTotal})` });
      return;
    }

    await db.update(bookingsTable)
      .set({ downPayment: String(dp), isDpPaid: true })
      .where(eq(bookingsTable.id, id));

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
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    const [beforeUpdate] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    await db.update(bookingsTable).set(updateData).where(eq(bookingsTable.id, id));
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

// POST /bookings/:id/check-in — tandai booking sudah check-in (admin)
router.post("/bookings/:id/check-in", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    if (booking.checkedInAt) { res.status(400).json({ error: "Booking sudah check-in" }); return; }
    if (booking.status !== "confirmed") { res.status(400).json({ error: "Check-in hanya bisa dilakukan untuk booking yang sudah dikonfirmasi" }); return; }
    const now = new Date();
    const todayJKT = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    if (booking.bookingDate !== todayJKT) { res.status(400).json({ error: "Check-in hanya bisa dilakukan pada hari H booking" }); return; }
    await db.update(bookingsTable).set({ checkedInAt: now, updatedAt: now }).where(eq(bookingsTable.id, id));
    await db.insert(bookingHistoryTable).values({
      bookingId: id,
      fromStatus: booking.status,
      toStatus: booking.status,
      changedByName: "admin",
      note: `Check-in pukul ${now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`,
    });
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
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId)).limit(1);
  if (!booking) return { notFound: true } as const;

  if (booking.customerType !== "angkasa_pura" || booking.verificationStatus !== "pending") {
    await db.insert(verificationLogsTable).values({
      bookingId,
      orderNumber: opts.orderNumber ?? booking.orderNumber,
      verifiedByUserId: opts.verifiedByUserId ?? null,
      idCardNumberInput: idCardNumber,
      status: "failed",
      notes: `Booking status: ${booking.verificationStatus} / type: ${booking.customerType}`,
      ipAddress: opts.ipAddress ?? null,
    });
    return {
      success: false, result: "not_pending" as const,
      message: `Booking sudah berstatus '${booking.verificationStatus}', tidak perlu verifikasi.`,
    };
  }

  if (booking.idCardNumber && booking.idCardNumber !== idCardNumber) {
    await db.insert(verificationLogsTable).values({
      bookingId,
      orderNumber: opts.orderNumber ?? booking.orderNumber,
      verifiedByUserId: opts.verifiedByUserId ?? null,
      idCardNumberInput: idCardNumber,
      status: "mismatch",
      notes: `Expected: ${booking.idCardNumber}, got: ${idCardNumber}`,
      ipAddress: opts.ipAddress ?? null,
    });
    return {
      success: false, result: "mismatch" as const,
      message: `ID Card hasil scan (${idCardNumber}) tidak cocok dengan data booking (${booking.idCardNumber}).`,
    };
  }

  const [member] = await db.select().from(apMembersTable)
    .where(and(eq(apMembersTable.idCardNumber, idCardNumber), eq(apMembersTable.isActive, true)))
    .limit(1);

  if (!member) {
    await db.update(bookingsTable).set({ verificationStatus: "rejected" }).where(eq(bookingsTable.id, bookingId));
    await db.insert(verificationLogsTable).values({
      bookingId,
      orderNumber: opts.orderNumber ?? booking.orderNumber,
      verifiedByUserId: opts.verifiedByUserId ?? null,
      idCardNumberInput: idCardNumber,
      status: "failed",
      notes: "ID Card tidak ditemukan di database AP2",
      ipAddress: opts.ipAddress ?? null,
    });
    return {
      success: false, result: "invalid_card" as const,
      message: "ID Card tidak valid atau bukan member Angkasa Pura aktif.",
    };
  }

  const [setting] = await db.select().from(discountSettingsTable)
    .where(eq(discountSettingsTable.customerType, "angkasa_pura")).limit(1);
  const discountEnabled = !!setting && setting.isActive;
  const discountPct = discountEnabled ? setting.discountPercentage : 0;
  const basePrice = booking.basePrice == null ? Number(booking.totalPrice) : Number(booking.basePrice);
  const discountAmount = Math.round((basePrice * discountPct) / 100);
  const finalPrice = basePrice - discountAmount;

  // Recalculate tax on finalPrice (tax is inclusive — grandTotal = finalPrice)
  const finalTaxCalc = await calculateTax(finalPrice, "sport_booking", booking.bookingDate ?? undefined);

  // Terapkan diskon ke booking utama
  await db.update(bookingsTable).set({
    verificationStatus: "verified",
    idCardNumber,
    apDiscountAmount: String(discountAmount),
    discountAmount: String(discountAmount),
    totalPrice: String(finalPrice),
    grandTotal: finalTaxCalc.taxAmount > 0 ? String(finalTaxCalc.grandTotal) : null,
    dpp: finalTaxCalc.taxAmount > 0 ? String(finalTaxCalc.dpp) : null,
    ppnAmount: finalTaxCalc.taxAmount > 0 ? String(finalTaxCalc.taxAmount) : null,
  }).where(eq(bookingsTable.id, bookingId));

  await db.insert(verificationLogsTable).values({
    bookingId,
    orderNumber: opts.orderNumber ?? booking.orderNumber,
    verifiedByUserId: opts.verifiedByUserId ?? null,
    idCardNumberInput: idCardNumber,
    status: "success",
    notes: discountEnabled ? `Diskon ${discountPct}% (Rp ${discountAmount.toLocaleString("id-ID")})` : "Terverifikasi (diskon nonaktif)",
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
      const siblingDiscount = Math.round((siblingBase * discountPct) / 100);
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
      ? `Verifikasi berhasil. Diskon ${discountPct}% diterapkan${groupUpdatedCount > 0 ? ` ke ${groupUpdatedCount + 1} booking dalam grup` : ""}. Harga akhir Rp ${finalPrice.toLocaleString("id-ID")}.`
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

    if (!discountEnabled || discountPct <= 0) {
      res.status(400).json({ error: "Diskon AP sedang tidak aktif atau 0%" });
      return;
    }

    let updatedCount = 0;
    const details: { orderNumber: string; before: number; after: number; discount: number }[] = [];

    for (const booking of allBookings) {
      const basePrice = booking.basePrice == null ? Number(booking.totalPrice) : Number(booking.basePrice);
      const discountAmount = Math.round((basePrice * discountPct) / 100);
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
