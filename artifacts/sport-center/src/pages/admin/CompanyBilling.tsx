import { useState, useRef } from "react";
import {
  useListCompanyInvoices, useGenerateCompanyInvoice, useUpdateCompanyInvoice,
  useListCustomers,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2, Plus, CheckCircle, FileText, AlertCircle, RefreshCw, Eye,
  User, Phone, Mail, MapPin, Download, MessageSquare, AlertTriangle,
  Package, Settings, CheckSquare, XSquare, Send, Upload, ImageIcon, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { getListCompanyInvoicesQueryKey } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";

const BILLING_DOC_TYPES = [
  { key: "invoice", label: "Invoice" },
  { key: "faktur_pajak", label: "Faktur Pajak" },
  { key: "kwitansi", label: "Kwitansi" },
  { key: "spp", label: "SPP (Surat Permohonan Pembayaran)" },
  { key: "lampiran_pemakaian", label: "Lampiran Pemakaian" },
  { key: "dokumentasi", label: "Dokumentasi" },
  { key: "berita_acara", label: "Berita Acara" },
  { key: "surat_pengantar", label: "Surat Pengantar" },
  { key: "materai", label: "Materai" },
  { key: "custom_document", label: "Dokumen Kustom" },
] as const;

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function getMonthOptions() {
  const opts = [];
  const now = new Date();
  const year = now.getFullYear();
  // Bulan depan s/d akhir tahun (belum lewat)
  for (let m = 11; m > now.getMonth(); m--) {
    const d = new Date(year, m, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("id-ID", { year: "numeric", month: "long" });
    opts.push({ value, label });
  }
  // Bulan saat ini s/d Januari (sudah lewat / sekarang)
  for (let m = now.getMonth(); m >= 0; m--) {
    const d = new Date(year, m, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("id-ID", { year: "numeric", month: "long" });
    opts.push({ value, label });
  }
  return opts;
}

function getCurrentPeriodMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(periodMonth: string) {
  const [year, month] = periodMonth.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("id-ID", { year: "numeric", month: "long" });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid")
    return <Badge className="bg-green-100 text-green-700 border-green-200 gap-1"><CheckCircle size={10} /> Lunas</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 gap-1"><AlertCircle size={10} /> Belum Lunas</Badge>;
}

async function auditBillingAction(invoiceId: number, action: string, documents?: string[]) {
  const token = getToken();
  try {
    await fetch(`/api/company-invoices/${invoiceId}/audit-billing-action`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, documents }),
    });
  } catch { /* non-fatal */ }
}

// ─── Tax helpers ─────────────────────────────────────────────────────────────
// totalAmountInclusive = harga jual sudah termasuk PPN (yang customer bayar)
// DPP              = totalAmountInclusive / 1.11
// DPP Nilai Lain   = DPP × (11/12)
// PPN 12%          = DPP Nilai Lain × 0.12   (= DPP × 11%)
// Grand Total      = DPP + PPN ≈ totalAmountInclusive
function taxBreakdown(totalAmountInclusive: number) {
  const dpp = Math.round(totalAmountInclusive / 1.11);
  const dppNilaiLain = Math.round(dpp * 11 / 12);
  const ppn = Math.round(dppNilaiLain * 0.12);
  const grandTotal = dpp + ppn;
  return { dpp, dppNilaiLain, ppn, grandTotal };
}

// ─── PDF Print Helpers ────────────────────────────────────────────────────────

