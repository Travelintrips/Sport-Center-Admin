import { Router } from "express";
import { db, paymentsTable, bookingsTable, bookingHistoryTable, facilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { notifyPaymentConfirmed, notifyPaymentProofUploaded } from "../lib/notifications";
import { logAudit, getClientInfo, getUserFromReq, logAccountingError } from "../lib/auditLog";
import { syncStatusToBizportal } from "../lib/bizportalSync";
import { BUCKETS, uploadToStorage } from "../lib/supabaseStorage";
import { createJournalEntry, createPublicAccountingEntry } from "../lib/accounting";
import { createWaToken } from "../lib/waTokens";
import { logger } from "../lib/logger";

function getAppUrl(): string {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) return (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const validMime = /image\/(jpeg|png|webp)|application\/pdf/.test(file.mimetype);
    cb(null, validMime);
  },
});

router.post("/payments/proof-upload", upload.single("proof"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }
    const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const objectName = `proof-${randomUUID()}${ext}`;
    const url = await uploadToStorage(
      BUCKETS.proof,
      objectName,
      req.file.buffer,
      req.file.mimetype,
    );
    res.json({ objectPath: url, url });
  } catch (err) {
    req.log.error({ err }, "Upload proof error");
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/payments", async (req, res) => {
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

router.post("/payments", async (req, res) => {
  try {
    const { bookingId, amount, proofUrl, notes } = req.body;
    let paymentType: string = req.body.paymentType ?? "";

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, Number(bookingId))).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

    const existingPayments = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.bookingId, Number(bookingId)));

    // Auto-detect payment_type jika tidak dikirim dari client
    if (!paymentType) {
      if (booking.isDpPaid && Number(booking.downPayment) > 0) {
        const hasDpActive = existingPayments.some(
          (p) => p.paymentType === "dp" && (p.status === "pending" || p.status === "confirmed"),
        );
        paymentType = hasDpActive ? "pelunasan" : "dp";
      } else {
        paymentType = "full_payment";
      }
    }

    // Validasi: jangan buat duplicate pending payment untuk tipe yang sama
    if (paymentType === "dp") {
      const hasPendingDp = existingPayments.some(
        (p) => p.paymentType === "dp" && p.status === "pending",
      );
      if (hasPendingDp) {
        res.status(409).json({ error: "Bukti DP sudah dikirim, mohon tunggu konfirmasi admin" });
        return;
      }
    }

    if (paymentType === "pelunasan") {
      const hasPendingPelunasan = existingPayments.some(
        (p) => p.paymentType === "pelunasan" && p.status === "pending",
      );
      if (hasPendingPelunasan) {
        res.status(409).json({ error: "Bukti pelunasan sudah dikirim, mohon tunggu konfirmasi admin" });
        return;
      }
    }

    // Insert payment record baru (no upsert)
    const [payment] = await db.insert(paymentsTable)
      .values({
        bookingId: Number(bookingId),
        amount: String(amount),
        proofUrl,
        notes,
        paymentType: paymentType as "dp" | "pelunasan" | "full_payment",
      })
      .returning();

    const prevStatus = booking.status;
    await db.update(bookingsTable)
      .set({ status: "waiting_confirmation", updatedAt: new Date() })
      .where(eq(bookingsTable.id, Number(bookingId)));

    const historyNote =
      paymentType === "dp"
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

    const [facility] = await db
      .select({ name: facilitiesTable.name })
      .from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId))
      .limit(1);

    // Generate single review token so admin gets ONE link (proof + approve/reject in one page)
    const APP_URL = getAppUrl();
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
      reviewUrl: `${APP_URL}/wa/review/${reviewToken}`,
    });
    syncStatusToBizportal(booking.orderNumber, "waiting_confirmation", proofUrl).catch(() => {});

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
    const { status, notes } = req.body;
    const [before] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
    if (!before) { res.status(404).json({ error: "Not found" }); return; }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (status === "confirmed") updateData.confirmedAt = new Date();
    if (notes !== undefined) updateData.notes = notes;
    await db.update(paymentsTable).set(updateData).where(eq(paymentsTable.id, id));

    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
    if (!payment) { res.status(404).json({ error: "Not found" }); return; }

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, payment.bookingId)).limit(1);
    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);

    if (status === "confirmed") {
      const isDP = payment.paymentType === "dp";

      if (isDP) {
        // DP dikonfirmasi — booking kembali ke pending_payment untuk upload pelunasan
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
            note: "DP dikonfirmasi oleh admin, menunggu pelunasan",
          });
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
          }).catch((err) => logger.error({ err, orderNumber: booking.orderNumber, phone: booking.customerPhone }, "[WA] notifyPaymentConfirmed error"));
          syncStatusToBizportal(booking.orderNumber, "confirmed", payment.proofUrl, new Date()).catch(() => {});

          const today = new Date().toISOString().split("T")[0];
          const subtotal = Number(booking.totalPrice);
          const ppnAmount = booking.ppnAmount != null ? Number(booking.ppnAmount) : 0;
          createJournalEntry(booking.id, booking.orderNumber, subtotal, ppnAmount, today).catch((err) =>
            logAccountingError({ operation: "createJournalEntry", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
          );
          createPublicAccountingEntry(booking.id, booking.orderNumber, subtotal, ppnAmount, booking.facilityId, today).catch((err) =>
            logAccountingError({ operation: "createPublicAccountingEntry", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
          );
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
        syncStatusToBizportal(booking.orderNumber, "pending_payment").catch(() => {});
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
        before: { status: before?.status },
        after: { status },
        ...clientInfo,
      });
    }

    res.json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Update payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
