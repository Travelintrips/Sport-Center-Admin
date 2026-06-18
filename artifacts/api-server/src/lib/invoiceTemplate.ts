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
    @page { margin: 16mm 18mm; size: A4; }
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
      padding: 28px 36px;
      font-size: 13px;
      background: #fff;
    }

    /* ── Header ── */
    .sc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 18px;
      border-bottom: 3px solid #ea580c;
      margin-bottom: 22px;
    }
    .sc-brand-name {
      font-size: 22px;
      font-weight: 900;
      color: #ea580c;
      letter-spacing: -0.5px;
      margin: 0;
    }
    .sc-brand-sub {
      font-size: 13px;
      font-weight: 700;
      color: #374151;
      margin: 2px 0 4px;
    }
    .sc-brand-addr {
      font-size: 11px;
      color: #6b7280;
      margin: 0;
      max-width: 260px;
    }
    .sc-invoice-label {
      text-align: right;
    }
    .sc-invoice-title {
      font-size: 28px;
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
      gap: 24px;
      margin-bottom: 22px;
    }
    .sc-info-box {
      flex: 1;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px 16px;
    }
    .sc-info-box h4 {
      margin: 0 0 10px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
    }
    .sc-info-table td {
      padding: 3px 0;
      font-size: 12px;
      vertical-align: top;
    }
    .sc-info-table td:first-child {
      color: #6b7280;
      width: 115px;
      font-size: 11.5px;
    }
    .sc-info-table td:nth-child(2) {
      color: #6b7280;
      width: 8px;
    }
    .sc-info-table td:last-child {
      font-weight: 600;
      color: #111827;
    }
    .sc-notice {
      font-size: 10.5px;
      color: #9ca3af;
      font-style: italic;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #e5e7eb;
    }

    /* ── Detail Table ── */
    .sc-section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #6b7280;
      margin: 0 0 8px;
    }
    .sc-detail-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .sc-detail-table thead th {
      background: #ea580c;
      color: #fff;
      padding: 9px 12px;
      font-size: 11.5px;
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
      margin-bottom: 20px;
    }
    .sc-total-table {
      border-collapse: collapse;
      min-width: 320px;
    }
    .sc-total-table td {
      padding: 7px 14px;
      font-size: 13px;
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
      font-size: 15px;
    }
    .sc-total-table tr.grand td:last-child {
      text-align: right;
      font-family: 'Courier New', monospace;
    }
    .sc-terbilang {
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 12px;
      color: #92400e;
      margin-bottom: 20px;
    }
    .sc-terbilang strong { font-weight: 700; }

    /* ── Payment Info ── */
    .sc-bottom-row {
      display: flex;
      gap: 20px;
      margin-bottom: 28px;
    }
    .sc-payment-box {
      flex: 1;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      padding: 14px 16px;
    }
    .sc-payment-box h4 {
      margin: 0 0 10px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #0369a1;
      border-bottom: 1px solid #bae6fd;
      padding-bottom: 6px;
    }
    .sc-notes-box {
      flex: 1;
      background: #fafafa;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
      padding: 14px 16px;
    }
    .sc-notes-box h4 {
      margin: 0 0 10px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
    }

    /* ── Footer ── */
    .sc-footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .sc-footer-left {
      font-size: 11px;
      color: #9ca3af;
    }
    .sc-signature {
      text-align: center;
      font-size: 12px;
    }
    .sc-signature-line {
      border-bottom: 1px solid #374151;
      width: 140px;
      margin: 40px auto 6px;
    }
    .sc-signature-name {
      font-weight: 700;
      font-size: 12px;
    }
    .sc-signature-role {
      font-size: 11px;
      color: #6b7280;
    }
  </style>
  ${autoPrint ? `<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 500); }</script>` : ""}
</head>
<body>

  <!-- ═══════════════════════════════════════════════════════════════
       A. HEADER
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-header">
    <div>
      <div class="sc-brand-name">SPORT CENTER</div>
      <div class="sc-brand-sub">Bandara Soekarno-Hatta</div>
      <div class="sc-brand-addr">${data.centerAddress || "Kawasan Bandara Soekarno-Hatta, Tangerang 19110"}</div>
      ${data.centerPhone ? `<div class="sc-brand-addr" style="margin-top:3px;">Telp: ${data.centerPhone}</div>` : ""}
    </div>
    <div class="sc-invoice-label">
      <div class="sc-invoice-title">INVOICE</div>
      <div class="sc-template-id">Template: ${templateVersion}</div>
    </div>
  </div>

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
        <th style="text-align:right;">Harga</th>
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
      <tr class="subtotal">
        <td>DPP</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">Rp ${rp(data.dpp)}</td>
      </tr>
      <tr class="ppn">
        <td>PPN ${data.ppnRate}%</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">Rp ${rp(data.ppnAmount)}</td>
      </tr>
      <tr class="grand">
        <td>TOTAL</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">Rp ${rp(data.grandTotal)}</td>
      </tr>
    </table>
  </div>

  <div class="sc-terbilang">
    <strong>Terbilang:</strong> ${terbilangStr}
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       F. PAYMENT INFO
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-bottom-row">
    <div class="sc-payment-box">
      <h4>Informasi Pembayaran</h4>
      <table class="sc-info-table">
        <tr>
          <td>Bank</td>
          <td>:</td>
          <td style="font-weight:700;color:#0369a1;">${data.bankName || "Bank Mandiri"}</td>
        </tr>
        <tr>
          <td>No Rekening</td>
          <td>:</td>
          <td style="font-family:'Courier New',monospace;font-weight:700;">${data.bankAccount || "-"}</td>
        </tr>
        <tr>
          <td>Atas Nama</td>
          <td>:</td>
          <td>${data.bankAccountName || "Sport Center Soekarno-Hatta"}</td>
        </tr>
      </table>
    </div>

    <div class="sc-notes-box">
      <h4>Petunjuk Pembayaran</h4>
      <div style="font-size:12px;color:#374151;line-height:1.7;">
        <div>1. Transfer sesuai jumlah total invoice</div>
        <div>2. Cantumkan No Pesanan sebagai referensi</div>
        <div>3. Kirim bukti transfer via WhatsApp</div>
        <div style="margin-top:8px;font-size:11px;color:#9ca3af;">
          Pembayaran berlaku <strong>setelah dikonfirmasi</strong> oleh tim Finance
        </div>
      </div>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       FOOTER / SIGNATURE
  ═══════════════════════════════════════════════════════════════ -->
  <div class="sc-footer">
    <div class="sc-footer-left">
      <div>Invoice dicetak: ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</div>
      <div style="margin-top:4px;">Dokumen ini sah tanpa tanda tangan basah</div>
      <div style="margin-top:2px;font-size:10px;color:#d1d5db;">${templateVersion}</div>
    </div>
    <div class="sc-signature">
      <div style="font-size:12px;color:#374151;margin-bottom:4px;">Hormat kami,</div>
      <div class="sc-signature-line"></div>
      <div class="sc-signature-name">${data.centerName || "Sport Center Soekarno-Hatta"}</div>
      <div class="sc-signature-role">Tim Finance</div>
    </div>
  </div>

</body>
</html>`;
}
