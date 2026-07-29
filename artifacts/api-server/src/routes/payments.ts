import { Router } from "express";
import { db, paymentsTable, bookingsTable, bookingHistoryTable, facilitiesTable, bookingGroupsTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { notifyPaymentConfirmed, notifyPaymentProofUploaded } from "../lib/notifications";
import { logAudit, getClientInfo, getUserFromReq, logAccountingError } from "../lib/auditLog";
import { syncStatusToBizportal, pushConfirmedPaymentAsBankMutation } from "../lib/bizportalSync";
import { uploadProofWithFallback } from "./storage";
import { createJournalEntry, createPublicAccountingEntry, extractBookingDpp } from "../lib/accounting";
import { createWaToken } from "../lib/waTokens";
import { logger } from "../lib/logger";
import { getBaseUrl } from "../lib/appUrl";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { sendInvoiceToCustomer, sendGroupInvoiceToCustomer } from "../lib/invoiceDelivery";

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

    // ── Validasi nominal pembayaran ───────────────────────────────────────────
    // For group bookings, use the group's total payment as the ceiling, not the per-session price
    let grandTotalVal = booking.grandTotal != null ? Number(booking.grandTotal) : Number(booking.totalPrice);
    if (booking.groupRef) {
      const [group] = await db.select().from(bookingGroupsTable)
        .where(eq(bookingGroupsTable.groupRef, booking.groupRef)).limit(1);
      if (group) grandTotalVal = Number(group.totalPayment);
    }
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
      const confirmedDpTotal = existingPayments
        .filter((p) => p.paymentType === "dp" && p.status === "confirmed")
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const remainingAmount = grandTotalVal - confirmedDpTotal;
      if (amountNum > remainingAmount + PAYMENT_TOLERANCE) {
        res.status(400).json({
          error: `Nominal pelunasan (Rp ${amountNum.toLocaleString("id-ID")}) melebihi sisa tagihan (Rp ${remainingAmount.toLocaleString("id-ID")})`,
        });
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
            amount: String(sib.totalPrice),
            proofUrl,
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

    // Helper: propagasi status ke semua sibling dalam grup
    const propagateGroupStatus = async (
      targetStatus: string,
      note: string,
      proofUrl?: string | null,
      paidAt?: Date | null,
    ) => {
      if (!booking?.groupRef) return;
      const siblings = await db.select().from(bookingsTable).where(
        and(eq(bookingsTable.groupRef, booking.groupRef), ne(bookingsTable.id, payment.bookingId))
      );
      for (const sib of siblings) {
        const sibPrev = sib.status;
        await db.update(bookingsTable)
          .set({ status: targetStatus as any, updatedAt: new Date() })
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
          .set({ status: status as any, ...(status === "confirmed" ? { confirmedAt: new Date() } : {}) })
          .where(and(eq(paymentsTable.bookingId, sib.id), eq(paymentsTable.status, "pending")));
        // Sync sibling ke BizPortal
        syncStatusToBizportal(sib.orderNumber, targetStatus, proofUrl, paidAt, sib).catch(() => {});
      }
    };

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
          await propagateGroupStatus("pending_payment", "DP dikonfirmasi oleh admin, menunggu pelunasan", null, null);
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
          syncStatusToBizportal(booking.orderNumber, "confirmed", payment.proofUrl, new Date(), booking).catch(() => {});
          pushConfirmedPaymentAsBankMutation(booking, new Date()).catch(() => {});

          const today = new Date().toISOString().split("T")[0];
          const { dpp, ppnAmount } = extractBookingDpp(booking);
          createJournalEntry(booking.id, booking.orderNumber, dpp, ppnAmount, today).catch((err) =>
            logAccountingError({ operation: "createJournalEntry", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
          );
          createPublicAccountingEntry(booking.id, booking.orderNumber, dpp, ppnAmount, booking.facilityId, today).catch((err) =>
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
        before: { status: before?.status },
        after: { status },
        ...clientInfo,
      });
    }

    // Rekap otomatis hanya jika status BENAR-BENAR berubah & booking hari ini
    if (booking && (status === "confirmed" || status === "rejected") && before.status !== status) {
      triggerRekapIfToday(booking.bookingDate);
    }

    res.json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Update payment error");
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

export default router;