function printInvoicePdf(invoice: any, signatureUrl?: string | null, financeName?: string | null, financeTitle?: string | null) {
  const items: any[] = invoice.items ?? [];
  const periodStr = periodLabel(invoice.periodMonth);
  const today = new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" });

  // Sum-of-rows agar konsisten dengan tabel (hindari rounding drift)
  const rowDpp   = (i: any) => Math.round(Number(i.subtotal ?? 0) / 1.11);
  const rowDppNL = (i: any) => Math.round(rowDpp(i) * 11 / 12);
  const rowPpn   = (i: any) => Math.round(rowDppNL(i) * 0.12);
  const dpp         = items.reduce((s: number, i: any) => s + rowDpp(i), 0);
  const dppNilaiLain = items.reduce((s: number, i: any) => s + rowDppNL(i), 0);
  const ppn         = items.reduce((s: number, i: any) => s + rowPpn(i), 0);
  const grandTotal  = invoice.totalAmount ?? 0; // selalu = sum subtotal, bukan dpp+ppn

  const rows = items.map((item: any, i: number) => `
    <tr style="border-bottom:1px solid #e5e7eb; ${i % 2 === 1 ? "background:#f9fafb;" : ""}">
      <td style="padding:6px 7px; font-size:11px;">${i + 1}</td>
      <td style="padding:6px 7px; font-size:11px;">${item.customerName ?? "-"}</td>
      <td style="padding:6px 7px; font-size:11px;">${item.customerPhone ?? "-"}</td>
      <td style="padding:6px 7px; font-size:11px;">${item.facilityName ?? "-"}</td>
      <td style="padding:6px 7px; font-size:11px;">${item.bookingDate ?? "-"}</td>
      <td style="padding:6px 7px; font-size:11px;">${item.startTime ?? "-"}–${item.endTime ?? "-"}</td>
      <td style="padding:6px 7px; font-size:11px; text-align:center;">${item.durationHours ?? 0} jam</td>
      <td style="padding:6px 7px; font-size:11px; text-align:right;">${formatCurrency(Math.round((item.subtotal ?? 0) / 1.11))}</td>
      <td style="padding:6px 7px; font-size:11px; text-align:right; color:#6b7280;">${formatCurrency(Math.round(Math.round(Math.round((item.subtotal ?? 0) / 1.11) * 11 / 12) * 0.12))}</td>
      <td style="padding:6px 7px; font-size:11px; text-align:right; font-weight:600;">${formatCurrency(item.subtotal ?? 0)}</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"/>
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    @media print { body { margin: 0; } }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 28px 32px; color: #111; font-size:12px; }
    h1 { margin:0; font-size:20px; color:#ea580c; font-weight:900; }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th { background:#ea580c; color:#fff; padding:7px 7px; font-size:11px; text-align:left; }
    .total-row td { font-weight:600; background:#fff7ed; }
    .tax-row td { font-size:11px; color:#374151; }
    .grand-row td { font-weight:900; font-size:13px; background:#ea580c; color:#fff; }
    .info-box { background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:12px; }
    .flex { display:flex; justify-content:space-between; align-items:flex-start; }
    .badge-unpaid { background:#fef9c3; color:#a16207; padding:3px 10px; border-radius:99px; font-size:11px; font-weight:700; }
    .badge-paid { background:#dcfce7; color:#15803d; padding:3px 10px; border-radius:99px; font-size:11px; font-weight:700; }
    .section-title { font-size:11px; color:#9ca3af; font-weight:700; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }
    .payment-box { border:1px solid #e5e7eb; border-radius:6px; padding:12px 14px; background:#f0fdf4; margin-top:14px; }
  </style></head><body>

  <!-- HEADER -->
  <div class="flex" style="margin-bottom:14px;">
    <div>
      <h1>Sport Center Soekarno-Hatta</h1>
      <div style="color:#6b7280;font-size:11px;margin-top:3px;">Kawasan Bandara Soekarno-Hatta, Tangerang</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:20px;font-weight:900;color:#ea580c;">${invoice.invoiceNumber}</div>
      <div style="font-size:11px;color:#6b7280;">Tanggal Terbit: ${today}</div>
      <div class="${invoice.status === "paid" ? "badge-paid" : "badge-unpaid"}" style="margin-top:5px;display:inline-block;">${invoice.status === "paid" ? "✓ LUNAS" : "BELUM LUNAS"}</div>
    </div>
  </div>
  <hr style="margin:0 0 14px;border:none;border-top:2px solid #ea580c;"/>

  <!-- TAGIHAN KEPADA + PERIODE -->
  <div class="flex" style="gap:16px;margin-bottom:14px;">
    <div class="info-box" style="flex:1;">
      <div class="section-title">Tagihan Kepada</div>
      <div style="font-weight:700;font-size:13px;">${invoice.companyName}</div>
      ${invoice.picName ? `<div style="font-size:11px;color:#374151;margin-top:3px;">PIC: ${invoice.picName}</div>` : ""}
      ${invoice.picPhone ? `<div style="font-size:11px;color:#374151;">Telp: ${invoice.picPhone}</div>` : ""}
      ${invoice.picEmail ? `<div style="font-size:11px;color:#374151;">Email: ${invoice.picEmail}</div>` : ""}
      ${invoice.billingAddress ? `<div style="font-size:11px;color:#374151;margin-top:2px;">${invoice.billingAddress}</div>` : ""}
    </div>
    <div class="info-box" style="flex:1;">
      <div class="section-title">Periode Tagihan</div>
      <div style="font-weight:700;font-size:13px;">${periodStr}</div>
      <div style="font-size:11px;color:#374151;margin-top:4px;">Jumlah Sesi: <strong>${items.length} sesi</strong></div>
      <div style="font-size:11px;color:#374151;">Tgl Cetak: ${today}</div>
    </div>
  </div>

  <!-- DETAIL PEMAKAIAN -->
  <div style="font-weight:700;font-size:12px;margin-bottom:6px;">Detail Pemakaian Fasilitas</div>
  <table><thead><tr>
    <th style="width:24px;">No.</th>
    <th>Customer</th><th>No. WA</th><th>Fasilitas</th><th>Tanggal</th><th>Jam</th>
    <th style="text-align:center;">Durasi</th>
    <th style="text-align:right;">DPP</th>
    <th style="text-align:right;">PPN 12%</th>
    <th style="text-align:right;">Total</th>
  </tr></thead><tbody>
    ${rows || `<tr><td colspan="10" style="text-align:center;padding:16px;color:#9ca3af;">Tidak ada data pemakaian</td></tr>`}
  </tbody><tfoot>
    <tr class="total-row">
      <td colspan="7" style="padding:8px 7px;font-size:12px;border-top:2px solid #ea580c;">Total</td>
      <td style="padding:8px 7px;text-align:right;font-size:12px;border-top:2px solid #ea580c;">${formatCurrency(items.reduce((s: number, i: any) => s + Math.round(Number(i.subtotal ?? 0) / 1.11), 0))}</td>
      <td style="padding:8px 7px;text-align:right;font-size:12px;border-top:2px solid #ea580c;color:#6b7280;">${formatCurrency(items.reduce((s: number, i: any) => s + Math.round(Math.round(Math.round(Number(i.subtotal ?? 0) / 1.11) * 11 / 12) * 0.12), 0))}</td>
      <td style="padding:8px 7px;text-align:right;font-size:12px;border-top:2px solid #ea580c;">${formatCurrency(items.reduce((s: number, i: any) => s + Number(i.subtotal ?? 0), 0))}</td>
    </tr>
  </tfoot></table>

  <!-- TAX SUMMARY BOX -->
  <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
    <table style="margin:0;">
      <colgroup><col style="width:60%"/><col style="width:40%"/></colgroup>
      <tbody>
        <tr class="tax-row"><td style="padding:7px 12px;">Subtotal Pemakaian</td><td style="padding:7px 12px;text-align:right;font-weight:600;">${formatCurrency(invoice.totalAmount ?? 0)}</td></tr>
        <tr class="tax-row" style="background:#f9fafb;"><td style="padding:7px 12px;">DPP</td><td style="padding:7px 12px;text-align:right;font-weight:600;">${formatCurrency(dpp)}</td></tr>
        <tr class="tax-row"><td style="padding:7px 12px;">DPP Nilai Lain</td><td style="padding:7px 12px;text-align:right;font-weight:600;">${formatCurrency(dppNilaiLain)}</td></tr>
        <tr class="tax-row" style="background:#f9fafb;"><td style="padding:7px 12px;">PPN 12%</td><td style="padding:7px 12px;text-align:right;font-weight:600;">${formatCurrency(ppn)}</td></tr>
        <tr class="grand-row"><td style="padding:10px 12px;font-size:13px;">GRAND TOTAL</td><td style="padding:10px 12px;text-align:right;font-size:15px;font-weight:900;">${formatCurrency(grandTotal)}</td></tr>
      </tbody>
    </table>
  </div>

  <!-- INFORMASI PEMBAYARAN -->
  <div class="payment-box">
    <div class="section-title" style="margin-bottom:6px;">Informasi Pembayaran</div>
    <div style="font-size:12px;line-height:1.8;">
      Harap melakukan pembayaran melalui transfer bank ke:<br/>
      <strong>PT CAHAYA SEJATI TEKNOLOGI</strong><br/>
      Bank Mandiri · No. Rekening: <strong>1640006707220</strong><br/>
      Dengan mencantumkan No. Invoice <strong>${invoice.invoiceNumber}</strong> sebagai keterangan transfer.
    </div>
  </div>

  ${invoice.notes ? `<div style="margin-top:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:11px;"><strong>Catatan:</strong> ${invoice.notes}</div>` : ""}
  ${invoice.paidAt ? `<div style="margin-top:10px;color:#15803d;font-size:11px;">✓ Dibayar pada ${new Date(invoice.paidAt).toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" })}</div>` : ""}

  <!-- TANDA TANGAN -->
  <div style="margin-top:28px;display:flex;justify-content:flex-end;">
    <div style="text-align:center;min-width:200px;">
      <div style="font-size:12px;color:#374151;margin-bottom:4px;">Hormat kami,</div>
      ${signatureUrl
        ? `<img src="${signatureUrl}" alt="Tanda Tangan" style="height:72px;width:auto;object-fit:contain;margin:4px 0;" />`
        : `<div style="height:80px;"></div>`
      }
      <div style="border-bottom:1px solid #374151;width:140px;margin:0 auto 6px;"></div>
      <div style="font-weight:700;font-size:11.5px;color:#111827;">${financeName || "Admin Sport Center"}</div>
      <div style="font-size:10.5px;color:#374151;">${financeTitle || "Sport Center Soekarno-Hatta"}</div>
    </div>
  </div>

  <hr style="margin:20px 0 10px;border:none;border-top:1px solid #e5e7eb;"/>
  <div style="font-size:9px;color:#9ca3af;text-align:center;">Dokumen ini diterbitkan secara otomatis oleh sistem Sport Center Soekarno-Hatta · ${invoice.invoiceNumber} · ${today}</div>
  <script>window.onload=function(){window.print();};</script>
</body></html>`;
  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

function printLampiranPemakaian(invoice: any) {
  const items: any[] = invoice.items ?? [];
  const periodStr = periodLabel(invoice.periodMonth);
  const rows = items.map((item: any, i: number) => `
    <tr style="${i % 2 === 1 ? "background:#f9fafb;" : ""}">
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;">${i + 1}</td>
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;">${item.customerName ?? "-"}</td>
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;">${item.facilityName ?? "-"}</td>
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;">${item.bookingDate ?? "-"}</td>
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;">${item.startTime ?? "-"}–${item.endTime ?? "-"}</td>
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;text-align:center;">${item.durationHours ?? 0} jam</td>
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;text-align:right;">${formatCurrency(Math.round(Number(item.subtotal ?? 0) / 1.11))}</td>
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;text-align:right;color:#6b7280;">${formatCurrency(Math.round(Math.round(Math.round(Number(item.subtotal ?? 0) / 1.11) * 11 / 12) * 0.12))}</td>
      <td style="padding:6px 8px;font-size:12px;border:1px solid #e5e7eb;text-align:right;font-weight:600;">${formatCurrency(item.subtotal ?? 0)}</td>
    </tr>
  `).join("");
  const totalDurasi = items.reduce((s, i) => s + Number(i.durationHours ?? 0), 0);
  const totalHarga = items.reduce((s, i) => s + Number(i.subtotal ?? 0), 0);

  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"/>
  <title>Lampiran Pemakaian – ${invoice.invoiceNumber}</title>
  <style>
    @media print { body { margin: 0; } }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 32px; color: #111; font-size:13px; }
    h2 { color:#ea580c; margin:0 0 4px; }
    table { width:100%; border-collapse:collapse; margin-top:16px; }
    th { background:#ea580c; color:#fff; padding:7px 8px; font-size:12px; text-align:left; border:1px solid #c2410c; }
    .total-row td { font-weight:700; background:#fff7ed; border-top:2px solid #ea580c; border:1px solid #e5e7eb; }
    .header-row { display:flex; justify-content:space-between; margin-bottom:16px; }
    .info-block { background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:10px 14px; }
  </style></head><body>
  <h2>LAMPIRAN PEMAKAIAN FASILITAS</h2>
  <div style="color:#6b7280;font-size:12px;margin-bottom:16px;">Sport Center Soekarno-Hatta · Kawasan Bandara Soekarno-Hatta, Tangerang</div>
  <div class="header-row">
    <div class="info-block">
      <div style="font-size:11px;color:#9ca3af;font-weight:700;text-transform:uppercase;margin-bottom:6px;">Perusahaan</div>
      <div style="font-weight:700;">${invoice.companyName}</div>
      ${invoice.picName ? `<div style="color:#374151;font-size:12px;">PIC: ${invoice.picName}</div>` : ""}
    </div>
    <div class="info-block">
      <div style="font-size:11px;color:#9ca3af;font-weight:700;text-transform:uppercase;margin-bottom:6px;">Referensi</div>
      <div style="font-weight:700;color:#ea580c;">${invoice.invoiceNumber}</div>
      <div style="color:#374151;font-size:12px;">Periode: ${periodStr}</div>
      <div style="color:#374151;font-size:12px;">Tanggal cetak: ${new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" })}</div>
    </div>
  </div>
  <table><thead><tr>
    <th style="width:32px;">No.</th>
    <th>Nama Customer</th>
    <th>Fasilitas</th>
    <th>Tanggal</th>
    <th>Jam</th>
    <th style="text-align:center;">Durasi</th>
    <th style="text-align:right;">DPP</th>
    <th style="text-align:right;">PPN 12%</th>
    <th style="text-align:right;">Total</th>
  </tr></thead><tbody>
    ${rows || `<tr><td colspan="9" style="text-align:center;padding:16px;color:#9ca3af;border:1px solid #e5e7eb;">Tidak ada data pemakaian</td></tr>`}
  </tbody><tfoot>
    <tr class="total-row">
      <td colspan="5" style="padding:8px;text-align:right;font-size:12px;">Total:</td>
      <td style="padding:8px;text-align:center;font-size:12px;font-weight:700;">${totalDurasi.toFixed(1)} jam</td>
      <td style="padding:8px;text-align:right;font-size:12px;font-weight:700;">${formatCurrency(items.reduce((s: number, i: any) => s + Math.round(Number(i.subtotal ?? 0) / 1.11), 0))}</td>
      <td style="padding:8px;text-align:right;font-size:12px;color:#6b7280;">${formatCurrency(items.reduce((s: number, i: any) => s + Math.round(Math.round(Math.round(Number(i.subtotal ?? 0) / 1.11) * 11 / 12) * 0.12), 0))}</td>
      <td style="padding:8px;text-align:right;font-size:13px;font-weight:900;color:#ea580c;">${formatCurrency(totalHarga)}</td>
    </tr>
  </tfoot></table>
  <div style="margin-top:32px;display:flex;justify-content:flex-end;">
    <div style="text-align:center;width:180px;">
      <div style="font-size:12px;color:#6b7280;">Mengetahui,</div>
      <div style="margin:48px 0 4px;border-bottom:1px solid #111;"></div>
      <div style="font-size:12px;font-weight:600;">Admin Sport Center</div>
    </div>
  </div>
  <script>window.onload=function(){window.print();};</script>
</body></html>`;
  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

function printKwitansi(invoice: any) {
  const periodStr = periodLabel(invoice.periodMonth);
  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"/>
  <title>Kwitansi – ${invoice.invoiceNumber}</title>
  <style>
    @media print { body { margin: 0; } }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 48px; color: #111; }
    .kwitansi-box { border:2px solid #111; padding:32px; max-width:540px; margin:0 auto; }
    h2 { text-align:center; letter-spacing:4px; font-size:20px; margin:0 0 20px; border-bottom:2px solid #111; padding-bottom:12px; }
    .row { display:flex; margin-bottom:14px; }
    .label { width:180px; font-size:13px; color:#6b7280; flex-shrink:0; }
    .value { font-size:13px; font-weight:600; border-bottom:1px dotted #9ca3af; flex:1; padding-bottom:2px; }
    .amount-box { text-align:center; margin:24px 0; padding:16px; background:#fff7ed; border:2px solid #ea580c; border-radius:8px; }
    .amount-box .num { font-size:28px; font-weight:900; color:#ea580c; }
    .footer { margin-top:40px; display:flex; justify-content:flex-end; }
    .sign-box { text-align:center; width:160px; }
  </style></head><body>
  <div class="kwitansi-box">
    <div style="text-align:center;margin-bottom:8px;font-size:13px;color:#6b7280;">Sport Center Soekarno-Hatta</div>
    <h2>K W I T A N S I</h2>
    <div class="row">
      <div class="label">No. Kwitansi</div>
      <div class="value">${invoice.invoiceNumber.replace("INV-", "KWT-")}</div>
    </div>
    <div class="row">
      <div class="label">Sudah Terima Dari</div>
      <div class="value">${invoice.companyName}</div>
    </div>
    <div class="amount-box">
      <div style="font-size:12px;color:#9ca3af;margin-bottom:4px;">JUMLAH</div>
      <div class="num">${formatCurrency(invoice.grandTotal)}</div>
    </div>
    <div class="row">
      <div class="label">Untuk Pembayaran</div>
      <div class="value">Tagihan Sport Center Periode ${periodStr}</div>
    </div>
    <div class="row">
      <div class="label">No. Invoice</div>
      <div class="value">${invoice.invoiceNumber}</div>
    </div>
    <div class="row">
      <div class="label">Tanggal</div>
      <div class="value">${new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" })}</div>
    </div>
    <div class="row">
      <div class="label">Status</div>
      <div class="value">${invoice.status === "paid" ? "✓ LUNAS" : "BELUM LUNAS"}</div>
    </div>
    <div style="margin:18px 0;padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:12px;">
      <div style="font-weight:700;margin-bottom:4px;">Transfer ke:</div>
      <div style="font-weight:700;">PT CAHAYA SEJATI TEKNOLOGI</div>
      <div>Bank Mandiri · No. Rek: <strong>1640006707220</strong></div>
    </div>
    <div class="footer">
      <div class="sign-box">
        <div style="font-size:12px;color:#6b7280;">Hormat kami,</div>
        <div style="border:1px dashed #d1d5db;border-radius:50%;width:56px;height:56px;margin:6px auto;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:7px;color:#9ca3af;text-align:center;line-height:1.3;">Materai<br/>Rp 10.000</span>
        </div>
        <div style="border:2px dashed #ea580c;border-radius:50%;width:72px;height:72px;margin:-18px auto 0;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:6px;color:#ea580c;text-align:center;line-height:1.4;font-weight:700;">STEMPEL<br/>SPORT CENTER</span>
        </div>
        <div style="margin:4px 0 4px;border-bottom:1px solid #111;"></div>
        <div style="font-size:12px;font-weight:600;">Sport Center Soekarno-Hatta</div>
      </div>
    </div>
  </div>
  <script>window.onload=function(){window.print();};</script>
</body></html>`;
  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

function printSpp(invoice: any) {
  const periodStr = periodLabel(invoice.periodMonth);
  const today = new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" });
  const dueDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 10).toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" });
  const sppNo = `SPP-${invoice.invoiceNumber.replace("INV-", "")}`;

  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"/>
  <title>SPP – ${invoice.invoiceNumber}</title>
  <style>
    @media print { body { margin: 0; } }
    body { font-family: 'Times New Roman', serif; margin: 48px; color: #111; font-size:13px; }
    h2 { text-align:center; font-size:16px; font-weight:700; margin:0 0 4px; text-transform:uppercase; letter-spacing:1px; }
    .sub { text-align:center; font-size:13px; color:#555; margin-bottom:24px; }
    .ref-table { width:100%; margin-bottom:20px; }
    .ref-table td { padding:2px 0; vertical-align:top; }
    .ref-table .label { width:140px; }
    .ref-table .colon { width:16px; }
    .body-text { line-height:1.8; margin-bottom:24px; }
    .amount-line { font-weight:700; font-size:15px; }
    table.detail { width:100%; border-collapse:collapse; margin:16px 0; }
    table.detail th { background:#f3f4f6; padding:7px 10px; font-size:12px; border:1px solid #d1d5db; text-align:left; }
    table.detail td { padding:7px 10px; font-size:12px; border:1px solid #d1d5db; }
    .sign-section { margin-top:40px; display:flex; justify-content:flex-end; }
    .sign-box { text-align:center; width:180px; }
  </style></head><body>
  <div style="text-align:center;margin-bottom:4px;font-size:15px;font-weight:700;">SPORT CENTER SOEKARNO-HATTA</div>
  <div style="text-align:center;font-size:12px;color:#555;margin-bottom:20px;">Kawasan Bandara Soekarno-Hatta, Tangerang</div>
  <hr style="border:none;border-top:2px solid #111;margin-bottom:4px;"/>
  <hr style="border:none;border-top:1px solid #111;margin-bottom:20px;"/>
  <h2>Surat Permohonan Pembayaran</h2>
  <div class="sub">Nomor: ${sppNo}</div>

  <table class="ref-table">
    <tr><td class="label">Kepada Yth.</td><td class="colon">:</td><td>${invoice.companyName}${invoice.picName ? ` – ${invoice.picName}` : ""}</td></tr>
    <tr><td class="label">Perihal</td><td class="colon">:</td><td>Permohonan Pembayaran Tagihan Sport Center Periode ${periodStr}</td></tr>
    <tr><td class="label">Tanggal</td><td class="colon">:</td><td>${today}</td></tr>
  </table>

  <div class="body-text">
    <p>Dengan hormat,</p>
    <p>Bersama surat ini kami mengajukan permohonan pembayaran atas pemakaian fasilitas olahraga Sport Center Soekarno-Hatta oleh karyawan <strong>${invoice.companyName}</strong> untuk periode <strong>${periodStr}</strong>, dengan rincian sebagai berikut:</p>
  </div>

  <table class="detail">
    <thead><tr><th>Keterangan</th><th>Detail</th></tr></thead>
    <tbody>
      <tr><td>No. Invoice</td><td><strong>${invoice.invoiceNumber}</strong></td></tr>
      <tr><td>Perusahaan</td><td>${invoice.companyName}</td></tr>
      <tr><td>Periode Tagihan</td><td>${periodStr}</td></tr>
      <tr><td>Jumlah Sesi Pemakaian</td><td>${invoice.items?.length ?? 0} sesi</td></tr>
      <tr><td>Subtotal Pemakaian</td><td>${formatCurrency(invoice.totalAmount)}</td></tr>
      <tr><td>DPP</td><td>${formatCurrency(invoice.dpp ?? Math.round((invoice.totalAmount ?? 0) / 1.11))}</td></tr>
      <tr><td>DPP Nilai Lain</td><td>${formatCurrency(invoice.dppNilaiLain ?? Math.round(Math.round((invoice.totalAmount ?? 0) / 1.11) * 11 / 12))}</td></tr>
      <tr><td>PPN 12%</td><td>${formatCurrency(invoice.ppnAmount)}</td></tr>
      <tr><td style="font-weight:700;background:#fef3c7;">GRAND TOTAL</td><td style="font-weight:700;color:#dc2626;font-size:14px;background:#fef3c7;">${formatCurrency(invoice.grandTotal)}</td></tr>
      <tr><td>Jatuh Tempo</td><td>${dueDate}</td></tr>
    </tbody>
  </table>

  <div class="body-text">
    <p>Kami mohon agar pembayaran dapat dilakukan selambat-lambatnya pada tanggal <strong>${dueDate}</strong> melalui transfer bank ke rekening berikut:</p>
    <table class="detail" style="margin:12px 0;">
      <tbody>
        <tr><td style="width:160px;">Nama Rekening</td><td><strong>PT CAHAYA SEJATI TEKNOLOGI</strong></td></tr>
        <tr><td>Bank</td><td>Bank Mandiri</td></tr>
        <tr><td>No. Rekening</td><td><strong>1640006707220</strong></td></tr>
        <tr><td>Keterangan</td><td><strong>${invoice.invoiceNumber}</strong></td></tr>
      </tbody>
    </table>
    <p>Terlampir bersama surat ini: Invoice, Lampiran Pemakaian, dan dokumen pendukung lainnya.</p>
    <p>Atas perhatian dan kerjasamanya, kami ucapkan terima kasih.</p>
  </div>

  <div class="sign-section">
    <div class="sign-box">
      <div>Hormat kami,</div>
      <div style="border:1px dashed #d1d5db;border-radius:50%;width:56px;height:56px;margin:8px auto;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:7px;color:#9ca3af;text-align:center;line-height:1.3;">Materai<br/>Rp 10.000</span>
      </div>
      <div style="border:2px dashed #ea580c;border-radius:50%;width:72px;height:72px;margin:-20px auto 0;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:6px;color:#ea580c;text-align:center;line-height:1.4;font-weight:700;">STEMPEL<br/>SPORT CENTER</span>
      </div>
      <div style="margin:4px 0 4px;border-bottom:1px solid #111;"></div>
      <div style="font-weight:700;">Admin Sport Center</div>
      <div style="font-size:12px;color:#555;">Sport Center Soekarno-Hatta</div>
    </div>
  </div>
  <script>window.onload=function(){window.print();};</script>
</body></html>`;
  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

function printBeritaAcara(invoice: any) {
  const periodStr = periodLabel(invoice.periodMonth);
  const today = new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" });

  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"/>
  <title>Berita Acara – ${invoice.invoiceNumber}</title>
  <style>
    @media print { body { margin: 0; } }
    body { font-family: 'Times New Roman', serif; margin: 48px; color: #111; font-size:13px; line-height:1.8; }
  </style></head><body>
  <div style="text-align:center;font-weight:700;font-size:15px;margin-bottom:4px;">BERITA ACARA PEMAKAIAN FASILITAS</div>
  <div style="text-align:center;font-size:13px;margin-bottom:20px;">Sport Center Soekarno-Hatta</div>
  <hr style="border:none;border-top:2px solid #111;margin-bottom:20px;"/>
  <p>Nomor: BA-${invoice.invoiceNumber.replace("INV-", "")}</p>
  <p>Pada hari ini, <strong>${today}</strong>, telah dilaksanakan pemakaian fasilitas olahraga Sport Center Soekarno-Hatta oleh:</p>
  <p><strong>Perusahaan:</strong> ${invoice.companyName}</p>
  <p><strong>Periode:</strong> ${periodStr}</p>
  <p><strong>Jumlah Sesi:</strong> ${invoice.items?.length ?? 0} sesi pemakaian</p>
  <p><strong>Total Nilai:</strong> ${formatCurrency(invoice.grandTotal)}</p>
  <p>Seluruh kegiatan pemakaian fasilitas telah berjalan dengan baik sesuai dengan ketentuan yang berlaku. Berita acara ini dibuat sebagai bukti pelaksanaan pemakaian fasilitas untuk keperluan administrasi dan pembayaran.</p>
  <div style="margin-top:48px;display:flex;justify-content:space-between;">
    <div style="text-align:center;width:200px;">
      <div>Pihak Perusahaan,</div>
      <div style="margin:52px 0 4px;border-bottom:1px solid #111;"></div>
      <div style="font-weight:700;">${invoice.picName ?? invoice.companyName}</div>
      <div style="font-size:12px;">${invoice.companyName}</div>
    </div>
    <div style="text-align:center;width:200px;">
      <div>Pihak Sport Center,</div>
      <div style="margin:52px 0 4px;border-bottom:1px solid #111;"></div>
      <div style="font-weight:700;">Admin Sport Center</div>
      <div style="font-size:12px;">Sport Center Soekarno-Hatta</div>
    </div>
  </div>
  <script>window.onload=function(){window.print();};</script>
</body></html>`;
  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

async function downloadBillingPackage(invoice: any, requirements: any[], signatureUrl?: string | null, financeName?: string | null, financeTitle?: string | null) {
  const docTypes = requirements.map((r: any) => r.documentType);
  const delays: Array<{ fn: () => void; delay: number; doc: string }> = [];
  let delay = 0;

  if (docTypes.includes("invoice")) {
    delays.push({ fn: () => printInvoicePdf(invoice, signatureUrl, financeName, financeTitle), delay, doc: "invoice" });
    delay += 800;
  }
  if (docTypes.includes("lampiran_pemakaian")) {
    delays.push({ fn: () => printLampiranPemakaian(invoice), delay, doc: "lampiran_pemakaian" });
    delay += 800;
  }
  if (docTypes.includes("kwitansi")) {
    delays.push({ fn: () => printKwitansi(invoice), delay, doc: "kwitansi" });
    delay += 800;
  }
  if (docTypes.includes("spp")) {
    delays.push({ fn: () => printSpp(invoice), delay, doc: "spp" });
    delay += 800;
  }
  if (docTypes.includes("berita_acara")) {
    delays.push({ fn: () => printBeritaAcara(invoice), delay, doc: "berita_acara" });
    delay += 800;
  }

  for (const item of delays) {
    setTimeout(item.fn, item.delay);
  }
  return delays.map((d) => d.doc);
}

// ─── Billing Documents Tab ────────────────────────────────────────────────────

function BillingDocumentsTab({ companies }: { companies: any[] }) {
  const { toast } = useToast();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [checkedDocs, setCheckedDocs] = useState<Set<string>>(new Set(["invoice"]));

  const { data: reqs, isLoading: reqsLoading, refetch: refetchReqs } = useQuery({
    queryKey: ["billing-requirements", selectedCompanyId],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const token = getToken();
      const res = await fetch(`/api/company-billing-requirements?companyId=${selectedCompanyId}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error("Gagal memuat persyaratan");
      return res.json() as Promise<any[]>;
    },
    enabled: !!selectedCompanyId,
  });

  const saveMutation = useMutation({
    mutationFn: async (documentTypes: string[]) => {
      const token = getToken();
      const res = await fetch(`/api/company-billing-requirements/${selectedCompanyId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ documentTypes }),
      });
      if (!res.ok) throw new Error("Gagal menyimpan");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Persyaratan dokumen berhasil disimpan" });
      refetchReqs();
    },
    onError: () => toast({ title: "Gagal menyimpan persyaratan", variant: "destructive" }),
  });

  const handleCompanyChange = (v: string) => {
    setSelectedCompanyId(v);
    setCheckedDocs(new Set(["invoice"]));
  };

  const handleRequirementsLoaded = () => {
    if (reqs && reqs.length > 0) {
      setCheckedDocs(new Set(reqs.map((r: any) => r.documentType)));
    } else if (reqs && reqs.length === 0) {
      setCheckedDocs(new Set(["invoice"]));
    }
  };

  if (reqs !== undefined && !reqsLoading) {
    const existing = new Set(reqs.map((r: any) => r.documentType));
    const currentSet = checkedDocs;
    // Sync loaded reqs to checkedDocs if not yet synced
    if (reqs.length > 0 && [...existing].some((d) => !currentSet.has(d))) {
      void handleRequirementsLoaded();
    }
  }

  const toggleDoc = (key: string) => {
    setCheckedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = () => {
    saveMutation.mutate([...checkedDocs]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Select value={selectedCompanyId} onValueChange={handleCompanyChange}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Pilih perusahaan..." />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.companyName ?? c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedCompanyId && (
          <Button onClick={handleSave} disabled={saveMutation.isPending} size="sm" className="gap-1.5">
            <CheckCircle size={13} />
            {saveMutation.isPending ? "Menyimpan..." : "Simpan Persyaratan"}
          </Button>
        )}
      </div>

      {!selectedCompanyId && (
        <div className="text-center py-16 text-muted-foreground">
          <Settings size={32} className="mx-auto mb-3 opacity-30" />
          <div className="font-semibold">Pilih perusahaan</div>
          <div className="text-sm">untuk mengatur dokumen tagihan yang diperlukan</div>
        </div>
      )}

      {selectedCompanyId && (
        <div className="space-y-4">
          <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Dokumen yang diperlukan untuk paket tagihan:
          </div>
          {reqsLoading ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {BILLING_DOC_TYPES.map((doc) => (
                <label
                  key={doc.key}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    checkedDocs.has(doc.key)
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted/40"
                  }`}
                >
                  <Checkbox
                    checked={checkedDocs.has(doc.key)}
                    onCheckedChange={() => toggleDoc(doc.key)}
                  />
                  <div>
                    <div className="font-medium text-sm">{doc.label}</div>
                    <div className="text-xs text-muted-foreground">{doc.key}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {!reqsLoading && reqs && reqs.length > 0 && (
            <div className="text-xs text-muted-foreground bg-muted/40 rounded p-3">
              Tersimpan: {reqs.map((r: any) => r.label).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Generate Invoice Dialog ──────────────────────────────────────────────────

function GenerateInvoiceDialog({
  onClose,
  initialCompanyId,
}: {
  onClose: () => void;
  initialCompanyId?: number | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState(initialCompanyId ? String(initialCompanyId) : "");
  const [periodMonth, setPeriodMonth] = useState(getCurrentPeriodMonth());
  const [notes, setNotes] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const generateMutation = useGenerateCompanyInvoice();
  const { data: companies } = useListCustomers({ accountType: "company" });

  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ["invoice-preview", companyId, periodMonth],
    queryFn: async () => {
      if (!companyId) return null;
      const token = getToken();
      const res = await fetch(
        `/api/company-invoices/preview?companyCustomerId=${companyId}&periodMonth=${periodMonth}`,
        { headers: { Authorization: `Bearer ${token ?? ""}` } }
      );
      if (!res.ok) throw new Error("Gagal memuat preview");
      return res.json();
    },
    enabled: !!companyId,
  });

  const subtotal = preview?.subtotal ?? 0;
  const ppnAmount = preview?.ppnAmount ?? 0;
  const grandTotal = preview?.grandTotal ?? subtotal;
  const existingInvoice = preview?.existingInvoice;

  const handleGenerate = async () => {
    if (!companyId) { toast({ title: "Pilih perusahaan", variant: "destructive" }); return; }
    if (!existingInvoice && (preview?.bookingCount ?? 0) === 0) {
      toast({ title: "Tidak ada booking untuk ditagihkan pada periode ini", variant: "destructive" });
      return;
    }
    try {
      const result = await generateMutation.mutateAsync({
        data: { companyCustomerId: parseInt(companyId), periodMonth, notes: notes || undefined },
      });
      const msg = (result as any)?.message;
      toast({ title: msg ?? "Invoice berhasil dibuat" });
      qc.invalidateQueries({ queryKey: getListCompanyInvoicesQueryKey() });
      onClose();
    } catch (e: any) {
      const errMsg = e?.message ?? "Gagal membuat invoice";
      toast({ title: errMsg, variant: "destructive" });
    }
  };

  const monthOptions = getMonthOptions();
  const canGenerate = !!companyId && (
    existingInvoice
      ? existingInvoice.status !== "paid" && (preview?.bookingCount ?? 0) > 0
      : (preview?.bookingCount ?? 0) > 0
  );

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Generate Invoice Bulanan</DialogTitle></DialogHeader>
      <div className="space-y-4 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <Label>Perusahaan *</Label>
            <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setShowPreview(false); }}>
              <SelectTrigger><SelectValue placeholder="Pilih perusahaan..." /></SelectTrigger>
              <SelectContent>
                {companies?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {(c as any).companyName ?? c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Periode Bulan *</Label>
            <Select value={periodMonth} onValueChange={setPeriodMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {companyId && !previewLoading && existingInvoice && (
          <div className={`rounded-lg border p-3 flex items-start gap-2.5 text-sm ${
            existingInvoice.status === "paid"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}>
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div>
              {existingInvoice.status === "paid"
                ? <><strong>Invoice sudah ada dan lunas:</strong> {existingInvoice.invoiceNumber}. Tidak dapat menambahkan booking baru.</>
                : <><strong>Invoice sudah ada:</strong> {existingInvoice.invoiceNumber} (Belum Lunas). {(preview?.bookingCount ?? 0) > 0 ? `${preview?.bookingCount} booking baru akan ditambahkan ke invoice ini.` : "Tidak ada booking baru."}</>
              }
            </div>
          </div>
        )}

        {companyId && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-sm font-semibold transition-colors"
            >
              <span className="flex items-center gap-2">
                <Eye size={13} className="text-primary" />
                Preview Booking Belum Ditagih
                {previewLoading && <span className="text-xs text-muted-foreground">(memuat...)</span>}
                {preview && !previewLoading && (
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs px-1.5 py-0">
                    {preview.bookingCount} booking
                  </Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{showPreview ? "▲" : "▼"}</span>
            </button>
            {showPreview && preview && (
              <div className="p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {preview.bookings?.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">Tidak ada booking unbilled pada periode ini</p>
                )}
                {preview.bookings?.map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between text-xs p-1.5 bg-slate-50 dark:bg-slate-800 rounded">
                    <div>
                      <div className="font-medium">{b.facilityName}</div>
                      <div className="text-muted-foreground">{b.bookingDate} · {b.startTime}–{b.endTime} · {b.durationHours}jam · {b.customerName}</div>
                    </div>
                    <span className="font-semibold shrink-0 ml-2">{formatCurrency(b.totalPrice)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {companyId && preview && (preview.bookingCount ?? 0) > 0 && (() => {
          // Sum-of-rows agar konsisten dengan tabel (hindari rounding drift)
          const pvRows: any[] = preview?.bookings ?? [];
          const rowDpp   = (b: any) => Math.round((b.totalPrice ?? 0) / 1.11);
          const rowDppNL = (b: any) => Math.round(rowDpp(b) * 11 / 12);
          const rowPpn   = (b: any) => Math.round(rowDppNL(b) * 0.12);
          const pvDpp         = pvRows.length > 0 ? pvRows.reduce((s, b) => s + rowDpp(b), 0) : (preview?.dpp ?? Math.round(subtotal / 1.11));
          const pvDppNilaiLain = pvRows.length > 0 ? pvRows.reduce((s, b) => s + rowDppNL(b), 0) : (preview?.dppNilaiLain ?? Math.round(pvDpp * 11 / 12));
          const pvPpn          = pvRows.length > 0 ? pvRows.reduce((s, b) => s + rowPpn(b), 0) : (preview?.ppnAmount ?? Math.round(pvDppNilaiLain * 0.12));
          const pvGrandTotal  = subtotal; // selalu = sum subtotal
          return (
            <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal Pemakaian</span><span className="font-semibold">{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">DPP</span><span>{formatCurrency(pvDpp)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">DPP Nilai Lain</span><span className="text-orange-600">{formatCurrency(pvDppNilaiLain)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">PPN 12%</span><span>{formatCurrency(pvPpn)}</span></div>
              <div className="flex justify-between border-t pt-1 font-black"><span>Grand Total</span><span className="text-primary">{formatCurrency(pvGrandTotal)}</span></div>
            </div>
          );
        })()}

        <div className="space-y-1">
          <Label>Catatan (opsional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan tambahan..." rows={2} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleGenerate} disabled={generateMutation.isPending || !canGenerate} className="gap-2">
            <FileText size={14} />
            {generateMutation.isPending
              ? "Memproses..."
              : existingInvoice && existingInvoice.status !== "paid"
                ? "Tambah ke Invoice Existing"
                : "Generate Invoice"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

// ─── Invoice Detail ───────────────────────────────────────────────────────────

function InvoiceDetail({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMutation = useUpdateCompanyInvoice();
  const [sendingWa, setSendingWa] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [generatingPackage, setGeneratingPackage] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [paymentNotes, setPaymentNotes] = useState("");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [markPaidOnUpload, setMarkPaidOnUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["company-invoice-detail", invoiceId],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/api/company-invoices/${invoiceId}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error("Gagal memuat invoice");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: invoiceSettings } = useQuery({
    queryKey: ["invoice-settings-public"],
    queryFn: async () => {
      const res = await fetch("/api/invoice-settings/public");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: billingDocStatus } = useQuery({
    queryKey: ["billing-doc-status", invoiceId],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/api/company-invoices/${invoiceId}/billing-document-status`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!invoiceId,
  });

  const handleMarkPaid = async () => {
    try {
      await updateMutation.mutateAsync({ id: invoiceId, data: { status: "paid" } });
      toast({ title: "Invoice ditandai sebagai lunas" });
      qc.invalidateQueries({ queryKey: getListCompanyInvoicesQueryKey() });
      qc.invalidateQueries({ queryKey: ["company-invoice-detail", invoiceId] });
      onClose();
    } catch {
      toast({ title: "Gagal memperbarui invoice", variant: "destructive" });
    }
  };

  const handleRebuildItems = async () => {
    setRebuilding(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/company-invoices/${invoiceId}/rebuild-items`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal sinkronisasi");
      toast({ title: `Sinkronisasi berhasil`, description: `${data.rebuiltCount} item pemakaian ditemukan` });
      qc.invalidateQueries({ queryKey: ["company-invoice-detail", invoiceId] });
    } catch (e: any) {
      toast({ title: e?.message ?? "Gagal sinkronisasi item", variant: "destructive" });
    } finally {
      setRebuilding(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setProofPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setProofPreview(null);
    }
  };

  const handleUploadProof = async () => {
    if (!proofFile && !paymentNotes.trim()) {
      toast({ title: "Pilih file bukti atau isi catatan terlebih dahulu", variant: "destructive" });
      return;
    }
    setUploadingProof(true);
    try {
      const token = getToken();
      const formData = new FormData();
      if (proofFile) formData.append("file", proofFile);
      formData.append("paymentNotes", paymentNotes);
      formData.append("markPaid", String(markPaidOnUpload));
      const res = await fetch(`/api/company-invoices/${invoiceId}/upload-payment-proof`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload gagal");
      toast({ title: "Bukti pembayaran berhasil disimpan" });
      setProofFile(null);
      setProofPreview(null);
      setPaymentNotes("");
      qc.invalidateQueries({ queryKey: ["company-invoice-detail", invoiceId] });
      qc.invalidateQueries({ queryKey: getListCompanyInvoicesQueryKey() });
    } catch (e: any) {
      toast({ title: e?.message ?? "Gagal upload bukti", variant: "destructive" });
    } finally {
      setUploadingProof(false);
    }
  };

  const handleSendWa = async () => {
    setSendingWa(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/company-invoices/${invoiceId}/send-wa`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal kirim WA");
      toast({ title: data.message ?? "WA berhasil dikirim" });
      await auditBillingAction(invoiceId, "COMPANY_DOCUMENT_SENT", ["invoice"]);
    } catch (e: any) {
      toast({ title: e?.message ?? "Gagal kirim WA", variant: "destructive" });
    } finally {
      setSendingWa(false);
    }
  };

  const handleDownloadInvoice = async () => {
    if (!invoice) return;
    printInvoicePdf(invoice, invoiceSettings?.signatureUrl, invoiceSettings?.financeName, invoiceSettings?.financeTitle);
    await auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["invoice"]);
  };

  const handleDownloadPackage = async () => {
    if (!invoice) return;
    setGeneratingPackage(true);
    try {
      const requirements = billingDocStatus?.documents ?? [
        { documentType: "invoice" },
        { documentType: "lampiran_pemakaian" },
        { documentType: "kwitansi" },
      ];
      const docs = await downloadBillingPackage(invoice, requirements, invoiceSettings?.signatureUrl, invoiceSettings?.financeName, invoiceSettings?.financeTitle);
      toast({
        title: "Billing Package sedang dibuka",
        description: `${docs.length} dokumen dibuka di tab baru untuk dicetak`,
      });
      await auditBillingAction(invoiceId, "COMPANY_BILLING_PACKAGE_GENERATED", docs);
    } finally {
      setGeneratingPackage(false);
    }
  };

  if (isLoading) {
    return (
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Detail Invoice</DialogTitle></DialogHeader>
        <div className="space-y-3 p-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      </DialogContent>
    );
  }

  if (!invoice) return null;
  const items: any[] = invoice.items ?? [];
  const docStatusList: any[] = billingDocStatus?.documents ?? [];
  const hasRequirements = docStatusList.length > 0;
  const docStatusOverall = billingDocStatus?.status ?? null;

  return (
    <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Detail Invoice</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-black text-2xl">{invoice.invoiceNumber}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
              <Building2 size={12} /> {invoice.companyName}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">{periodLabel(invoice.periodMonth)}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={invoice.status} />
            <Button size="sm" variant="outline" onClick={handleDownloadInvoice} className="gap-1.5">
              <FileText size={13} /> Invoice
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPackage}
              disabled={generatingPackage}
              className="gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50"
            >
              <Package size={13} /> {generatingPackage ? "Membuka..." : "Billing Package"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSendWa}
              disabled={sendingWa}
              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
            >
              <MessageSquare size={13} /> {sendingWa ? "Mengirim..." : "Kirim WA"}
            </Button>
            {invoice.status === "unpaid" && (
              <Button size="sm" onClick={handleMarkPaid} disabled={updateMutation.isPending} className="gap-1.5 bg-green-600 hover:bg-green-700">
                <CheckCircle size={13} /> Tandai Lunas
              </Button>
            )}
          </div>
        </div>

        {/* Document Status */}
        {hasRequirements && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm flex items-center gap-2">
                <Package size={14} className="text-primary" />
                Status Dokumen Tagihan
              </div>
              {docStatusOverall === "complete" ? (
                <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
                  <CheckCircle size={10} /> Lengkap
                </Badge>
              ) : (
                <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 gap-1">
                  <AlertCircle size={10} /> Belum Lengkap
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {docStatusList.map((d: any) => (
                <div
                  key={d.documentType}
                  className={`flex items-center gap-2 p-2 rounded text-xs font-medium ${
                    d.available ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                  }`}
                >
                  {d.available
                    ? <CheckSquare size={13} className="shrink-0" />
                    : <XSquare size={13} className="shrink-0" />}
                  {d.label}
                </div>
              ))}
            </div>
            {/* Quick print individual docs */}
            <div className="flex flex-wrap gap-2 pt-1 border-t">
              {docStatusList.some((d: any) => d.documentType === "lampiran_pemakaian" && d.available) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { printLampiranPemakaian(invoice); auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["lampiran_pemakaian"]); }}>
                  <Download size={11} /> Lampiran Pemakaian
                </Button>
              )}
              {docStatusList.some((d: any) => d.documentType === "kwitansi" && d.available) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { printKwitansi(invoice); auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["kwitansi"]); }}>
                  <Download size={11} /> Kwitansi
                </Button>
              )}
              {docStatusList.some((d: any) => d.documentType === "spp" && d.available) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { printSpp(invoice); auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["spp"]); }}>
                  <Download size={11} /> SPP
                </Button>
              )}
              {docStatusList.some((d: any) => d.documentType === "berita_acara" && d.available) && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { printBeritaAcara(invoice); auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["berita_acara"]); }}>
                  <Download size={11} /> Berita Acara
                </Button>
              )}
            </div>
          </div>
        )}

        {/* No requirements set — show default actions */}
        {!hasRequirements && (
          <div className="flex flex-wrap gap-2 rounded-lg border p-3 bg-muted/20">
            <div className="text-xs text-muted-foreground w-full mb-1">Cetak dokumen:</div>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { printLampiranPemakaian(invoice); auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["lampiran_pemakaian"]); }}>
              <Download size={11} /> Lampiran Pemakaian
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { printKwitansi(invoice); auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["kwitansi"]); }}>
              <Download size={11} /> Kwitansi
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { printSpp(invoice); auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["spp"]); }}>
              <Download size={11} /> SPP
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { printBeritaAcara(invoice); auditBillingAction(invoiceId, "COMPANY_DOCUMENT_DOWNLOADED", ["berita_acara"]); }}>
              <Download size={11} /> Berita Acara
            </Button>
          </div>
        )}

        {/* PIC info */}
        {(invoice.picName || invoice.picPhone || invoice.picEmail || invoice.billingAddress) && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5 text-xs">
            <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Informasi PIC</div>
            {invoice.picName && <div className="flex items-center gap-2"><User size={11} className="text-muted-foreground" /><span>{invoice.picName}</span></div>}
            {invoice.picPhone && <div className="flex items-center gap-2"><Phone size={11} className="text-muted-foreground" /><span>{invoice.picPhone}</span></div>}
            {invoice.picEmail && <div className="flex items-center gap-2"><Mail size={11} className="text-muted-foreground" /><span>{invoice.picEmail}</span></div>}
            {invoice.billingAddress && <div className="flex items-center gap-2"><MapPin size={11} className="text-muted-foreground" /><span>{invoice.billingAddress}</span></div>}
          </div>
        )}

        {/* Line items table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-sm">Detail Pemakaian ({items.length} sesi)</h4>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRebuildItems}
              disabled={rebuilding}
              className="gap-1.5 text-xs h-7 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={11} className={rebuilding ? "animate-spin" : ""} />
              {rebuilding ? "Sinkronisasi..." : "Sinkronisasi Item"}
            </Button>
          </div>
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8 border rounded-lg border-dashed space-y-2">
              <FileText size={28} className="mx-auto text-muted-foreground/40" />
              <div>Tidak ada data pemakaian</div>
              <div className="text-xs">Klik "Sinkronisasi Item" untuk mencari booking terkait</div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 border-b">
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Customer</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">No. WA</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Fasilitas</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Tanggal</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Jam</th>
                    <th className="text-center p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Durasi</th>
                    <th className="text-right p-2.5 font-semibold text-muted-foreground whitespace-nowrap">DPP</th>
                    <th className="text-right p-2.5 font-semibold text-muted-foreground whitespace-nowrap">PPN 12%</th>
                    <th className="text-right p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Total</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">No. Booking</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item: any, i: number) => (
                    <tr key={item.id ?? i} className="hover:bg-muted/20 transition-colors">
                      <td className="p-2.5 whitespace-nowrap font-medium">{item.customerName ?? "-"}</td>
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground">{item.customerPhone ?? "-"}</td>
                      <td className="p-2.5 whitespace-nowrap">{item.facilityName ?? "-"}</td>
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground">
                        {item.bookingDate ? new Date(item.bookingDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-"}
                      </td>
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground">
                        {item.startTime ?? "-"}{item.endTime ? `–${item.endTime}` : ""}
                      </td>
                      <td className="p-2.5 text-center whitespace-nowrap">{item.durationHours ?? 0} jam</td>
                      <td className="p-2.5 text-right whitespace-nowrap">{formatCurrency(Math.round((item.subtotal ?? 0) / 1.11))}</td>
                      <td className="p-2.5 text-right whitespace-nowrap text-muted-foreground">{formatCurrency(Math.round(Math.round(Math.round((item.subtotal ?? 0) / 1.11) * 11 / 12) * 0.12))}</td>
                      <td className="p-2.5 text-right whitespace-nowrap font-semibold">{formatCurrency(item.subtotal ?? 0)}</td>
                      <td className="p-2.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground">{item.orderNumber ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td colSpan={6} className="p-2.5 text-xs font-semibold text-muted-foreground">{items.length} sesi</td>
                    <td className="p-2.5 text-right text-xs font-semibold">{formatCurrency(items.reduce((s: number, i: any) => s + Math.round((i.subtotal ?? 0) / 1.11), 0))}</td>
                    <td className="p-2.5 text-right text-xs text-muted-foreground">{formatCurrency(items.reduce((s: number, i: any) => s + Math.round(Math.round(Math.round((i.subtotal ?? 0) / 1.11) * 11 / 12) * 0.12), 0))}</td>
                    <td className="p-2.5 text-right text-xs font-bold text-primary">{formatCurrency(items.reduce((s: number, i: any) => s + (i.subtotal ?? 0), 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Totals */}
        {(() => {
          // Hitung dari sum-of-rows supaya konsisten dengan tabel (hindari rounding drift)
          const rowDpp      = (i: any) => Math.round((i.subtotal ?? 0) / 1.11);
          const rowDppNL    = (i: any) => Math.round(rowDpp(i) * 11 / 12);
          const rowPpn      = (i: any) => Math.round(rowDppNL(i) * 0.12);
          const dpp         = items.reduce((s: number, i: any) => s + rowDpp(i), 0);
          const dppNilaiLain = items.reduce((s: number, i: any) => s + rowDppNL(i), 0);
          const ppn         = items.reduce((s: number, i: any) => s + rowPpn(i), 0);
          const grand       = invoice.totalAmount ?? 0; // selalu = sum subtotal, bukan dpp+ppn
          return (
            <div className="rounded-lg border overflow-hidden text-sm">
              <div className="bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ringkasan Pajak</div>
              <div className="divide-y">
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">Subtotal Pemakaian</span>
                  <span className="font-semibold">{formatCurrency(invoice.totalAmount)}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5 bg-muted/20">
                  <span className="text-muted-foreground">DPP</span>
                  <span className="font-semibold">{formatCurrency(dpp)}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5 bg-orange-50/50 dark:bg-orange-900/10">
                  <span className="text-muted-foreground">DPP Nilai Lain</span>
                  <span className="font-semibold text-orange-700 dark:text-orange-400">{formatCurrency(dppNilaiLain)}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">PPN 12%</span>
                  <span className="font-semibold">{formatCurrency(ppn)}</span>
                </div>
              </div>
              <div className="flex justify-between px-4 py-3 bg-primary text-white font-black text-base">
                <span>Grand Total</span>
                <span>{formatCurrency(grand)}</span>
              </div>
            </div>
          );
        })()}

        {/* Payment info */}
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-4 text-sm">
          <div className="font-semibold text-green-800 dark:text-green-300 text-xs uppercase tracking-wide mb-2">Informasi Pembayaran</div>
          <div className="text-green-900 dark:text-green-200 space-y-0.5 text-sm">
            <div className="font-bold">PT CAHAYA SEJATI TEKNOLOGI</div>
            <div>Bank Mandiri &nbsp;·&nbsp; No. Rek: <span className="font-mono font-bold">1640006707220</span></div>
            <div className="text-xs text-green-700 dark:text-green-400 mt-1">Cantumkan No. Invoice <strong>{invoice.invoiceNumber}</strong> sebagai keterangan transfer.</div>
          </div>
        </div>

        {invoice.notes && <div className="text-sm text-muted-foreground bg-muted/40 rounded p-3">{invoice.notes}</div>}

        {invoice.paidAt && (
          <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
            <CheckCircle size={14} />
            Dibayar pada {new Date(invoice.paidAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
          </div>
        )}

        {/* Upload Bukti Pembayaran */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="font-semibold text-sm flex items-center gap-2">
            <Upload size={14} className="text-blue-600" />
            Bukti Pembayaran Transfer
          </div>

          {/* Existing proof */}
          {invoice.paymentProofUrl && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Bukti yang sudah diupload</div>
              {invoice.paymentProofUrl.match(/\.(jpg|jpeg|png|webp|gif|heic)$/i) ? (
                <a href={invoice.paymentProofUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={invoice.paymentProofUrl}
                    alt="Bukti pembayaran"
                    className="max-h-48 rounded-lg border object-contain bg-muted/20 cursor-zoom-in hover:opacity-90 transition-opacity"
                  />
                </a>
              ) : (
                <a
                  href={invoice.paymentProofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                >
                  <FileText size={14} /> Lihat Bukti Pembayaran (PDF)
                </a>
              )}
              {invoice.paymentNotes && (
                <div className="text-sm text-muted-foreground bg-muted/30 rounded p-2">{invoice.paymentNotes}</div>
              )}
            </div>
          )}

          {/* Upload area */}
          {invoice.status !== "paid" && (
            <div className="space-y-3 pt-1 border-t">
              <div className="text-xs text-muted-foreground">
                {invoice.paymentProofUrl ? "Perbarui bukti pembayaran" : "Upload bukti transfer dari perusahaan"}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />

              {proofPreview ? (
                <div className="relative inline-block">
                  <img src={proofPreview} alt="Preview" className="max-h-40 rounded-lg border object-contain bg-muted/20" />
                  <button
                    type="button"
                    onClick={() => { setProofFile(null); setProofPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-0.5 hover:bg-destructive/80"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : proofFile ? (
                <div className="flex items-center gap-2 text-sm bg-muted/30 rounded p-2">
                  <FileText size={14} className="text-blue-600" />
                  <span className="truncate flex-1">{proofFile.name}</span>
                  <button type="button" onClick={() => { setProofFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                    <X size={13} className="text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-6 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  <ImageIcon size={16} />
                  Pilih foto atau PDF bukti transfer
                </button>
              )}

              {proofFile && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={12} /> Ganti File
                </Button>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Catatan (opsional)</label>
                <Textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Mis: Transfer BCA tgl 5 Agustus 2026, ref TXN-12345..."
                  rows={2}
                  className="text-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="mark-paid"
                  checked={markPaidOnUpload}
                  onCheckedChange={(v) => setMarkPaidOnUpload(!!v)}
                />
                <label htmlFor="mark-paid" className="text-sm cursor-pointer select-none">
                  Tandai invoice ini sebagai <strong>Lunas</strong> setelah upload
                </label>
              </div>

              <Button
                onClick={handleUploadProof}
                disabled={uploadingProof || (!proofFile && !paymentNotes.trim())}
                className="w-full gap-2"
                size="sm"
              >
                <Upload size={13} />
                {uploadingProof ? "Mengupload..." : "Simpan Bukti Pembayaran"}
              </Button>
            </div>
          )}

          {/* Show update option even if paid */}
          {invoice.status === "paid" && (
            <div className="space-y-3 pt-1 border-t">
              <div className="text-xs text-muted-foreground">
                {invoice.paymentProofUrl ? "Perbarui bukti pembayaran" : "Upload bukti transfer"}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              {proofPreview ? (
                <div className="relative inline-block">
                  <img src={proofPreview} alt="Preview" className="max-h-40 rounded-lg border object-contain bg-muted/20" />
                  <button
                    type="button"
                    onClick={() => { setProofFile(null); setProofPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-0.5 hover:bg-destructive/80"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : proofFile ? (
                <div className="flex items-center gap-2 text-sm bg-muted/30 rounded p-2">
                  <FileText size={14} className="text-blue-600" />
                  <span className="truncate flex-1">{proofFile.name}</span>
                  <button type="button" onClick={() => { setProofFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                    <X size={13} className="text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                >
                  <Upload size={13} /> {invoice.paymentProofUrl ? "Perbarui bukti" : "Upload bukti"}
                </button>
              )}
              {proofFile && (
                <div className="space-y-2">
                  <Textarea
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Catatan (opsional)"
                    rows={2}
                    className="text-sm"
                  />
                  <Button onClick={handleUploadProof} disabled={uploadingProof} size="sm" variant="outline" className="gap-2">
                    <Upload size={13} /> {uploadingProof ? "Mengupload..." : "Simpan"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DialogContent>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminCompanyBilling() {
  const [activeTab, setActiveTab] = useState<"invoices" | "documents">("invoices");
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateCompanyId, setGenerateCompanyId] = useState<number | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  const { data: companies } = useListCustomers({ accountType: "company" });
  const { data: allInvoices } = useListCompanyInvoices();
  const { data: invoices, isLoading, isError, error, refetch } = useListCompanyInvoices({
    companyCustomerId: filterCompany !== "all" ? parseInt(filterCompany) : undefined,
    status: filterStatus !== "all" ? filterStatus as "unpaid" | "paid" : undefined,
  });

  const totalUnpaid = invoices?.filter((i) => i.status === "unpaid").reduce((s, i) => s + i.grandTotal, 0) ?? 0;
  const totalPaid = invoices?.filter((i) => i.status === "paid").reduce((s, i) => s + i.grandTotal, 0) ?? 0;
  const companiesWithoutInvoice = (companies ?? []).filter(
    (company) => !(allInvoices ?? []).some((invoice) => invoice.companyCustomerId === company.id),
  );

  const openGenerate = (companyId?: number) => {
    setGenerateCompanyId(companyId ?? null);
    setShowGenerate(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Tagihan Perusahaan</h1>
          <p className="text-muted-foreground">Invoice bulanan untuk customer perusahaan</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw size={16} /></Button>
          <Button onClick={() => openGenerate()} className="gap-2"><Plus size={16} /> Generate Invoice</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center text-yellow-600"><AlertCircle size={20} /></div>
            <div>
              <div className="text-xs text-muted-foreground">Belum Lunas</div>
              <div className="font-black text-lg">{formatCurrency(totalUnpaid)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-green-600"><CheckCircle size={20} /></div>
            <div>
              <div className="text-xs text-muted-foreground">Sudah Lunas</div>
              <div className="font-black text-lg">{formatCurrency(totalPaid)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><FileText size={20} /></div>
            <div>
              <div className="text-xs text-muted-foreground">Total Invoice</div>
              <div className="font-black text-lg">{invoices?.length ?? 0}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setActiveTab("invoices")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "invoices" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2"><FileText size={14} /> Daftar Invoice</span>
        </button>
        <button
          onClick={() => setActiveTab("documents")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === "documents" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-2"><Package size={14} /> Dokumen Billing</span>
        </button>
      </div>

      {/* Tab: Daftar Invoice */}
      {activeTab === "invoices" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daftar Invoice</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex flex-wrap gap-3 mb-4">
              <Select value={filterCompany} onValueChange={setFilterCompany}>
                <SelectTrigger className="w-52"><SelectValue placeholder="Semua perusahaan" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Perusahaan</SelectItem>
                  {companies?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.companyName ?? c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="unpaid">Belum Lunas</SelectItem>
                  <SelectItem value="paid">Lunas</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : isError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
                <div className="font-semibold">Gagal memuat daftar invoice</div>
                <div className="mt-1 text-xs">{(error as any)?.message ?? "Periksa login admin dan koneksi API."}</div>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                  Coba Lagi
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-3 pr-4 font-semibold text-muted-foreground">No. Invoice</th>
                      <th className="pb-3 pr-4 font-semibold text-muted-foreground">Perusahaan</th>
                      <th className="pb-3 pr-4 font-semibold text-muted-foreground">Periode</th>
                      <th className="pb-3 pr-4 font-semibold text-muted-foreground">DPP</th>
                      <th className="pb-3 pr-4 font-semibold text-muted-foreground">PPN 12%</th>
                      <th className="pb-3 pr-4 font-semibold text-muted-foreground">Grand Total</th>
                      <th className="pb-3 pr-4 font-semibold text-muted-foreground">Status</th>
                      <th className="pb-3 font-semibold text-muted-foreground">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoices?.map((inv) => {
                      const [year, month] = inv.periodMonth.split("-");
                      const label = new Date(parseInt(year), parseInt(month) - 1, 1)
                        .toLocaleDateString("id-ID", { year: "numeric", month: "short" });
                      return (
                        <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 pr-4"><span className="font-mono text-xs font-semibold">{inv.invoiceNumber}</span></td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <Building2 size={12} className="text-orange-500 shrink-0" />
                              <span className="font-medium">{inv.companyName}</span>
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-muted-foreground">{label}</td>
                          <td className="py-3 pr-4">{formatCurrency(Math.round((inv.totalAmount ?? 0) / 1.11))}</td>
                          <td className="py-3 pr-4 text-muted-foreground">{formatCurrency(inv.ppnAmount)}</td>
                          <td className="py-3 pr-4 font-semibold">{formatCurrency(inv.grandTotal)}</td>
                          <td className="py-3 pr-4"><StatusBadge status={inv.status} /></td>
                          <td className="py-3">
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setSelectedInvoiceId(inv.id)} className="gap-1 h-7 text-xs">
                                <Eye size={12} /> Detail
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!invoices?.length && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada invoice</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "invoices" && !isLoading && !isError && companiesWithoutInvoice.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Perusahaan Belum Memiliki Invoice</CardTitle>
            <p className="text-xs text-muted-foreground">
              Generate invoice per perusahaan untuk periode yang dipilih.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="divide-y">
              {companiesWithoutInvoice.map((company) => (
                <div key={company.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 size={15} className="text-orange-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{company.companyName ?? company.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Belum ada invoice di daftar
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => openGenerate(company.id)}>
                    <Plus size={13} /> Generate
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab: Dokumen Billing */}
      {activeTab === "documents" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings size={16} /> Persyaratan Dokumen per Perusahaan
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <BillingDocumentsTab companies={companies ?? []} />
          </CardContent>
        </Card>
      )}

      <Dialog open={showGenerate} onOpenChange={(v) => !v && setShowGenerate(false)}>
        {showGenerate && (
          <GenerateInvoiceDialog
            initialCompanyId={generateCompanyId}
            onClose={() => {
              setShowGenerate(false);
              setGenerateCompanyId(null);
            }}
          />
        )}
      </Dialog>

      <Dialog open={!!selectedInvoiceId} onOpenChange={(v) => !v && setSelectedInvoiceId(null)}>
        {selectedInvoiceId && <InvoiceDetail key={selectedInvoiceId} invoiceId={selectedInvoiceId} onClose={() => setSelectedInvoiceId(null)} />}
      </Dialog>
    </div>
  );
}
