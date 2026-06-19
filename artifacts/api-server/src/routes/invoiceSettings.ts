import { Router } from "express";
import { db, companyInvoiceSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
    else cb(new Error("Only image files allowed"));
  },
});

async function getOrCreate(): Promise<typeof companyInvoiceSettingsTable.$inferSelect> {
  const [existing] = await db.select().from(companyInvoiceSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(companyInvoiceSettingsTable).values({}).returning();
  return created;
}

// GET /admin/invoice-settings
router.get("/admin/invoice-settings", adminMiddleware, async (req, res) => {
  try {
    const settings = await getOrCreate();
    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Get invoice settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/invoice-settings/public — no auth, for invoice rendering
router.get("/invoice-settings/public", async (req, res) => {
  try {
    const settings = await getOrCreate();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /admin/invoice-settings
router.put("/admin/invoice-settings", adminMiddleware, async (req, res) => {
  try {
    const existing = await getOrCreate();
    const {
      companyName, logoUrl, kopSuratHtml, address, phone, email,
      bankName, bankAccount, bankAccountName,
      financeName, financeTitle, signatureUrl,
      invoicePrefix, taxRate, footerText,
    } = req.body;

    const updates: Partial<typeof companyInvoiceSettingsTable.$inferInsert> = {};
    if (companyName !== undefined) updates.companyName = companyName;
    if (logoUrl !== undefined) updates.logoUrl = logoUrl;
    if (kopSuratHtml !== undefined) updates.kopSuratHtml = kopSuratHtml;
    if (address !== undefined) updates.address = address;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    if (bankName !== undefined) updates.bankName = bankName;
    if (bankAccount !== undefined) updates.bankAccount = bankAccount;
    if (bankAccountName !== undefined) updates.bankAccountName = bankAccountName;
    if (financeName !== undefined) updates.financeName = financeName;
    if (financeTitle !== undefined) updates.financeTitle = financeTitle;
    if (signatureUrl !== undefined) updates.signatureUrl = signatureUrl;
    if (invoicePrefix !== undefined) updates.invoicePrefix = invoicePrefix.toUpperCase();
    if (taxRate !== undefined) updates.taxRate = String(taxRate);
    if (footerText !== undefined) updates.footerText = footerText;

    const [updated] = await db
      .update(companyInvoiceSettingsTable)
      .set(updates)
      .where(eq(companyInvoiceSettingsTable.id, existing.id))
      .returning();

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "DOCUMENT_SETTINGS_UPDATED",
      entity: "company_invoice_settings",
      entityId: existing.id,
      before: existing,
      after: updated,
      ipAddress,
      userAgent,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update invoice settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/invoice-settings/upload-logo
router.post("/admin/invoice-settings/upload-logo", adminMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "File diperlukan" }); return; }
    const ext = req.file.originalname.split(".").pop() ?? "png";
    const filename = `invoice-logo-${randomUUID()}.${ext}`;
    const url = await uploadToStorage(BUCKETS.facility, filename, req.file.buffer, req.file.mimetype);

    const existing = await getOrCreate();
    const [updated] = await db
      .update(companyInvoiceSettingsTable)
      .set({ logoUrl: url })
      .where(eq(companyInvoiceSettingsTable.id, existing.id))
      .returning();

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_TEMPLATE_CHANGED",
      entity: "company_invoice_settings",
      entityId: existing.id,
      after: { field: "logoUrl", url },
      ipAddress,
      userAgent,
    });

    res.json({ url, settings: updated });
  } catch (err: any) {
    req.log.error({ err }, "Upload invoice logo error");
    res.status(500).json({ error: err?.message || "Upload gagal" });
  }
});

// POST /admin/invoice-settings/upload-signature
router.post("/admin/invoice-settings/upload-signature", adminMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "File diperlukan" }); return; }
    const ext = req.file.originalname.split(".").pop() ?? "png";
    const filename = `invoice-signature-${randomUUID()}.${ext}`;
    const url = await uploadToStorage(BUCKETS.facility, filename, req.file.buffer, req.file.mimetype);

    const existing = await getOrCreate();
    const [updated] = await db
      .update(companyInvoiceSettingsTable)
      .set({ signatureUrl: url })
      .where(eq(companyInvoiceSettingsTable.id, existing.id))
      .returning();

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      ...userInfo,
      action: "INVOICE_TEMPLATE_CHANGED",
      entity: "company_invoice_settings",
      entityId: existing.id,
      after: { field: "signatureUrl", url },
      ipAddress,
      userAgent,
    });

    res.json({ url, settings: updated });
  } catch (err: any) {
    req.log.error({ err }, "Upload signature error");
    res.status(500).json({ error: err?.message || "Upload gagal" });
  }
});

export default router;
