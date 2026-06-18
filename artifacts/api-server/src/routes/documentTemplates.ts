import { Router } from "express";
import { db, companyDocumentTemplatesTable, usersTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { renderDocument, type DocumentType } from "../lib/documentRenderer";

const router = Router();

const DOCUMENT_TYPES = ["invoice", "spp", "faktur", "kwitansi", "lampiran", "berita_acara"];

router.get("/document-templates", adminMiddleware, async (req, res) => {
  try {
    const { companyId, documentType } = req.query;
    let rows = await db.select().from(companyDocumentTemplatesTable);

    if (companyId === "null" || companyId === "0") {
      rows = rows.filter((r) => r.companyId === null);
    } else if (companyId) {
      rows = rows.filter((r) => r.companyId === parseInt(String(companyId)));
    }
    if (documentType) {
      rows = rows.filter((r) => r.documentType === String(documentType));
    }

    const companyIds = [...new Set(rows.filter((r) => r.companyId != null).map((r) => r.companyId!))];
    let companyMap: Record<number, string> = {};
    if (companyIds.length > 0) {
      const companies = await db.select({ id: usersTable.id, name: usersTable.name, companyName: usersTable.companyName }).from(usersTable);
      companyMap = Object.fromEntries(companies.map((c) => [c.id, c.companyName || c.name]));
    }

    res.json(rows.map((r) => ({ ...r, companyName: r.companyId ? (companyMap[r.companyId] ?? "") : "System Default" })));
  } catch (err) {
    req.log.error({ err }, "List document templates error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/document-templates/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [tpl] = await db.select().from(companyDocumentTemplatesTable).where(eq(companyDocumentTemplatesTable.id, id)).limit(1);
    if (!tpl) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }
    res.json(tpl);
  } catch (err) {
    req.log.error({ err }, "Get document template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/document-templates", adminMiddleware, async (req, res) => {
  try {
    const { companyId, documentType, isDefault, headerLogoUrl, kopSuratHtml, footerHtml, companyDisplayName, financeName, financeTitle, financeSignature, address, phone, email, numberFormatPrefix, numberFormatPattern, paperStyle } = req.body;

    if (!documentType || !DOCUMENT_TYPES.includes(documentType)) {
      res.status(400).json({ error: `documentType harus salah satu dari: ${DOCUMENT_TYPES.join(", ")}` });
      return;
    }

    const [tpl] = await db.insert(companyDocumentTemplatesTable).values({
      companyId: companyId ? parseInt(String(companyId)) : null,
      documentType,
      isDefault: !!isDefault,
      headerLogoUrl: headerLogoUrl ?? null,
      kopSuratHtml: kopSuratHtml ?? null,
      footerHtml: footerHtml ?? null,
      companyDisplayName: companyDisplayName ?? null,
      financeName: financeName ?? null,
      financeTitle: financeTitle ?? null,
      financeSignature: financeSignature ?? null,
      address: address ?? null,
      phone: phone ?? null,
      email: email ?? null,
      numberFormatPrefix: numberFormatPrefix ?? null,
      numberFormatPattern: numberFormatPattern ?? null,
      paperStyle: paperStyle ?? "A4",
    }).returning();

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({ ...userInfo, action: "COMPANY_DOCUMENT_TEMPLATE_CREATED", entity: "document_template", entityId: tpl.id, after: { documentType, companyId }, ipAddress, userAgent });

    res.status(201).json(tpl);
  } catch (err) {
    req.log.error({ err }, "Create document template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/document-templates/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(companyDocumentTemplatesTable).where(eq(companyDocumentTemplatesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }

    const { companyId, documentType, isDefault, headerLogoUrl, kopSuratHtml, footerHtml, companyDisplayName, financeName, financeTitle, financeSignature, address, phone, email, numberFormatPrefix, numberFormatPattern, paperStyle } = req.body;

    if (documentType && !DOCUMENT_TYPES.includes(documentType)) {
      res.status(400).json({ error: `documentType harus salah satu dari: ${DOCUMENT_TYPES.join(", ")}` });
      return;
    }

    const updates: Partial<typeof companyDocumentTemplatesTable.$inferInsert> = {};
    if (companyId !== undefined) updates.companyId = companyId ? parseInt(String(companyId)) : null;
    if (documentType !== undefined) updates.documentType = documentType;
    if (isDefault !== undefined) updates.isDefault = !!isDefault;
    if (headerLogoUrl !== undefined) updates.headerLogoUrl = headerLogoUrl;
    if (kopSuratHtml !== undefined) updates.kopSuratHtml = kopSuratHtml;
    if (footerHtml !== undefined) updates.footerHtml = footerHtml;
    if (companyDisplayName !== undefined) updates.companyDisplayName = companyDisplayName;
    if (financeName !== undefined) updates.financeName = financeName;
    if (financeTitle !== undefined) updates.financeTitle = financeTitle;
    if (financeSignature !== undefined) updates.financeSignature = financeSignature;
    if (address !== undefined) updates.address = address;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    if (numberFormatPrefix !== undefined) updates.numberFormatPrefix = numberFormatPrefix;
    if (numberFormatPattern !== undefined) updates.numberFormatPattern = numberFormatPattern;
    if (paperStyle !== undefined) updates.paperStyle = paperStyle;

    const [updated] = await db.update(companyDocumentTemplatesTable).set(updates).where(eq(companyDocumentTemplatesTable.id, id)).returning();

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({ ...userInfo, action: "COMPANY_DOCUMENT_TEMPLATE_UPDATED", entity: "document_template", entityId: id, before: existing, after: updated, ipAddress, userAgent });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update document template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/document-templates/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(companyDocumentTemplatesTable).where(eq(companyDocumentTemplatesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }
    if (existing.isDefault) { res.status(400).json({ error: "System default template tidak bisa dihapus" }); return; }

    await db.delete(companyDocumentTemplatesTable).where(eq(companyDocumentTemplatesTable.id, id));

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({ ...userInfo, action: "COMPANY_DOCUMENT_TEMPLATE_DELETED", entity: "document_template", entityId: id, before: existing, ipAddress, userAgent });

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete document template error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/documents/:documentType/:entityId/preview", adminMiddleware, async (req, res) => {
  try {
    const { documentType, entityId } = req.params;
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId)) : null;
    const printMode = req.query.print === "1";

    if (!DOCUMENT_TYPES.includes(documentType)) {
      res.status(400).json({ error: "documentType tidak valid" });
      return;
    }

    const { html, templateId } = await renderDocument({
      documentType: documentType as DocumentType,
      entityId: parseInt(entityId),
      companyId,
      printMode,
    });

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({ ...userInfo, action: "DOCUMENT_RENDERED_WITH_TEMPLATE", entity: documentType, entityId: parseInt(entityId), after: { templateId, companyId, printMode }, ipAddress, userAgent });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    req.log.error({ err }, "Document preview error");
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

router.get("/documents/:documentType/:entityId/pdf", adminMiddleware, async (req, res) => {
  try {
    const { documentType, entityId } = req.params;
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId)) : null;

    if (!DOCUMENT_TYPES.includes(documentType)) {
      res.status(400).json({ error: "documentType tidak valid" });
      return;
    }

    const { html, templateId } = await renderDocument({
      documentType: documentType as DocumentType,
      entityId: parseInt(entityId),
      companyId,
      printMode: true,
    });

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({ ...userInfo, action: "DOCUMENT_PDF_GENERATED", entity: documentType, entityId: parseInt(entityId), after: { templateId, companyId }, ipAddress, userAgent });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${documentType}-${entityId}.html"`);
    res.send(html);
  } catch (err: any) {
    req.log.error({ err }, "Document PDF error");
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

export default router;
