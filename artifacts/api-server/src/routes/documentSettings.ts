import { Router } from "express";
import { db, companyDocumentSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { DocumentType } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import multer from "multer";
import { BUCKETS, uploadToStorage } from "../lib/supabaseStorage";
import { randomUUID } from "crypto";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Hanya file gambar yang diizinkan"));
  },
});

const bgTemplateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Hanya PNG, JPG, WebP, atau PDF yang diizinkan"));
  },
});

const VALID_TYPES: DocumentType[] = [
  "general", "invoice", "spp", "kwitansi", "lampiran", "berita_acara", "surat_pengantar",
];

function isValidType(t: unknown): t is DocumentType {
  return VALID_TYPES.includes(t as DocumentType);
}

/** Get or auto-create a row for the given document_type */
export async function getDocumentSettings(docType: DocumentType = "invoice") {
  const [row] = await db
    .select()
    .from(companyDocumentSettingsTable)
    .where(eq(companyDocumentSettingsTable.documentType, docType))
    .limit(1);
  if (row) return row;
  const [created] = await db
    .insert(companyDocumentSettingsTable)
    .values({ documentType: docType })
    .returning();
  return created;
}

/** Get all document settings as a map */
async function getAllSettings() {
  return db.select().from(companyDocumentSettingsTable);
}

