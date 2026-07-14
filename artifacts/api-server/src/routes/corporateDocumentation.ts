import { Router } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { db, bookingsTable, corporateBookingDocumentationTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { uploadFile, BUCKETS } from "../lib/storage";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { logger } from "../lib/logger";

const router = Router();

const MAX_FILES_PER_BOOKING = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/pdf", "application/pdf"];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Format file tidak didukung. Gunakan JPG, PNG, atau PDF."));
    }
  },
});

// ─── GET /api/bookings/:id/documentation ──────────────────────────────────
// Ambil semua dokumentasi untuk booking tertentu
router.get("/bookings/:id/documentation", async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    if (isNaN(bookingId)) {
      res.status(400).json({ error: "ID booking tidak valid" });
      return;
    }

    const docs = await db
      .select()
      .from(corporateBookingDocumentationTable)
      .where(eq(corporateBookingDocumentationTable.bookingId, bookingId))
      .orderBy(corporateBookingDocumentationTable.createdAt);

    res.json(docs);
  } catch (err) {
    logger.error({ err }, "GET documentation error");
    res.status(500).json({ error: "Gagal mengambil dokumentasi" });
  }
});

// ─── POST /api/bookings/:id/documentation ─────────────────────────────────
// Upload dokumentasi untuk corporate booking
router.post(
  "/bookings/:id/documentation",
  upload.single("file"),
  async (req, res) => {
    try {
      const bookingId = parseInt(req.params.id);
      if (isNaN(bookingId)) {
        res.status(400).json({ error: "ID booking tidak valid" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: "File wajib diunggah" });
        return;
      }

      // Validasi booking
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId))
        .limit(1);

      if (!booking) {
        res.status(404).json({ error: "Booking tidak ditemukan" });
        return;
      }

      if (booking.payerType !== "company") {
        res.status(403).json({
          error: "Fitur dokumentasi hanya tersedia untuk booking perusahaan",
        });
        return;
      }

      const allowedStatuses = ["confirmed", "completed", "pending_payment", "paid", "waiting_confirmation"];
      if (!allowedStatuses.includes(booking.status)) {
        res.status(403).json({
          error: `Dokumentasi tidak dapat diunggah untuk booking dengan status "${booking.status}"`,
        });
        return;
      }

      // Cek batas maksimal file per booking
      const existingDocs = await db
        .select({ id: corporateBookingDocumentationTable.id })
        .from(corporateBookingDocumentationTable)
        .where(eq(corporateBookingDocumentationTable.bookingId, bookingId));

      if (existingDocs.length >= MAX_FILES_PER_BOOKING) {
        res.status(400).json({
          error: `Maksimal ${MAX_FILES_PER_BOOKING} file per booking. Hapus file lama terlebih dahulu.`,
        });
        return;
      }

      // Upload file ke storage
      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      const fileName = `SC-${bookingId}-${Date.now()}${ext}`;
      const objectPath = `corporate-docs/${fileName}`;

      const fileUrl = await uploadFile(
        BUCKETS.corporateDocs,
        objectPath,
        req.file.buffer,
        req.file.mimetype,
      );

      // Tentukan siapa yang upload
      const user = (req as any).user;
      const uploadedBy: "admin" | "customer" =
        user?.role === "admin" ? "admin" : "customer";

      // Simpan record ke database
      const caption = typeof req.body.caption === "string" ? req.body.caption.trim() : null;

      const [doc] = await db
        .insert(corporateBookingDocumentationTable)
        .values({
          bookingId,
          companyId: booking.companyCustomerId ?? null,
          uploadedBy,
          fileUrl,
          fileName,
          caption: caption || null,
        })
        .returning();

      // Audit log
      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: "DOCUMENTATION_UPLOADED",
        entity: "corporate_booking_documentation",
        entityId: doc.id,
        after: {
          bookingId,
          orderNumber: booking.orderNumber,
          companyId: booking.companyCustomerId,
          fileName,
          uploadedBy,
          caption: caption || null,
        },
        ipAddress,
        userAgent,
      });

      logger.info(
        { bookingId, docId: doc.id, uploadedBy },
        "[corporateDocs] Dokumentasi berhasil diunggah",
      );

      res.status(201).json(doc);
    } catch (err: any) {
      if (err?.message?.includes("Format file")) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error({ err }, "POST documentation error");
      res.status(500).json({ error: "Gagal mengunggah dokumentasi" });
    }
  },
);

// ─── DELETE /api/bookings/:id/documentation/:docId ────────────────────────
// Hapus dokumentasi — hanya admin
router.delete(
  "/bookings/:id/documentation/:docId",
  adminMiddleware,
  async (req, res) => {
    try {
      const bookingId = parseInt(req.params.id);
      const docId = parseInt(req.params.docId);

      if (isNaN(bookingId) || isNaN(docId)) {
        res.status(400).json({ error: "ID tidak valid" });
        return;
      }

      const [doc] = await db
        .select()
        .from(corporateBookingDocumentationTable)
        .where(
          and(
            eq(corporateBookingDocumentationTable.id, docId),
            eq(corporateBookingDocumentationTable.bookingId, bookingId),
          ),
        )
        .limit(1);

      if (!doc) {
        res.status(404).json({ error: "Dokumentasi tidak ditemukan" });
        return;
      }

      await db
        .delete(corporateBookingDocumentationTable)
        .where(eq(corporateBookingDocumentationTable.id, docId));

      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: "DOCUMENTATION_DELETED",
        entity: "corporate_booking_documentation",
        entityId: docId,
        before: { bookingId, fileUrl: doc.fileUrl, fileName: doc.fileName },
        ipAddress,
        userAgent,
      });

      logger.info({ bookingId, docId }, "[corporateDocs] Dokumentasi dihapus");
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DELETE documentation error");
      res.status(500).json({ error: "Gagal menghapus dokumentasi" });
    }
  },
);

// ─── GET /api/bookings/:id/documentation/invoice-summary ──────────────────
// Ambil dokumentasi untuk ditampilkan di invoice — dipakai saat generate invoice
router.get(
  "/bookings/:id/documentation/invoice-summary",
  adminMiddleware,
  async (req, res) => {
    try {
      const bookingId = parseInt(req.params.id);
      if (isNaN(bookingId)) {
        res.status(400).json({ error: "ID booking tidak valid" });
        return;
      }

      const docs = await db
        .select()
        .from(corporateBookingDocumentationTable)
        .where(eq(corporateBookingDocumentationTable.bookingId, bookingId))
        .orderBy(corporateBookingDocumentationTable.createdAt);

      res.json({ bookingId, docs });
    } catch (err) {
      logger.error({ err }, "GET invoice-summary docs error");
      res.status(500).json({ error: "Gagal mengambil dokumentasi" });
    }
  },
);

export default router;
