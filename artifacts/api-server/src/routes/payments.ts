import { Router } from "express";
import { db, paymentsTable, bookingsTable, bookingHistoryTable, facilitiesTable, bookingGroupsTable } from "@workspace/db";
import { eq, and, ne, inArray, sql } from "drizzle-orm";
import { adminMiddleware, verifyToken } from "../lib/auth";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { notifyPaymentConfirmed, notifyPaymentProofUploaded } from "../lib/notifications";
import { logAudit, getClientInfo, getUserFromReq, logAccountingError } from "../lib/auditLog";
import { syncStatusToBizportal, pushConfirmedPaymentAsBankMutation } from "../lib/bizportalSync";
import { uploadProofWithFallback } from "./storage";

import {
  createJournalEntry,
  createPublicAccountingEntryForGroup,
  extractBookingDpp,
  postConfirmedPaymentAccounting,
} from "../lib/accounting";

import { createWaToken } from "../lib/waTokens";
import { logger } from "../lib/logger";
import { getBaseUrl } from "../lib/appUrl";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { sendInvoiceToCustomer, sendGroupInvoiceToCustomer } from "../lib/invoiceDelivery";
import { normalizePaymentProvider, parseProviderPaidAt } from "../lib/paymentProvider";
import { createPaymentProviderId, createPaymentProviderOrderId, normalizeProviderName } from "../lib/paymentMetadata";
import { ensurePaymentBankAccount, resolveRequiredPaymentEnrichment, paymentEffectiveDate } from "../lib/paymentEnrichment";

// Helper: kirim rekap ke admin WA hanya jika tanggal booking = hari ini (WIB)
function todayWIB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
function triggerRekapIfToday(bookingDate: string): void {
  if (bookingDate === todayWIB()) {
    sendRekapPemakaianToAdmin(bookingDate).catch((err) =>
      logger.error({ err }, "[REKAP] Gagal kirim rekap pemakaian (payments)"),
    );
  }
}

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/octet-stream";
    cb(null, ok);
  },
});

