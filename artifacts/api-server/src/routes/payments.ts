import { Router } from "express";
import {
  db,
  paymentsTable,
  bookingsTable,
  bookingHistoryTable,
  facilitiesTable,
  bookingGroupsTable,
  bankMutationsTable,
} from "@workspace/db";
import { eq, and, ne, inArray, or, sql } from "drizzle-orm";
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
  extractBookingDpp,
  postConfirmedPaymentAccounting,
} from "../lib/accounting";

import { createWaToken } from "../lib/waTokens";
import { logger } from "../lib/logger";
import { getBaseUrl } from "../lib/appUrl";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { sendInvoiceToCustomer, sendGroupInvoiceToCustomer } from "../lib/invoiceDelivery";
import { normalizePaymentProvider, resolveManualPaymentPaidAt } from "../lib/paymentProvider";
import { createPaymentProviderId, createPaymentProviderOrderId, normalizeProviderName } from "../lib/paymentMetadata";
import { validatePaymentMetadataUpdate } from "../lib/paymentMetadataUpdate";
import {
  ensurePaymentBankAccount,
  resolveRequiredPaymentEnrichment,
  paymentEffectiveDate,
  type SettlementProvider,
} from "../lib/paymentEnrichment";
import { assertPaymentMirrorMigrationReady } from "../lib/paymentMirrorMigration";
import {
  createProofOcrToken,
  paymentMethodMatchesOcr,
  scanPaymentProof,
  storedPaymentProofOcr,
  verifyProofOcrToken,
} from "../lib/paymentProofOcr";
import { readPaymentProofOcr } from "../lib/paymentOcr";

