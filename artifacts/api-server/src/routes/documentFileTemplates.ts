import { Router } from "express";
import multer from "multer";
import { db, documentFileTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { uploadToStorage, deleteFromStorage } from "../lib/supabaseStorage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BUCKET = "document-templates";
const DOCUMENT_TYPES = ["invoice", "spp", "faktur", "kwitansi", "lampiran", "berita_acara"] as const;
type DocType = typeof DOCUMENT_TYPES[number];

function detectTemplateType(mime: string, filename: string): "image" | "pdf" {
  if (mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) return "pdf";
  return "image";
}

// ─── List all file templates ────────────────────────────────────────────────
router.get("/api/admin/document-file-templates", adminMiddleware, async (req, res) => {
  try {
    const { documentType, companyId } = req.query;
    let rows = await db.select().from(documentFileTemplatesTable).orderBy(documentFileTemplatesTable.documentType);
    if (documentType) rows = rows.filter((r) => r.documentType === String(documentType));
    if (companyId === "null") rows = rows.filter((r) => r.companyId === null);
    else if (companyId) rows = rows.filter((r) => r.companyId === parseInt(String(companyId)));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "List document file templates error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Upload file template for a document type ────────────────────────────────
router.post(
  "/api/admin/document-file-templates/upload",
  adminMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      const { documentType, companyId } = req.body;
      if (!documentType || !(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
        res.status(400).json({ error: `documentType harus salah satu dari: ${DOCUMENT_TYPES.join(", ")}` });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "File wajib diupload" });
        return;
      }

      const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
      if (!allowed.includes(req.file.mimetype)) {
        res.status(400).json({ error: "Format file harus PNG, JPG, atau PDF" });
        return;
      }

      const templateType = detectTemplateType(req.file.mimetype, req.file.originalname);
      const ext = req.file.originalname.split(".").pop()?.toLowerCase() || "png";
      const safeDocType = String(documentType).replace(/[^a-z_]/g, "");
      const objectPath = `${safeDocType}/${Date.now()}-template.${ext}`;

      const fileUrl = await uploadToStorage(BUCKET, objectPath, req.file.buffer, req.file.mimetype);

      const cid = companyId ? parseInt(String(companyId)) : null;

      const [row] = await db.insert(documentFileTemplatesTable).values({
        companyId: cid,
        documentType: String(documentType),
        templateType,
        fileUrl,
        fileName: req.file.originalname,
        isActive: false,
      }).returning();

      const { ipAddress, userAgent } = getClientInfo(req);
      const userInfo = getUserFromReq(req);
      await logAudit({
        ...userInfo,
        action: "TEMPLATE_UPLOADED",
        entity: "document_file_template",
        entityId: row.id,
        after: { documentType, templateType, fileUrl },
        ipAddress,
        userAgent,
      });

      res.status(201).json(row);
    } catch (err: any) {
      req.log.error({ err }, "Upload document file template error");
      res.status(500).json({ error: err?.message || "Internal server error" });
    }
  }
);

// ─── Activate a file template (deactivates others for same docType) ──────────
router.patch("/api/admin/document-file-templates/:id/activate", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [existing] = await db.select().from(documentFileTemplatesTable).where(eq(documentFileTemplatesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }

    // Deactivate all others for same docType + companyId
    const cond = existing.companyId != null
      ? and(eq(documentFileTemplatesTable.documentType, existing.documentType), eq(documentFileTemplatesTable.companyId, existing.companyId))
      : and(eq(documentFileTemplatesTable.documentType, existing.documentType));
    await db.update(documentFileTemplatesTable).set({ isActive: false }).where(cond!);

    // Activate this one
    const [updated] = await db.update(documentFileTemplatesTable)
      .set({ isActive: true })
      .where(eq(documentFileTemplatesTable.id, id))
      .returning();

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "TEMPLATE_CHANGED",
      entity: "document_file_template",
      entityId: id,
      before: existing,
      after: updated,
      ipAddress,
      userAgent,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Activate document file template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Deactivate a file template ──────────────────────────────────────────────
router.patch("/api/admin/document-file-templates/:id/deactivate", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [existing] = await db.select().from(documentFileTemplatesTable).where(eq(documentFileTemplatesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }

    const [updated] = await db.update(documentFileTemplatesTable)
      .set({ isActive: false })
      .where(eq(documentFileTemplatesTable.id, id))
      .returning();

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "TEMPLATE_DEACTIVATED",
      entity: "document_file_template",
      entityId: id,
      before: existing,
      after: updated,
      ipAddress,
      userAgent,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Deactivate document file template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Delete a file template ──────────────────────────────────────────────────
router.delete("/api/admin/document-file-templates/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [existing] = await db.select().from(documentFileTemplatesTable).where(eq(documentFileTemplatesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }

    await deleteFromStorage(existing.fileUrl);
    await db.delete(documentFileTemplatesTable).where(eq(documentFileTemplatesTable.id, id));

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "TEMPLATE_CHANGED",
      entity: "document_file_template",
      entityId: id,
      before: existing,
      ipAddress,
      userAgent,
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete document file template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