router.post("/payments/proof-upload", upload.single("proof"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }
    const url = await uploadProofWithFallback(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ objectPath: url, url });
  } catch (err) {
    req.log.error({ err }, "Upload proof error");
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/payments", adminMiddleware, async (req, res) => {
  try {
    const { bookingId } = req.query;
    let payments = await db.select().from(paymentsTable);
    if (bookingId) payments = payments.filter((p) => p.bookingId === Number(bookingId));
    res.json(payments.map((p) => ({ ...p, amount: Number(p.amount) })));
  } catch (err) {
    req.log.error({ err }, "List payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /payments/grouped — daftar pembayaran dikelompokkan per Group Booking (admin only)
router.get("/payments/grouped", adminMiddleware, async (req, res) => {
  try {
    // Ambil semua payments beserta booking & fasilitas
    const rows = await db.execute(sql`
      SELECT
        p.id            AS payment_id,
        p.booking_id    AS booking_id,
        p.amount,
        p.status        AS payment_status,
        p.payment_type,
        p.proof_url,
        p.created_at    AS payment_created_at,
        b.id            AS bid,
        b.order_number,
        b.customer_name,
        b.customer_phone,
        b.booking_date,
        b.start_time,
        b.end_time,
        b.total_price,
        b.grand_total,
        b.status        AS booking_status,
        b.group_ref,
        f.name          AS facility_name
      FROM sport_center.payments p
      JOIN sport_center.bookings b ON b.id = p.booking_id
      LEFT JOIN sport_center.facilities f ON f.id = b.facility_id
      ORDER BY p.created_at DESC
    `);

    type Row = {
      payment_id: number; booking_id: number; amount: string;
      payment_status: string; payment_type: string; proof_url: string | null;
      payment_created_at: string;
      bid: number; order_number: string; customer_name: string; customer_phone: string;
      booking_date: string; start_time: string; end_time: string;
      total_price: string; grand_total: string | null; booking_status: string;
      group_ref: string | null; facility_name: string | null;
    };

    const allRows = rows.rows as Row[];

    // Agregasi: kelompokkan berdasarkan groupRef
    const groupMap = new Map<string, Row[]>(); // groupRef → rows
    const singles: Row[] = []; // booking tanpa groupRef

    for (const row of allRows) {
      if (row.group_ref) {
        const existing = groupMap.get(row.group_ref) ?? [];
        // Deduplicate: satu booking per group entry
        const alreadyHasBooking = existing.some(r => r.booking_id === row.booking_id);
        if (!alreadyHasBooking) existing.push(row);
        groupMap.set(row.group_ref, existing);
      } else {
        singles.push(row);
      }
    }

    const result: any[] = [];

    // Group entries
    for (const [groupRef, groupRows] of groupMap) {
      const repRow = groupRows[0]!;
      // Cari payment yang punya proof untuk representative
      const withProof = groupRows.find(r => r.proof_url);
      const repPayment = withProof ?? repRow;

      const totalAmount = groupRows.reduce((s, r) => s + Number(r.grand_total ?? r.total_price), 0);
      const childBookings = groupRows.map(r => ({
        bookingId: r.booking_id,
        orderNumber: r.order_number,
        facilityName: r.facility_name,
        bookingDate: r.booking_date,
        startTime: r.start_time,
        endTime: r.end_time,
        amount: Number(r.grand_total ?? r.total_price),
        bookingStatus: r.booking_status,
        paymentStatus: r.payment_status,
      }));

      result.push({
        isGroup: true,
        groupRef,
        groupBookingId: groupRef,
        bookingCount: groupRows.length,
        totalGroupAmount: totalAmount,
        customerName: repRow.customer_name,
        customerPhone: repRow.customer_phone,
        paymentId: repPayment.payment_id,
        proofUrl: repPayment.proof_url,
        paymentStatus: repRow.payment_status,
        paymentType: repRow.payment_type,
        bookingStatus: repRow.booking_status,
        createdAt: repRow.payment_created_at,
        childBookings,
      });
    }

    // Single (non-group) entries — deduplicate by bookingId, use latest payment
    const singleByBooking = new Map<number, Row>();
    for (const row of singles) {
      const existing = singleByBooking.get(row.booking_id);
      if (!existing || new Date(row.payment_created_at) > new Date(existing.payment_created_at)) {
        singleByBooking.set(row.booking_id, row);
      }
    }

    for (const row of singleByBooking.values()) {
      result.push({
        isGroup: false,
        groupRef: null,
        groupBookingId: null,
        bookingCount: 1,
        totalGroupAmount: Number(row.grand_total ?? row.total_price),
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        paymentId: row.payment_id,
        proofUrl: row.proof_url,
        paymentStatus: row.payment_status,
        paymentType: row.payment_type,
        bookingStatus: row.booking_status,
        orderNumber: row.order_number,
        facilityName: row.facility_name,
        bookingDate: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
        createdAt: row.payment_created_at,
        childBookings: [],
      });
    }

    // Sort by createdAt desc
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List grouped payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/payments", async (req, res) => {
  try {
    const { bookingId, amount, proofUrl, notes } = req.body;

    const requestedPaymentType: string = req.body.paymentType ?? "";

    const rawPaymentMethod = req.body.paymentMethod;
    const rawPaymentProvider = req.body.paymentProvider;
    let paymentMethod: "QRIS" | "Transfer Bank" = "Transfer Bank";
    let paymentProvider: "mandiri_direct" | "unknown" | null = null;
    if (rawPaymentMethod !== undefined) {
      const method = String(rawPaymentMethod).trim().toLowerCase();
      if (method === "qris") {
        paymentMethod = "QRIS";
        const normalizedProvider = normalizePaymentProvider(rawPaymentProvider);
        if (normalizedProvider !== "mandiri_direct") {
          res.status(400).json({
            error: "Pembayaran QRIS manual wajib menyertakan paymentProvider mandiri_direct.",
          });
          return;
        }
        paymentProvider = normalizedProvider as "mandiri_direct" | "unknown";
      } else if (method === "transfer" || method === "bank_transfer" || method === "transfer bank") {
        paymentMethod = "Transfer Bank";
      } else {
        res.status(400).json({ error: "Metode pembayaran tidak didukung. Pilih QRIS atau Transfer Bank." });
        return;
      }
    }
    if (paymentMethod === "QRIS") {
      const normalizedProvider = normalizePaymentProvider(rawPaymentProvider);
      if (normalizedProvider !== "mandiri_direct") {
        res.status(400).json({
            error: "Provider QRIS manual wajib diisi: mandiri_direct.",
        });
        return;
      }
      paymentProvider = normalizedProvider as "mandiri_direct" | "unknown";
    } else if (rawPaymentProvider !== undefined && rawPaymentProvider !== null && rawPaymentProvider !== "") {
      res.status(400).json({ error: "Provider hanya boleh diisi untuk pembayaran QRIS." });
      return;
    }

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, Number(bookingId))).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

    // Booking yang expired boleh direaktivasi melalui pengiriman bukti bayar.
    // Setelah bukti diterima, alur normal akan memindahkannya ke
    // waiting_confirmation untuk verifikasi admin. Status terminal lain tetap
    // ditolak agar booking yang dibatalkan/ditolak/refunded tidak bisa dipakai
    // kembali tanpa proses admin khusus.
    if (booking.status !== "pending_payment" && booking.status !== "expired") {
      res.status(409).json({ error: "Booking tidak dalam status menunggu pembayaran" });
      return;
    }

    // Validasi kepemilikan: jika request membawa token, pastikan customer yang mengirim adalah pemilik booking
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const payload = verifyToken(authHeader.slice(7));
      if (payload?.userId) {
        const isOwner = booking.customerId === payload.userId || booking.bookedByUserId === payload.userId;
        const isAdmin = !!payload.role && payload.role !== "customer";
        if (!isOwner && !isAdmin) {
          res.status(403).json({ error: "Tidak diizinkan mengupload bukti untuk booking ini" });
          return;
        }
      }
    }

    const groupBookings = booking.groupRef
      ? await db.select({
          id: bookingsTable.id,
          downPayment: bookingsTable.downPayment,
          isDpPaid: bookingsTable.isDpPaid,
        }).from(bookingsTable).where(eq(bookingsTable.groupRef, booking.groupRef))
      : [{ id: booking.id, downPayment: booking.downPayment, isDpPaid: booking.isDpPaid }];
    const groupBookingIds = groupBookings.map((b) => b.id);
    const existingPayments = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.bookingId, Number(bookingId)));
    const groupPayments = booking.groupRef && groupBookingIds.length > 1
      ? await db.select().from(paymentsTable).where(inArray(paymentsTable.bookingId, groupBookingIds))
      : existingPayments;

    const configuredDownPayment = Math.max(
      0,
      ...groupBookings.map((b) => Number(b.downPayment ?? 0)),
    );
    const configuredDp = groupBookings.some((b) => b.isDpPaid) || configuredDownPayment > 0;
    const hasDpActive = groupPayments.some(
      (p) => p.paymentType === "dp" && (p.status === "pending" || p.status === "confirmed"),
    );
    const paymentType = configuredDp
      ? hasDpActive ? "pelunasan" : "dp"
      : "full_payment";

    // Payment type is derived from the booking state, never trusted from the browser.
    // This also repairs the old recurring-booking bug where the client sent
    // full_payment even though a DP had been configured.
    if (
      requestedPaymentType &&
      !["dp", "pelunasan", "full_payment"].includes(requestedPaymentType)
    ) {
      res.status(400).json({ error: "Tipe pembayaran tidak valid" });
      return;
    }

    // Group/recurring bookings are paid as one combined invoice. The
    // representative booking row can contain only one session's total, while
    // the customer-facing page correctly shows booking_groups.total_payment.
    // Use the group total for payment-type validation as well.
    const [bookingGroup] = booking.groupRef
      ? await db.select({ totalPayment: bookingGroupsTable.totalPayment })
          .from(bookingGroupsTable)
          .where(eq(bookingGroupsTable.groupRef, booking.groupRef))
          .limit(1)
      : [];
    const total = Number(bookingGroup?.totalPayment ?? booking.grandTotal ?? booking.totalPrice);
    const confirmedDp = Math.max(
      0,
      ...groupPayments
        .filter((p) => p.paymentType === "dp" && p.status === "confirmed")
        .map((p) => Number(p.amount)),
    );
    const expectedAmount =
      paymentType === "dp"
        ? configuredDownPayment
        : paymentType === "pelunasan"
        ? Math.max(0, total - confirmedDp)
        : total;
    const submittedAmount = Number(amount);
    if (
      !Number.isFinite(submittedAmount) ||
      submittedAmount <= 0 ||
      Math.abs(submittedAmount - expectedAmount) > 1
    ) {
      res.status(400).json({
        error: `Nominal ${paymentType} harus ${expectedAmount.toLocaleString("id-ID")}`,
      });
      return;
    }

    // Validasi: jangan buat duplicate pending payment untuk tipe yang sama
    if (paymentType === "dp") {
      const hasPendingDp = groupPayments.some(
        (p) => p.paymentType === "dp" && p.status === "pending",
      );
      if (hasPendingDp) {
        res.status(409).json({ error: "Bukti DP sudah dikirim, mohon tunggu konfirmasi admin" });
        return;
      }
    }

    if (paymentType === "pelunasan") {
      const hasPendingPelunasan = groupPayments.some(
        (p) => p.paymentType === "pelunasan" && p.status === "pending",
      );
      if (hasPendingPelunasan) {
        res.status(409).json({ error: "Bukti pelunasan sudah dikirim, mohon tunggu konfirmasi admin" });
        return;
      }
    }

    // ── Validasi nominal pembayaran ───────────────────────────────────────────
    // For group bookings, use the group's total payment as the ceiling, not the per-session price
    const grandTotalVal = total;
    const amountNum = Number(amount);
    const PAYMENT_TOLERANCE = 1000;

    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({ error: "Nominal pembayaran harus lebih dari 0" });
      return;
    }

    if (paymentType === "full_payment") {
      if (amountNum > grandTotalVal + PAYMENT_TOLERANCE) {
        res.status(400).json({
          error: `Nominal pembayaran (Rp ${amountNum.toLocaleString("id-ID")}) melebihi total tagihan (Rp ${grandTotalVal.toLocaleString("id-ID")})`,
        });
        return;
      }
    }

    if (paymentType === "pelunasan") {
      const confirmedDpTotal = Math.max(
        0,
        ...groupPayments
          .filter((p) => p.paymentType === "dp" && p.status === "confirmed")
          .map((p) => Number(p.amount)),
      );
      const remainingAmount = grandTotalVal - confirmedDpTotal;
      if (amountNum > remainingAmount + PAYMENT_TOLERANCE) {
        res.status(400).json({
          error: `Nominal pelunasan (Rp ${amountNum.toLocaleString("id-ID")}) melebihi sisa tagihan (Rp ${remainingAmount.toLocaleString("id-ID")})`,
        });
        return;
      }
    }

    const manualPaidAt = paymentMethod === "QRIS"
      ? parseProviderPaidAt(req.body as Record<string, unknown>) ?? new Date()
      : null;
    const paymentEnrichment = await resolveRequiredPaymentEnrichment(
      booking,
      paymentMethod === "QRIS" ? (paymentProvider ?? "unknown") : "unknown",
      manualPaidAt,
      {
        // The booking relation is the primary company evidence. The
        // effective date is passed explicitly so both settlement resolvers
        // use the same provider timestamp.
        effectiveDate: manualPaidAt ? paymentEffectiveDate(manualPaidAt) : null,
      },
    );
    const providerName = normalizeProviderName(paymentProvider ?? "unknown");
    const providerId = createPaymentProviderId(
      paymentProvider ?? "unknown",
      req.body.providerId ?? req.body.providerReference ?? req.body.providerTradeNo ?? req.body.merchantTradeNo,
    );
    const providerOrderId = createPaymentProviderOrderId(
      paymentProvider ?? "unknown",
      req.body.providerOrderId ?? req.body.merchantTradeNo ?? req.body.providerReference ?? req.body.providerTradeNo,
    );

    // Insert payment record baru (no upsert)
    const [payment] = await db.insert(paymentsTable)
      .values({
        bookingId: Number(bookingId),
        amount: String(amount),
        proofUrl,
        paymentMethod,
        paymentProvider: paymentProvider ?? "unknown",
        providerName,
        providerId,
        providerOrderId,
        companyId: paymentEnrichment.companyId ?? null,
        bankAccountId: paymentEnrichment.bankAccountId,
        expectedSettlementDate: paymentEnrichment.expectedSettlementDate ?? null,
        paidAt: paymentEnrichment.paidAt ?? null,
        notes,
        paymentType: paymentType as "dp" | "pelunasan" | "full_payment",
      })
      .returning();

    const prevStatus = booking.status;
    await db.update(bookingsTable)
      .set({ status: "waiting_confirmation", updatedAt: new Date() })
      .where(eq(bookingsTable.id, Number(bookingId)));

    const historyNote = prevStatus === "expired"
      ? "Booking expired direaktivasi; bukti transfer diupload"
      : paymentType === "dp"
      ? "Bukti DP diupload"
      : paymentType === "pelunasan"
      ? "Bukti pelunasan diupload"
      : "Bukti transfer diupload";

    await db.insert(bookingHistoryTable).values({
      bookingId: Number(bookingId),
      fromStatus: prevStatus,
      toStatus: "waiting_confirmation",
      changedByName: booking.customerName,
      note: historyNote,
    });

    // Grup repeat booking: propagasi waiting_confirmation + proof ke semua sibling
    if (booking.groupRef) {
      const siblings = await db.select().from(bookingsTable).where(
        and(
          eq(bookingsTable.groupRef, booking.groupRef),
          ne(bookingsTable.id, Number(bookingId)),
        )
      );
      for (const sib of siblings) {
        // Buat payment record untuk sibling agar bukti transfer tercatat di semua sesi
        const hasPendingPayment = await db.select({ id: paymentsTable.id })
          .from(paymentsTable)
          .where(and(
            eq(paymentsTable.bookingId, sib.id),
            eq(paymentsTable.status, "pending"),
          ));
        if (hasPendingPayment.length === 0) {
          await db.insert(paymentsTable).values({
            bookingId: sib.id,
            // A group payment is one financial event. Mirror the submitted
            // amount for UI/history consistency instead of showing each
            // sibling's session price as another payment.
            amount: String(amountNum),
            proofUrl,
            paymentMethod,
            paymentProvider: paymentProvider ?? "unknown",
            providerName,
            providerId,
            providerOrderId,
            companyId: paymentEnrichment.companyId ?? null,
            bankAccountId: paymentEnrichment.bankAccountId,
            expectedSettlementDate: paymentEnrichment.expectedSettlementDate ?? null,
            paidAt: paymentEnrichment.paidAt ?? null,
            notes: `[Grup ${booking.groupRef}] ${notes || ""}`.trim(),
            paymentType: paymentType as "dp" | "pelunasan" | "full_payment",
          });
        }
        const sibPrev = sib.status;
        await db.update(bookingsTable)
          .set({ status: "waiting_confirmation", updatedAt: new Date() })
          .where(eq(bookingsTable.id, sib.id));
        await db.insert(bookingHistoryTable).values({
          bookingId: sib.id,
          fromStatus: sibPrev,
          toStatus: "waiting_confirmation",
          changedByName: booking.customerName,
          note: `${historyNote} (grup ${booking.groupRef})`,
        });
        // Sync sibling ke BizPortal
        syncStatusToBizportal(sib.orderNumber, "waiting_confirmation", proofUrl, null, sib).catch(() => {});
      }
    }

    const [facility] = await db
      .select({ name: facilitiesTable.name })
      .from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId))
      .limit(1);

    // Generate single review token so admin gets ONE link (proof + approve/reject in one page)
    const APP_URL = await getBaseUrl();
    const reviewToken = await createWaToken(Number(bookingId), "review_payment", 7);
    notifyPaymentProofUploaded({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      reviewUrl: `${APP_URL}/ulasan/${reviewToken}`,
    });
    syncStatusToBizportal(booking.orderNumber, "waiting_confirmation", proofUrl, null, booking).catch(() => {});

    // Rekap otomatis jika booking hari ini
    triggerRekapIfToday(booking.bookingDate);

    const auditAction =
      paymentType === "dp" ? "DP_PAYMENT_CREATED" : "FINAL_PAYMENT_CREATED";
    const clientInfo = getClientInfo(req);
    await logAudit({
      action: auditAction,
      entity: "payment",
      entityId: payment.id,
      after: { bookingId: Number(bookingId), paymentType, amount },
      ...clientInfo,
    });

    res.status(201).json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Create payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/payments/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { status, paymentMethod, paymentProvider: rawPaymentProvider, notes } = req.body;
    const [before] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: "Not found" }); return; }
    // A repeated confirmation callback must be a no-op. Besides avoiding
    // duplicate notifications, this prevents a second accounting post for the
    // same payment when an admin or provider retries the request.
    if (status === "confirmed" && before.status === "confirmed") {
      const [bookingForRepair] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, before.bookingId))
        .limit(1);
      const repairableBookingStatuses = ["pending_payment", "waiting_confirmation", "paid"];

      // A previous WhatsApp/provider confirmation can succeed on the payment
      // row and fail before the booking row is updated. Keep confirmation
      // idempotent, but repair that narrowly-defined split state when an admin
      // retries the confirmation from the dashboard.
      if (bookingForRepair && repairableBookingStatuses.includes(bookingForRepair.status)) {
        const repairedPaidAt = before.paidAt ?? before.confirmedAt ?? new Date();
        await db
          .update(bookingsTable)
          .set({ status: "confirmed", paidAt: repairedPaidAt, updatedAt: new Date() })
          .where(eq(bookingsTable.id, before.bookingId));
        await db.insert(bookingHistoryTable).values({
          bookingId: before.bookingId,
          fromStatus: bookingForRepair.status,
          toStatus: "confirmed",
          changedByName: getUserFromReq(req).userName || "admin",
          note: "Status booking disinkronkan dengan pembayaran yang sudah dikonfirmasi",
        });
        await logAudit({
          ...getUserFromReq(req),
          action: "RECONCILE_CONFIRMED_PAYMENT_BOOKING",
          entity: "payment",
          entityId: before.id,
          before: { bookingStatus: bookingForRepair.status, paymentStatus: before.status },
          after: { bookingStatus: "confirmed", paymentStatus: before.status },
          ...getClientInfo(req),
        });
      }
      res.json({ ...before, amount: Number(before.amount) });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (status === "confirmed") {
      const canonicalPaidAt = before.paidAt ?? new Date();
      updateData.confirmedAt = before.confirmedAt ?? canonicalPaidAt;
      updateData.paidAt = canonicalPaidAt;
    }
    if (paymentMethod !== undefined) {
      if (typeof paymentMethod !== "string" || !paymentMethod.trim()) {
        res.status(400).json({ error: "Metode pembayaran wajib diisi" });
        return;
      }
      if (paymentMethod.trim().length > 120) {
        res.status(400).json({ error: "Metode pembayaran terlalu panjang" });
        return;
      }
      updateData.paymentMethod = paymentMethod.trim();
      if (paymentMethod.trim().toUpperCase() === "QRIS") {
        const provider = normalizePaymentProvider(rawPaymentProvider ?? before.paymentProvider);
        if (provider !== "mandiri_direct") {
          res.status(400).json({
            error: "Pembayaran QRIS wajib memiliki paymentProvider mandiri_direct.",
          });
          return;
        }
        updateData.paymentProvider = provider;
      }
    }
    if (rawPaymentProvider !== undefined) {
      const normalizedProvider = normalizePaymentProvider(rawPaymentProvider);
      const effectiveMethod = paymentMethod !== undefined ? paymentMethod.trim() : before.paymentMethod;
      if (effectiveMethod?.toUpperCase() === "QRIS" && !normalizedProvider) {
        res.status(400).json({ error: "Provider QRIS tidak valid atau belum diisi." });
        return;
      }
      if (effectiveMethod?.toUpperCase() !== "QRIS" && rawPaymentProvider) {
        res.status(400).json({ error: "Provider hanya boleh diisi untuk pembayaran QRIS." });
        return;
      }
      updateData.paymentProvider = effectiveMethod?.toUpperCase() === "QRIS" ? normalizedProvider : null;
    }
    if (notes !== undefined) updateData.notes = notes;
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "Tidak ada perubahan pembayaran" });
      return;
    }
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, before.bookingId)).limit(1);

    // Prepare all required accounting dimensions before claiming the payment.
    // If QRIS settlement configuration is incomplete, the request must fail
    // while the payment is still pending instead of returning 500 after the
    // status has already changed to confirmed.
    let preparedPayment: typeof before = before;
    if (status === "confirmed" && booking) {
      // Historical/manual QRIS rows may have been created before the provider
      // metadata was made mandatory. QRIS in this app settles through Mandiri
      // Direct, so do not send "unknown" into the enrichment resolver when an
      // old row is confirmed from the admin screen.
      const effectiveMethod = String(
        paymentMethod ?? before.paymentMethod ?? "",
      ).trim().toUpperCase();
      const storedProvider = String(
        rawPaymentProvider ?? before.paymentProvider ?? "",
      ).trim().toLowerCase();
      const effectiveProvider =
        effectiveMethod === "QRIS" &&
        (!storedProvider || storedProvider === "unknown")
          ? "mandiri_direct"
          : storedProvider || "unknown";
      const paymentCandidate = {
        ...before,
        ...updateData,
        ...(effectiveMethod === "QRIS"
          ? { paymentMethod: "QRIS", paymentProvider: effectiveProvider }
          : {}),
      } as typeof before;
      preparedPayment = await ensurePaymentBankAccount(
        paymentCandidate,
        booking,
        effectiveProvider,
        paymentCandidate.paidAt ?? paymentCandidate.confirmedAt ?? new Date(),
      );
      if (paymentCandidate.paymentMethod?.toUpperCase() === "QRIS") {
        const enrichment = await resolveRequiredPaymentEnrichment(
          booking,
          effectiveProvider,
          preparedPayment.paidAt ?? preparedPayment.confirmedAt ?? new Date(),
          {
            // Preserve the existing payment snapshot as resolver context during
            // confirmation/replay. Resolver results are still applied with
            // COALESCE below, so a missing source can never erase dimensions.
            explicitCompanyId: preparedPayment.companyId,
            effectiveDate: preparedPayment.paidAt
              ? paymentEffectiveDate(preparedPayment.paidAt)
              : preparedPayment.confirmedAt
                ? paymentEffectiveDate(preparedPayment.confirmedAt)
                : null,
          },
        );
        const [enrichedPayment] = await db
          .update(paymentsTable)
          .set({
            companyId: enrichment.companyId ?? preparedPayment.companyId,
            bankAccountId: enrichment.bankAccountId ?? preparedPayment.bankAccountId,
            expectedSettlementDate: enrichment.expectedSettlementDate ?? preparedPayment.expectedSettlementDate,
            paidAt: preparedPayment.paidAt ?? preparedPayment.confirmedAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paymentsTable.id, preparedPayment.id))
          .returning();
        if (enrichedPayment) preparedPayment = enrichedPayment;
      }
    }

    let payment: typeof before | undefined;
    if (status === "confirmed") {
      // Claim the pending payment in the database. Two concurrent callbacks
      // can both read "pending", but only one can transition it and continue
      // to accounting.
      [payment] = await db
        .update(paymentsTable)
        .set(updateData)
        .where(and(eq(paymentsTable.id, id), inArray(paymentsTable.status, ["pending", "waiting_confirmation"] as any[])))
        .returning();

      if (!payment) {
        const [current] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
        if (!current) { res.status(404).json({ error: "Not found" }); return; }
        if (current.status === "confirmed") {
          res.json({ ...current, amount: Number(current.amount) });
          return;
        }
        res.status(409).json({ error: "Pembayaran tidak lagi menunggu konfirmasi" });
        return;
      }
    } else {
      await db.update(paymentsTable).set(updateData).where(eq(paymentsTable.id, id));
      [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
      if (!payment) { res.status(404).json({ error: "Not found" }); return; }
    }

    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);

    // Helper: propagasi status ke semua sibling dalam grup
    const propagateGroupStatus = async (
      targetStatus: string,
      note: string,
      proofUrl?: string | null,
      paidAt?: Date | null,
      extraFields?: Record<string, unknown>,
    ) => {
      if (!booking?.groupRef) return;
      const siblings = await db.select().from(bookingsTable).where(
        and(eq(bookingsTable.groupRef, booking.groupRef), ne(bookingsTable.id, payment.bookingId))
      );
      for (const sib of siblings) {
        const sibPrev = sib.status;
        await db.update(bookingsTable)
          .set({ status: targetStatus as any, updatedAt: new Date(), ...(extraFields ?? {}) })
          .where(eq(bookingsTable.id, sib.id));
        await db.insert(bookingHistoryTable).values({
          bookingId: sib.id,
          fromStatus: sibPrev,
          toStatus: targetStatus,
          changedByName: userInfo.userName || "admin",
          note: `${note} (grup ${booking.groupRef})`,
        });
        // Update juga sibling payment records ke status yang sama
        await db.update(paymentsTable)
         .set({
           status: status as any,
           ...(status === "confirmed"
             ? { confirmedAt: payment.paidAt ?? payment.confirmedAt ?? new Date(), paidAt: payment.paidAt ?? payment.confirmedAt ?? new Date() }
             : {}),
         })
          .where(and(eq(paymentsTable.bookingId, sib.id), eq(paymentsTable.status, "pending")));
        // Sync sibling ke BizPortal dengan total_price = 0:
        // Nilai finansial sudah tercatat di booking utama (primary) sehingga
        // sibling tidak boleh menambah nominal di BizPortal (mencegah double counting).
        syncStatusToBizportal(sib.orderNumber, targetStatus, proofUrl, paidAt, {
          ...sib,
          totalPrice: "0",
          grandTotal: null,
          dpp: null,
          ppnAmount: null,
        } as any).catch(() => {});
      }
    };

    if (status === "confirmed") {
      const isDP = payment.paymentType === "dp";

      if (isDP) {
        // DP dikonfirmasi — set isDpPaid=true, booking kembali ke pending_payment untuk upload pelunasan
        const prevStatus = booking?.status ?? "waiting_confirmation";
        await db.update(bookingsTable)
          .set({ status: "pending_payment", isDpPaid: true, updatedAt: new Date() })
          .where(eq(bookingsTable.id, payment.bookingId));

        if (booking) {
          await db.insert(bookingHistoryTable).values({
            bookingId: payment.bookingId,
            fromStatus: prevStatus,
            toStatus: "pending_payment",
            changedByName: userInfo.userName || "admin",
            note: "DP dikonfirmasi oleh admin, menunggu pelunasan",
          });
          // Sync status ke BizPortal — booking sudah DP, menunggu pelunasan
          syncStatusToBizportal(booking.orderNumber, "pending_payment", payment.proofUrl).catch(() => {});

          await propagateGroupStatus("pending_payment", "DP dikonfirmasi oleh admin, menunggu pelunasan", null, null, { isDpPaid: true });
        }

        await logAudit({
          ...userInfo,
          action: "DP_PAYMENT_APPROVED",
          entity: "payment",
          entityId: id,
          before: { status: before.status },
          after: { status, paymentType: payment.paymentType },
          ...clientInfo,
        });
      } else {
        // Pelunasan / full_payment dikonfirmasi → booking confirmed
        const prevStatus = booking?.status ?? "waiting_confirmation";
        await db.update(bookingsTable)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(eq(bookingsTable.id, payment.bookingId));

        if (booking) {
          await db.insert(bookingHistoryTable).values({
            bookingId: payment.bookingId,
            fromStatus: prevStatus,
            toStatus: "confirmed",
            changedByName: userInfo.userName || "admin",
            note:
              payment.paymentType === "pelunasan"
                ? "Pelunasan dikonfirmasi oleh admin"
                : "Pembayaran dikonfirmasi oleh admin",
          });

          // Propagasi confirmed ke semua sibling dalam grup
          await propagateGroupStatus(
            "confirmed",
            payment.paymentType === "pelunasan"
              ? "Pelunasan dikonfirmasi oleh admin"
              : "Pembayaran dikonfirmasi oleh admin",
            payment.proofUrl,
            new Date(),
          );

          const [facility] = await db
            .select({ name: facilitiesTable.name })
            .from(facilitiesTable)
            .where(eq(facilitiesTable.id, booking.facilityId))
            .limit(1);

          logger.info({ orderNumber: booking.orderNumber, phone: booking.customerPhone }, "[WA] Mengirim notif konfirmasi pembayaran ke customer");
          notifyPaymentConfirmed({
            customerName: booking.customerName,
            customerPhone: booking.customerPhone,
            orderNumber: booking.orderNumber,
            facilityName: facility?.name ?? "",
            bookingDate: booking.bookingDate,
            startTime: booking.startTime,
            endTime: booking.endTime,
            totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
            bookingId: booking.id,
            groupRef: booking.groupRef,
          }).catch((err) => logger.error({ err, orderNumber: booking.orderNumber, phone: booking.customerPhone }, "[WA] notifyPaymentConfirmed error"));

          // Kirim invoice PDF ke customer via email & WA (fire-and-forget)
          // Jika booking bagian dari grup, kirim invoice gabungan
          const invoiceAudit = { userId: userInfo.userId, userName: userInfo.userName ?? "admin", ...clientInfo };
          if (booking.groupRef) {
            sendGroupInvoiceToCustomer(booking.groupRef, invoiceAudit)
              .catch((err) => logger.error({ err, groupRef: booking.groupRef }, "[InvoiceDelivery] Gagal kirim invoice grup setelah payment confirmed"));
          } else {
            sendInvoiceToCustomer(booking.orderNumber, invoiceAudit)
              .catch((err) => logger.error({ err, orderNumber: booking.orderNumber }, "[InvoiceDelivery] Gagal kirim invoice PDF setelah payment confirmed"));
          }
          const today = new Date().toISOString().split("T")[0];
          const paymentMethodLabel = payment.paymentMethod ?? "Transfer Bank";

          // Hitung total finansial: untuk grup pakai sum semua sesi, bukan hanya sesi utama
          // Ini memastikan BizPortal, bank mutation, dan jurnal mencatat nilai yang benar
          let journalDpp: number;
          let journalPpn: number;
          let bookingForFinancial: typeof booking;

          if (booking.groupRef) {
            const allGroupBookings = await db
              .select({ totalPrice: bookingsTable.totalPrice, grandTotal: bookingsTable.grandTotal, dpp: bookingsTable.dpp, ppnAmount: bookingsTable.ppnAmount })
              .from(bookingsTable)
              .where(eq(bookingsTable.groupRef, booking.groupRef));
            journalDpp = 0;
            journalPpn = 0;
            for (const gb of allGroupBookings) {
              const extracted = extractBookingDpp(gb);
              journalDpp += extracted.dpp;
              journalPpn += extracted.ppnAmount;
            }
            // Override grandTotal & totalPrice → total grup, bukan per-sesi
            const groupGrandTotal = journalDpp + journalPpn;
            bookingForFinancial = { ...booking, grandTotal: String(groupGrandTotal), totalPrice: String(groupGrandTotal) } as any;
          } else {
            const extracted = extractBookingDpp(booking);
            journalDpp = extracted.dpp;
            journalPpn = extracted.ppnAmount;
            bookingForFinancial = booking;
          }

          // Sync ke BizPortal pakai total grup (bukan per-sesi) agar nominal tidak terbelah
          syncStatusToBizportal(booking.orderNumber, "confirmed", payment.proofUrl, new Date(), bookingForFinancial).catch(() => {});
          pushConfirmedPaymentAsBankMutation(bookingForFinancial, new Date()).catch(() => {});
          if (booking.groupRef) {
            // Group bookings still represent one payment event. Keep the
            // accounting identity at payment level; never create sc_group_*
            // entries that cannot be traced to the confirmed payment.
            postConfirmedPaymentAccounting({
              bookingId: booking.id,
              orderNumber: booking.orderNumber,
              dpp: journalDpp,
              ppnAmount: journalPpn,
                ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
              facilityId: booking.facilityId,
              journalDate: today,
              paymentMethod: paymentMethodLabel,
              paymentId: payment.id,
              paymentType: payment.paymentType,
              paymentProvider: payment.paymentProvider,
              bankAccountId: payment.bankAccountId,
              providerReference: payment.providerReference,
              providerOrderId: payment.providerOrderId,
              merchantTradeNo: payment.merchantTradeNo,
              providerTradeNo: payment.providerTradeNo,
            }).catch((err) =>
              logAccountingError({ operation: "postConfirmedPaymentAccounting", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
            );
          } else {
            postConfirmedPaymentAccounting({
              bookingId: booking.id,
              orderNumber: booking.orderNumber,
              dpp: journalDpp,
              ppnAmount: journalPpn,
                ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
              facilityId: booking.facilityId,
              journalDate: today,
              paymentMethod: paymentMethodLabel,
              paymentId: payment.id,
              paymentType: payment.paymentType,
              paymentProvider: payment.paymentProvider,
              bankAccountId: payment.bankAccountId,
              providerReference: payment.providerReference,
              providerOrderId: payment.providerOrderId,
              merchantTradeNo: payment.merchantTradeNo,
              providerTradeNo: payment.providerTradeNo,
            }).catch((err) =>
              logAccountingError({ operation: "postConfirmedPaymentAccounting", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
            );
          }

        }

        await logAudit({
          ...userInfo,
          action: "FINAL_PAYMENT_APPROVED",
          entity: "payment",
          entityId: id,
          before: { status: before.status },
          after: { status, paymentType: payment.paymentType },
          ...clientInfo,
        });
      }
    } else if (status === "rejected") {
      // Tolak DP atau pelunasan — booking kembali ke pending_payment
      const prevStatus = booking?.status ?? "waiting_confirmation";
      await db.update(bookingsTable)
        .set({ status: "pending_payment", updatedAt: new Date() })
        .where(eq(bookingsTable.id, payment.bookingId));

      if (booking) {
        await db.insert(bookingHistoryTable).values({
          bookingId: payment.bookingId,
          fromStatus: prevStatus,
          toStatus: "pending_payment",
          changedByName: userInfo.userName || "admin",
          note: `Pembayaran ditolak: ${notes ?? ""}`,
        });
        // Propagasi rejected ke semua sibling dalam grup
        await propagateGroupStatus("pending_payment", `Pembayaran ditolak: ${notes ?? ""}`, null, null);
        syncStatusToBizportal(booking.orderNumber, "pending_payment", null, null, booking).catch(() => {});
      }

      const auditAction =
        payment.paymentType === "dp" ? "DP_PAYMENT_REJECTED" : "FINAL_PAYMENT_REJECTED";
      await logAudit({
        ...userInfo,
        action: auditAction,
        entity: "payment",
        entityId: id,
        before: { status: before.status },
        after: { status, notes },
        ...clientInfo,
      });
    } else {
      await logAudit({
        ...userInfo,
        action: "update_payment",
        entity: "payment",
        entityId: id,
        before: { status: before?.status, paymentMethod: before?.paymentMethod },
        after: { status, paymentMethod: payment.paymentMethod },
        ...clientInfo,
      });
    }

    // Rekap otomatis hanya jika status BENAR-BENAR berubah & booking hari ini
    if (booking && (status === "confirmed" || status === "rejected") && before.status !== status) {
      triggerRekapIfToday(booking.bookingDate);
    }

    res.json({ ...payment, amount: Number(payment.amount) });
  } catch (err: any) {
    req.log.error({ err }, "Update payment error");
    const message = String(err instanceof Error ? err.message : err ?? "");
    const safeError =
      message === "RECEIVING_BANK_ACCOUNT_NOT_CONFIGURED"
        ? "Rekening penerima pembayaran belum dikonfigurasi."
        : message.startsWith("PAYMENT_BANK_ACCOUNT_REQUIRED:")
          ? "Rekening penerima pembayaran belum tersedia untuk payment ini."
          : message.startsWith("PAYMENT_PROVIDER")
            ? "Metadata provider pembayaran belum lengkap."
            : "Internal server error";
    res.status(safeError === "Internal server error" ? 500 : 422).json({
      error: safeError,
    });
    const msg: string = err?.message ?? "";
    if (msg === "RECEIVING_BANK_ACCOUNT_NOT_CONFIGURED") {
      res.status(422).json({ error: "Rekening penerima belum dikonfigurasi. Buka Pengaturan → Rekening Bank dan isi rekening penerima default." });
      return;
    }
    if (msg.startsWith("PAYMENT_BANK_ACCOUNT_REQUIRED")) {
      res.status(422).json({ error: "Tidak dapat menentukan rekening penerima untuk pembayaran ini. Pastikan konfigurasi settlement sudah lengkap." });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /payments/:id/proof — admin: hapus bukti transfer, kembalikan status booking ke pending_payment
router.delete("/payments/:id/proof", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
    if (!payment) { res.status(404).json({ error: "Not found" }); return; }

    // Hanya boleh hapus bukti jika payment masih pending
    if (payment.status !== "pending") {
      res.status(400).json({ error: "Bukti transfer hanya bisa dihapus jika pembayaran masih pending" });
      return;
    }

    await db.update(paymentsTable).set({
      proofUrl: null,
      ocrName: null,
      ocrAmount: null,
      ocrDate: null,
      ocrRaw: null,
      ocrData: null,
    }).where(eq(paymentsTable.id, id));

    // Kembalikan status booking ke pending_payment jika masih waiting_confirmation
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, payment.bookingId)).limit(1);

    if (booking && booking.status === "waiting_confirmation") {
      await db.update(bookingsTable)
        .set({ status: "pending_payment" })
        .where(eq(bookingsTable.id, booking.id));

      // Propagasi ke sibling jika booking grup
      if (booking.groupRef) {
        const siblings = await db.select().from(bookingsTable).where(
          and(eq(bookingsTable.groupRef, booking.groupRef), ne(bookingsTable.id, booking.id))
        );
        for (const sib of siblings) {
          // Hapus payment record pending sibling yang dibuat saat upload grup
          await db.delete(paymentsTable)
            .where(and(eq(paymentsTable.bookingId, sib.id), eq(paymentsTable.status, "pending")));
          if (sib.status === "waiting_confirmation") {
            await db.update(bookingsTable)
              .set({ status: "pending_payment" })
              .where(eq(bookingsTable.id, sib.id));
          }
        }
      }
    }

    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);
    await logAudit({
      ...userInfo,
      action: "delete_payment_proof",
      entity: "payment",
      entityId: id,
      before: { proofUrl: payment.proofUrl },
      after: { proofUrl: null },
      ...clientInfo,
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete payment proof error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /payments/backfill-group-accounting
// Backfill BizPortal entries untuk semua grup booking lama yang sudah confirmed/completed
// tapi belum punya group entry (correlation_id = sc_group_<groupRef>).
// Idempotent — aman dijalankan berulang kali.
router.post("/payments/backfill-group-accounting", adminMiddleware, async (req, res) => {
  try {
    // 1. Ambil semua groupRef unik yang punya booking confirmed/completed
    const groupRows = await db
      .selectDistinct({ groupRef: bookingsTable.groupRef })
      .from(bookingsTable)
      .where(
        and(
          ne(bookingsTable.groupRef, ""),
        )
      );

    const groupRefs = groupRows
      .map(r => r.groupRef)
      .filter((g): g is string => !!g);

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const groupRef of groupRefs) {
      try {
        // Ambil semua booking dalam grup ini
        const bookingsInGroup = await db
          .select({
            id: bookingsTable.id,
            orderNumber: bookingsTable.orderNumber,
            totalPrice: bookingsTable.totalPrice,
            ppnAmount: bookingsTable.ppnAmount,
            grandTotal: bookingsTable.grandTotal,
            facilityId: bookingsTable.facilityId,
            status: bookingsTable.status,
            updatedAt: bookingsTable.updatedAt,
          })
          .from(bookingsTable)
          .where(eq(bookingsTable.groupRef, groupRef));

        // Hanya proses grup yang minimal ada 1 booking confirmed/completed
        const hasConfirmed = bookingsInGroup.some(
          b => b.status === "confirmed" || b.status === "completed"
        );
        if (!hasConfirmed) { skipped++; continue; }

        // Pakai tanggal updatedAt booking pertama yang confirmed sebagai journal date
        const confirmedBooking = bookingsInGroup.find(
          b => b.status === "confirmed" || b.status === "completed"
        );
        const journalDate = confirmedBooking?.updatedAt
          ? new Date(confirmedBooking.updatedAt).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);

        const groupEntries = bookingsInGroup.map(b => {
          const extracted = extractBookingDpp(b);
          return {
          id: b.id,
          orderNumber: b.orderNumber,
          subtotal: extracted.dpp,
          ppnAmount: extracted.ppnAmount,
          facilityId: b.facilityId,
          };
        });

        await createPublicAccountingEntryForGroup(groupRef, groupEntries, journalDate);
        processed++;
      } catch (err: any) {
        failed++;
        errors.push(`${groupRef}: ${err?.message ?? "unknown error"}`);
        logger.error({ err, groupRef }, "[backfill-group-accounting] Gagal proses grup");
      }
    }

    res.json({
      ok: true,
      totalGroups: groupRefs.length,
      processed,
      skipped,
      failed,
      errors: errors.slice(0, 10),
    });
  } catch (err: any) {
    req.log.error({ err }, "Backfill group accounting error");
    res.status(500).json({ error: err?.message ?? "Gagal backfill group accounting" });
  }
});

export default router;
