import { Router } from "express";
import { db, companyDocumentTemplatesTable, usersTable, bookingsTable, facilitiesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminMiddleware, adminDocumentPreviewMiddleware } from "../lib/auth";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { renderDocument, type DocumentType } from "../lib/documentRenderer";

const router = Router();

const DOCUMENT_TYPES = ["invoice", "spp", "faktur", "kwitansi", "lampiran", "berita_acara"] as const;
const PAPER_STYLES = ["A4", "F4", "Letter"] as const;

function validateTemplateBody(body: any): { valid: true; error?: never } | { valid: false; error: string } {
  if (!body.documentType || !(DOCUMENT_TYPES as readonly string[]).includes(body.documentType)) {
    return { valid: false, error: `documentType harus salah satu dari: ${DOCUMENT_TYPES.join(", ")}` };
  }
  if (body.paperStyle !== undefined && !(PAPER_STYLES as readonly string[]).includes(body.paperStyle)) {
    return { valid: false, error: `paperStyle harus salah satu dari: ${PAPER_STYLES.join(", ")}` };
  }
  if (body.companyId !== undefined && body.companyId !== null) {
    const cid = Number(body.companyId);
    if (!Number.isFinite(cid) || cid < 1) return { valid: false, error: "companyId harus angka positif atau null" };
  }
  return { valid: true };
}

function validateTemplatePatch(body: any): { valid: true; error?: never } | { valid: false; error: string } {
  if (body.documentType !== undefined && !(DOCUMENT_TYPES as readonly string[]).includes(body.documentType)) {
    return { valid: false, error: `documentType harus salah satu dari: ${DOCUMENT_TYPES.join(", ")}` };
  }
  if (body.paperStyle !== undefined && !(PAPER_STYLES as readonly string[]).includes(body.paperStyle)) {
    return { valid: false, error: `paperStyle harus salah satu dari: ${PAPER_STYLES.join(", ")}` };
  }
  return { valid: true };
}

// ─── Template CRUD ────────────────────────────────────────────────────────────

