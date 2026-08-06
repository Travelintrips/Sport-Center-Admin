import { Router } from "express";
import { db, paymentsTable, bookingsTable, bookingHistoryTable, facilitiesTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { notifyPaymentConfirmed, notifyPaymentProofUploaded } from "../lib/notifications";
import { logAudit, getClientInfo, getUserFromReq, logAccountingError } from "../lib/auditLog";
import { syncStatusToBizportal } from "../lib/bizportalSync";
import { uploadProofWithFallback } from "./storage";
import { createJournalEntry, createPublicAccountingEntry, createPublicAccountingEntryForGroup } from "../lib/accounting";
import { createWaToken } from "../lib/waTokens";
import { logger } from "../lib/logger";
import { getBaseUrl } from "../lib/appUrl";

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

    // Helper: propagasi status ke semua sibling dalam grup
    const propagateGroupStatus = async (targetStatus: string, note: string) => {
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
          await propagateGroupStatus("pending_payment", "DP dikonfirmasi oleh admin, menunggu pelunasan");
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
          await propagateGroupStatus("confirmed",
            payment.paymentType === "pelunasan"
              ? "Pelunasan dikonfirmasi oleh admin"
              : "Pembayaran dikonfirmasi oleh admin"
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
          }).catch((err) => logger.error({ err, orderNumber: booking.orderNumber, phone: booking.customerPhone }, "[WA] notifyPaymentConfirmed error"));
          syncStatusToBizportal(booking.orderNumber, "confirmed", payment.proofUrl, new Date()).catch(() => {});

          const today = new Date().toISOString().split("T")[0];
          const subtotal = Number(booking.totalPrice);
          const ppnAmount = booking.ppnAmount != null ? Number(booking.ppnAmount) : 0;

          // Jurnal internal per booking (tidak berubah)
          createJournalEntry(booking.id, booking.orderNumber, subtotal, ppnAmount, today).catch((err) =>
            logAccountingError({ operation: "createJournalEntry", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
          );

          // BizPortal: grup booking → 1 entry total; booking tunggal → 1 entry per booking
          if (booking.groupRef) {
            // Ambil semua booking dalam grup (termasuk yang ini)
            const allGroupBookings = await db.select({
              id: bookingsTable.id,
              orderNumber: bookingsTable.orderNumber,
              totalPrice: bookingsTable.totalPrice,
              ppnAmount: bookingsTable.ppnAmount,
              facilityId: bookingsTable.facilityId,
            }).from(bookingsTable).where(eq(bookingsTable.groupRef, booking.groupRef));

            const groupEntries = allGroupBookings.map(b => ({
              id: b.id,
              orderNumber: b.orderNumber,
              subtotal: Number(b.totalPrice),
              ppnAmount: b.ppnAmount != null ? Number(b.ppnAmount) : 0,
              facilityId: b.facilityId,
            }));

            createPublicAccountingEntryForGroup(booking.groupRef, groupEntries, today).catch((err) =>
              logAccountingError({ operation: "createPublicAccountingEntryForGroup", orderNumber: booking.groupRef!, bookingId: booking.id, error: err }),
            );
          } else {
            createPublicAccountingEntry(booking.id, booking.orderNumber, subtotal, ppnAmount, booking.facilityId, today).catch((err) =>
              logAccountingError({ operation: "createPublicAccountingEntry", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
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
        await propagateGroupStatus("pending_payment", `Pembayaran ditolak: ${notes ?? ""}`);
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
