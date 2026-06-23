// ─── Invoice Template: invoice_template_sport_center_v1 ──────────────────────
//
// HTML-based invoice template for Sport Center Soekarno-Hatta.
// Supports: Preview (HTML), Print-to-PDF, WhatsApp, Email.
//
// Template ID: invoice_template_sport_center_v1

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  status: string;

  customerName: string;
  customerPhone: string;
  customerEmail: string;

  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;

  pricePerHour: number;
  dpp: number;
  dppNilaiLain: number;
  ppnRate: number;
  ppnAmount: number;
  grandTotal: number;

  promoCode?: string | null;
  discountAmount?: number;

  centerName: string;
  centerAddress: string;
  centerPhone: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;

  // Dynamic invoice settings
  logoUrl?: string | null;
  kopSuratHtml?: string | null;
  financeName?: string | null;
  financeTitle?: string | null;
  signatureUrl?: string | null;
  footerText?: string | null;
  invoicePrefix?: string | null;
}

// ─── Terbilang Converter (Indonesian number to words) ────────────────────────

const SATUAN = [
  "", "satu", "dua", "tiga", "empat", "lima",
  "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas",
];

function terbilangKecil(n: number): string {
  if (n < 12) return SATUAN[n] ?? "";
  if (n < 20) return (SATUAN[n - 10] ?? "") + " belas";
  if (n < 100) {
    const t = Math.floor(n / 10);
    const s = n % 10;
    return (SATUAN[t] ?? "") + " puluh" + (s ? " " + (SATUAN[s] ?? "") : "");
  }
  if (n < 200) return "seratus" + (n > 100 ? " " + terbilangKecil(n - 100) : "");
  if (n < 1000) {
    const r = Math.floor(n / 100);
    const s = n % 100;
    return (SATUAN[r] ?? "") + " ratus" + (s ? " " + terbilangKecil(s) : "");
  }
  if (n < 2000) return "seribu" + (n > 1000 ? " " + terbilangKecil(n - 1000) : "");
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000);
    const s = n % 1000;
    return terbilangKecil(k) + " ribu" + (s ? " " + terbilangKecil(s) : "");
  }
  if (n < 1_000_000_000) {
    const m = Math.floor(n / 1_000_000);
    const s = n % 1_000_000;
    return terbilangKecil(m) + " juta" + (s ? " " + terbilangKecil(s) : "");
  }
  const b = Math.floor(n / 1_000_000_000);
  const s = n % 1_000_000_000;
  return terbilangKecil(b) + " miliar" + (s ? " " + terbilangKecil(s) : "");
}

export function terbilang(n: number): string {
  const rounded = Math.round(n);
  if (rounded === 0) return "Nol Rupiah";
  const words = terbilangKecil(rounded).trim();
  return words.charAt(0).toUpperCase() + words.slice(1) + " Rupiah";
}

// ─── Currency formatter ───────────────────────────────────────────────────────

function rp(n: number): string {
  return new Intl.NumberFormat("id-ID").format(n);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function statusBadge(status: string): string {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    confirmed:    { label: "CONFIRMED",    bg: "#dcfce7", color: "#15803d" },
    completed:    { label: "SELESAI",      bg: "#dcfce7", color: "#15803d" },
    pending_payment: { label: "MENUNGGU PEMBAYARAN", bg: "#fef9c3", color: "#a16207" },
    waiting_confirmation: { label: "VERIFIKASI",   bg: "#dbeafe", color: "#1d4ed8" },
    paid:         { label: "LUNAS",        bg: "#dcfce7", color: "#15803d" },
    cancelled:    { label: "DIBATALKAN",   bg: "#fee2e2", color: "#b91c1c" },
    refunded:     { label: "REFUND",       bg: "#e0e7ff", color: "#4338ca" },
    expired:      { label: "KADALUARSA",   bg: "#f1f5f9", color: "#64748b" },
  };
  const s = map[status] ?? { label: status.toUpperCase(), bg: "#f1f5f9", color: "#64748b" };
  return `<span style="background:${s.bg};color:${s.color};padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.5px;">${s.label}</span>`;
}

// ─── Format tanggal Indonesia ─────────────────────────────────────────────────