async function postPaymentAccountingProjection(payment: any, booking: any): Promise<void> {
  let dpp = extractBookingDpp(booking).dpp;
  let ppnAmount = extractBookingDpp(booking).ppnAmount;

  if (booking.groupRef) {
    const groupBookings = await db
      .select({
        dpp: bookingsTable.dpp,
        totalPrice: bookingsTable.totalPrice,
        grandTotal: bookingsTable.grandTotal,
        ppnAmount: bookingsTable.ppnAmount,
      })
      .from(bookingsTable)
      .where(eq(bookingsTable.groupRef, booking.groupRef));
    dpp = 0;
    ppnAmount = 0;
    for (const groupBooking of groupBookings) {
      const extracted = extractBookingDpp(groupBooking);
      dpp += extracted.dpp;
      ppnAmount += extracted.ppnAmount;
    }
  }

  const paidAt = payment.paidAt ?? payment.confirmedAt ?? new Date();
  await postConfirmedPaymentAccounting({
    bookingId: booking.id,
    orderNumber: booking.orderNumber,
    dpp,
    ppnAmount,
    ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
    facilityId: booking.facilityId,
    journalDate: paidAt.toISOString().slice(0, 10),
    paymentMethod: payment.paymentMethod ?? undefined,
    paymentId: payment.id,
    paymentType: payment.paymentType,
    paymentProvider: payment.paymentProvider,
    bankAccountId: payment.bankAccountId,
    providerReference: payment.providerReference,
    providerOrderId: payment.providerOrderId,
    merchantTradeNo: payment.merchantTradeNo,
    providerTradeNo: payment.providerTradeNo,
  });
}
import { isBookingConfirmableStatus } from "../lib/bookingLifecycle";
import { insertGroupPaymentAllocations } from "../lib/paymentAllocations";

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
    const ocrScan = await scanPaymentProof(req.file.buffer, req.file.mimetype);
    res.json({
      objectPath: url,
      url,
      ocrScan: {
        paymentMethod: ocrScan.paymentMethod,
        confidence: ocrScan.confidence,
        signals: ocrScan.signals,
        amount: ocrScan.amount,
        date: ocrScan.date,
        engine: ocrScan.engine,
      },
      ocrScanToken: createProofOcrToken(url, ocrScan),
    });
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

    const proofOcr = verifyProofOcrToken(req.body.ocrScanToken, String(proofUrl ?? ""));
    const ocrMethodMatch = paymentMethodMatchesOcr(paymentMethod, proofOcr);
    if (ocrMethodMatch === false) {
      res.status(422).json({
        error: `Metode pembayaran tidak sesuai dengan bukti. OCR mendeteksi ${proofOcr?.paymentMethod}.`,
        code: "PAYMENT_METHOD_PROOF_MISMATCH",
        ocrScan: {
          paymentMethod: proofOcr?.paymentMethod,
          confidence: proofOcr?.confidence,
          signals: proofOcr?.signals,
        },
      });
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
          totalPrice: bookingsTable.totalPrice,
          grandTotal: bookingsTable.grandTotal,
        }).from(bookingsTable).where(eq(bookingsTable.groupRef, booking.groupRef))
      : [{
          id: booking.id,
          downPayment: booking.downPayment,
          isDpPaid: booking.isDpPaid,
          totalPrice: booking.totalPrice,
          grandTotal: booking.grandTotal,
        }];
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
    const hasPendingDp = groupPayments.some(
      (p) => p.paymentType === "dp" && (p.status === "pending" || p.status === "confirmed"),
    );
    const hasConfirmedDp = groupPayments.some(
      (p) => p.paymentType === "dp" && p.status === "confirmed",
    );
    const dpAlreadyConfirmed = hasConfirmedDp || groupBookings.some((b) => b.isDpPaid);

    // A second proof is only for pelunasan after the first DP proof has been
    // confirmed. Do not let an expired booking or a stale client turn a
    // pending DP into a pelunasan.
    if (
      configuredDp &&
      hasPendingDp &&
      !dpAlreadyConfirmed
    ) {
      res.status(409).json({
        error: "Bukti DP masih menunggu konfirmasi admin. Upload pelunasan tersedia setelah DP dikonfirmasi.",
      });
      return;
    }

    const paymentType = configuredDp
      ? dpAlreadyConfirmed ? "pelunasan" : "dp"
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

    // Every manual payment needs one canonical effective timestamp, including
    // bank transfers. Besides preserving when the proof was submitted, this
    // lets company ownership and settlement rules resolve against the same
    // effective date instead of leaving transfer payments without company
    // metadata.
    const manualPaidAt = resolveManualPaymentPaidAt(
      req.body as Record<string, unknown>,
    );
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
        ocrName: proofOcr?.name ?? null,
        ocrAmount: proofOcr?.amount == null ? null : String(proofOcr.amount),
        ocrDate: proofOcr?.date ?? null,
        ocrRaw: proofOcr?.rawText ?? null,
        ocrData: proofOcr ? {
          paymentMethod: proofOcr.paymentMethod,
          confidence: proofOcr.confidence,
          signals: proofOcr.signals,
          engine: proofOcr.engine,
          scannedAt: proofOcr.scannedAt,
          methodMatch: ocrMethodMatch,
        } : null,
        paymentType: paymentType as "dp" | "pelunasan" | "full_payment",
      })
      .returning();

    if (booking.groupRef) {
      // One transfer/invoice means one financial payment. Session-level
      // amounts are stored separately as display-only allocations.
      await insertGroupPaymentAllocations(payment.id, groupBookings, amountNum);
    }

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

    // Grup repeat booking: propagate only booking lifecycle state. Do not copy
    // the payment row to siblings: that would create duplicate mirrors,
    // journals, tax ledgers, and bank-reconciliation candidates.
    if (booking.groupRef) {
      const siblings = await db.select().from(bookingsTable).where(
        and(
          eq(bookingsTable.groupRef, booking.groupRef),
          ne(bookingsTable.id, Number(bookingId)),
        )
      );
      for (const sib of siblings) {
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

    // OCR dijalankan setelah payment tersimpan agar upload bukti tetap
    // responsif. Auto-detection hanya mengubah metode bila confidence tinggi;
    // kegagalan OCR tidak menggagalkan pembuatan payment.
    if (proofUrl) {
      readPaymentProofOcr(proofUrl)
        .then(async (ocrResult) => {
          const detection = ocrResult.paymentMethodDetection;
          const [currentPayment] = await db.select().from(paymentsTable)
            .where(eq(paymentsTable.id, payment.id)).limit(1);
          if (!currentPayment) return;

          const shouldUpdateMethod =
            detection.highConfidence &&
            Boolean(detection.paymentMethod) &&
            detection.paymentMethod !== currentPayment.paymentMethod;
          const nextMethod = shouldUpdateMethod
            ? detection.paymentMethod
            : currentPayment.paymentMethod;
          await db.update(paymentsTable).set({
            ocrName: ocrResult.ocrName,
            ocrAmount: ocrResult.ocrAmount == null ? null : String(ocrResult.ocrAmount),
            ocrDate: ocrResult.ocrDate,
            ocrRaw: ocrResult.ocrRaw,
            ocrData: {
              paymentMethodDetection: {
                ...detection,
                detectedAt: new Date().toISOString(),
                source: "ocr",
              },
            },
            ...(shouldUpdateMethod ? { paymentMethod: nextMethod } : {}),
            ...(shouldUpdateMethod && nextMethod === "QRIS" && currentPayment.paymentProvider === "unknown"
              ? { paymentProvider: "mandiri_direct" as const }
              : {}),
            updatedAt: new Date(),
          }).where(eq(paymentsTable.id, payment.id));

          if (shouldUpdateMethod) {
            await logAudit({
              action: "payment_method_auto_detected_ocr",
              entity: "payment",
              entityId: payment.id,
              before: { paymentMethod: currentPayment.paymentMethod, paymentStatus: currentPayment.status },
              after: {
                paymentMethod: nextMethod,
                confidence: detection.confidence,
                signals: detection.signals,
                matchedTerms: detection.matchedTerms,
                source: "ocr",
              },
            });
          }
        })
        .catch((error) => logger.warn({ error, paymentId: payment.id }, "Payment proof OCR failed"));
    }

    res.status(201).json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Create payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Repair a historical Gym payment after QRIS evidence has been verified.
 *
 * This endpoint is intentionally separate from the generic metadata editor:
 * it can enrich provider/company dimensions and replay accounting, but only
 * when the stored/current OCR evidence is high-confidence QRIS.
 */
router.post("/payments/:id/repair-qris", adminMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "ID pembayaran tidak valid" });
      return;
    }

    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, id))
      .limit(1);
    if (!payment) {
      res.status(404).json({ error: "Pembayaran tidak ditemukan" });
      return;
    }
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, payment.bookingId))
      .limit(1);
    if (!booking) {
      res.status(409).json({ error: "Booking pembayaran tidak ditemukan" });
      return;
    }

    const storedOcr = storedPaymentProofOcr(payment);
    let ocrResult: Awaited<ReturnType<typeof readPaymentProofOcr>> | null = null;
    if (
      payment.proofUrl &&
      (!storedOcr || storedOcr.paymentMethod !== "QRIS" || storedOcr.confidence < 0.85)
    ) {
      try {
        ocrResult = await readPaymentProofOcr(payment.proofUrl);
      } catch (error) {
        req.log.warn({ err: error, paymentId: id }, "QRIS repair OCR gagal");
      }
    }

    const detection = ocrResult?.paymentMethodDetection;
    const hasQrisEvidence =
      payment.paymentMethod?.trim().toUpperCase() === "QRIS" ||
      storedOcr?.paymentMethod === "QRIS" && storedOcr.confidence >= 0.85 ||
      detection?.paymentMethod === "QRIS" && detection.highConfidence;
    if (!hasQrisEvidence) {
      res.status(422).json({
        error: "Bukti QRIS belum terdeteksi dengan confidence tinggi. Payment tetap tidak diubah.",
        candidate: true,
        ocr: detection ?? storedOcr ?? null,
      });
      return;
    }

    const paidAt = payment.paidAt ?? payment.confirmedAt ?? payment.createdAt;
    const enrichment = await resolveRequiredPaymentEnrichment(
      booking,
      "mandiri_direct",
      paidAt,
      {
        sourcePaymentCompanyId: payment.companyId,
        explicitCompanyId: payment.companyId,
        effectiveDate: paymentEffectiveDate(paidAt),
      },
    );
    const usableProviderId = payment.providerId &&
      !payment.providerId.toLowerCase().startsWith("legacy-") &&
      !payment.providerId.toLowerCase().startsWith("internal-unknown-")
      ? payment.providerId
      : null;
    const usableProviderOrderId = payment.providerOrderId &&
      !payment.providerOrderId.toLowerCase().startsWith("legacy-") &&
      !payment.providerOrderId.toLowerCase().startsWith("internal-order-unknown-")
      ? payment.providerOrderId
      : null;
    const providerId = createPaymentProviderId(
      "mandiri_direct",
      usableProviderId
        ? usableProviderId
        : payment.providerReference ?? payment.providerTradeNo ?? payment.merchantTradeNo,
    );
    const providerOrderId = createPaymentProviderOrderId(
      "mandiri_direct",
      usableProviderOrderId
        ? usableProviderOrderId
        : payment.merchantTradeNo ?? payment.providerTradeNo ?? payment.providerReference,
    );

    const mergedOcrData = {
      ...(payment.ocrData && typeof payment.ocrData === "object"
        ? payment.ocrData as Record<string, unknown>
        : {}),
      ...(ocrResult
        ? {
            paymentMethodDetection: {
              ...ocrResult.paymentMethodDetection,
              detectedAt: new Date().toISOString(),
              source: "repair_qris",
            },
          }
        : {}),
      qrisRepair: {
        evidence: "high_confidence_ocr_or_existing_qris_method",
        repairedAt: new Date().toISOString(),
      },
    };

    const [repaired] = await db
      .update(paymentsTable)
      .set({
        paymentMethod: "QRIS",
        paymentProvider: "mandiri_direct",
        providerName: normalizeProviderName("mandiri_direct"),
        providerId,
        providerOrderId,
        companyId: enrichment.companyId,
        bankAccountId: enrichment.bankAccountId,
        expectedSettlementDate: payment.expectedSettlementDate ?? enrichment.expectedSettlementDate,
        ocrName: ocrResult?.ocrName ?? payment.ocrName,
        ocrAmount: ocrResult?.ocrAmount == null
          ? payment.ocrAmount
          : String(ocrResult.ocrAmount),
        ocrDate: ocrResult?.ocrDate ?? payment.ocrDate,
        ocrRaw: ocrResult?.ocrRaw ?? payment.ocrRaw,
        ocrData: mergedOcrData,
        updatedAt: new Date(),
      })
      .where(eq(paymentsTable.id, id))
      .returning();
    if (!repaired) {
      res.status(409).json({ error: "Payment gagal diperbarui" });
      return;
    }

    let accounting: "posted" | "skipped" = "skipped";
    if (repaired.status === "confirmed") {
      await postPaymentAccountingProjection(repaired, booking);
      accounting = "posted";
    }

    await logAudit({
      ...getUserFromReq(req),
      action: "PAYMENT_QRIS_REPAIRED",
      entity: "payment",
      entityId: id,
      before: {
        paymentMethod: payment.paymentMethod,
        paymentProvider: payment.paymentProvider,
        providerName: payment.providerName,
        providerId: payment.providerId,
        companyId: payment.companyId,
      },
      after: {
        paymentMethod: repaired.paymentMethod,
        paymentProvider: repaired.paymentProvider,
        providerName: repaired.providerName,
        providerId: repaired.providerId,
        companyId: repaired.companyId,
        accounting,
      },
      ...getClientInfo(req),
    });

    res.json({
      ...repaired,
      amount: Number(repaired.amount),
      accounting,
      evidence: detection ?? storedOcr ?? { paymentMethod: "QRIS", source: "existing_payment_method" },
    });
  } catch (err: any) {
    req.log.error({ err }, "Repair QRIS payment error");
    const message = String(err?.message ?? err);
    if (message.includes("PAYMENT_COMPANY_ID_REQUIRED") || message.includes("RECEIVING_BANK_ACCOUNT_NOT_CONFIGURED")) {
      res.status(409).json({
        error: "Company atau rekening settlement belum dapat dibuktikan secara deterministik. Payment tetap menjadi kandidat review.",
        candidate: true,
      });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Metadata-only payment edit.
 *
 * Hanya metadata revisi yang boleh diubah oleh admin: metode/provider dan,
 * bila perlu, company_id/bank_account_id. Tidak ada konfirmasi,
 * rekonsiliasi, posting jurnal, atau sinkronisasi BizPortal. Mismatch settlement
 * menjadi warning selama mode revisi; field finansial dan lifecycle tetap
 * ditolak.
 *
 * Selama masa koreksi yang disetujui owner, transaksi endpoint ini memberi
 * trigger database izin lokal untuk menyelaraskan metadata pada mirror/jurnal
 * yang sudah posted. Izin itu hanya hidup selama transaksi, dan validasi di
 * bawah tetap melarang semua field finansial maupun lifecycle pembayaran.
 */
router.patch("/payments/:id/metadata", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "ID pembayaran tidak valid" });
      return;
    }
    const [before] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: "Not found" }); return; }

    const result = validatePaymentMetadataUpdate(req.body, {
      paymentMethod: before.paymentMethod,
      paymentProvider: before.paymentProvider,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { update } = result;

    const noChange =
      (update.paymentMethod === undefined ||
        update.paymentMethod === String(before.paymentMethod ?? "").trim()) &&
      (update.paymentProvider === undefined ||
        String(update.paymentProvider ?? "") === String(before.paymentProvider ?? "")) &&
      (update.companyId === undefined || update.companyId === before.companyId) &&
      (update.bankAccountId === undefined || String(update.bankAccountId ?? "") === String(before.bankAccountId ?? ""));

    if (noChange) {
      // Idempotent: mengulang nilai yang sama tidak boleh error dan tidak
      // boleh menyentuh apa pun.
      res.json({ ...before, amount: Number(before.amount) });
      return;
    }

    // QRIS tidak boleh meneruskan rekening legacy/manual yang mungkin tersisa
    // pada payment lama. Ambil rekening Mandiri CST dari settlement config yang
    // aktif, bukan dari request admin. Dengan begitu trigger canonical dapat
    // memvalidasi provider QRIS terhadap rekening yang benar tanpa membuka
    // endpoint metadata untuk perubahan rekening/settlement secara bebas.
    const revisionWarnings: string[] = [];
    const metadataPatch: Record<string, unknown> = {
      ...(update.paymentMethod !== undefined ? { paymentMethod: update.paymentMethod } : {}),
      ...(update.paymentProvider !== undefined ? { paymentProvider: update.paymentProvider } : {}),
      ...(update.providerName !== undefined ? { providerName: update.providerName } : {}),
      ...(update.companyId !== undefined ? { companyId: update.companyId } : {}),
      ...(update.bankAccountId !== undefined ? { bankAccountId: update.bankAccountId || "unknown" } : {}),
    };
    const effectiveMethod = String(update.paymentMethod ?? before.paymentMethod ?? "").trim().toUpperCase();
    let metadataBooking: any = null;
    if (effectiveMethod === "QRIS") {
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, before.bookingId))
        .limit(1);
      if (!booking) {
        res.status(409).json({
          error: "Booking untuk pembayaran ini tidak ditemukan. Perubahan dibatalkan.",
        });
        return;
      }
      metadataBooking = booking;

      const paymentDate = before.paidAt ?? before.confirmedAt ?? before.createdAt;
      const enrichment = await resolveRequiredPaymentEnrichment(
        booking,
        "mandiri_direct",
        paymentDate,
        {
          sourcePaymentCompanyId: update.companyId ?? before.companyId,
          explicitCompanyId: update.companyId ?? before.companyId,
          effectiveDate: paymentEffectiveDate(paymentDate),
        },
      );
      const usableProviderId = before.providerId &&
        !before.providerId.toLowerCase().startsWith("legacy-") &&
        !before.providerId.toLowerCase().startsWith("internal-unknown-")
        ? before.providerId
        : null;
      const usableProviderOrderId = before.providerOrderId &&
        !before.providerOrderId.toLowerCase().startsWith("legacy-") &&
        !before.providerOrderId.toLowerCase().startsWith("internal-order-unknown-")
        ? before.providerOrderId
        : null;
      const providerId = createPaymentProviderId(
        "mandiri_direct",
        usableProviderId
          ? usableProviderId
          : before.providerReference ?? before.providerTradeNo ?? before.merchantTradeNo,
      );
      const providerOrderId = createPaymentProviderOrderId(
        "mandiri_direct",
        usableProviderOrderId
          ? usableProviderOrderId
          : before.merchantTradeNo ?? before.providerTradeNo ?? before.providerReference,
      );
      Object.assign(metadataPatch, {
        paymentMethod: "QRIS",
        paymentProvider: "mandiri_direct",
        providerName: normalizeProviderName("mandiri_direct"),
        providerId,
        providerOrderId,
        companyId: update.companyId ?? before.companyId ?? enrichment.companyId,
        bankAccountId: enrichment.bankAccountId,
        expectedSettlementDate: before.expectedSettlementDate ?? enrichment.expectedSettlementDate,
      });
    }

    const payment = await db.transaction(async (tx) => {
      // TEMPORARY CORRECTION MODE: scope-nya hanya request admin ini dan
      // otomatis hilang saat transaksi selesai. Hapus set_config ini setelah
      // seluruh koreksi metadata selesai untuk mengaktifkan kembali conflict
      // guard pada payment posted.
      await tx.execute(sql`
        SELECT set_config(
          'sport_center.allow_posted_payment_metadata_correction',
          'on',
          true
        )
      `);
      // The internal posted-journal guard uses a separate, narrower GUC.
      // Enable it only for this metadata-only transaction so the journal
      // trigger can mirror method/provider changes without allowing any
      // financial, lifecycle, or journal-line mutation.
      await tx.execute(sql`
        SELECT set_config(
          'sport_center.allow_posted_accounting_metadata_correction',
          'on',
          true
        )
      `);

      const [updated] = await tx
        .update(paymentsTable)
        .set({ ...metadataPatch, updatedAt: new Date() } as any)
        .where(eq(paymentsTable.id, id))
        .returning();
      return updated;
    });
    if (!payment) { res.status(404).json({ error: "Not found" }); return; }

    await logAudit({
      ...getUserFromReq(req),
      action: "PAYMENT_METADATA_UPDATED",
      entity: "payment",
      entityId: payment.id,
      before: {
        paymentMethod: before.paymentMethod,
        paymentProvider: before.paymentProvider,
        providerName: before.providerName,
      },
      after: {
        paymentMethod: payment.paymentMethod,
        paymentProvider: payment.paymentProvider,
        providerName: payment.providerName,
      },
      ...getClientInfo(req),
    });

    let accounting: "posted" | "skipped" = "skipped";
    if (payment.status === "confirmed" && effectiveMethod === "QRIS" && metadataBooking) {
      await postPaymentAccountingProjection(payment, metadataBooking);
      accounting = "posted";
    }

    res.json({
      ...payment,
      amount: Number(payment.amount),
      accounting,
      warnings: revisionWarnings,
    });
  } catch (err: any) {
    const message = String(err?.message ?? "") + " " + String((err as any)?.cause?.message ?? "");
    if (message.includes("POSTED_ACCOUNTING_JOURNAL") || message.includes("PAYMENT_ACCOUNTING_JOURNAL_AMBIGUOUS")) {
      req.log.error({ err }, "Payment metadata update blocked by accounting guard");
      res.status(409).json({ error: "Jurnal akuntansi terkait tidak bisa disinkronkan. Hubungi finance." });
      return;
    }
    if (message.includes("CANONICAL_BANK_ACCOUNT_UNRESOLVED")) {
      req.log.warn({ err }, "Payment metadata update blocked by receiving-account mapping");
      res.status(409).json({
        error:
          "Rekening penerima pada pembayaran ini belum terdaftar sebagai rekening perusahaan aktif. Perubahan dibatalkan.",
      });
      return;
    }
    if (message.includes("CANONICAL_PROVIDER_RULE_UNRESOLVED")) {
      // Payment sudah confirmed dan terikat kontrak settlement owner-approved.
      // Tidak ada aturan settlement untuk kombinasi metode/provider baru,
      // jadi edit ditolak (fail closed) tanpa menyentuh settlement lama.
      req.log.warn({ err }, "Payment metadata update blocked by settlement contract");
      res.status(409).json({
        error:
          "Metode/provider ini tidak punya aturan settlement yang disetujui untuk pembayaran yang sudah dikonfirmasi. Perubahan dibatalkan.",
      });
      return;
    }
    if (message.includes("CANONICAL_")) {
      req.log.warn({ err }, "Payment metadata update blocked by canonical payment configuration");
      res.status(409).json({
        error:
          "Konfigurasi penerima atau settlement untuk pembayaran yang sudah dikonfirmasi belum lengkap. Perubahan dibatalkan.",
      });
      return;
    }
    req.log.error({ err }, "Update payment metadata error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/payments/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    let { status, paymentMethod, paymentProvider: rawPaymentProvider, notes } = req.body;
    // Edit metadata tanpa perubahan status harus lewat endpoint khusus
    // PATCH /payments/:id/metadata yang metadata-only dan tervalidasi ketat.
    // Route lebar ini hanya untuk konfirmasi/penolakan status (boleh disertai
    // koreksi metadata dalam request konfirmasi yang sama).
    if (status === undefined && (paymentMethod !== undefined || rawPaymentProvider !== undefined)) {
      res.status(400).json({
        error: "Gunakan endpoint /payments/:id/metadata untuk mengubah metode/provider pembayaran",
      });
      return;
    }
    const [before] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: "Not found" }); return; }
    // A repeated confirmation callback must be a no-op. Besides avoiding
    // duplicate notifications, this prevents a second accounting post for the
    // same payment when an admin or provider retries the request.
    if (
      status === "confirmed" &&
      before.status === "confirmed" &&
      paymentMethod === undefined &&
      rawPaymentProvider === undefined &&
      notes === undefined
    ) {
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

    // Jika admin mengirim status confirmed bersamaan dengan koreksi metadata,
    // status yang sudah confirmed tidak perlu di-claim ulang. Proses request
    // tetap dilanjutkan sebagai update metadata payment.
    if (status === "confirmed" && before.status === "confirmed") {
      status = undefined;
    }

    const updateData: Record<string, unknown> = {};
    const existingOcr = storedPaymentProofOcr(before);
    let normalizedPaymentMethod: string | undefined;
    if (paymentMethod !== undefined) {
      if (typeof paymentMethod !== "string" || !paymentMethod.trim()) {
        res.status(400).json({ error: "Metode pembayaran wajib diisi" });
        return;
      }
      normalizedPaymentMethod = paymentMethod.trim();
      if (normalizedPaymentMethod.length > 120) {
        res.status(400).json({ error: "Metode pembayaran terlalu panjang" });
        return;
      }
    }
    if (status) updateData.status = status;
    if (status === "confirmed") {
      const canonicalPaidAt = before.paidAt ?? new Date();
      updateData.confirmedAt = before.confirmedAt ?? canonicalPaidAt;
      updateData.paidAt = canonicalPaidAt;
    }
    if (normalizedPaymentMethod !== undefined) {
      updateData.paymentMethod = normalizedPaymentMethod;
    }
    if (rawPaymentProvider !== undefined) {
      const normalizedProvider = normalizePaymentProvider(rawPaymentProvider);
      const effectiveMethod = normalizedPaymentMethod ?? before.paymentMethod;
      if (effectiveMethod?.toUpperCase() === "QRIS") {
        // QRIS manual Sport Center selalu masuk ke Bank Mandiri CST,
        // sehingga provider tidak boleh mengikuti nilai lama dari form.
        updateData.paymentProvider = "mandiri_direct";
      } else if (rawPaymentProvider) {
        if (!normalizedProvider) {
          res.status(400).json({ error: "Provider pembayaran tidak valid." });
          return;
        }
        res.status(400).json({ error: "Provider hanya boleh diisi untuk pembayaran QRIS." });
        return;
      }
      if (effectiveMethod?.toUpperCase() !== "QRIS") {
        updateData.paymentProvider = null;
      }
    }
    if (notes !== undefined) updateData.notes = notes;
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "Tidak ada perubahan pembayaran" });
      return;
    }
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, before.bookingId)).limit(1);
    if (status === "confirmed" && booking && !isBookingConfirmableStatus(booking.status)) {
      res.status(409).json({
        error: `Booking dengan status ${booking.status} tidak dapat dikonfirmasi melalui pembayaran.`,
      });
      return;
    }

    const paymentMethodChanged =
      normalizedPaymentMethod !== undefined &&
      normalizedPaymentMethod !== String(before.paymentMethod ?? "").trim();

    // Koreksi metode oleh admin adalah override yang disengaja. Validasi OCR
    // tetap ditampilkan di UI, tetapi tidak boleh memblokir koreksi sumber
    // pembayaran setelah admin memeriksa bukti secara manual.
    const methodOcrMismatch =
      normalizedPaymentMethod !== undefined &&
      paymentMethodMatchesOcr(normalizedPaymentMethod, existingOcr) === false;

    if (paymentMethodChanged) {
      const changedMethod = normalizedPaymentMethod;
      if (!changedMethod) {
        res.status(400).json({ error: "Metode pembayaran wajib diisi" });
        return;
      }
      const isQris = changedMethod.toUpperCase() === "QRIS";
      const nextProvider: SettlementProvider = isQris ? "mandiri_direct" : "unknown";
      const paidAt = before.paidAt ?? before.confirmedAt ?? null;

      updateData.paymentProvider = nextProvider;
      updateData.providerName = normalizeProviderName(nextProvider);
      updateData.providerId = createPaymentProviderId(
        nextProvider,
        before.providerReference ?? before.providerTradeNo ?? before.merchantTradeNo ?? `sport-payment-${id}`,
      );
      updateData.providerOrderId = createPaymentProviderOrderId(
        nextProvider,
        before.merchantTradeNo ?? before.providerTradeNo ?? before.providerReference ?? `SC-PAYMENT-${id}`,
      );

      if (isQris && booking) {
        // QRIS Sport Center selalu settle ke rekening Bank Mandiri CST.
        // Resolver memakai konfigurasi effective-dated bila tersedia, lalu
        // fallback ke rekening penerimaan Sport Center.
        const enrichment = await resolveRequiredPaymentEnrichment(
          booking,
          "mandiri_direct",
          paidAt,
          {
            sourcePaymentCompanyId: before.companyId,
            explicitCompanyId: before.companyId,
            effectiveDate: paidAt ? paymentEffectiveDate(paidAt) : null,
          },
        );
        updateData.companyId = before.companyId ?? enrichment.companyId;
        updateData.bankAccountId = enrichment.bankAccountId;
        updateData.expectedSettlementDate =
          enrichment.expectedSettlementDate ?? before.expectedSettlementDate;
      }

      // Simpan tanda bahwa metode adalah hasil koreksi admin, tanpa menghapus
      // hasil OCR sebagai bukti historis.
      if (before.ocrData && typeof before.ocrData === "object") {
        updateData.ocrData = {
          ...(before.ocrData as Record<string, unknown>),
          methodMatch: methodOcrMismatch ? false : true,
          adminMethodOverride: true,
          adminMethodOverrideAt: new Date().toISOString(),
        };
      }
    }

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
        normalizedPaymentMethod ?? before.paymentMethod ?? "",
      ).trim().toUpperCase();
      const storedProvider = String(
        updateData.paymentProvider ?? rawPaymentProvider ?? before.paymentProvider ?? "",
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
        effectiveProvider as SettlementProvider,
        paymentCandidate.paidAt ?? paymentCandidate.confirmedAt ?? new Date(),
      );
      if (paymentCandidate.paymentMethod?.toUpperCase() === "QRIS") {
        const enrichment = await resolveRequiredPaymentEnrichment(
          booking,
          effectiveProvider as SettlementProvider,
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
      assertPaymentMirrorMigrationReady();
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

    if (paymentMethodChanged && booking) {
      const linkedMutationConditions = [
        eq(bankMutationsTable.matchedPaymentId, payment.id),
        eq(bankMutationsTable.matchedOrderId, booking.id),
        eq(bankMutationsTable.mutationKey, `SC-${booking.orderNumber}`),
      ];

      // Mutasi bank memakai payment/order link yang sudah ada. Hanya metadata
      // settlement yang diperbarui; nominal, tanggal, status, dan keputusan
      // rekonsiliasi tidak disentuh.
      await db
        .update(bankMutationsTable)
        .set({
          companyId: payment.companyId,
          bankAccountId: payment.bankAccountId,
          providerName: payment.providerName,
          providerOrderId: payment.providerOrderId,
          updatedAt: new Date(),
        })
        .where(or(...linkedMutationConditions));
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
        if (!isBookingConfirmableStatus(sib.status)) continue;
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
          try {
            await db.insert(bookingHistoryTable).values({
              bookingId: payment.bookingId,
              fromStatus: prevStatus,
              toStatus: "pending_payment",
              changedByName: userInfo.userName || "admin",
              note: "DP dikonfirmasi oleh admin, menunggu pelunasan",
            });
          } catch (err) {
            req.log.error({ err, paymentId: id, bookingId: payment.bookingId }, "Payment confirmed but DP history could not be written");
          }

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
          try {
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
          } catch (err) {
            req.log.error({ err, paymentId: id, bookingId: payment.bookingId }, "Payment confirmed but booking history could not be written");
          }

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

    // Koreksi metode pada payment confirmed harus memperbarui projection
    // accounting/reconciliation yang sudah ada, bukan hanya sport_payments.
    // Jalur konfirmasi normal di atas sudah mem-posting ulang sendiri, jadi
    // refresh ini khusus untuk edit metode tanpa perubahan status.
    if (paymentMethodChanged && status === undefined && payment.status === "confirmed" && booking) {
      let dpp = extractBookingDpp(booking).dpp;
      let ppnAmount = extractBookingDpp(booking).ppnAmount;
      if (booking.groupRef) {
        const groupBookings = await db
          .select({
            dpp: bookingsTable.dpp,
            totalPrice: bookingsTable.totalPrice,
            grandTotal: bookingsTable.grandTotal,
            ppnAmount: bookingsTable.ppnAmount,
          })
          .from(bookingsTable)
          .where(eq(bookingsTable.groupRef, booking.groupRef));
        dpp = 0;
        ppnAmount = 0;
        for (const groupBooking of groupBookings) {
          const extracted = extractBookingDpp(groupBooking);
          dpp += extracted.dpp;
          ppnAmount += extracted.ppnAmount;
        }
      }

      const projectionPaidAt = payment.paidAt ?? payment.confirmedAt ?? new Date();
      await postConfirmedPaymentAccounting({
        bookingId: booking.id,
        orderNumber: booking.orderNumber,
        dpp,
        ppnAmount,
        ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
        facilityId: booking.facilityId,
        journalDate: projectionPaidAt.toISOString().slice(0, 10),
        paymentMethod: payment.paymentMethod ?? undefined,
        paymentId: payment.id,
        paymentType: payment.paymentType,
        paymentProvider: payment.paymentProvider,
        bankAccountId: payment.bankAccountId,
        providerReference: payment.providerReference,
        providerOrderId: payment.providerOrderId,
        merchantTradeNo: payment.merchantTradeNo,
        providerTradeNo: payment.providerTradeNo,
      }).catch((err) =>
        logAccountingError({
          operation: "postConfirmedPaymentAccounting",
          orderNumber: booking.orderNumber,
          bookingId: booking.id,
          error: err,
        }),
      );
    }

    res.json({ ...payment, amount: Number(payment.amount) });
  } catch (err: any) {
    req.log.error({ err }, "Update payment error");
    if (res.headersSent) return;
    const message = String(err instanceof Error ? err.message : err ?? "");
    const isAccountingConflict =
      message.includes("POSTED_ACCOUNTING_JOURNAL") ||
      message.includes("PAYMENT_ACCOUNTING_JOURNAL_AMBIGUOUS");
    const isPaymentMigrationPending =
      message === "PAYMENT_MIRROR_MIGRATION_PENDING" ||
      message === "PAYMENT_MIRROR_MIGRATION_FAILED";
    const safeError =
      message === "RECEIVING_BANK_ACCOUNT_NOT_CONFIGURED"
        ? "Rekening penerima pembayaran belum dikonfigurasi."
        : message.startsWith("PAYMENT_BANK_ACCOUNT_REQUIRED:")
          ? "Rekening penerima pembayaran belum tersedia untuk payment ini."
          : message.startsWith("PAYMENT_PROVIDER")
            ? "Metadata provider pembayaran belum lengkap."
            : message.includes("CANONICAL_") || message.includes("MIRROR_")
              ? "Pembayaran belum dapat dikonfirmasi karena aturan settlement atau data penerima belum lengkap."
              : isAccountingConflict
                ? "Pembayaran sudah tercatat pada jurnal akuntansi dan tidak dapat diubah."
                : isPaymentMigrationPending
                  ? "Sistem konfirmasi pembayaran sedang disiapkan. Silakan coba lagi sesaat lagi."
                  : "Internal server error";
    res.status(
      safeError === "Internal server error"
        ? 500
        : isPaymentMigrationPending
          ? 503
          : isAccountingConflict
            ? 409
            : 422,
    ).json({
      error: safeError,
    });
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
// The old endpoint created booking-based accounting entries
// (source=sport_center_booking). Historical repair belongs to a controlled
// finance migration, not to the live Sport Center payment owner.
router.post("/payments/backfill-group-accounting", adminMiddleware, async (req, res) => {
  res.status(410).json({
    error: "GROUP_ACCOUNTING_BACKFILL_RETIRED",
    message: "Booking-based group accounting is retired. Use payment-level finance events for new payments.",
  });
});

export default router;
