
import { db, companyDocumentTemplatesTable, companyInvoicesTable, companyInvoiceItemsTable, bookingsTable, usersTable, facilitiesTable, settingsTable, documentFileTemplatesTable } from "@workspace/db";

import { db, companyDocumentTemplatesTable, companyDocumentSettingsTable, companyInvoicesTable, companyInvoiceItemsTable, bookingsTable, usersTable, facilitiesTable, settingsTable } from "@workspace/db";

import { eq, and, isNull } from "drizzle-orm";
import type { DocumentTemplate } from "@workspace/db";
import { generateDocumentNumber, deriveCompanyCode } from "./documentNumbering";

export type DocumentType = "invoice" | "spp" | "faktur" | "kwitansi" | "lampiran" | "berita_acara";

const DOC_PREFIX_MAP: Record<DocumentType, string> = {
  invoice: "INV",
  spp: "SPP",
  faktur: "FAKTUR",
  kwitansi: "KWT",
  lampiran: "LMP",
  berita_acara: "BA",
};

function formatIDR(n: number | string | null | undefined): string {
  const num = Number(n ?? 0);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

async function getTemplate(documentType: string, companyId: number | null): Promise<DocumentTemplate | null> {
  if (companyId != null) {
    const [tpl] = await db
      .select()
      .from(companyDocumentTemplatesTable)
      .where(and(eq(companyDocumentTemplatesTable.companyId, companyId), eq(companyDocumentTemplatesTable.documentType, documentType)))
      .limit(1);
    if (tpl) return tpl;
  }
  const [def] = await db
    .select()
    .from(companyDocumentTemplatesTable)
    .where(and(isNull(companyDocumentTemplatesTable.companyId), eq(companyDocumentTemplatesTable.documentType, documentType), eq(companyDocumentTemplatesTable.isDefault, true)))
    .limit(1);
  return def ?? null;
}

async function getSettings() {
  try {
    const [s] = await db.select().from(settingsTable).limit(1);
    return s;
  } catch { return null; }
}

async function getActiveFileTemplate(documentType: string, companyId: number | null): Promise<{ fileUrl: string; templateType: string } | null> {
  try {
    const rows = await db.select().from(documentFileTemplatesTable).where(
      and(
        eq(documentFileTemplatesTable.documentType, documentType),
        eq(documentFileTemplatesTable.isActive, true),
      )
    ).limit(10);
    // Company-specific takes priority over global
    if (companyId != null) {
      const match = rows.find((r) => r.companyId === companyId);
      if (match) return { fileUrl: match.fileUrl, templateType: match.templateType };
    }
    const global = rows.find((r) => r.companyId == null);
    return global ? { fileUrl: global.fileUrl, templateType: global.templateType } : null;
  } catch {
    return null;
  }
}

function buildDefaultKopHtml(vars: Record<string, string>): string {
  return `
<div style="display:flex;align-items:center;gap:16px;border-bottom:3px solid #ea580c;padding-bottom:16px;margin-bottom:16px;">
  ${vars.headerLogoUrl ? `<img src="${vars.headerLogoUrl}" style="height:64px;object-fit:contain;" />` : ""}
  <div>
    <h1 style="margin:0;font-size:20px;font-weight:900;color:#ea580c;">${vars.companyDisplayName || "Sport Center Bandara Soekarno Hatta"}</h1>
    ${vars.address ? `<div style="font-size:12px;color:#555;">${vars.address}</div>` : ""}
    ${vars.phone ? `<div style="font-size:12px;color:#555;">Telp: ${vars.phone}</div>` : ""}
    ${vars.email ? `<div style="font-size:12px;color:#555;">Email: ${vars.email}</div>` : ""}
  </div>
</div>`;
}

function buildDefaultFooterHtml(vars: Record<string, string>): string {
  return `
<div style="margin-top:40px;display:flex;justify-content:flex-end;">
  <div style="text-align:center;min-width:200px;">
    <div style="font-size:13px;">Jakarta, ${new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })}</div>
    <div style="font-size:13px;margin-top:4px;">${vars.financeTitle || "Finance Manager"}</div>
    <div style="margin:40px 0 8px;">
      ${vars.financeSignature ? `<img src="${vars.financeSignature}" style="height:48px;object-fit:contain;" />` : ""}
    </div>
    <div style="font-weight:700;font-size:13px;">${vars.financeName || ""}</div>
  </div>
</div>
<div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:11px;color:#9ca3af;text-align:center;">
  Dokumen ini diterbitkan secara resmi oleh ${vars.companyDisplayName || "Sport Center Bandara Soekarno Hatta"}
</div>`;
}

function buildInvoiceTableHtml(items: any[]): string {
  const rows = items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#fafafa"};">
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${i + 1}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${item.orderNumber || "-"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${item.facilityName || "-"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${item.bookingDate ? formatDate(item.bookingDate) : "-"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${item.startTime || ""} – ${item.endTime || ""}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatIDR(item.subtotal)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatIDR(item.taxAmount)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatIDR(item.totalAmount)}</td>
    </tr>`).join("");

  return `
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
  <thead>
    <tr style="background:#ea580c;color:#fff;">
      <th style="padding:10px;text-align:left;">#</th>
      <th style="padding:10px;text-align:left;">Order</th>
      <th style="padding:10px;text-align:left;">Fasilitas</th>
      <th style="padding:10px;text-align:left;">Tanggal</th>
      <th style="padding:10px;text-align:left;">Jam</th>
      <th style="padding:10px;text-align:right;">Subtotal</th>
      <th style="padding:10px;text-align:right;">PPN</th>
      <th style="padding:10px;text-align:right;">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}


function wrapInHtmlPage(bodyContent: string, paperStyle = "A4", printMode = false, backgroundUrl?: string | null): string {
  const pageSize = paperStyle === "A4" ? "210mm 297mm" : "216mm 279mm";
  const hasBackground = backgroundUrl && !backgroundUrl.toLowerCase().endsWith(".pdf");
  const bgLayer = hasBackground ? `
  <div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;">
    <img src="${backgroundUrl}" style="width:100%;height:100%;object-fit:contain;print-color-adjust:exact;-webkit-print-color-adjust:exact;"
      onerror="this.parentElement.style.display='none'" />
  </div>` : "";

function wrapInHtmlPage(bodyContent: string, paperStyle = "A4", printMode = false, bgTemplateUrl?: string | null, bgTemplateType?: string | null): string {
  const pageSize = paperStyle === "A4" ? "210mm 297mm" : "216mm 279mm";

  const hasBgImage = bgTemplateUrl && bgTemplateType === "image";
  const hasBgPdf = bgTemplateUrl && bgTemplateType === "pdf";

  const bgStyles = hasBgImage
    ? `background-image: url('${bgTemplateUrl}'); background-size: cover; background-position: top left; background-repeat: no-repeat;`
    : "";

  const pdfBgLayer = hasBgPdf
    ? `<div style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;overflow:hidden;">
        <iframe src="${bgTemplateUrl}#toolbar=0&navpanes=0&scrollbar=0" style="width:100%;height:100%;border:none;opacity:0.9;"></iframe>
       </div>`
    : "";

  const contentStyle = (hasBgImage || hasBgPdf)
    ? `position:relative; z-index:1; padding:40px; min-height:inherit;`
    : `padding:40px;`;

  const pageStyle = (hasBgImage || hasBgPdf)
    ? `background: #fff; max-width: 800px; margin: 24px auto; min-height: 1122px; position: relative; box-shadow: 0 1px 8px rgba(0,0,0,0.1); ${bgStyles}`
    : `background: #fff; max-width: 800px; margin: 24px auto; padding: 40px; box-shadow: 0 1px 8px rgba(0,0,0,0.1);`;


  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dokumen Sport Center</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #1f2937; background: #f3f4f6; }

    .page { ${hasBackground ? "background: transparent;" : "background: #fff;"} max-width: 800px; margin: 24px auto; padding: 40px; box-shadow: 0 1px 8px rgba(0,0,0,0.1); position: relative; z-index: 1; }
    @media print {
      body { background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .page { margin: 0; box-shadow: none; padding: 20px; }
      @page { size: ${pageSize}; margin: 15mm; }

    .page { ${pageStyle} }
    .bg-layer { position:absolute; top:0; left:0; width:100%; height:100%; z-index:0; }
    .content-layer { ${contentStyle} }
    @media print {
      body { background: #fff; }
      .page { margin: 0; box-shadow: none; ${hasBgImage || hasBgPdf ? "" : "padding: 20px;"} }
      @page { size: ${pageSize}; margin: 0; }

    }
  </style>
  ${printMode ? "<script>window.onload = () => { document.title = 'Dokumen Sport Center'; window.print(); };</script>" : ""}
</head>
<body>
  ${bgLayer}
  <div class="page">
    ${pdfBgLayer}
    <div class="content-layer">
      ${bodyContent}
    </div>
  </div>
</body>
</html>`;
}

async function getDocSettingsForType(documentType: string) {
  try {
    const [row] = await db
      .select()
      .from(companyDocumentSettingsTable)
      .where(eq(companyDocumentSettingsTable.documentType, documentType as any))
      .limit(1);
    if (row?.bgTemplateActive && row?.bgTemplateUrl) {
      return { bgTemplateUrl: row.bgTemplateUrl, bgTemplateType: row.bgTemplateType };
    }
    // Fallback to "general" if this type has no active bg template
    if (documentType !== "general") {
      const [general] = await db
        .select()
        .from(companyDocumentSettingsTable)
        .where(eq(companyDocumentSettingsTable.documentType, "general" as any))
        .limit(1);
      if (general?.bgTemplateActive && general?.bgTemplateUrl) {
        return { bgTemplateUrl: general.bgTemplateUrl, bgTemplateType: general.bgTemplateType };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function renderDocument(params: {
  documentType: DocumentType;
  entityId: number;
  companyId?: number | null;
  printMode?: boolean;
  issueDocumentNumber?: boolean;
}): Promise<{ html: string; templateId: number | null; documentNumber: string | null }> {
  const { documentType, entityId, companyId = null, printMode = false, issueDocumentNumber = false } = params;
  const tpl = await getTemplate(documentType, companyId);
  const settings = await getSettings();

  const centerName = settings?.centerName || "Sport Center Bandara Soekarno Hatta";
  const bankName = settings?.bankName || "";
  const bankAccount = settings?.bankAccount || "";
  const bankAccountName = settings?.bankAccountName || "";
  const centerAddress = settings?.address || "";
  const centerPhone = settings?.phone || "";
  const centerEmail = settings?.email || "";

  const tplVars: Record<string, string> = {
    companyDisplayName: tpl?.companyDisplayName || centerName,
    financeName: tpl?.financeName || "",
    financeTitle: tpl?.financeTitle || "Finance Manager",
    financeSignature: tpl?.financeSignature || "",
    address: tpl?.address || centerAddress,
    phone: tpl?.phone || centerPhone,
    email: tpl?.email || centerEmail,
    headerLogoUrl: tpl?.headerLogoUrl || "",
    bankName,
    bankAccount,
    bankAccountName,
    centerName,
  };

  const kopHtml = tpl?.kopSuratHtml ? interpolate(tpl.kopSuratHtml, tplVars) : buildDefaultKopHtml(tplVars);
  const footerHtml = tpl?.footerHtml ? interpolate(tpl.footerHtml, tplVars) : buildDefaultFooterHtml(tplVars);

  let bodyContent = "";
  let documentNumber: string | null = null;

  if (documentType === "invoice" || documentType === "lampiran" || documentType === "berita_acara") {
    const [inv] = await db.select().from(companyInvoicesTable).where(eq(companyInvoicesTable.id, entityId)).limit(1);
    if (!inv) throw new Error("Invoice tidak ditemukan");
    const [company] = await db.select().from(usersTable).where(eq(usersTable.id, inv.companyCustomerId)).limit(1);
    const items = await db.select().from(companyInvoiceItemsTable).where(eq(companyInvoiceItemsTable.invoiceId, entityId));

    const prefix = tpl?.numberFormatPrefix || DOC_PREFIX_MAP[documentType];
    const companyCode = deriveCompanyCode(company?.companyName || company?.name);

    if (issueDocumentNumber) {
      documentNumber = await generateDocumentNumber({
        prefix,
        companyId,
        companyCode,
        documentType,
        entityType: "invoice",
        entityId,
      });
    } else {
      documentNumber = inv.invoiceNumber;
    }

    const docTitle = documentType === "invoice" ? "INVOICE" : documentType === "lampiran" ? "LAMPIRAN INVOICE" : "BERITA ACARA PEMBAYARAN";
    const subtotal = Number(inv.totalAmount);
    const grand = Number(inv.grandTotal);
    // Core tax calculation (DPP Nilai Lain is display-only):
    //   DPP          = grandTotal / 1.11
    //   DPP Nilai Lain = DPP × (11/12)  ← display only, tidak masuk total
    //   PPN          = DPP × 11%
    //   TOTAL        = DPP + PPN
    const dppCorp = grand > 0 ? Math.round(grand / 1.11) : 0;
    const dppNilaiLainCorp = dppCorp > 0 ? Math.round(dppCorp * 11 / 12) : 0;
    const ppnCorp = dppCorp > 0 ? Math.round(dppCorp * 0.11) : Number(inv.ppnAmount);
    const grandAligned = dppCorp > 0 ? dppCorp + ppnCorp : grand;

    const itemsTable = buildInvoiceTableHtml(items);

    const corpTaxRows = dppCorp > 0 ? `
          <tr><td style="padding:4px 16px;">Subtotal</td><td style="text-align:right;font-weight:600;">${formatIDR(subtotal)}</td></tr>
          <tr><td style="padding:4px 16px;">DPP</td><td style="text-align:right;font-weight:600;">${formatIDR(dppCorp)}</td></tr>
          <tr><td style="padding:4px 16px;color:#6b7280;font-size:12px;">DPP Nilai Lain <span style="font-weight:400;">(11/12 × DPP)</span></td><td style="text-align:right;color:#6b7280;font-size:12px;">${formatIDR(dppNilaiLainCorp)}</td></tr>
          <tr><td style="padding:4px 16px;">PPN 11%</td><td style="text-align:right;font-weight:600;">${formatIDR(ppnCorp)}</td></tr>` : `
          <tr><td style="padding:4px 16px;">Subtotal</td><td style="text-align:right;font-weight:600;">${formatIDR(subtotal)}</td></tr>`;

    bodyContent = `
      ${kopHtml}
      <div style="margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h2 style="font-size:18px;font-weight:900;text-transform:uppercase;color:#1f2937;">${docTitle}</h2>
          <div style="font-size:13px;color:#6b7280;">Nomor: <strong>${documentNumber}</strong></div>
          <div style="font-size:13px;color:#6b7280;">Periode: <strong>${inv.periodMonth}</strong></div>
          <div style="font-size:13px;color:#6b7280;">Tanggal: <strong>${formatDate(inv.createdAt?.toString())}</strong></div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;font-weight:700;">Kepada Yth.</div>
          <div style="font-size:14px;font-weight:900;">${company?.companyName || company?.name || "-"}</div>
          ${company?.picName ? `<div style="font-size:12px;color:#6b7280;">u/p ${company.picName}</div>` : ""}
          ${company?.billingAddress ? `<div style="font-size:12px;color:#6b7280;">${company.billingAddress}</div>` : ""}
        </div>
      </div>
      ${itemsTable}
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <table style="font-size:13px;min-width:320px;">
          ${corpTaxRows}
          <tr style="background:#ea580c;color:#fff;">
            <td style="padding:8px 16px;font-weight:700;">GRAND TOTAL</td>
            <td style="padding:8px 16px;text-align:right;font-weight:900;font-size:15px;">${formatIDR(grandAligned)}</td>
          </tr>
        </table>
      </div>
      ${inv.notes ? `<div style="margin-top:16px;padding:12px;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;font-size:12px;"><strong>Catatan:</strong> ${inv.notes}</div>` : ""}
      <div style="margin-top:24px;padding:16px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;font-size:13px;">
        <div style="font-weight:700;margin-bottom:8px;">Pembayaran ditransfer ke:</div>
        <div>Bank: <strong>${bankName}</strong></div>
        <div>No. Rekening: <strong>${bankAccount}</strong></div>
        <div>Atas Nama: <strong>${bankAccountName}</strong></div>
      </div>
      ${footerHtml}`;
  } else {
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, entityId)).limit(1);
    if (!booking) throw new Error("Booking tidak ditemukan");
    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    const prefix = tpl?.numberFormatPrefix || DOC_PREFIX_MAP[documentType];
    const companyCode = "SC";

    if (issueDocumentNumber) {
      documentNumber = await generateDocumentNumber({
        prefix,
        companyId,
        companyCode,
        documentType,
        entityType: "booking",
        entityId,
      });
    } else {
      documentNumber = booking.orderNumber;
    }

    const docTitleMap: Record<string, string> = {
      spp: "SURAT PERINTAH PEMBAYARAN (SPP)",
      faktur: "FAKTUR PEMBAYARAN",
      kwitansi: "KWITANSI PEMBAYARAN",
    };
    const docTitle = docTitleMap[documentType] || documentType.toUpperCase();
    const total = Number(booking.totalPrice ?? 0);
    const grand = Number(booking.grandTotal ?? total);
    // Core tax calculation (DPP Nilai Lain is display-only):
    //   DPP          = grandTotal / 1.11
    //   DPP Nilai Lain = DPP × (11/12)  ← display only, tidak masuk total
    //   PPN          = DPP × 11%
    //   TOTAL        = DPP + PPN
    const hasPpn = Number(booking.ppnAmount ?? 0) > 0 || Number(booking.ppnRate ?? 0) > 0;
    const dppBook = hasPpn ? Math.round(grand / 1.11) : 0;
    const dppNilaiLainBook = dppBook > 0 ? Math.round(dppBook * 11 / 12) : 0;
    const ppnBook = dppBook > 0 ? Math.round(dppBook * 0.11) : 0;
    const grandAlignedBook = dppBook > 0 ? dppBook + ppnBook : grand;

    bodyContent = `
      ${kopHtml}
      <div style="margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h2 style="font-size:18px;font-weight:900;text-transform:uppercase;color:#1f2937;">${docTitle}</h2>
          <div style="font-size:13px;color:#6b7280;">Nomor: <strong>${documentNumber}</strong></div>
          <div style="font-size:13px;color:#6b7280;">Tanggal: <strong>${formatDate(booking.bookingDate)}</strong></div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;font-weight:700;">Kepada Yth.</div>
          <div style="font-size:14px;font-weight:900;">${booking.customerName || "-"}</div>
          ${booking.customerPhone ? `<div style="font-size:12px;color:#6b7280;">${booking.customerPhone}</div>` : ""}
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
        <thead>
          <tr style="background:#ea580c;color:#fff;">
            <th style="padding:10px;text-align:left;">Keterangan</th>
            <th style="padding:10px;text-align:left;">Detail</th>
            <th style="padding:10px;text-align:right;">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">Sewa ${facility?.name || "Fasilitas"}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${booking.bookingDate} | ${booking.startTime} – ${booking.endTime} (${booking.durationHours} jam)</td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatIDR(total)}</td>
          </tr>
          ${dppBook > 0 ? `
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">DPP</td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;"></td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatIDR(dppBook)}</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;">DPP Nilai Lain <span style="font-weight:400;">(11/12 × DPP)</span></td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;"></td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;font-size:12px;">${formatIDR(dppNilaiLainBook)}</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">PPN 11%</td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;"></td>
            <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatIDR(ppnBook)}</td>
          </tr>` : ""}
          <tr style="background:#ea580c;color:#fff;">
            <td style="padding:8px 10px;font-weight:700;">TOTAL</td>
            <td style="padding:8px 10px;"></td>
            <td style="padding:8px 10px;text-align:right;font-weight:900;font-size:15px;">${formatIDR(grandAlignedBook)}</td>
          </tr>
        </tbody>
      </table>
      ${documentType !== "kwitansi" ? `
      <div style="margin-top:16px;padding:16px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;font-size:13px;">
        <div style="font-weight:700;margin-bottom:8px;">Transfer pembayaran ke:</div>
        <div>Bank: <strong>${bankName}</strong></div>
        <div>No. Rekening: <strong>${bankAccount}</strong></div>
        <div>Atas Nama: <strong>${bankAccountName}</strong></div>
      </div>` : `
      <div style="margin-top:16px;padding:16px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;font-size:13px;">
        <div style="font-weight:700;margin-bottom:4px;">✅ Telah diterima pembayaran sebesar <strong>${formatIDR(grand)}</strong></div>
        <div>Untuk sewa <strong>${facility?.name || "fasilitas"}</strong> pada tanggal <strong>${formatDate(booking.bookingDate)}</strong></div>
        <div>Pukul <strong>${booking.startTime} – ${booking.endTime}</strong></div>
      </div>`}
      ${footerHtml}`;
  }


  const fileTpl = await getActiveFileTemplate(documentType, companyId);
  const html = wrapInHtmlPage(bodyContent, tpl?.paperStyle || "A4", printMode, fileTpl?.fileUrl ?? null);

  return { html, templateId: tpl?.id ?? null, documentNumber, tplVars, fileTemplateUrl: fileTpl?.fileUrl ?? null };

  // Background template override (image/pdf as page background)
  let bgTemplateUrl: string | null | undefined = undefined;
  let bgTemplateType: string | null | undefined = undefined;
  try {
    const bgSettings = await getDocSettingsForType(documentType);
    bgTemplateUrl = bgSettings?.bgTemplateUrl;
    bgTemplateType = bgSettings?.bgTemplateType;
  } catch { /* fallback to no bg */ }

  const html = wrapInHtmlPage(bodyContent, tpl?.paperStyle || "A4", printMode, bgTemplateUrl, bgTemplateType);

  return { html, templateId: tpl?.id ?? null, documentNumber };

}

/**
 * Returns a WhatsApp-formatted plain text representation of the document,
 * using company-specific template branding (companyDisplayName, financeName,
 * financeTitle) merged with entity data. Returns null if entity not found.
 */
export async function renderDocumentText(params: {
  documentType: DocumentType;
  entityId: number;
  companyId?: number | null;
}): Promise<string | null> {
  const { documentType, entityId, companyId = null } = params;

  try {
    const tpl = await getTemplate(documentType, companyId);
    const settings = await getSettings();
    const centerName = settings?.centerName || "Sport Center Bandara Soekarno Hatta";

    const companyDisplayName = tpl?.companyDisplayName || centerName;
    const financeName = tpl?.financeName || "";
    const financeTitle = tpl?.financeTitle || "Finance Manager";

    if (documentType === "invoice" || documentType === "lampiran" || documentType === "berita_acara") {
      const [inv] = await db.select().from(companyInvoicesTable).where(eq(companyInvoicesTable.id, entityId)).limit(1);
      if (!inv) return null;
      const [company] = await db.select().from(usersTable).where(eq(usersTable.id, inv.companyCustomerId)).limit(1);
      const total = Number(inv.grandTotal || inv.totalAmount || 0);

      return [
        `📄 *INVOICE PEMBAYARAN*`,
        `Nomor: ${inv.invoiceNumber || "-"}`,
        `Periode: ${inv.periodMonth || "-"}`,
        ``,
        `Kepada Yth.`,
        `*${company?.companyName || company?.name || "-"}*`,
        ``,
        `Total Tagihan: *${formatIDR(total)}*`,
        ``,
        `Diterbitkan oleh: ${companyDisplayName}`,
        financeName ? `${financeTitle}: ${financeName}` : "",
      ].filter(Boolean).join("\n");
    } else {
      const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, entityId)).limit(1);
      if (!booking) return null;
      const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
      const grand = Number(booking.grandTotal ?? booking.totalPrice ?? 0);

      const docTitleMap: Record<string, string> = {
        spp: "SURAT PERINTAH PEMBAYARAN (SPP)",
        faktur: "FAKTUR PEMBAYARAN",
        kwitansi: "KWITANSI PEMBAYARAN",
      };
      const docTitle = docTitleMap[documentType] || documentType.toUpperCase();

      return [
        `📄 *${docTitle}*`,
        ``,
        `Kepada: *${booking.customerName || "-"}*`,
        `Fasilitas: ${facility?.name || "-"}`,
        `Tanggal: ${formatDate(booking.bookingDate)}`,
        `Waktu: ${booking.startTime} – ${booking.endTime}`,
        ``,
        `Total: *${formatIDR(grand)}*`,
        documentType === "kwitansi" ? `✅ Pembayaran telah dikonfirmasi` : "",
        ``,
        `Diterbitkan oleh: ${companyDisplayName}`,
        financeName ? `${financeTitle}: ${financeName}` : "",
      ].filter(Boolean).join("\n");
    }
  } catch {
    return null;
  }
}