// ── GET /admin/document-settings ─────────────────────────────────────────────
router.get("/admin/document-settings", adminMiddleware, async (req, res) => {
  try {
    const rows = await getAllSettings();
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Get document settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/document-settings/:type ───────────────────────────────────────
router.get("/admin/document-settings/:type", adminMiddleware, async (req, res) => {
  const { type } = req.params;
  if (!isValidType(type)) { res.status(400).json({ error: "Invalid document type" }); return; }
  try {
    const row = await getDocumentSettings(type);
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Get document settings type error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/document-settings/public ────────────────────────────────────────
router.get("/document-settings/public", async (req, res) => {
  try {
    const rows = await getAllSettings();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /admin/document-settings/:type ───────────────────────────────────────
router.put("/admin/document-settings/:type", adminMiddleware, async (req, res) => {
  const { type } = req.params;
  if (!isValidType(type)) { res.status(400).json({ error: "Invalid document type" }); return; }
  try {
    const existing = await getDocumentSettings(type);
    const {
      logoUrl, kopSuratHtml, footerHtml,
      bankName, bankAccount, bankHolder,
      financeName, financeTitle, signatureUrl,
      prefixNumber, taxRate,
    } = req.body;

    const updates: Partial<typeof companyDocumentSettingsTable.$inferInsert> = {};
    if (logoUrl !== undefined) updates.logoUrl = logoUrl;
    if (kopSuratHtml !== undefined) updates.kopSuratHtml = kopSuratHtml;
    if (footerHtml !== undefined) updates.footerHtml = footerHtml;
    if (bankName !== undefined) updates.bankName = bankName;
    if (bankAccount !== undefined) updates.bankAccount = bankAccount;
    if (bankHolder !== undefined) updates.bankHolder = bankHolder;
    if (financeName !== undefined) updates.financeName = financeName;
    if (financeTitle !== undefined) updates.financeTitle = financeTitle;
    if (signatureUrl !== undefined) updates.signatureUrl = signatureUrl;
    if (prefixNumber !== undefined) updates.prefixNumber = String(prefixNumber).toUpperCase();
    if (taxRate !== undefined) updates.taxRate = String(taxRate);

    const [updated] = await db
      .update(companyDocumentSettingsTable)
      .set(updates)
      .where(eq(companyDocumentSettingsTable.documentType, type))
      .returning();

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "DOCUMENT_TEMPLATE_UPDATED",
      entity: "company_document_settings",
      entityId: existing.id,
      before: existing,
      after: updated,
      ipAddress,
      userAgent,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update document settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/document-settings/:type/upload-logo ──────────────────────────
router.post(
  "/admin/document-settings/:type/upload-logo",
  adminMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { type } = req.params;
    if (!isValidType(type)) { res.status(400).json({ error: "Invalid document type" }); return; }
    try {
      if (!req.file) { res.status(400).json({ error: "File diperlukan" }); return; }
      const ext = req.file.originalname.split(".").pop() ?? "png";
      const filename = `doc-logo-${type}-${randomUUID()}.${ext}`;
      const url = await uploadToStorage(BUCKETS.facility, filename, req.file.buffer, req.file.mimetype);

      const existing = await getDocumentSettings(type);
      const [updated] = await db
        .update(companyDocumentSettingsTable)
        .set({ logoUrl: url })
        .where(eq(companyDocumentSettingsTable.documentType, type))
        .returning();

      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: "DOCUMENT_TYPE_CHANGED",
        entity: "company_document_settings",
        entityId: existing.id,
        after: { type, field: "logoUrl", url },
        ipAddress,
        userAgent,
      });

      res.json({ url, settings: updated });
    } catch (err: any) {
      req.log.error({ err }, "Upload document logo error");
      res.status(500).json({ error: err?.message || "Upload gagal" });
    }
  },
);

// ── POST /admin/document-settings/:type/upload-signature ─────────────────────
router.post(
  "/admin/document-settings/:type/upload-signature",
  adminMiddleware,
  upload.single("file"),
  async (req, res) => {
    const { type } = req.params;
    if (!isValidType(type)) { res.status(400).json({ error: "Invalid document type" }); return; }
    try {
      if (!req.file) { res.status(400).json({ error: "File diperlukan" }); return; }
      const ext = req.file.originalname.split(".").pop() ?? "png";
      const filename = `doc-signature-${type}-${randomUUID()}.${ext}`;
      const url = await uploadToStorage(BUCKETS.facility, filename, req.file.buffer, req.file.mimetype);

      const existing = await getDocumentSettings(type);
      const [updated] = await db
        .update(companyDocumentSettingsTable)
        .set({ signatureUrl: url })
        .where(eq(companyDocumentSettingsTable.documentType, type))
        .returning();

      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: "DOCUMENT_TYPE_CHANGED",
        entity: "company_document_settings",
        entityId: existing.id,
        after: { type, field: "signatureUrl", url },
        ipAddress,
        userAgent,
      });

      res.json({ url, settings: updated });
    } catch (err: any) {
      req.log.error({ err }, "Upload document signature error");
      res.status(500).json({ error: err?.message || "Upload gagal" });
    }
  },
);

// ── POST /admin/document-settings/:type/upload-bg-template ───────────────────
router.post(
  "/admin/document-settings/:type/upload-bg-template",
  adminMiddleware,
  bgTemplateUpload.single("file"),
  async (req, res) => {
    const { type } = req.params;
    if (!isValidType(type)) { res.status(400).json({ error: "Invalid document type" }); return; }
    try {
      if (!req.file) { res.status(400).json({ error: "File diperlukan" }); return; }

      const isPdf = req.file.mimetype === "application/pdf";
      const templateType = isPdf ? "pdf" : "image";
      const ext = isPdf ? "pdf" : (req.file.originalname.split(".").pop() ?? "png");
      const filename = `doc-bg-template-${type}-${randomUUID()}.${ext}`;
      const url = await uploadToStorage(BUCKETS.docTemplates, filename, req.file.buffer, req.file.mimetype);

      const existing = await getDocumentSettings(type);
      const [updated] = await db
        .update(companyDocumentSettingsTable)
        .set({ bgTemplateUrl: url, bgTemplateType: templateType, bgTemplateActive: true })
        .where(eq(companyDocumentSettingsTable.documentType, type))
        .returning();

      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: "TEMPLATE_UPLOADED",
        entity: "company_document_settings",
        entityId: existing.id,
        after: { type, field: "bgTemplateUrl", url, templateType },
        ipAddress,
        userAgent,
      });

      res.json({ url, templateType, settings: updated });
    } catch (err: any) {
      req.log.error({ err }, "Upload bg template error");
      res.status(500).json({ error: err?.message || "Upload gagal" });
    }
  },
);

// ── PATCH /admin/document-settings/:type/bg-template/toggle ──────────────────
router.patch(
  "/admin/document-settings/:type/bg-template/toggle",
  adminMiddleware,
  async (req, res) => {
    const { type } = req.params;
    if (!isValidType(type)) { res.status(400).json({ error: "Invalid document type" }); return; }
    try {
      const existing = await getDocumentSettings(type);
      if (!existing.bgTemplateUrl) {
        res.status(400).json({ error: "Belum ada background template yang diupload" });
        return;
      }

      const newActive = !existing.bgTemplateActive;
      const [updated] = await db
        .update(companyDocumentSettingsTable)
        .set({ bgTemplateActive: newActive })
        .where(eq(companyDocumentSettingsTable.documentType, type))
        .returning();

      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: newActive ? "TEMPLATE_CHANGED" : "TEMPLATE_DEACTIVATED",
        entity: "company_document_settings",
        entityId: existing.id,
        before: { bgTemplateActive: existing.bgTemplateActive },
        after: { bgTemplateActive: newActive, type },
        ipAddress,
        userAgent,
      });

      res.json({ bgTemplateActive: newActive, settings: updated });
    } catch (err: any) {
      req.log.error({ err }, "Toggle bg template error");
      res.status(500).json({ error: err?.message || "Gagal toggle" });
    }
  },
);

// ── DELETE /admin/document-settings/:type/bg-template ────────────────────────
router.delete(
  "/admin/document-settings/:type/bg-template",
  adminMiddleware,
  async (req, res) => {
    const { type } = req.params;
    if (!isValidType(type)) { res.status(400).json({ error: "Invalid document type" }); return; }
    try {
      const existing = await getDocumentSettings(type);
      const [updated] = await db
        .update(companyDocumentSettingsTable)
        .set({ bgTemplateUrl: null, bgTemplateType: null, bgTemplateActive: false })
        .where(eq(companyDocumentSettingsTable.documentType, type))
        .returning();

      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: "TEMPLATE_DEACTIVATED",
        entity: "company_document_settings",
        entityId: existing.id,
        before: { bgTemplateUrl: existing.bgTemplateUrl },
        after: { type, removed: true },
        ipAddress,
        userAgent,
      });

      res.json({ success: true, settings: updated });
    } catch (err: any) {
      req.log.error({ err }, "Delete bg template error");
      res.status(500).json({ error: err?.message || "Gagal menghapus" });
    }
  },
);

export default router;
