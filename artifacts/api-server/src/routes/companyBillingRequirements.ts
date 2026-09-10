import { Router } from "express";
import { db, usersTable, companyBillingRequirementsTable, companyInvoicesTable, companyInvoiceItemsTable, auditLogsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { BILLING_DOCUMENT_TYPES, BILLING_DOCUMENT_LABELS, type BillingDocumentType } from "@workspace/db";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";

const router = Router();

router.get("/company-billing-requirements", adminMiddleware, async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) {
      res.status(400).json({ error: "companyId wajib diisi" });
      return;
    }
    const cid = parseInt(String(companyId));
    const rows = await db
      .select()
      .from(companyBillingRequirementsTable)
      .where(eq(companyBillingRequirementsTable.companyId, cid));

    const reqs = rows.filter((r) => r.active);
    res.json(reqs.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      documentType: r.documentType,
      required: r.required,
      active: r.active,
      label: BILLING_DOCUMENT_LABELS[r.documentType as BillingDocumentType] ?? r.documentType,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    req.log.error({ err }, "List billing requirements error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /company-billing-requirements/:companyId  — replace all reqs for company
router.put("/company-billing-requirements/:companyId", adminMiddleware, async (req, res) => {
  try {
    const cid = parseInt(String(req.params.companyId));
    const { documentTypes } = req.body as { documentTypes: string[] };

    if (!Array.isArray(documentTypes)) {
      res.status(400).json({ error: "documentTypes harus array" });
      return;
    }

    const validTypes = documentTypes.filter((t) => (BILLING_DOCUMENT_TYPES as readonly string[]).includes(t));

    // Deactivate all existing
    await db
      .update(companyBillingRequirementsTable)
      .set({ active: false })
      .where(eq(companyBillingRequirementsTable.companyId, cid));

    // Upsert each active type
    for (const docType of validTypes) {
      const [existing] = await db
        .select()
        .from(companyBillingRequirementsTable)
        .where(
          and(
            eq(companyBillingRequirementsTable.companyId, cid),
            eq(companyBillingRequirementsTable.documentType, docType),
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(companyBillingRequirementsTable)
          .set({ active: true, required: true })
          .where(eq(companyBillingRequirementsTable.id, existing.id));
      } else {
        await db.insert(companyBillingRequirementsTable).values({
          companyId: cid,
          documentType: docType,
          required: true,
          active: true,
        });
      }
    }

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      action: "COMPANY_BILLING_REQUIREMENTS_UPDATED",
      entity: "company",
      entityId: cid,
      after: { documentTypes: validTypes },

      userId: userInfo.userId,
      userName: userInfo.userName,
      userRole: userInfo.userRole,
      ipAddress,
      userAgent,
    });

    const updated = await db
      .select()
      .from(companyBillingRequirementsTable)
      .where(and(eq(companyBillingRequirementsTable.companyId, cid), eq(companyBillingRequirementsTable.active, true)));

    res.json(updated.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      documentType: r.documentType,
      required: r.required,
      active: r.active,
      label: BILLING_DOCUMENT_LABELS[r.documentType as BillingDocumentType] ?? r.documentType,
    })));
  } catch (err) {
    req.log.error({ err }, "Update billing requirements error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /company-invoices/:id/billing-document-status
// Returns per-invoice document availability based on company requirements
router.get("/company-invoices/:id/billing-document-status", adminMiddleware, async (req, res) => {
  try {
    const invoiceId = parseInt(String(req.params.id));
    const [invoice] = await db
      .select()
      .from(companyInvoicesTable)
      .where(eq(companyInvoicesTable.id, invoiceId))
      .limit(1);

    if (!invoice) {
      res.status(404).json({ error: "Invoice tidak ditemukan" });
      return;
    }

    const requirements = await db
      .select()
      .from(companyBillingRequirementsTable)
      .where(
        and(
          eq(companyBillingRequirementsTable.companyId, invoice.companyCustomerId),
          eq(companyBillingRequirementsTable.active, true),
        )
      );

    const items = await db
      .select()
      .from(companyInvoiceItemsTable)
      .where(eq(companyInvoiceItemsTable.invoiceId, invoiceId));

    const hasItems = items.length > 0;

    const docStatus = requirements.map((req) => {
      const dt = req.documentType as BillingDocumentType;
      let available = false;
      switch (dt) {
        case "invoice": available = true; break;
        case "lampiran_pemakaian": available = hasItems; break;
        case "kwitansi": available = true; break;
        case "spp": available = true; break;
        case "faktur_pajak": available = hasItems; break;
        case "dokumentasi": available = false; break; // requires photo uploads
        case "berita_acara": available = hasItems; break;
        case "surat_pengantar": available = true; break;
        case "materai": available = false; break; // physical only
        case "custom_document": available = false; break;
        default: available = false;
      }
      return {
        documentType: dt,
        label: BILLING_DOCUMENT_LABELS[dt] ?? dt,
        required: req.required,
        available,
      };
    });

    const allComplete = docStatus.filter((d) => d.required).every((d) => d.available);

    res.json({ status: allComplete ? "complete" : "incomplete", documents: docStatus });
  } catch (err) {
    req.log.error({ err }, "Billing document status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /company-invoices/:id/audit-billing-action — log download/send actions
router.post("/company-invoices/:id/audit-billing-action", adminMiddleware, async (req, res) => {
  try {
    const invoiceId = parseInt(String(req.params.id));
    const { action, documents } = req.body as { action: string; documents?: string[] };

    const validActions = [
      "COMPANY_BILLING_PACKAGE_GENERATED",
      "COMPANY_DOCUMENT_GENERATED",
      "COMPANY_DOCUMENT_SENT",
      "COMPANY_DOCUMENT_DOWNLOADED",
    ];

    if (!validActions.includes(action)) {
      res.status(400).json({ error: "Action tidak valid" });
      return;
    }

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({
      action,
      entity: "company_invoice",
      entityId: invoiceId,

      after: { documents: Array.isArray(documents) ? documents.slice(0, 30) : [] },
      userId: userInfo.userId,
      userName: userInfo.userName,
      userRole: userInfo.userRole,
      ipAddress,
      userAgent,
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Audit billing action error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
