import { Router } from "express";
import { db, paymentsTable, bookingsTable, bookingHistoryTable, facilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { notifyPaymentConfirmed, notifyPaymentProofUploaded } from "../lib/notifications";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

const PROOFS_DIR = path.resolve(process.cwd(), "uploads", "proofs");
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROOFS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `proof-${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const validMime = /image\/(jpeg|png|webp)|application\/pdf/.test(file.mimetype);
    cb(null, validMime);
  },
});

router.post("/payments/proof-upload", upload.single("proof"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }
    const objectPath = `/api/uploads/proofs/${req.file.filename}`;
    res.json({ objectPath });
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
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, Number(bookingId))).limit(1);

    const [existing] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.bookingId, Number(bookingId))).limit(1);

    if (existing) {
      await db.update(paymentsTable).set({ proofUrl, notes, status: "pending" })
        .where(eq(paymentsTable.bookingId, Number(bookingId)));
      await db.update(bookingsTable).set({ status: "waiting_confirmation", updatedAt: new Date() })
        .where(eq(bookingsTable.id, Number(bookingId)));

      if (booking) {
        await db.insert(bookingHistoryTable).values({
          bookingId: Number(bookingId),
          fromStatus: booking.status,
          toStatus: "waiting_confirmation",
          changedByName: booking.customerName,
          note: "Bukti transfer diupload (update)",
        });
        const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
          .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
        notifyPaymentProofUploaded({
          customerName: booking.customerName, customerPhone: booking.customerPhone,
          orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
          bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
          totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
        });
      }

      const [updated] = await db.select().from(paymentsTable)
        .where(eq(paymentsTable.bookingId, Number(bookingId))).limit(1);
      res.status(201).json({ ...updated, amount: Number(updated.amount) });
      return;
    }

    const [payment] = await db.insert(paymentsTable)
      .values({ bookingId: Number(bookingId), amount: String(amount), proofUrl, notes })
      .returning();

    await db.update(bookingsTable).set({ status: "waiting_confirmation", updatedAt: new Date() })
      .where(eq(bookingsTable.id, Number(bookingId)));

    if (booking) {
      await db.insert(bookingHistoryTable).values({
        bookingId: Number(bookingId),
        fromStatus: booking.status,
        toStatus: "waiting_confirmation",
        changedByName: booking.customerName,
        note: "Bukti transfer diupload",
      });
      const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
        .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
      notifyPaymentProofUploaded({
        customerName: booking.customerName, customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
        bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      });
    }

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

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    await db.update(paymentsTable).set(updateData).where(eq(paymentsTable.id, id));

    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (!payment) { res.status(404).json({ error: "Not found" }); return; }

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, payment.bookingId)).limit(1);
    const userInfo = getUserFromReq(req);
    const clientInfo = getClientInfo(req);

    if (status === "confirmed") {
      const prevStatus = booking?.status ?? "waiting_confirmation";
      await db.update(bookingsTable).set({ status: "confirmed", updatedAt: new Date() })
        .where(eq(bookingsTable.id, payment.bookingId));

      if (booking) {
        await db.insert(bookingHistoryTable).values({
          bookingId: payment.bookingId,
          fromStatus: prevStatus,
          toStatus: "confirmed",
          changedByName: userInfo.userName || "admin",
          note: "Pembayaran dikonfirmasi oleh admin",
        });
        const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
          .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
        notifyPaymentConfirmed({
          customerName: booking.customerName, customerPhone: booking.customerPhone,
          orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
          bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
          totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
        });
      }
    } else if (status === "rejected") {
      const prevStatus = booking?.status ?? "waiting_confirmation";
      await db.update(bookingsTable).set({ status: "pending_payment", updatedAt: new Date() })
        .where(eq(bookingsTable.id, payment.bookingId));

      if (booking) {
        await db.insert(bookingHistoryTable).values({
          bookingId: payment.bookingId,
          fromStatus: prevStatus,
          toStatus: "pending_payment",
          changedByName: userInfo.userName || "admin",
          note: `Pembayaran ditolak: ${notes ?? ""}`,
        });
      }
    }

    await logAudit({
      ...userInfo,
      action: "update_payment",
      entity: "payment",
      entityId: id,
      before: { status: before?.status },
      after: { status },
      ...clientInfo,
    });

    res.json({ ...payment, amount: Number(payment.amount) });
  } catch (err) {
    req.log.error({ err }, "Update payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
