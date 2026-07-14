// ─── Invoice Template: invoice_template_sport_center_v1 ──────────────────────
//
// HTML-based invoice template for Sport Center Soekarno-Hatta.
// Supports: Preview (HTML), Print-to-PDF, WhatsApp, Email.
//
// Template ID: invoice_template_sport_center_v1

export interface InvoiceSession {
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  basePrice: number;       // harga asli sebelum diskon
  grandTotal: number;      // harga final setelah diskon+pajak
  discountAmount?: number;
  status: string;
}

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

  // Group invoice support
  groupRef?: string | null;
  sessions?: InvoiceSession[];

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

  // Dokumentasi kegiatan (corporate booking)
  documentation?: Array<{ fileUrl: string; fileName: string | null; caption: string | null }>;
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

  // Gunakan sessions[] jika ada (grup), fallback ke single booking
  const isGroup = data.sessions && data.sessions.length > 0;
  const priceRows = isGroup
    ? data.sessions!.map((s, i) => {
        const hasSessionDiscount = (s.discountAmount ?? 0) > 0;
        // Tampilkan harga asli di kolom, diskon di baris bawah, final di total bawah
        const displayPrice = hasSessionDiscount ? s.basePrice : s.grandTotal;
        return `
          <tr>
            <td style="padding:10px 12px;font-size:13px;">${i + 1}</td>
            <td style="padding:10px 12px;font-size:13px;font-weight:600;">${s.facilityName}</td>
            <td style="padding:10px 12px;font-size:13px;">${formatTanggal(s.bookingDate)}</td>
            <td style="padding:10px 12px;font-size:13px;">${s.startTime} – ${s.endTime}</td>
            <td style="padding:10px 12px;font-size:13px;text-align:center;">${s.durationHours} jam</td>
            <td style="padding:10px 12px;font-size:13px;text-align:right;">Rp ${rp(displayPrice)}</td>
          </tr>
          ${hasSessionDiscount ? `
          <tr style="background:#fff7ed;">
            <td></td>
            <td colspan="4" style="padding:4px 12px;font-size:11.5px;color:#92400e;">Diskon AP2${data.promoCode ? ` (${data.promoCode})` : ""}</td>
            <td style="padding:4px 12px;font-size:11.5px;text-align:right;color:#92400e;">-Rp ${rp(s.discountAmount ?? 0)}</td>
          </tr>
          <tr style="background:#f0fdf4;">
            <td></td>
            <td colspan="4" style="padding:4px 12px;font-size:11.5px;color:#15803d;font-weight:600;">Harga Setelah Diskon</td>
            <td style="padding:4px 12px;font-size:11.5px;text-align:right;color:#15803d;font-weight:700;">Rp ${rp(s.grandTotal)}</td>
          </tr>` : ""}
        `;
      }).join("")
    : `
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
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  <style>
    @page { margin: 10mm 14mm; size: A4; }
    @media print {
      body { margin: 0 !important; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', Arial, 'Segoe UI', sans-serif;
      color: #111827;
      margin: 0;
      padding: 32px 24px 16px;
      font-size: 12px;
      line-height: 1.5;
      background: #fff;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Header ── */
    .sc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 12px;
      border-bottom: 3px solid #ea580c;
      margin-bottom: 14px;
    }
    .sc-brand-name {
      font-size: 20px;
      font-weight: 800;
      color: #ea580c;
      letter-spacing: -0.3px;
      margin: 0 0 2px;
      line-height: 1.2;
    }
    .sc-brand-sub {
      font-size: 11px;
      font-weight: 600;
      color: #111827;
      margin: 2px 0 2px;
      letter-spacing: 0.1px;
    }
    .sc-brand-addr {
      font-size: 10.5px;
      color: #374151;
      margin: 0;
      max-width: 280px;
      line-height: 1.55;
      font-weight: 400;
    }
    .sc-invoice-label {
      text-align: right;
    }
    .sc-invoice-title {
      font-size: 26px;
      font-weight: 800;
      color: #ea580c;
      letter-spacing: 5px;
      text-transform: uppercase;
      line-height: 1;
    }
    .sc-template-id {
      font-size: 9px;
      color: #d1d5db;
      margin-top: 4px;
      letter-spacing: 0.3px;
    }

    /* ── Info Row ── */
    .sc-info-row {
      display: flex;
      gap: 14px;
      margin-bottom: 14px;
    }
    .sc-info-box {
      flex: 1;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .sc-info-box h4 {
      margin: 0 0 8px;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 5px;
    }
    .sc-info-table td {
      padding: 3px 0;
      font-size: 11.5px;
      vertical-align: top;
      line-height: 1.45;
    }
    .sc-info-table td:first-child {
      color: #4b5563;
      width: 115px;
      font-weight: 400;
    }
    .sc-info-table td:nth-child(2) {
      color: #4b5563;
      width: 10px;
      padding: 3px 4px;
    }
    .sc-info-table td:last-child {
      font-weight: 600;
      color: #111827;
    }
    .sc-notice {
      font-size: 9.5px;
      color: #4b5563;
      font-style: italic;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #e5e7eb;
      line-height: 1.4;
    }

    /* ── Detail Table ── */
    .sc-section-title {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #374151;
      margin: 0 0 6px;
    }
    .sc-detail-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    .sc-detail-table thead th {
      background: #ea580c;
      color: #fff;
      padding: 8px 12px;
      font-size: 10.5px;
      font-weight: 600;
      text-align: left;
      letter-spacing: 0.2px;
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
      margin-bottom: 12px;
    }
    .sc-total-table {
      border-collapse: collapse;
      min-width: 300px;
    }
    .sc-total-table td {
      padding: 6px 14px;
      font-size: 12px;
      line-height: 1.4;
    }
    .sc-total-table tr.subtotal td {
      background: #f9fafb;
      color: #374151;
      font-weight: 400;
    }
    .sc-total-table tr.subtotal td:last-child {
      text-align: right;
      font-weight: 600;
    }
    .sc-total-table tr.ppn td {
      background: #fff7ed;
      color: #92400e;
    }
    .sc-total-table tr.ppn td:last-child {
      text-align: right;
      font-weight: 600;
    }
    .sc-total-table tr.grand td {
      background: #ea580c;
      color: #fff;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 0.2px;
    }
    .sc-total-table tr.grand td:last-child {
      text-align: right;
    }
    .sc-terbilang {
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 11.5px;
      color: #92400e;
      margin-bottom: 12px;
      line-height: 1.5;
    }
    .sc-terbilang strong { font-weight: 700; }

    /* ── Payment Info ── */
    .sc-bottom-row {
      display: flex;
      gap: 14px;
      margin-bottom: 14px;
    }
    .sc-payment-box {
      flex: 1;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .sc-payment-box h4 {
      margin: 0 0 8px;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #0369a1;
      border-bottom: 1px solid #bae6fd;
      padding-bottom: 5px;
    }
    .sc-notes-box {
      flex: 1;
      background: #fafafa;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .sc-notes-box h4 {
      margin: 0 0 8px;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 5px;
    }

    /* ── Footer ── */
    .sc-footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .sc-footer-left {
      font-size: 10.5px;
      color: #4b5563;
      line-height: 1.6;
    }
    .sc-signature {
      text-align: center;
      font-size: 11px;
    }
    .sc-signature-line {
      border-bottom: 1px solid #374151;
      width: 140px;
      margin: 0 auto 6px;
    }
    .sc-signature-name {
      font-weight: 700;
      font-size: 11.5px;
      color: #111827;
    }
    .sc-signature-role {
      font-size: 10.5px;
      color: #374151;
      font-weight: 400;
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
      ${data.logoUrl ? `<img src="${data.logoUrl}" alt="Logo" style="height:80px;width:auto;object-fit:contain;" />` : ""}
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
          <td style="font-size:13px;font-weight:700;color:#ea580c;letter-spacing:0.3px;">${data.invoiceNumber}</td>
        </tr>
        <tr>
          <td>Tanggal Invoice</td>
          <td>:</td>
          <td>${invoiceDateFmt}</td>
        </tr>
        <tr>
          <td>No Pesanan</td>
          <td>:</td>
          <td style="font-weight:600;letter-spacing:0.2px;">${data.orderNumber}</td>
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
        <td style="text-align:right;">Rp ${rp(data.dpp)}</td>
      </tr>
      <tr class="subtotal">
        <td style="color:#4b5563;font-size:11.5px;">DPP Nilai Lain</td>
        <td style="text-align:right;color:#4b5563;font-size:11.5px;">Rp ${rp(data.dppNilaiLain)}</td>
      </tr>
      <tr class="ppn">
        <td>PPN ${data.ppnRate ? data.ppnRate + '%' : '12%'}</td>
        <td style="text-align:right;">Rp ${rp(data.ppnAmount)}</td>
      </tr>` : ""}
      <tr class="grand">
        <td>TOTAL</td>
        <td style="text-align:right;">Rp ${rp(data.grandTotal)}</td>
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
       E2. DOKUMENTASI KEGIATAN (corporate booking)
  ═══════════════════════════════════════════════════════════════ -->
  ${(data.documentation && data.documentation.length > 0) ? `
  <div class="sc-section-title" style="margin-top:24px;">Dokumentasi Kegiatan</div>
  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;">
    <thead>
      <tr style="background:#f8fafc;">
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;">No</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;">Nama File</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;">Keterangan</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:600;">Link</th>
      </tr>
    </thead>
    <tbody>
      ${data.documentation.map((doc, i) => `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:6px 10px;color:#374151;">${i + 1}</td>
        <td style="padding:6px 10px;color:#374151;">${doc.fileName ?? "—"}</td>
        <td style="padding:6px 10px;color:#374151;">${doc.caption ?? "—"}</td>
        <td style="padding:6px 10px;">
          <a href="${doc.fileUrl}" style="color:#0369a1;text-decoration:underline;font-size:11px;" target="_blank">Buka File ↗</a>
        </td>
      </tr>`).join("")}
    </tbody>
  </table>
  ` : ""}

  <!-- ═══════════════════════════════════════════════════════════════
       F. PAYMENT INFO
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-bottom-row">
    <div class="sc-payment-box">
      <h4>Informasi Pembayaran</h4>
      <div style="font-size:12px;color:#111827;line-height:1.9;">
        <div style="font-weight:700;color:#0369a1;">${data.bankAccountName || data.centerName}</div>
        ${data.bankName ? `<div>${data.bankName}</div>` : ""}
        ${data.bankAccount ? `<div style="font-weight:700;font-size:13px;letter-spacing:0.3px;">No. Rek: ${data.bankAccount}</div>` : ""}
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