function formatTanggal(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── Main HTML builder ────────────────────────────────────────────────────────

export interface BuildOptions {
  autoPrint?: boolean;
  templateVersion?: string;
}

export function buildInvoiceHtml(data: InvoiceData, opts: BuildOptions = {}): string {
  const {
    autoPrint = false,
    templateVersion = "invoice_template_sport_center_v1",
  } = opts;

  const terbilangStr = terbilang(data.grandTotal);
  const hasDiscount = (data.discountAmount ?? 0) > 0;
  const bookingDateFmt = formatTanggal(data.bookingDate);
  const invoiceDateFmt = formatTanggal(data.invoiceDate);

  const priceRows = `
    <tr>
      <td style="padding:10px 12px;font-size:13px;">1</td>
      <td style="padding:10px 12px;font-size:13px;font-weight:600;">${data.facilityName}</td>
      <td style="padding:10px 12px;font-size:13px;">${bookingDateFmt}</td>
      <td style="padding:10px 12px;font-size:13px;">${data.startTime} – ${data.endTime}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;">${data.durationHours} jam</td>
      <td style="padding:10px 12px;font-size:13px;text-align:right;">Rp ${rp(data.grandTotal)}</td>
    </tr>
    ${hasDiscount ? `
    <tr style="background:#fff7ed;">
      <td></td>
      <td colspan="4" style="padding:6px 12px;font-size:12px;color:#92400e;">Diskon${data.promoCode ? ` (${data.promoCode})` : ""}</td>
      <td style="padding:6px 12px;font-size:12px;text-align:right;color:#92400e;">-Rp ${rp(data.discountAmount ?? 0)}</td>
    </tr>` : ""}
  `;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Invoice ${data.invoiceNumber}</title>
  <style>
    @page { margin: 10mm 14mm; size: A4; }
    @media print {
      body { margin: 0 !important; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, 'Segoe UI', sans-serif;
      color: #111827;
      margin: 0;
      padding: 16px 24px;
      font-size: 12px;
      background: #fff;
    }

    /* ── Header ── */
    .sc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 10px;
      border-bottom: 3px solid #ea580c;
      margin-bottom: 12px;
    }
    .sc-brand-name {
      font-size: 19px;
      font-weight: 900;
      color: #ea580c;
      letter-spacing: -0.5px;
      margin: 0;
    }
    .sc-brand-sub {
      font-size: 11px;
      font-weight: 700;
      color: #111827;
      margin: 1px 0 2px;
    }
    .sc-brand-addr {
      font-size: 10px;
      color: #374151;
      margin: 0;
      max-width: 260px;
      line-height: 1.4;
    }
    .sc-invoice-label {
      text-align: right;
    }
    .sc-invoice-title {
      font-size: 24px;
      font-weight: 900;
      color: #ea580c;
      letter-spacing: 4px;
      text-transform: uppercase;
    }
    .sc-template-id {
      font-size: 9px;
      color: #d1d5db;
      margin-top: 2px;
    }

    /* ── Info Row ── */
    .sc-info-row {
      display: flex;
      gap: 14px;
      margin-bottom: 12px;
    }
    .sc-info-box {
      flex: 1;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 8px 12px;
    }
    .sc-info-box h4 {
      margin: 0 0 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
    }
    .sc-info-table td {
      padding: 2px 0;
      font-size: 11px;
      vertical-align: top;
    }
    .sc-info-table td:first-child {
      color: #374151;
      width: 110px;
      font-size: 11px;
    }
    .sc-info-table td:nth-child(2) {
      color: #374151;
      width: 8px;
    }
    .sc-info-table td:last-child {
      font-weight: 600;
      color: #111827;
    }
    .sc-notice {
      font-size: 9.5px;
      color: #4b5563;
      font-style: italic;
      margin-top: 5px;
      padding-top: 5px;
      border-top: 1px dashed #e5e7eb;
    }

    /* ── Detail Table ── */
    .sc-section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #374151;
      margin: 0 0 5px;
    }
    .sc-detail-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
    }
    .sc-detail-table thead th {
      background: #ea580c;
      color: #fff;
      padding: 6px 10px;
      font-size: 10.5px;
      font-weight: 700;
      text-align: left;
    }
    .sc-detail-table thead th:last-child {
      text-align: right;
    }
    .sc-detail-table thead th:nth-child(4),
    .sc-detail-table thead th:nth-child(5) {
      text-align: center;
    }
    .sc-detail-table tbody tr {
      border-bottom: 1px solid #f3f4f6;
    }
    .sc-detail-table tbody tr:last-child {
      border-bottom: 2px solid #e5e7eb;
    }

    /* ── Total Section ── */
    .sc-total-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 10px;
    }
    .sc-total-table {
      border-collapse: collapse;
      min-width: 300px;
    }
    .sc-total-table td {
      padding: 5px 12px;
      font-size: 12px;
    }
    .sc-total-table tr.subtotal td {
      background: #f9fafb;
      color: #374151;
    }
    .sc-total-table tr.subtotal td:last-child {
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    .sc-total-table tr.ppn td {
      background: #fff7ed;
      color: #92400e;
    }
    .sc-total-table tr.ppn td:last-child {
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    .sc-total-table tr.grand td {
      background: #ea580c;
      color: #fff;
      font-weight: 900;
      font-size: 14px;
    }
    .sc-total-table tr.grand td:last-child {
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    .sc-terbilang {
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 11px;
      color: #92400e;
      margin-bottom: 10px;
    }
    .sc-terbilang strong { font-weight: 700; }

    /* ── Payment Info ── */
    .sc-bottom-row {
      display: flex;
      gap: 14px;
      margin-bottom: 12px;
    }
    .sc-payment-box {
      flex: 1;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 6px;
      padding: 8px 12px;
    }
    .sc-payment-box h4 {
      margin: 0 0 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #0369a1;
      border-bottom: 1px solid #bae6fd;
      padding-bottom: 4px;
    }
    .sc-notes-box {
      flex: 1;
      background: #fafafa;
      border: 1px dashed #d1d5db;
      border-radius: 6px;
      padding: 8px 12px;
    }
    .sc-notes-box h4 {
      margin: 0 0 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
    }

    /* ── Footer ── */
    .sc-footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 10px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .sc-footer-left {
      font-size: 10px;
      color: #4b5563;
    }
    .sc-signature {
      text-align: center;
      font-size: 11px;
    }
    .sc-signature-line {
      border-bottom: 1px solid #374151;
      width: 140px;
      margin: 0 auto 5px;
    }
    .sc-signature-name {
      font-weight: 700;
      font-size: 11px;
    }
    .sc-signature-role {
      font-size: 10px;
      color: #374151;
    }
  </style>
  ${autoPrint ? `<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 500); }</script>` : ""}
</head>
<body>

  <!-- ═══════════════════════════════════════════════════════════════
       A. HEADER
  ═══════════════════════════════════════════════════════════════ -->
  ${data.kopSuratHtml
    ? `<div class="sc-header-custom">${data.kopSuratHtml
        .replace(/\{\{companyName\}\}/g, data.centerName)
        .replace(/\{\{centerName\}\}/g, data.centerName)
        .replace(/\{\{address\}\}/g, data.centerAddress)
        .replace(/\{\{phone\}\}/g, data.centerPhone)
        .replace(/\{\{logoUrl\}\}/g, data.logoUrl ?? "")
        .replace(/\{\{financeName\}\}/g, data.financeName ?? "")
        .replace(/\{\{financeTitle\}\}/g, data.financeTitle ?? "Finance Manager")
      }</div>`
    : `<div class="sc-header">
    <div style="display:flex;align-items:center;gap:12px;">
      ${data.logoUrl ? `<img src="${data.logoUrl}" alt="Logo" style="height:56px;width:auto;object-fit:contain;" />` : ""}
      <div>
        <div class="sc-brand-name">${data.centerName}</div>
        ${data.centerAddress ? `<div class="sc-brand-addr">${data.centerAddress}</div>` : ""}
        ${data.centerPhone ? `<div class="sc-brand-addr" style="margin-top:3px;">Telp: ${data.centerPhone}</div>` : ""}
      </div>
    </div>
    <div class="sc-invoice-label">
      <div class="sc-invoice-title">INVOICE</div>
      <div class="sc-template-id">Template: ${templateVersion}</div>
    </div>
  </div>`
  }

  <!-- ═══════════════════════════════════════════════════════════════
       B. INVOICE INFO + C. CUSTOMER INFO
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-info-row">

    <!-- B. Invoice Info -->
    <div class="sc-info-box">
      <h4>Informasi Invoice</h4>
      <table class="sc-info-table">
        <tr>
          <td>No Invoice</td>
          <td>:</td>
          <td style="font-family:'Courier New',monospace;font-size:13px;color:#ea580c;">${data.invoiceNumber}</td>
        </tr>
        <tr>
          <td>Tanggal Invoice</td>
          <td>:</td>
          <td>${invoiceDateFmt}</td>
        </tr>
        <tr>
          <td>No Pesanan</td>
          <td>:</td>
          <td style="font-family:'Courier New',monospace;">${data.orderNumber}</td>
        </tr>
      </table>
      <div class="sc-notice">
        &#9432; Dokumen ini dibuat secara otomatis oleh sistem Sport Center
      </div>
    </div>

    <!-- C. Customer Info -->
    <div class="sc-info-box">
      <h4>Informasi Pelanggan</h4>
      <table class="sc-info-table">
        <tr>
          <td>Nama</td>
          <td>:</td>
          <td>${data.customerName}</td>
        </tr>
        <tr>
          <td>No HP</td>
          <td>:</td>
          <td>${data.customerPhone}</td>
        </tr>
        <tr>
          <td>Email</td>
          <td>:</td>
          <td>${data.customerEmail}</td>
        </tr>
        <tr>
          <td>Status</td>
          <td>:</td>
          <td>${statusBadge(data.status)}</td>
        </tr>
      </table>
    </div>

  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       D. DETAIL PEMESANAN TABLE
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-section-title">Detail Pemesanan</div>
  <table class="sc-detail-table">
    <thead>
      <tr>
        <th style="width:36px;">No</th>
        <th>Fasilitas</th>
        <th>Tanggal</th>
        <th style="text-align:center;">Jam</th>
        <th style="text-align:center;">Durasi</th>
        <th style="text-align:right;">Harga (Inc. PPN)</th>
      </tr>
    </thead>
    <tbody>
      ${priceRows}
    </tbody>
  </table>

  <!-- ═══════════════════════════════════════════════════════════════
       E. TOTAL SECTION
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-total-wrap">
    <table class="sc-total-table">
      ${data.ppnAmount > 0 ? `
      <tr class="subtotal">
        <td>DPP</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">Rp ${rp(data.dpp)}</td>
      </tr>
      <tr class="subtotal">
        <td style="color:#6b7280;font-size:12px;">DPP Nilai Lain</td>
        <td style="text-align:right;font-family:'Courier New',monospace;color:#6b7280;font-size:12px;">Rp ${rp(data.dppNilaiLain)}</td>
      </tr>
      <tr class="ppn">
        <td>PPN 12%</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">Rp ${rp(data.ppnAmount)}</td>
      </tr>` : ""}
      <tr class="grand">
        <td>TOTAL</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">Rp ${rp(data.grandTotal)}</td>
      </tr>
    </table>
  </div>
  ${data.dppNilaiLain > 0 ? `
  <div style="text-align:right;margin-top:-14px;margin-bottom:16px;">
    <span style="font-size:10px;color:#9ca3af;font-style:italic;">
      Perhitungan pajak menggunakan DPP Nilai Lain sesuai konfigurasi sistem.
    </span>
  </div>` : ""}

  <div class="sc-terbilang">
    <strong>Terbilang:</strong> ${terbilangStr}
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       F. PAYMENT INFO
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-bottom-row">
    <div class="sc-payment-box">
      <h4>Informasi Pembayaran</h4>
      <div style="font-size:12px;color:#111827;line-height:1.9;">
        <div style="font-weight:700;color:#0369a1;">${data.bankAccountName || data.centerName}</div>
        ${data.bankName ? `<div>${data.bankName}</div>` : ""}
        ${data.bankAccount ? `<div style="font-family:'Courier New',monospace;font-weight:700;font-size:13px;">No. Rek: ${data.bankAccount}</div>` : ""}
      </div>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       FOOTER / SIGNATURE
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-footer">
    <div class="sc-footer-left">
      ${data.footerText
        ? `<div>${data.footerText}</div>`
        : `<div>Invoice dicetak: ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</div>
      <div style="margin-top:4px;">Dokumen ini sah tanpa tanda tangan basah</div>`
      }
      <div style="margin-top:2px;font-size:10px;color:#d1d5db;">${templateVersion}</div>
    </div>
    <div class="sc-signature">
      <div style="font-size:12px;color:#374151;margin-bottom:4px;">Hormat kami,</div>
      ${data.signatureUrl
        ? `<img src="${data.signatureUrl}" alt="Tanda Tangan" style="height:72px;width:auto;object-fit:contain;margin:4px 0;" />`
        : `<div style="height:80px;"></div>`
      }
      <div class="sc-signature-line"></div>
      <div class="sc-signature-name">${data.financeName || data.centerName}</div>
      ${data.financeTitle ? `<div class="sc-signature-role">${data.financeTitle}</div>` : ""}
    </div>
  </div>

</body>
</html>`;
}