router.get("/admin/document-templates", adminMiddleware, async (req, res) => {
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

router.get("/admin/document-templates/:id", adminMiddleware, async (req, res) => {
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

router.post("/admin/document-templates", adminMiddleware, async (req, res) => {
  try {
    const validation = validateTemplateBody(req.body);
    if (!validation.valid) { res.status(400).json({ error: validation.error }); return; }

    const { companyId, documentType, isDefault, headerLogoUrl, kopSuratHtml, footerHtml, companyDisplayName, financeName, financeTitle, financeSignature, address, phone, email, numberFormatPrefix, numberFormatPattern, paperStyle } = req.body;

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

router.put("/admin/document-templates/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(companyDocumentTemplatesTable).where(eq(companyDocumentTemplatesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }

    const validation = validateTemplatePatch(req.body);
    if (!validation.valid) { res.status(400).json({ error: validation.error }); return; }

    const { companyId, documentType, isDefault, headerLogoUrl, kopSuratHtml, footerHtml, companyDisplayName, financeName, financeTitle, financeSignature, address, phone, email, numberFormatPrefix, numberFormatPattern, paperStyle } = req.body;

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

router.delete("/admin/document-templates/:id", adminMiddleware, async (req, res) => {
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

// ─── Document Rendering Endpoints ─────────────────────────────────────────────
// adminDocumentPreviewMiddleware supports both Bearer header AND ?_token= query param
// (needed for browser window.open() flows where custom headers cannot be set)

router.get("/admin/documents/:documentType/:entityId/preview", adminDocumentPreviewMiddleware, async (req, res) => {
  try {
    const { documentType, entityId } = req.params;
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId)) : null;

    if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
      res.status(400).json({ error: "documentType tidak valid" });
      return;
    }

    const { html, templateId, documentNumber } = await renderDocument({
      documentType: documentType as DocumentType,
      entityId: parseInt(entityId),
      companyId,
      printMode: false,
      issueDocumentNumber: false,
    });

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);
    await logAudit({ ...userInfo, action: "DOCUMENT_RENDERED_WITH_TEMPLATE", entity: documentType, entityId: parseInt(entityId), after: { templateId, companyId, documentNumber, mode: "preview" }, ipAddress, userAgent });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    req.log.error({ err }, "Document preview error");
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

router.get("/admin/documents/:documentType/:entityId/pdf", adminDocumentPreviewMiddleware, async (req, res) => {
  try {
    const { documentType, entityId } = req.params;
    const companyId = req.query.companyId ? parseInt(String(req.query.companyId)) : null;

    if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
      res.status(400).json({ error: "documentType tidak valid" });
      return;
    }

    const { html, templateId, documentNumber } = await renderDocument({
      documentType: documentType as DocumentType,
      entityId: parseInt(entityId),
      companyId,
      printMode: false,
      issueDocumentNumber: true,
    });

    let pdfBuffer: Buffer | null = null;

    try {
      const puppeteer = await import("puppeteer-core");
      const chromium = await import("@sparticuz/chromium-min");

      const execPath = await (chromium as any).default.executablePath(
        `https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar`
      );

      const browser = await puppeteer.default.launch({
        args: (chromium as any).default.args,
        defaultViewport: (chromium as any).default.defaultViewport,
        executablePath: execPath,
        headless: true,
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });

      pdfBuffer = Buffer.from(await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
      }));

      await browser.close();
    } catch (puppeteerErr) {
      req.log.warn({ err: puppeteerErr }, "Puppeteer PDF generation failed, falling back to HTML");
    }

    const { ipAddress, userAgent } = getClientInfo(req);
    const userInfo = getUserFromReq(req);

    // Audit: render event (always)
    await logAudit({ ...userInfo, action: "DOCUMENT_RENDERED_WITH_TEMPLATE", entity: documentType, entityId: parseInt(entityId), after: { templateId, companyId, documentNumber, mode: pdfBuffer ? "pdf" : "html-fallback" }, ipAddress, userAgent });
    // Audit: distinct PDF generated event (only when binary PDF produced)
    if (pdfBuffer) {
      await logAudit({ ...userInfo, action: "DOCUMENT_PDF_GENERATED", entity: documentType, entityId: parseInt(entityId), after: { templateId, companyId, documentNumber, bytes: pdfBuffer.length }, ipAddress, userAgent });
    }

    if (pdfBuffer) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${documentType}-${documentNumber || entityId}.pdf"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.end(pdfBuffer);
    } else {
      const { html: printHtml } = await renderDocument({
        documentType: documentType as DocumentType,
        entityId: parseInt(entityId),
        companyId,
        printMode: true,
        issueDocumentNumber: false,
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="${documentType}-${documentNumber || entityId}.html"`);
      res.send(printHtml);
    }
  } catch (err: any) {
    req.log.error({ err }, "Document PDF error");
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

// ─── GET /public/kwitansi/:orderNumber ────────────────────────────────────────
// Render HTML kwitansi page langsung dari server — works in both dev & production.
router.get("/public/kwitansi/:orderNumber", async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, orderNumber))
      .limit(1);

    if (!booking) {
      res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tidak Ditemukan</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}
        .box{text-align:center;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 2px 8px rgba(0,0,0,.1);max-width:360px}
        h2{color:#1f2937;margin-bottom:.5rem}p{color:#6b7280;font-size:.9rem}</style></head>
        <body><div class="box"><h2>❌ Kwitansi Tidak Ditemukan</h2><p>Nomor order <strong>${orderNumber}</strong> tidak ditemukan dalam sistem.</p></div></body></html>`);
      return;
    }

    if (!["confirmed", "completed", "checked_in"].includes(booking.status)) {
      res.status(403).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Belum Tersedia</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}
        .box{text-align:center;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 2px 8px rgba(0,0,0,.1);max-width:360px}
        h2{color:#1f2937;margin-bottom:.5rem}p{color:#6b7280;font-size:.9rem}</style></head>
        <body><div class="box"><h2>⏳ Kwitansi Belum Tersedia</h2><p>Kwitansi hanya tersedia untuk booking yang sudah dikonfirmasi pembayarannya.</p></div></body></html>`);
      return;
    }

    const [[facilityRow], [settings]] = await Promise.all([
      db.select({ name: facilitiesTable.name }).from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1).catch(() => [null]),
      db.select().from(settingsTable).limit(1).catch(() => [null]),
    ]);

    const s = settings as any;
    const centerName = s?.centerName ?? "Sport Center Jakarta";
    const centerAddress = s?.address ?? "";
    const centerPhone = s?.phone ?? "";

    const subtotal = Number(booking.totalPrice ?? 0);
    const ppnAmount = booking.ppnAmount != null ? Number(booking.ppnAmount) : 0;
    const grandTotal = booking.grandTotal != null ? Number(booking.grandTotal) : subtotal;
    const ppnRate = booking.ppnRate != null ? Number(booking.ppnRate) : null;
    const hasPpn = ppnAmount > 0 && ppnRate != null;

    function formatIDR(n: number) {
      return "Rp " + n.toLocaleString("id-ID");
    }
    function formatDate(s: string) {
      if (!s) return "-";
      try { return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }); } catch { return s; }
    }
    function formatDateTime(s: string) {
      if (!s) return "-";
      try { return new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WIB"; } catch { return s; }
    }

    const confirmedAt = formatDateTime((booking as any).updatedAt ?? (booking as any).createdAt ?? "");

    const ppnRow = hasPpn ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:.85rem">PPN ${ppnRate}%</td><td style="padding:6px 0;text-align:right;color:#374151;font-size:.85rem">${formatIDR(ppnAmount)}</td></tr>` : "";

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Kwitansi ${orderNumber} — ${centerName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(to bottom,#fff7ed,#f9fafb);min-height:100vh;padding-bottom:2.5rem}
    .header{background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;padding:2rem 1.25rem 2.5rem}
    .header-inner{max-width:480px;margin:0 auto}
    .badge{display:inline-flex;align-items:center;gap:.4rem;font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:rgba(255,255,255,.8);margin-bottom:.4rem}
    .center-name{font-size:1.75rem;font-weight:900;line-height:1.1;margin-bottom:.25rem}
    .center-sub{font-size:.78rem;color:rgba(255,255,255,.7);margin-top:.15rem}
    .body{max-width:480px;margin:-1.25rem auto 0;padding:0 1rem}
    .card{background:#fff;border-radius:1rem;box-shadow:0 1px 4px rgba(0,0,0,.08);border:1px solid #f3f4f6;overflow:hidden;margin-bottom:1rem}
    .card-header{background:#f9fafb;padding:.75rem 1rem;border-bottom:1px solid #f3f4f6}
    .card-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;font-weight:600;margin-bottom:.15rem}
    .card-body{padding:1rem}
    .confirm-badge{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:1rem;padding:.75rem 1rem;display:flex;align-items:center;gap:.75rem;margin-bottom:1rem}
    .confirm-icon{width:2.25rem;height:2.25rem;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.1rem}
    .confirm-title{font-weight:900;color:#166534;font-size:.95rem}
    .confirm-sub{color:#16a34a;font-size:.75rem;margin-top:.1rem}
    .order-num{font-weight:900;font-size:1.3rem;color:#f97316;font-family:monospace}
    table{width:100%;border-collapse:collapse}
    td{padding:5px 0;vertical-align:top}
    .divider{border:none;border-top:1px solid #f3f4f6;margin:8px 0}
    .label-col{color:#9ca3af;font-size:.8rem;white-space:nowrap;padding-right:1rem}
    .val-col{text-align:right;color:#374151;font-size:.85rem;font-weight:500}
    .val-bold{font-weight:700;color:#111827}
    .total-row td{padding-top:10px}
    .total-label{font-weight:900;color:#1f2937;font-size:.95rem}
    .total-val{font-weight:900;color:#f97316;font-size:1.15rem;text-align:right}
    .stamp-area{display:flex;justify-content:space-between;align-items:flex-start}
    .stamp-circle{width:5rem;height:5rem;border:2px dashed #fed7aa;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff7ed;flex-shrink:0}
    .stamp-text{font-size:.55rem;font-weight:900;color:#f97316;text-transform:uppercase;line-height:1;margin-bottom:.15rem}
    .stamp-check{font-size:1.2rem}
    .footer-note{font-size:.65rem;color:#d1d5db;text-align:center;margin-top:.75rem}
    .print-btn{display:block;width:100%;padding:.75rem;background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;color:#4b5563;font-size:.85rem;font-weight:600;cursor:pointer;text-align:center;margin-top:.5rem;box-shadow:0 1px 2px rgba(0,0,0,.05)}
    .print-btn:hover{background:#f9fafb}
    @media print{body{background:#fff}.print-btn{display:none!important}header{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-inner">
      <div class="badge">✅ Kwitansi Pembayaran</div>
      <div class="center-name">${centerName}</div>
      ${centerAddress ? `<div class="center-sub">📍 ${centerAddress}</div>` : ""}
      ${centerPhone ? `<div class="center-sub">📞 ${centerPhone}</div>` : ""}
    </div>
  </div>

  <div class="body">
    <div class="confirm-badge">
      <div class="confirm-icon">✅</div>
      <div>
        <div class="confirm-title">Pembayaran Dikonfirmasi</div>
        <div class="confirm-sub">${confirmedAt}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-label">Nomor Order</div>
        <div class="order-num">${orderNumber}</div>
      </div>
      <div class="card-body">
        <table>
          <tr><td class="label-col">Nama Customer</td><td class="val-col val-bold">${booking.customerName ?? "-"}</td></tr>
          <tr><td class="label-col">No. HP</td><td class="val-col">${booking.customerPhone ?? "-"}</td></tr>
        </table>
        <hr class="divider">
        <table>
          <tr><td class="label-col">Fasilitas</td><td class="val-col val-bold">${facilityRow?.name ?? "-"}</td></tr>
          <tr><td class="label-col">Tanggal</td><td class="val-col">${formatDate(booking.bookingDate)}</td></tr>
          <tr><td class="label-col">Waktu</td><td class="val-col">${booking.startTime} – ${booking.endTime}</td></tr>
          <tr><td class="label-col">Durasi</td><td class="val-col">${booking.durationHours} jam</td></tr>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-label">Rincian Pembayaran</div></div>
      <div class="card-body">
        <table>
          <tr><td class="label-col">Subtotal</td><td class="val-col">${formatIDR(subtotal)}</td></tr>
          ${ppnRow}
          <tr class="total-row">
            <td colspan="2"><hr class="divider"></td>
          </tr>
          <tr>
            <td class="total-label">Total Dibayar</td>
            <td class="total-val">${formatIDR(grandTotal)}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <div class="stamp-area">
          <div>
            <div style="font-size:.75rem;color:#9ca3af;margin-bottom:.3rem">Diterbitkan oleh</div>
            <div style="font-weight:700;font-size:.9rem;color:#1f2937">🏢 ${centerName}</div>
            ${centerPhone ? `<div style="font-size:.75rem;color:#9ca3af;margin-top:.15rem">${centerPhone}</div>` : ""}
          </div>
          <div class="stamp-circle">
            <div class="stamp-text">LUNAS</div>
            <div class="stamp-check">✅</div>
          </div>
        </div>
        <p class="footer-note">Kwitansi ini merupakan bukti pembayaran yang sah. Diterbitkan secara digital oleh sistem Sport Center.</p>
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">🖨️ Cetak / Simpan PDF</button>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    req.log.error({ err }, "Public kwitansi HTML error");
    res.status(500).send("Terjadi kesalahan. Silakan coba lagi.");
  }
});

// ─── GET /public/kwitansi-data/:orderNumber ───────────────────────────────────
// Lightweight JSON endpoint for React kwitansi page — no auth, no Puppeteer.
router.get("/public/kwitansi-data/:orderNumber", async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, orderNumber))
      .limit(1);

    if (!booking) {
      res.status(404).json({ error: "Kwitansi tidak ditemukan" });
      return;
    }

    if (!["confirmed", "completed", "checked_in"].includes(booking.status)) {
      res.status(403).json({ error: "Kwitansi hanya tersedia untuk booking yang sudah dikonfirmasi" });
      return;
    }

    const [[facilityRow], [settings]] = await Promise.all([
      db.select({ name: facilitiesTable.name }).from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1).catch(() => [null]),
      db.select().from(settingsTable).limit(1).catch(() => [null]),
    ]);

    res.json({
      orderNumber: booking.orderNumber,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      facilityName: facilityRow?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      durationHours: booking.durationHours,
      totalPrice: Number(booking.totalPrice ?? 0),
      ppnRate: booking.ppnRate != null ? Number(booking.ppnRate) : null,
      ppnAmount: booking.ppnAmount != null ? Number(booking.ppnAmount) : null,
      grandTotal: booking.grandTotal != null ? Number(booking.grandTotal) : null,
      status: booking.status,
      confirmedAt: booking.updatedAt ?? booking.createdAt,
      centerName: (settings as any)?.centerName ?? "Sport Center Jakarta",
      centerAddress: (settings as any)?.address ?? "",
      centerPhone: (settings as any)?.phone ?? "",
      bankName: (settings as any)?.bankName ?? "",
      bankAccount: (settings as any)?.bankAccount ?? "",
      bankAccountName: (settings as any)?.bankAccountName ?? "",
    });
  } catch (err: any) {
    req.log.error({ err }, "Public kwitansi-data error");
    res.status(500).json({ error: "Terjadi kesalahan" });
  }
});

export default router;
