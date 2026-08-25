import { useState, useMemo, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useListBookings,
  useUpdateBooking,
  useUpdatePayment,
  useUpdatePaymentMetadata,
  useCheckInBooking,
  getListBookingsQueryKey,
  useGetBookingWaLogs,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Download,
  Search,
  Eye,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  Ban,
  CalendarCheck,
  CreditCard,
  ExternalLink,
  X,
  User,
  Users,
  Building2,
  Hash,
  CalendarDays,
  AlertTriangle,
  FileImage,
  Trash2,
  FileText,
  Receipt,
  Plane,
  PartyPopper,
  ShieldCheck,
  RefreshCw,
  LogIn,
  Link2,
  Unlink,
  Layers,
  MessageSquare,
  Send,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  CheckCircle,
  AlertCircle,
  Lock as LockIcon,
} from "lucide-react";
import { getToken } from "@/lib/auth";
import VerifyIdDialog from "@/components/admin/VerifyIdDialog";
import CorporateDocUpload from "@/components/CorporateDocUpload";

/* ─── Helpers ───────────────────────────────────────────────────── */

function proofImageUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  // External URL — use as-is
  if (rawUrl.startsWith("http")) return rawUrl;
  // Find /api/uploads/ anywhere (handles malformed /api/storage/objects//api/uploads/... paths)
  const uploadsIdx = rawUrl.lastIndexOf("/api/uploads/");
  if (uploadsIdx !== -1) return rawUrl.slice(uploadsIdx);
  // No leading slash variant: api/uploads/proofs/...
  if (rawUrl.startsWith("api/uploads/")) return `/${rawUrl}`;
  // Bare filename — assume proofs/ subdir
  const bare = rawUrl.replace(/^\/+/, "");
  return `/api/uploads/proofs/${bare}`;
}

/* ─── Status Config ────────────────────────────────────────────── */

type BookingStatus =
  | "pending_payment"
  | "paid"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "refunded";

const STATUS_CONFIG: Record<
  BookingStatus,
  { label: string; color: string; bg: string; icon: React.ElementType; pill: string }
> = {
  pending_payment: {
    label: "Menunggu Pembayaran",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-100 dark:bg-amber-900/30",
    icon: Clock,
    pill: "border-amber-200 dark:border-amber-800",
  },
  paid: {
    label: "Pembayaran Selesai",
    color: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-100 dark:bg-blue-900/30",
    icon: CreditCard,
    pill: "border-blue-200 dark:border-blue-800",
  },
  confirmed: {
    label: "Dikonfirmasi",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    icon: CheckCircle2,
    pill: "border-emerald-200 dark:border-emerald-800",
  },
  completed: {
    label: "Selesai",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    icon: CheckCircle2,
    pill: "border-emerald-200 dark:border-emerald-800",
  },
  cancelled: {
    label: "Dibatalkan",
    color: "text-red-700 dark:text-red-300",
    bg: "bg-red-100 dark:bg-red-900/30",
    icon: XCircle,
    pill: "border-red-200 dark:border-red-800",
  },
  refunded: {
    label: "Pengembalian Dana",
    color: "text-purple-700 dark:text-purple-300",
    bg: "bg-purple-100 dark:bg-purple-900/30",
    icon: RotateCcw,
    pill: "border-purple-200 dark:border-purple-800",
  },
};

const FILTER_OPTIONS = [
  { value: "all",             label: "Semua Status" },
  { value: "pending_payment", label: "Menunggu Pembayaran" },
  { value: "paid",            label: "Pembayaran Selesai" },
  { value: "confirmed",       label: "Dikonfirmasi" },
  { value: "completed",       label: "Selesai" },
  { value: "cancelled",       label: "Dibatalkan" },
  { value: "refunded",        label: "Pengembalian Dana" },
];

function StatusBadge({ status, isDpPaid }: { status: string; isDpPaid?: boolean }) {
  const cfg = STATUS_CONFIG[status as BookingStatus] ?? STATUS_CONFIG.pending_payment;
  const Icon = cfg.icon;
  if (isDpPaid && status === "pending_payment") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border border-violet-200 dark:border-violet-800 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
        <CreditCard size={11} />
        Menunggu Sisa
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.pill}`}
    >
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type PaymentMethodOption = {
  value: string;
  label: string;
  providerCode?: string;
};

function PaymentMethodSelect({
  payment,
  options,
  onChange,
  disabled = false,
  lockedReason,
}: {
  payment: any;
  options: PaymentMethodOption[];
  onChange: (paymentId: number, paymentMethod: string) => void;
  disabled?: boolean;
  lockedReason?: string;
}) {
  if (!payment) {
    return <span className="text-xs text-slate-300 dark:text-slate-600">—</span>;
  }

  const storedValue = String(payment.paymentMethod ?? "Transfer Bank");
  const storedCode = storedValue.trim().toLowerCase();
  const isDirectQris = payment.paymentProvider === "mandiri_direct" && storedCode === "qris";
  const configuredOption = options.find(
    (option) =>
      option.providerCode?.trim().toLowerCase() === storedCode &&
      (payment.paymentProvider === "paylabs" || !option.providerCode),
  );
  const currentValue = configuredOption?.value ?? storedValue;
  // A QRIS Direct payment must not be changed back to a Paylabs display
  // option. That would change the provider/settlement identity of an already
  // classified payment and is correctly rejected by the accounting guard.
  // Keep the valid direct method visible while hiding only gateway options.
  const availableOptions = isDirectQris
    ? options.filter((option) => !option.providerCode)
    : options;
  const mergedOptions = availableOptions.some((option) => option.value === currentValue)
    ? availableOptions
    : [{ value: currentValue, label: `${storedValue} (tersimpan)` }, ...availableOptions];

  return (
    <div title={lockedReason}>
      <Select
        value={currentValue}
        onValueChange={(value) => onChange(payment.id, value)}
        aria-label={lockedReason ?? "Metode pembayaran"}
        disabled={disabled || Boolean(lockedReason)}
      >
        <SelectTrigger className={`h-8 min-w-[150px] max-w-[190px] text-xs rounded-lg border-slate-200 dark:border-slate-700 ${lockedReason ? "cursor-not-allowed opacity-70" : ""}`}>
          {lockedReason && <LockIcon size={12} className="mr-1.5 shrink-0 text-slate-400" aria-hidden="true" />}
          <SelectValue />
        </SelectTrigger>
      <SelectContent>
        {mergedOptions.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
      </Select>
    </div>
  );
}

/* ─── Invoice / Kwitansi Print ──────────────────────────────────── */

async function printInvoice(booking: any, settings?: any) {
  // Buka window PERTAMA (sinkron) agar tidak diblokir popup blocker
  const w = window.open("about:blank", "_blank");
  if (!w) return;

  const centerName = settings?.centerName ?? "Sport Center";
  const address = settings?.address ?? "";
  const phone = settings?.phone ?? "";

  // Untuk booking grup: fetch semua sesi, tampilkan gabungan dalam satu invoice
  let sessions: any[] = [];
  let isGroup = false;
  let groupFetchFailed = false;
  if (booking.groupRef) {
    try {
      const res = await fetch(`/api/admin/bookings/groups/${booking.groupRef}/sessions`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        sessions = await res.json();
        isGroup = sessions.length > 1;
      } else {
        groupFetchFailed = true;
      }
    } catch { groupFetchFailed = true; }
  }
  if (groupFetchFailed) {
    w.document.write("<h2 style='font-family:sans-serif;padding:40px;color:#dc2626'>Gagal mengambil data sesi grup. Silakan coba lagi.</h2>");
    w.document.close();
    return;
  }
  if (!isGroup) sessions = [booking];

  // Hitung total dari semua sesi
  const grandTotalAll = sessions.reduce((sum: number, s: any) =>
    sum + (s.grandTotal != null ? Math.round(Number(s.grandTotal)) : Math.round(Number(s.totalPrice))), 0);
  const totalPpnAll = sessions.reduce((sum: number, s: any) =>
    sum + (s.ppnAmount != null ? Math.round(Number(s.ppnAmount)) : 0), 0);
  const hasPpn = totalPpnAll > 0;
  const dppAll = hasPpn ? (grandTotalAll - totalPpnAll) : grandTotalAll;
  const dppNilaiLainAll = hasPpn ? Math.round(dppAll * 11 / 12) : 0;

  // Baris sesi
  const sessionRows = sessions.map((s: any, i: number) => {
    const sTotal = s.grandTotal != null ? Math.round(Number(s.grandTotal)) : Math.round(Number(s.totalPrice));
    return `<tr>
      <td>${isGroup ? `Sesi ${i + 1} – ${s.facilityName ?? booking.facilityName}` : s.facilityName ?? booking.facilityName}</td>
      <td>${formatDate(s.bookingDate)}</td>
      <td>${String(s.startTime ?? "").slice(0, 5)} – ${String(s.endTime ?? "").slice(0, 5)}</td>
      <td>${s.durationHours} jam</td>
      <td style="text-align:right;font-weight:600">${formatCurrency(sTotal)}</td>
    </tr>`;
  }).join("\n");

  const docTitle = isGroup ? booking.groupRef : booking.orderNumber;

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <title>Invoice ${docTitle}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 720px; margin: auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #f97316; padding-bottom: 20px; margin-bottom: 28px; }
    .brand { font-size: 24px; font-weight: 900; color: #f97316; letter-spacing: -0.5px; }
    .brand-sub { font-size: 12px; color: #777; margin-top: 2px; }
    .invoice-meta { text-align: right; }
    .invoice-title { font-size: 28px; font-weight: 900; color: #111; letter-spacing: -1px; }
    .invoice-num { font-size: 13px; color: #f97316; margin-top: 4px; font-family: monospace; font-weight: 700; }
    .invoice-date { font-size: 12px; color: #777; margin-top: 2px; }
    .section { margin-bottom: 22px; }
    .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 8px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
    .info-item label { font-size: 11px; color: #888; display: block; margin-bottom: 1px; }
    .info-item span { font-size: 13px; font-weight: 600; color: #222; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead tr { background: #f97316; }
    th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #fff; }
    th:last-child { text-align: right; }
    tbody tr:nth-child(odd) { background: #fff7f3; }
    tbody tr:nth-child(even) { background: #ffeee5; }
    td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
    .totals-section { display: flex; justify-content: flex-end; margin-top: 10px; margin-bottom: 16px; }
    .totals-table { width: 300px; }
    .totals-table td { padding: 4px 8px; font-size: 12px; border: none; background: transparent; }
    .totals-table td:first-child { color: #555; text-align: left; }
    .totals-table td:last-child { color: #555; text-align: right; font-weight: 600; }
    .totals-table tr.grand-total td { font-size: 15px; font-weight: 900; color: #f97316; border-top: 2px solid #f97316; padding-top: 8px; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
    .status-completed { background: #d1fae5; color: #065f46; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-cancelled { background: #fee2e2; color: #991b1b; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${centerName}</div>
      <div class="brand-sub">${address}</div>
      <div class="brand-sub">${phone}</div>
    </div>
    <div class="invoice-meta">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-num">${docTitle}</div>
      <div class="invoice-date">Tanggal: ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Informasi Customer</div>
    <div class="info-grid">
      ${booking.bookerName && booking.bookerName !== booking.customerName
        ? `<div class="info-item"><label>Pemesan</label><span>${booking.bookerName}</span></div><div class="info-item"><label>Yang Akan Main</label><span>${booking.customerName}</span></div>`
        : `<div class="info-item"><label>Nama</label><span>${booking.customerName}</span></div>`}
      <div class="info-item"><label>No. HP</label><span>${booking.customerPhone || "-"}</span></div>
      <div class="info-item"><label>Email</label><span>${booking.customerEmail || "-"}</span></div>
      <div class="info-item"><label>Status</label><span class="status-badge ${
        booking.status === "completed" || booking.status === "confirmed" ? "status-completed" :
        booking.status === "cancelled" ? "status-cancelled" : "status-pending"
      }">${STATUS_CONFIG[booking.status as BookingStatus]?.label ?? booking.status}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Detail Pemesanan${isGroup ? ` (${sessions.length} Sesi)` : ""}</div>
    <table>
      <thead>
        <tr>
          <th>Fasilitas</th>
          <th>Tanggal</th>
          <th>Jam</th>
          <th>Durasi</th>
          <th style="text-align:right">Harga (Inc. PPN)</th>
        </tr>
      </thead>
      <tbody>
        ${sessionRows}
      </tbody>
    </table>
    <div class="totals-section">
      <table class="totals-table">
        ${hasPpn ? `
        <tr><td>DPP</td><td>${formatCurrency(dppAll)}</td></tr>
        <tr><td>DPP Nilai Lain (11/12 × DPP)</td><td>${formatCurrency(dppNilaiLainAll)}</td></tr>
        <tr><td>PPN 11%</td><td>${formatCurrency(totalPpnAll)}</td></tr>
        <tr class="grand-total"><td>TOTAL</td><td>${formatCurrency(grandTotalAll)}</td></tr>
        ` : `
        <tr class="grand-total"><td>TOTAL</td><td>${formatCurrency(grandTotalAll)}</td></tr>
        `}
      </table>
    </div>
  </div>

  ${booking.notes ? `<div class="section"><div class="section-title">Catatan</div><p style="font-size:13px;color:#555">${booking.notes}</p></div>` : ""}

  <div class="footer">
    Dokumen ini dicetak secara otomatis oleh sistem ${centerName}. Terima kasih atas kepercayaan Anda.
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Hapus referensi opener untuk cegah reverse-tabnabbing
  try { w.opener = null; } catch { /* cross-origin, abaikan */ }
}

function terbilang(n: number): string {
  const satuan = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan",
    "Sepuluh", "Sebelas", "Dua Belas", "Tiga Belas", "Empat Belas", "Lima Belas", "Enam Belas",
    "Tujuh Belas", "Delapan Belas", "Sembilan Belas"];
  if (n === 0) return "Nol";
  if (n < 0) return "Minus " + terbilang(-n);
  if (n < 20) return satuan[n];
  if (n < 100) return satuan[Math.floor(n / 10)] + " Puluh" + (n % 10 !== 0 ? " " + satuan[n % 10] : "");
  if (n < 200) return "Seratus" + (n % 100 !== 0 ? " " + terbilang(n % 100) : "");
  if (n < 1000) return satuan[Math.floor(n / 100)] + " Ratus" + (n % 100 !== 0 ? " " + terbilang(n % 100) : "");
  if (n < 2000) return "Seribu" + (n % 1000 !== 0 ? " " + terbilang(n % 1000) : "");
  if (n < 1000000) return terbilang(Math.floor(n / 1000)) + " Ribu" + (n % 1000 !== 0 ? " " + terbilang(n % 1000) : "");
  if (n < 1000000000) return terbilang(Math.floor(n / 1000000)) + " Juta" + (n % 1000000 !== 0 ? " " + terbilang(n % 1000000) : "");
  return terbilang(Math.floor(n / 1000000000)) + " Miliar" + (n % 1000000000 !== 0 ? " " + terbilang(n % 1000000000) : "");
}

async function printKwitansi(booking: any, settings?: any) {
  const centerName = settings?.centerName ?? "Sport Center";
  const address = settings?.address ?? "";
  const phone = settings?.phone ?? "";
  const bankName = settings?.bankName ?? "";
  const bankAccount = settings?.bankAccount ?? "";
  const bankAccountName = settings?.bankAccountName ?? "";
  const logoUrl = settings?.logoUrl ?? "";
  const now = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  const statusLabel = booking.status === "completed" ? "Lunas" :
    booking.status === "confirmed" ? "Dikonfirmasi" :
    booking.status === "cancelled" ? "Dibatalkan" : booking.status;

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #e5e7eb;" />`
    : `<div style="width:56px;height:56px;border-radius:50%;background:#f97316;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;flex-shrink:0;">SC</div>`;

  // Untuk booking grup/recurring: fetch semua sesi, tampilkan gabungan
  let sessions: any[] = [];
  let isGroup = false;
  if (booking.groupRef) {
    try {
      const res = await fetch(`/api/admin/bookings/groups/${booking.groupRef}/sessions`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        sessions = await res.json();
        isGroup = sessions.length > 1;
      }
    } catch { /* fallback ke single session */ }
  }
  if (!isGroup) {
    sessions = [booking];
  }

  // Hitung total gabungan dari semua sesi
  const grandTotalAll = sessions.reduce((sum: number, s: any) => {
    return sum + (s.grandTotal != null ? Math.round(Number(s.grandTotal)) : Math.round(Number(s.totalPrice)));
  }, 0);
  const totalPpnAll = sessions.reduce((sum: number, s: any) => sum + (s.ppnAmount != null ? Math.round(Number(s.ppnAmount)) : 0), 0);
  const hasPpnK = totalPpnAll > 0;
  const dppAll = hasPpnK ? (grandTotalAll - totalPpnAll) : grandTotalAll;
  const dppNilaiLainAll = hasPpnK ? Math.round(dppAll * 11 / 12) : 0;
  const terbilangText = terbilang(grandTotalAll) + " Rupiah";

  // Baris tabel sesi
  const sessionRows = sessions.map((s: any, i: number) => {
    const sTotal = s.grandTotal != null ? Math.round(Number(s.grandTotal)) : Math.round(Number(s.totalPrice));
    return `<tr>
      <td>${isGroup ? `Sesi ${i + 1}` : s.facilityName ?? booking.facilityName}</td>
      <td>${formatDate(s.bookingDate)}</td>
      <td>${String(s.startTime ?? "").slice(0, 5)} – ${String(s.endTime ?? "").slice(0, 5)}</td>
      <td>${s.durationHours} Jam</td>
      <td>${formatCurrency(sTotal)}</td>
    </tr>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <title>Kwitansi ${booking.orderNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 720px; margin: auto; font-size: 12px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
    .header-left { display: flex; align-items: flex-start; gap: 14px; }
    .brand-name { font-size: 18px; font-weight: 900; color: #1a1a1a; line-height: 1.1; }
    .brand-sub { font-size: 13px; font-weight: 700; color: #f97316; margin: 2px 0 4px; }
    .brand-addr { font-size: 11px; color: #444; line-height: 1.5; }
    .header-right { text-align: right; }
    .kwitansi-title { font-size: 26px; font-weight: 900; color: #1a1a1a; line-height: 1; }
    .kwitansi-num { font-size: 14px; font-weight: 700; color: #f97316; margin-top: 4px; }
    .kwitansi-date { font-size: 11px; color: #666; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
    .divider { border: none; border-top: 2.5px solid #f97316; margin: 14px 0; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1a1a1a; margin-bottom: 10px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 20px; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
    .info-cell { padding: 6px 0; border-bottom: 1px solid #eee; }
    .info-cell:nth-child(odd) { padding-right: 20px; border-right: 1px solid #eee; }
    .info-cell:nth-child(even) { padding-left: 20px; }
    .info-label { font-size: 11px; color: #555; margin-bottom: 2px; }
    .info-value { font-size: 12px; color: #1a1a1a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
    thead tr { background: #f97316; }
    th { padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #fff; letter-spacing: 0.5px; }
    th:last-child { text-align: right; }
    tbody tr:nth-child(odd) { background: #fff7f3; }
    tbody tr:nth-child(even) { background: #ffeee5; }
    td { padding: 9px 10px; font-size: 12px; color: #1a1a1a; }
    td:last-child { text-align: right; font-weight: 600; }
    .group-label { font-size: 11px; color: #f97316; font-weight: 700; margin-bottom: 6px; }
    .totals-section { display: flex; justify-content: flex-end; margin-top: 8px; margin-bottom: 16px; }
    .totals-table { width: 280px; }
    .totals-table td { padding: 4px 8px; font-size: 12px; border: none; background: transparent; }
    .totals-table td:first-child { color: #f97316; font-weight: 600; text-align: left; }
    .totals-table td:last-child { color: #f97316; font-weight: 700; text-align: right; }
    .totals-table tr.grand-total td { font-size: 13px; font-weight: 900; border-top: 1px solid #f97316; padding-top: 6px; }
    .terbilang { font-style: italic; font-weight: 700; font-size: 12px; color: #1a1a1a; margin-bottom: 18px; }
    .payment-info { font-size: 12px; color: #1a1a1a; line-height: 1.8; margin-bottom: 24px; }
    .sig-row { display: flex; justify-content: flex-end; margin-top: 8px; }
    .sig-box { text-align: center; width: 160px; }
    .sig-space { height: 52px; }
    .sig-line { border-top: 1px solid #aaa; padding-top: 4px; }
    .sig-name { font-size: 12px; font-weight: 700; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #888; text-align: center; line-height: 1.6; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      ${logoHtml}
      <div>
        <div class="brand-name">${centerName}</div>
        <div class="brand-sub">${centerName.toUpperCase()}</div>
        <div class="brand-addr">${address}${phone ? "<br/>" + phone : ""}</div>
      </div>
    </div>
    <div class="header-right">
      <div class="kwitansi-title">KWITANSI</div>
      <div class="kwitansi-num">${booking.groupRef && isGroup ? booking.groupRef : booking.orderNumber}</div>
      <div class="kwitansi-date">Tanggal Kwitansi</div>
      <div style="font-size:11px;color:#333;margin-top:2px;">${now}</div>
    </div>
  </div>

  <hr class="divider"/>

  <div class="section-title">Informasi Customer</div>
  <div class="info-grid">
    <div class="info-cell">
      <div class="info-label">${booking.bookerName && booking.bookerName !== booking.customerName ? "Yang Akan Main" : "Nama"}</div>
      <div class="info-value">${booking.customerName}${booking.bookerName && booking.bookerName !== booking.customerName ? ` <span style="font-size:10px;color:#666;">(dipesan oleh ${booking.bookerName})</span>` : ""}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">No. HP</div>
      <div class="info-value">${booking.customerPhone || "-"}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Email</div>
      <div class="info-value">${booking.customerEmail || "-"}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Status</div>
      <div class="info-value">${statusLabel}</div>
    </div>
    ${isGroup ? `<div class="info-cell">
      <div class="info-label">Fasilitas</div>
      <div class="info-value">${booking.facilityName}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Total Sesi</div>
      <div class="info-value">${sessions.length} sesi</div>
    </div>` : ""}
  </div>

  <div class="section-title">Detail Pemesanan${isGroup ? ` — ${sessions.length} Sesi (Recurring)` : ""}</div>
  <table>
    <thead>
      <tr>
        <th>${isGroup ? "Sesi" : "Fasilitas"}</th>
        <th>Tanggal</th>
        <th>Jam</th>
        <th>Durasi</th>
        <th>Harga</th>
      </tr>
    </thead>
    <tbody>
      ${sessionRows}
    </tbody>
  </table>

  <div class="totals-section">
    <table class="totals-table">
      ${hasPpnK ? `
      <tr>
        <td>DPP</td>
        <td>${formatCurrency(dppAll)}</td>
      </tr>
      <tr>
        <td style="font-size:11px;color:#999;">DPP Nilai Lain (11/12 × DPP)</td>
        <td style="font-size:11px;color:#999;">${formatCurrency(dppNilaiLainAll)}</td>
      </tr>
      <tr>
        <td>PPN 12%</td>
        <td>${formatCurrency(totalPpnAll)}</td>
      </tr>` : ""}
      <tr class="grand-total">
        <td>${isGroup ? `Total ${sessions.length} Sesi (sudah termasuk PPN)` : "Total (sudah termasuk PPN)"}</td>
        <td>${formatCurrency(grandTotalAll)}</td>
      </tr>
    </table>
  </div>

  <div class="terbilang">Terbilang: ${terbilangText}</div>

  ${bankAccountName || bankName || bankAccount ? `
  <div class="payment-info">
    Pembayaran: ${bankAccountName || centerName}<br/>
    ${bankName ? bankName + "<br/>" : ""}
    ${bankAccount ? "Account No. " + bankAccount : ""}
  </div>` : ""}

  <div class="sig-row">
    <div class="sig-box">
      <div class="sig-space"></div>
      <div class="sig-line">
        <div class="sig-name">Finance</div>
      </div>
    </div>
  </div>

  <div class="footer">
    Dokumen ini dicetak secara otomatis oleh sistem ${centerName}. Terima kasih atas kepercayaan Anda.<br/>
    Dikelola oleh <strong>${bankAccountName || centerName}</strong>
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

/* ─── Summary Stats ─────────────────────────────────────────────── */

function SummaryStats({
  bookings,
  activeFilter,
  onStatClick,
}: {
  bookings: any[];
  activeFilter: string;
  onStatClick: (filter: string) => void;
}) {
  const stats = [
    {
      label: "Total Booking",
      value: bookings.length,
      filter: "all",
      icon: CalendarCheck,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-900/20",
      border: "border-blue-200/60 dark:border-blue-800/40",
      activeBorder: "border-blue-400 dark:border-blue-500",
      activeRing: "ring-2 ring-blue-300/60 dark:ring-blue-600/40",
    },
    {
      label: "Perlu Verifikasi",
      value: bookings.filter((b) => b.status === "waiting_confirmation" || b.status === "paid").length,
      filter: "waiting_confirmation",
      icon: CreditCard,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-900/20",
      border: "border-amber-200/60 dark:border-amber-800/40",
      activeBorder: "border-amber-400 dark:border-amber-500",
      activeRing: "ring-2 ring-amber-300/60 dark:ring-amber-600/40",
    },
    {
      label: "Selesai",
      value: bookings.filter((b) => b.status === "completed" || b.status === "confirmed").length,
      filter: "completed",
      icon: CheckCircle2,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
      border: "border-emerald-200/60 dark:border-emerald-800/40",
      activeBorder: "border-emerald-400 dark:border-emerald-500",
      activeRing: "ring-2 ring-emerald-300/60 dark:ring-emerald-600/40",
    },
    {
      label: "Dibatalkan / Dikembalikan",
      value: bookings.filter((b) => b.status === "cancelled" || b.status === "refunded").length,
      filter: "cancelled",
      icon: Ban,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-900/20",
      border: "border-red-200/60 dark:border-red-800/40",
      activeBorder: "border-red-400 dark:border-red-500",
      activeRing: "ring-2 ring-red-300/60 dark:ring-red-600/40",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-2 lg:grid-cols-4 gap-3"
    >
      {stats.map((s, i) => {
        const Icon = s.icon;
        const isActive = activeFilter === s.filter;
        return (
          <motion.button
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onStatClick(s.filter)}
            className={`text-left rounded-2xl border p-4 shadow-sm transition-all duration-150 w-full focus:outline-none
              ${isActive
                ? `${s.activeBorder} ${s.activeRing} ${s.bg}`
                : `${s.border} bg-white dark:bg-slate-900 hover:${s.bg}`
              }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`p-2 rounded-xl ${s.bg} w-fit`}>
                <Icon size={16} className={s.color} />
              </div>
              {isActive && (
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${s.bg} ${s.color}`}>
                  aktif
                </span>
              )}
            </div>
            <div className={`text-3xl font-black ${s.color} mb-0.5`}>{s.value}</div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{s.label}</div>
          </motion.button>
        );
      })}
    </motion.div>
  );
}

/* ─── Proof Image Component ─────────────────────────────────────── */

function ProofImage({ proofUrl }: { proofUrl: string }) {
  const [imgError, setImgError] = useState(false);
  const url = proofImageUrl(proofUrl);

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-500">Bukti Transfer</div>
      {imgError ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <FileImage size={14} /> Buka File Bukti
          <ExternalLink size={11} className="ml-auto" />
        </a>
      ) : (
        <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 group">
          <img
            src={url}
            alt="Bukti transfer"
            className="w-full max-h-52 object-contain bg-slate-50 dark:bg-slate-800"
            onError={() => setImgError(true)}
          />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors"
          >
            <span className="opacity-0 group-hover:opacity-100 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-opacity">
              <ExternalLink size={11} /> Buka penuh
            </span>
          </a>
        </div>
      )}
    </div>
  );
}

/* ─── WA Notif Logs Panel ───────────────────────────────────────── */

const EVENT_LABEL: Record<string, string> = {
  booking_created: "Booking Dibuat",
  payment_confirmed: "Pembayaran Dikonfirmasi",
  booking_cancelled: "Booking Dibatalkan",
  booking_expired: "Booking Kedaluwarsa",
  booking_completed: "Booking Selesai",
  dp_paid: "DP Dibayar",
  resend: "Kirim Ulang",
};

function WaNotifLogsPanel({ bookingId }: { bookingId: number }) {
  const [expanded, setExpanded] = useState(false);
  const { data: logs, isLoading } = useGetBookingWaLogs(bookingId, {
    query: { enabled: expanded, queryKey: ["booking-wa-logs", bookingId] },
  });

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <MessageCircle size={13} className="text-emerald-500" />
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Riwayat Notifikasi WA</span>
          {!expanded && logs && logs.length > 0 && (
            <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{logs.length}</span>
          )}
        </div>
        {expanded ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-2">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                </div>
              ) : !logs || logs.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-4 text-slate-400 text-xs">
                  <MessageCircle size={14} />
                  <span>Belum ada log pengiriman WA</span>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="rounded-lg border border-slate-100 dark:border-slate-700 p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {log.status === "sent" ? (
                          <CheckCircle size={12} className="text-emerald-500 shrink-0" />
                        ) : (
                          <AlertCircle size={12} className="text-red-500 shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {log.event ? (EVENT_LABEL[log.event] ?? log.event) : "Notifikasi"}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${log.status === "sent" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"}`}>
                          {log.status === "sent" ? "Terkirim" : "Gagal"}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {new Date(log.sentAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">📱 {log.recipientPhone}</div>
                    {log.messagePreview && (
                      <div className="text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-800 rounded px-2 py-1.5 line-clamp-2 font-mono leading-relaxed">
                        {log.messagePreview}
                      </div>
                    )}
                    {log.status === "failed" && log.errorMessage && (
                      <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/10 rounded px-2 py-1">
                        ⚠ {log.errorMessage}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Booking Detail Drawer ─────────────────────────────────────── */

function BookingDetailDrawer({
  booking,
  onClose,
  onUpdateStatus,
  onConfirmPayment,
  onRejectPayment,
  onClearProof,
  onDelete,
  paymentMethodOptions,
  onUpdatePaymentMethod,
  isUpdating,
  settings,
  onUpdateDates,
}: {
  booking: any;
  onClose: () => void;
  onUpdateStatus: (status: string, notes?: string) => void;
  onConfirmPayment: (paymentId: number) => void;
  onRejectPayment: (paymentId: number) => void;
  onClearProof: (paymentId: number) => void;
  onDelete: (id: number) => void;
  paymentMethodOptions: PaymentMethodOption[];
  onUpdatePaymentMethod: (paymentId: number, paymentMethod: string) => void;
  isUpdating: boolean;
  settings?: any;
  onUpdateDates: (
    bookingId: number,
    bookingDate?: string,
    paymentDate?: string,
    startTime?: string,
    endTime?: string,
  ) => Promise<void>;
}) {
  const allPayments: any[] = booking.payments ?? (booking.payment ? [booking.payment] : []);
  const editablePayment =
    [...allPayments]
      .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))
      .find((payment) => payment.status === "pending" || payment.status === "confirmed") ??
    [...allPayments].sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))[0] ??
    booking.payment ??
    null;
  const paymentDateValue = editablePayment?.paidAt ?? editablePayment?.confirmedAt ?? booking.paidAt;
  const [adminNotes, setAdminNotes] = useState(booking.adminNotes ?? "");
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bookingDate, setBookingDate] = useState(String(booking.bookingDate ?? ""));
  const [paymentDate, setPaymentDate] = useState(
    paymentDateValue?.slice(0, 10) ?? "",
  );
  const [startTime, setStartTime] = useState(String(booking.startTime ?? "").slice(0, 5));
  const [endTime, setEndTime] = useState(String(booking.endTime ?? "").slice(0, 5));
  const [savingDates, setSavingDates] = useState(false);
  const originalBookingDate = String(booking.bookingDate ?? "");
  const originalPaymentDate = paymentDateValue?.slice(0, 10) ?? "";
  const originalStartTime = String(booking.startTime ?? "").slice(0, 5);
  const originalEndTime = String(booking.endTime ?? "").slice(0, 5);

  const cfg = STATUS_CONFIG[booking.status as BookingStatus] ?? STATUS_CONFIG.pending_payment;
  const StatusIcon = cfg.icon;

  const handleAction = (action: string) => {
    if (confirmAction === action) {
      if (action === "completed" || action === "cancelled" || action === "refunded") {
        onUpdateStatus(action, adminNotes);
      }
      setConfirmAction(null);
    } else {
      setConfirmAction(action);
    }
  };

  const isCompleted = booking.status === "completed" || booking.status === "confirmed";
  const hasConfirmedPaymentBookingMismatch =
    !isCompleted &&
    ["pending_payment", "waiting_confirmation", "paid"].includes(booking.status) &&
    allPayments.some((pmt) => pmt.status === "confirmed" && pmt.proofUrl);
  const datesChanged =
    bookingDate !== originalBookingDate ||
    paymentDate !== originalPaymentDate ||
    startTime !== originalStartTime ||
    endTime !== originalEndTime;

  const saveDates = async () => {
    if (
      !bookingDate ||
      (paymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) ||
      !/^\d{2}:\d{2}$/.test(startTime) ||
      !/^\d{2}:\d{2}$/.test(endTime) ||
      startTime >= endTime
    ) return;
    const nextBookingDate = bookingDate !== originalBookingDate ? bookingDate : undefined;
    const nextPaymentDate =
      paymentDate !== originalPaymentDate ? paymentDate || undefined : undefined;
    const nextStartTime = startTime !== originalStartTime ? startTime : undefined;
    const nextEndTime = endTime !== originalEndTime ? endTime : undefined;
    if (
      nextBookingDate === undefined &&
      nextPaymentDate === undefined &&
      nextStartTime === undefined &&
      nextEndTime === undefined
    ) return;
    setSavingDates(true);
    try {
      await onUpdateDates(
        booking.id,
        nextBookingDate,
        nextPaymentDate,
        nextStartTime,
        nextEndTime,
      );
    } finally {
      setSavingDates(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/25 dark:bg-black/50 z-40"
      />
      <motion.div
        key="drawer"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${cfg.bg}`}>
              <StatusIcon size={14} className={cfg.color} />
            </div>
            <div>
              <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                Detail Booking
              </div>
              <div className="text-xs text-slate-400 font-mono">{booking.orderNumber}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Invoice button */}
            <button
              onClick={() => printInvoice(booking, settings)}
              title="Cetak Invoice"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <FileText size={14} />
            </button>
            {/* Kwitansi button — only for completed */}
            {isCompleted && (
              <button
                onClick={() => printKwitansi(booking, settings)}
                title="Cetak Kwitansi"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
              >
                <Receipt size={14} />
              </button>
            )}
            {/* Document template preview — kwitansi uses booking.id directly */}
            {booking.id && (
              <button
                onClick={() => {
                  const apiBase = import.meta.env.VITE_API_BASE_URL ?? "/api";
                  const token = getToken() ?? "";
                  window.open(`${apiBase}/admin/documents/kwitansi/${booking.id}/preview?_token=${encodeURIComponent(token)}`, "_blank");
                }}
                title="Preview Kwitansi (Template)"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-violet-500 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
              >
                <Eye size={14} />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status Banner */}
          <div className={`flex items-center gap-3 p-3 rounded-xl border ${cfg.bg} ${cfg.pill}`}>
            <StatusIcon size={16} className={cfg.color} />
            <div>
              <div className={`text-sm font-bold ${cfg.color}`}>{cfg.label}</div>
              <div className="text-xs text-slate-500">
                {booking.status === "pending_payment" && "Menunggu customer upload bukti pembayaran"}
                {booking.status === "paid" && "Bukti transfer diterima — perlu verifikasi admin"}
                {(booking.status === "completed" || booking.status === "confirmed") && (
                  booking.payerType === "company"
                    ? "Booking perusahaan — dikonfirmasi otomatis, masuk tagihan bulanan"
                    : "Pembayaran sudah diverifikasi, booking aktif"
                )}
                {booking.status === "cancelled" && "Booking telah dibatalkan"}
                {booking.status === "refunded" && "Dana telah dikembalikan ke customer"}
              </div>
            </div>
          </div>

          {/* Event Discount Banner */}
          {(booking as any).bookingType === "event" && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20">
              <PartyPopper size={16} className="text-purple-600 dark:text-purple-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-purple-700 dark:text-purple-300">Booking Event — Diskon 21,4%</div>
                <div className="text-xs text-purple-500 dark:text-purple-400">
                  {(booking as any).eventDiscountAmount != null && Number((booking as any).eventDiscountAmount) > 0
                    ? `Diskon diterapkan: ${formatCurrency(Number((booking as any).eventDiscountAmount))} dari harga normal ${formatCurrency(Number((booking as any).basePrice ?? booking.totalPrice) + Number((booking as any).eventDiscountAmount))}`
                    : "Diskon event sudah diterapkan ke harga"}
                </div>
              </div>
            </div>
          )}

          {/* Company Billing Banner */}
          {booking.payerType === "company" && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20">
              <Building2 size={16} className="text-orange-600 dark:text-orange-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-orange-700 dark:text-orange-300">Tagihan Bulanan Perusahaan</div>
                <div className="text-xs text-orange-500 dark:text-orange-400">
                  Status tagihan: {" "}
                  {booking.billingStatus === "unbilled" && <span className="font-semibold">Belum Ditagih</span>}
                  {booking.billingStatus === "billed" && <span className="font-semibold text-blue-600">Sudah Ditagih</span>}
                  {booking.billingStatus === "paid" && <span className="font-semibold text-emerald-600">✓ Lunas</span>}
                  {!booking.billingStatus && "—"}
                </div>
              </div>
            </div>
          )}

          {/* Dokumentasi Corporate */}
          {booking.payerType === "company" && (
            <CorporateDocUpload
              bookingId={booking.id}
              isAdmin={true}
              canUpload={true}
            />
          )}

          {/* Customer Info */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Informasi Customer</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 text-sm">
              {booking.bookerName && booking.bookerName !== booking.customerName ? (
                <>
                  <InfoRow icon={User} label="Pemesan (WA)" value={booking.bookerName} span />
                  <InfoRow icon={Users} label="Yang Akan Main" value={booking.customerName} span />
                </>
              ) : (
                <InfoRow icon={User} label="Nama" value={booking.customerName} span />
              )}
              <InfoRow icon={Building2} label="Fasilitas" value={booking.facilityName} span />
              <div className="col-span-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-900/20 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  <CalendarDays size={13} /> Koreksi tanggal & jam
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Tanggal booking</Label>
                    <Input
                      type="date"
                      value={bookingDate}
                      onChange={(event) => setBookingDate(event.target.value)}
                      className="h-8 text-xs bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Tanggal pembayaran</Label>
                    <Input
                      type="date"
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                      disabled={!booking.payment && !booking.paidAt}
                      className="h-8 text-xs bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Jam mulai</Label>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                      className="h-8 text-xs bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Jam selesai</Label>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                      className="h-8 text-xs bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                {!booking.payment && !booking.paidAt && <div className="text-[10px] text-slate-500">Belum ada pembayaran untuk dikoreksi.</div>}
                <Button
                  size="sm"
                  onClick={saveDates}
                  disabled={!datesChanged || savingDates || !bookingDate}
                  className="h-8 text-xs"
                >
                  {savingDates ? "Menyimpan..." : "Simpan tanggal"}
                </Button>
              </div>
              <InfoRow icon={Clock} label="Waktu" value={`${booking.startTime?.slice(0, 5)} – ${booking.endTime?.slice(0, 5)}`} />
              <InfoRow icon={Hash} label="Durasi" value={`${booking.durationHours} jam`} />
              {/* Breakdown harga event */}
              {(booking as any).bookingType === "event" && (booking as any).eventDiscountAmount != null && Number((booking as any).eventDiscountAmount) > 0 && (
                <div className="col-span-2 border-t border-purple-100 dark:border-purple-800 pt-2.5 mt-1 space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Harga Normal</span>
                    <span className="line-through text-slate-400">{formatCurrency(Number((booking as any).basePrice ?? booking.totalPrice) + Number((booking as any).eventDiscountAmount))}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="flex items-center gap-1 text-purple-600"><PartyPopper size={11} />Diskon Event 21,4%</span>
                    <span className="font-semibold text-purple-600">−{formatCurrency(Number((booking as any).eventDiscountAmount))}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm border-t border-purple-100 dark:border-purple-800 pt-1.5 mt-1">
                    <span className="font-bold text-slate-700 dark:text-slate-200">Harga Setelah Diskon</span>
                    <span className="font-black text-purple-700 dark:text-purple-300">{formatCurrency(booking.totalPrice)}</span>
                  </div>
                </div>
              )}
              {booking.ppnAmount != null && Number(booking.ppnAmount) > 0 ? (
                <div className="col-span-2 border-t border-slate-100 dark:border-slate-700 pt-3 mt-1 space-y-1.5">
                  {(() => {
                    const gt = Number(booking.grandTotal ?? booking.totalPrice);
                    const dppCard = Math.round(gt / 1.11);
                    const dppNilaiLainCard = Math.round(dppCard * 11 / 12);
                    const ppnCard = gt - dppCard;
                    return (<>
                      <div className="flex justify-between items-center text-sm">
                        <span className="flex items-center gap-1 text-slate-500"><CreditCard size={11} />DPP</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(dppCard)}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-slate-400">
                        <span className="pl-3.5">DPP Nilai Lain (11/12 × DPP)</span>
                        <span>{formatCurrency(dppNilaiLainCard)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500 pl-3.5">PPN 12%</span>
                        <span className="text-orange-600 font-semibold">+{formatCurrency(ppnCard)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm border-t border-slate-100 dark:border-slate-700 pt-1.5 mt-1">
                        <span className="font-bold text-slate-700 dark:text-slate-200">Total DPP + PPN</span>
                        <span className="font-black text-emerald-600 dark:text-emerald-400 text-base">{formatCurrency(gt)}</span>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded font-semibold">PPN_OUT_12</span>
                        <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded font-semibold">DPP Nilai Lain</span>
                      </div>
                    </>);
                  })()}
                </div>
              ) : (
                <InfoRow
                  icon={CreditCard}
                  label="Total"
                  value={formatCurrency(booking.totalPrice)}
                  highlight
                />
              )}
              {booking.isDpPaid && (
                <div className="col-span-2 border-t border-violet-100 dark:border-violet-800 pt-2.5 mt-1 space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400"><CreditCard size={11} />DP Dibayar</span>
                    <span className="font-bold text-violet-700 dark:text-violet-300">{formatCurrency(Number(booking.downPayment || 0))}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Sisa Pembayaran</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400">{formatCurrency(Math.max(0, Number(booking.grandTotal ?? booking.totalPrice) - Number(booking.downPayment || 0)))}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {booking.notes && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Catatan Customer</div>
              <div className="text-sm text-slate-700 dark:text-slate-300">{booking.notes}</div>
            </div>
          )}

          {/* Payment Proof Section — multi-payment (DP + Pelunasan) */}
          {allPayments.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Riwayat Pembayaran</span>
                {booking.groupRef && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                    🏷️ Group Booking
                  </span>
                )}
              </div>
              {/* Group Booking banner */}
              {booking.groupRef && (
                <div className="px-4 py-2.5 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-100 dark:border-violet-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-violet-700 dark:text-violet-300 font-medium">
                      Grup: <span className="font-bold font-mono">{booking.groupRef}</span>
                    </span>
                    <span className="text-[10px] text-violet-600 dark:text-violet-400">
                      Konfirmasi 1 booking = konfirmasi seluruh sesi dalam grup
                    </span>
                  </div>
                </div>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {hasConfirmedPaymentBookingMismatch && (
                  <div className="m-4 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <div className="text-xs leading-relaxed">
                        Pembayaran sudah dikonfirmasi, tetapi status booking belum sinkron.
                        Gunakan tombol <span className="font-semibold">Sinkronkan Booking</span> di bawah.
                      </div>
                    </div>
                  </div>
                )}
                {allPayments.map((pmt: any) => {
                  const typeLabel =
                    pmt.paymentType === "dp"
                      ? "DP"
                      : pmt.paymentType === "pelunasan"
                      ? "Pelunasan"
                      : "Full Payment";
                  const typeColor =
                    pmt.paymentType === "dp"
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                      : pmt.paymentType === "pelunasan"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300";
                  const statusColor =
                    pmt.status === "confirmed"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : pmt.status === "rejected"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
                  const statusLabel =
                    pmt.status === "confirmed"
                      ? "Dikonfirmasi"
                      : pmt.status === "rejected"
                      ? "Ditolak"
                      : "Menunggu";
                  const isRepairingBooking =
                    pmt.status === "confirmed" &&
                    pmt.proofUrl &&
                    !isCompleted &&
                    ["pending_payment", "waiting_confirmation", "paid"].includes(booking.status);
                  const confirmLabel = isRepairingBooking
                    ? "Sinkronkan Booking"
                    : pmt.paymentType === "dp"
                      ? "Konfirmasi DP"
                      : "Konfirmasi → Selesai";
                  return (
                    <div key={pmt.id} className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeColor}`}>
                            {typeLabel}
                          </span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor}`}>
                            {statusLabel}
                          </span>
                        </div>
                        <span className="font-bold text-sm">{formatCurrency(pmt.amount)}</span>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-500 uppercase tracking-wide">
                          Metode Pembayaran
                        </Label>
                        <PaymentMethodSelect
                          payment={pmt}
                          options={paymentMethodOptions}
                          onChange={onUpdatePaymentMethod}
                          disabled={isUpdating}
                        />
                        {(() => {
                          const ocr = pmt.ocrData as {
                            paymentMethod?: string;
                            confidence?: number;
                            signals?: string[];
                            methodMatch?: boolean | null;
                            engine?: string;
                          } | null | undefined;
                          if (!ocr || ocr.engine !== "tesseract" || !ocr.paymentMethod || ocr.paymentMethod === "unknown") {
                            return (
                              <div className="text-[11px] text-slate-400">
                                OCR metode: belum dapat dibaca
                              </div>
                            );
                          }
                          const mismatch = ocr.methodMatch === false;
                          return (
                            <div className={`rounded-lg border px-2.5 py-2 text-[11px] ${
                              mismatch
                                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                            }`}>
                              <div className="flex items-center gap-1 font-semibold">
                                {mismatch ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                                OCR mendeteksi: {ocr.paymentMethod}
                                {typeof ocr.confidence === "number" && ocr.confidence > 0
                                  ? ` (${Math.round(ocr.confidence * 100)}%)`
                                  : ""}
                              </div>
                              {mismatch && (
                                <div className="mt-0.5">
                                  Sesuaikan metode sebelum konfirmasi pembayaran.
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      {pmt.proofUrl && <ProofImage proofUrl={pmt.proofUrl} />}
                      {((pmt.status === "pending" && pmt.proofUrl) || isRepairingBooking) && (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => onConfirmPayment(pmt.id)}
                            disabled={isUpdating}
                            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
                          >
                            <CheckCircle2 size={13} />
                            {confirmLabel}
                          </button>
                          <button
                            onClick={() => onRejectPayment(pmt.id)}
                            disabled={isUpdating}
                            className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                          >
                            <XCircle size={13} />
                            Tolak
                          </button>
                          <button
                            onClick={() => onClearProof(pmt.id)}
                            disabled={isUpdating}
                            title="Hapus bukti transfer"
                            className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-600 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Actions - Invoice / Kwitansi */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Dokumen</span>
            </div>
            <div className="p-3 flex flex-col gap-2">
              <a
                href={`/admin/invoice/${booking.orderNumber}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-orange-200 dark:border-orange-800 text-left hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors no-underline"
              >
                <FileText size={15} className="text-orange-500 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Invoice Template Baru</div>
                  <div className="text-[11px] text-slate-400">Preview · PDF · WhatsApp · Email</div>
                </div>
                <ExternalLink size={11} className="ml-auto text-slate-400" />
              </a>
              <button
                onClick={() => printInvoice(booking, settings)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-blue-200 dark:border-blue-800 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <FileText size={15} className="text-blue-500 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cetak Invoice (Lama)</div>
                  <div className="text-[11px] text-slate-400">Dokumen tagihan untuk semua status</div>
                </div>
              </button>
              {isCompleted ? (
                <button
                  onClick={() => printKwitansi(booking, settings)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 text-left hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                >
                  <Receipt size={15} className="text-emerald-500 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cetak Kwitansi</div>
                    <div className="text-[11px] text-slate-400">Bukti pembayaran lunas (completed)</div>
                  </div>
                </button>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 opacity-50">
                  <Receipt size={15} className="text-slate-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Kwitansi (khusus Completed)</div>
                    <div className="text-[11px] text-slate-400">Tersedia setelah pembayaran dikonfirmasi</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Admin Notes */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Catatan Admin (internal)
            </label>
            <Textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Catatan internal admin..."
              rows={2}
              className="text-sm rounded-xl border-slate-200 dark:border-slate-700 resize-none"
            />
            <button
              onClick={() => onUpdateStatus(booking.status, adminNotes)}
              disabled={isUpdating}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
            >
              Simpan catatan
            </button>
          </div>

          {/* Admin Status Actions */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Aksi Admin</span>
            </div>
            <div className="p-4 space-y-4">
              {/* Status Dropdown */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500">Ubah Status Langsung</label>
                <Select
                  value={booking.status}
                  onValueChange={(val) => {
                    setConfirmAction(val);
                  }}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="h-9 text-xs rounded-xl border-slate-200 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      { value: "pending_payment", label: "⏳ Menunggu Pembayaran" },
                      { value: "paid",            label: "💳 Menunggu Verifikasi" },
                      { value: "completed",       label: "✅ Selesai" },
                      { value: "cancelled",       label: "❌ Dibatalkan" },
                      { value: "refunded",        label: "↩️ Dikembalikan" },
                    ].map((o: {value:string;label:string}) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {confirmAction && confirmAction !== booking.status && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 mt-2"
                  >
                    <button
                      onClick={() => {
                        onUpdateStatus(confirmAction, adminNotes);
                        setConfirmAction(null);
                      }}
                      disabled={isUpdating}
                      className="flex-1 h-8 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
                    >
                      {isUpdating ? "Menyimpan..." : `Simpan → ${STATUS_CONFIG[confirmAction as BookingStatus]?.label ?? confirmAction}`}
                    </button>
                    <button
                      onClick={() => setConfirmAction(null)}
                      className="h-8 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Batal
                    </button>
                  </motion.div>
                )}
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
                <p className="text-xs text-slate-400">
                  Atau gunakan tombol cepat (klik dua kali untuk konfirmasi):
                </p>

                {booking.status !== "cancelled" && booking.status !== "refunded" && (
                  <ActionButton
                    action="cancelled"
                    label="Batalkan Booking"
                    description="Ubah status → Dibatalkan"
                    icon={XCircle}
                    confirmAction={confirmAction}
                    onClick={() => handleAction("cancelled")}
                    isUpdating={isUpdating}
                    variant="danger"
                  />
                )}

                {(booking.status === "completed" || booking.status === "confirmed" || booking.status === "cancelled") && (
                  <ActionButton
                    action="refunded"
                    label="Kembalikan Dana"
                    description="Ubah status → Dikembalikan"
                    icon={RotateCcw}
                    confirmAction={confirmAction}
                    onClick={() => handleAction("refunded")}
                    isUpdating={isUpdating}
                    variant="purple"
                  />
                )}

                {booking.status === "paid" && (
                  <ActionButton
                    action="completed"
                    label="Tandai Selesai"
                    description="Lewati verifikasi pembayaran → Selesai"
                    icon={CheckCircle2}
                    confirmAction={confirmAction}
                    onClick={() => handleAction("completed")}
                    isUpdating={isUpdating}
                    variant="success"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Riwayat Notifikasi WA */}
          <WaNotifLogsPanel bookingId={booking.id} />

          {/* Delete Booking */}
          <div className="rounded-xl border border-red-200 dark:border-red-900/40 overflow-hidden">
            <div className="px-4 py-2.5 bg-red-50 dark:bg-red-900/10 border-b border-red-200 dark:border-red-900/40">
              <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Zona Bahaya</span>
            </div>
            <div className="p-4">
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-red-200 dark:border-red-800 text-left hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={14} className="text-red-500 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-red-600">Hapus Booking</div>
                    <div className="text-[11px] text-slate-400">Menghapus permanen booking ini beserta data pembayaran</div>
                  </div>
                </button>
              ) : (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                  <p className="text-xs text-red-600 font-semibold">Yakin ingin menghapus booking ini? Tindakan ini tidak dapat dibatalkan.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { onDelete(booking.id); setConfirmDelete(false); }}
                      disabled={isUpdating}
                      className="flex-1 h-8 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
                    >
                      Ya, Hapus
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="h-8 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Batal
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  span,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  span?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <div className="flex items-center gap-1 text-xs text-slate-400 mb-0.5">
        <Icon size={11} />
        {label}
      </div>
      <div className={`text-sm font-semibold ${highlight ? "text-emerald-600 dark:text-emerald-400" : "text-slate-800 dark:text-slate-200"}`}>
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  action,
  label,
  description,
  icon: Icon,
  confirmAction,
  onClick,
  isUpdating,
  variant,
}: {
  action: string;
  label: string;
  description: string;
  icon: React.ElementType;
  confirmAction: string | null;
  onClick: () => void;
  isUpdating: boolean;
  variant: "danger" | "purple" | "success";
}) {
  const isPending = confirmAction === action;
  const variantStyles = {
    danger: isPending
      ? "bg-red-600 text-white border-red-600"
      : "border-red-200 dark:border-red-900/40 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20",
    purple: isPending
      ? "bg-purple-600 text-white border-purple-600"
      : "border-purple-200 dark:border-purple-900/40 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20",
    success: isPending
      ? "bg-emerald-600 text-white border-emerald-600"
      : "border-emerald-200 dark:border-emerald-900/40 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20",
  };

  return (
    <button
      onClick={onClick}
      disabled={isUpdating}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all disabled:opacity-50 ${variantStyles[variant]}`}
    >
      <Icon size={14} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold">
          {isPending ? `Klik lagi untuk konfirmasi ${label}` : label}
        </div>
        <div className={`text-[11px] ${isPending ? "opacity-80" : "opacity-60"}`}>{description}</div>
      </div>
      {isPending && (
        <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">KONFIRMASI</span>
      )}
    </button>
  );
}

/* ─── Inline Status Select ──────────────────────────────────────── */

const STATUS_OPTIONS = [
  { value: "pending_payment", label: "⏳ Menunggu Pembayaran" },
  { value: "paid",            label: "💳 Pembayaran Selesai" },
  { value: "confirmed",       label: "✅ Dikonfirmasi" },
  { value: "cancelled",       label: "❌ Dibatalkan" },
  { value: "refunded",        label: "↩️ Pengembalian Dana" },
];

function isBookingTimePast(bookingDate: string, endTime: string): boolean {
  const nowJKT = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const todayJKT = nowJKT.toISOString().split("T")[0];
  if (bookingDate < todayJKT) return true;
  if (bookingDate > todayJKT) return false;
  const nowMinutes = nowJKT.getUTCHours() * 60 + nowJKT.getUTCMinutes();
  const [endH, endM] = endTime.split(":").map(Number);
  return nowMinutes >= endH * 60 + endM;
}

function getNowJKT() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function isTimeReached(bookingDate: string, time: string): boolean {
  const nowJKT = getNowJKT();
  const todayJKT = nowJKT.toISOString().split("T")[0];
  if (bookingDate < todayJKT) return true;
  if (bookingDate > todayJKT) return false;
  const nowMin = nowJKT.getUTCHours() * 60 + nowJKT.getUTCMinutes();
  const [h, m] = time.split(":").map(Number);
  return nowMin >= h * 60 + m;
}

function InlineCheckInSelect({
  booking,
  onCheckIn,
  onComplete,
  isCheckingIn,
  isCompleting,
}: {
  booking: any;
  onCheckIn: (id: number) => void;
  onComplete: (id: number) => void;
  isCheckingIn: boolean;
  isCompleting: boolean;
}) {
  const [, setTick] = useState(0);

  // Re-render setiap 30 detik agar status berubah otomatis saat jam booking tiba
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const nowJKT = getNowJKT();
  const todayJKT = nowJKT.toISOString().split("T")[0];
  const isToday = booking.bookingDate === todayJKT;
  const isPast  = booking.bookingDate < todayJKT;
  const hasStarted = isTimeReached(booking.bookingDate, booking.startTime);
  const hasEnded   = isTimeReached(booking.bookingDate, booking.endTime);
  const isLoading  = isCheckingIn || isCompleting;

  // Sudah selesai / completed
  if (booking.status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800">
        <CheckCircle2 size={11} />
        Selesai
      </span>
    );
  }

  // Sudah check-in → sedang berlangsung, bisa tandai selesai
  if (booking.checkedInAt) {
    return (
      <Select
        value=""
        onValueChange={(val) => { if (val === "complete") onComplete(booking.id); }}
        disabled={isLoading}
      >
        <SelectTrigger
          className="h-7 min-w-[110px] gap-1.5 border rounded-full px-2.5 text-[11px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800"
          style={{ outline: "none" }}
        >
          {isLoading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />}
          <span>✓ Check-in {new Date(booking.checkedInAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="complete" className="text-xs">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-emerald-600" />
              Tandai Selesai
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // Sudah lewat jam selesai → perlu ditandai selesai
  if (hasEnded && booking.status === "confirmed") {
    return (
      <Select
        value=""
        onValueChange={(val) => { if (val === "complete") onComplete(booking.id); }}
        disabled={isLoading}
      >
        <SelectTrigger
          className="h-7 min-w-[110px] gap-1.5 border rounded-full px-2.5 text-[11px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"
          style={{ outline: "none" }}
        >
          {isLoading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />}
          <span>⏰ Sudah Lewat</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="complete" className="text-xs">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-emerald-600" />
              Tandai Selesai
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // Sedang berlangsung → check-in tersedia
  const isOngoing = isToday && hasStarted && !hasEnded;
  if (isOngoing && booking.status === "confirmed") {
    return (
      <Select
        value=""
        onValueChange={(val) => {
          if (val === "checkin") onCheckIn(booking.id);
          else if (val === "complete") onComplete(booking.id);
        }}
        disabled={isLoading}
      >
        <SelectTrigger
          className="h-7 min-w-[110px] gap-1.5 border rounded-full px-2.5 text-[11px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800 animate-pulse"
          style={{ outline: "none" }}
        >
          {isLoading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />}
          <span>🟢 Berlangsung</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="checkin" className="text-xs">
            <span className="flex items-center gap-1.5">
              <LogIn size={11} className="text-emerald-600" />
              Check-in Sekarang
            </span>
          </SelectItem>
          <SelectItem value="complete" className="text-xs">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-blue-600" />
              Tandai Selesai
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // Hari ini, belum mulai → menunggu jam booking
  if (isToday && !hasStarted && booking.status === "confirmed") {
    return (
      <Select
        value=""
        onValueChange={(val) => {
          if (val === "checkin") onCheckIn(booking.id);
          else if (val === "complete") onComplete(booking.id);
        }}
        disabled={isLoading}
      >
        <SelectTrigger
          className="h-7 min-w-[110px] gap-1.5 border rounded-full px-2.5 text-[11px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800"
          style={{ outline: "none" }}
        >
          {isLoading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />}
          <span>🕐 Mulai {booking.startTime?.slice(0, 5)}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="checkin" disabled className="text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <LogIn size={11} />
              Check-in (mulai {booking.startTime?.slice(0, 5)})
            </span>
          </SelectItem>
          <SelectItem value="complete" className="text-xs">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-blue-600" />
              Tandai Selesai
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // Booking belum hari ini (masa depan) atau booking lampau dikonfirmasi
  if (booking.status === "confirmed") {
    const label = isPast ? "📅 Lewat" : `📅 ${booking.bookingDate}`;
    return (
      <Select
        value=""
        onValueChange={(val) => {
          if (val === "checkin") onCheckIn(booking.id);
          else if (val === "complete") onComplete(booking.id);
        }}
        disabled={isLoading}
      >
        <SelectTrigger
          className="h-7 min-w-[110px] gap-1.5 border rounded-full px-2.5 text-[11px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/30 dark:text-slate-400 dark:border-slate-700"
          style={{ outline: "none" }}
        >
          {isLoading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />}
          <span>{label}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="checkin" className="text-xs">
            <span className="flex items-center gap-1.5">
              <LogIn size={11} className="text-emerald-600" />
              Check-in Manual
            </span>
          </SelectItem>
          <SelectItem value="complete" className="text-xs">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={11} className="text-blue-600" />
              Tandai Selesai
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return null;
}

function InlineStatusSelect({
  bookingId,
  status,
  onUpdate,
  isUpdating,
}: {
  bookingId: number;
  status: string;
  onUpdate: (id: number, status: string) => void;
  isUpdating: boolean;
}) {
  const cfg = STATUS_CONFIG[status as BookingStatus] ?? STATUS_CONFIG.pending_payment;
  const Icon = cfg.icon;

  return (
    <Select
      value={status}
      onValueChange={(val) => {
        if (val !== status) onUpdate(bookingId, val);
      }}
      disabled={isUpdating}
    >
      <SelectTrigger
        className={`h-7 w-auto min-w-0 gap-1.5 border rounded-full px-2.5 text-[11px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 ${cfg.bg} ${cfg.color} ${cfg.pill} disabled:opacity-70`}
        style={{ outline: "none" }}
      >
        <Icon size={11} className="shrink-0" />
        <SelectValue />
        {isUpdating && (
          <span className="ml-1 w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />
        )}
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ─── ExtendDialogBody ───────────────────────────────────────────── */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

function ExtendDialogBody({
  booking,
  extendHours,
  setExtendHours,
  onCancel,
  onSubmit,
  isPending,
}: {
  booking: { id: number; endTime: string; startTime: string; bookingDate: string; facilityName: string; orderNumber: string; customerName: string };
  extendHours: string;
  setExtendHours: (v: string) => void;
  onCancel: () => void;
  onSubmit: (extraHours: number) => void;
  isPending: boolean;
}) {
  const { data: options, isLoading } = useQuery({
    queryKey: ["extend-options", booking.id],
    queryFn: () =>
      fetch(`${API_BASE}/bookings/${booking.id}/extend-options`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("sport_center_token")}` },
      }).then((r) => r.json()),
    enabled: !!booking.id,
  });

  const availableHours: number[] = options?.availableHours ?? [];

  useEffect(() => {
    if (availableHours.length > 0 && !availableHours.includes(parseInt(extendHours))) {
      setExtendHours(String(availableHours[0]));
    }
  }, [availableHours.join(",")]);

  const extra = parseInt(extendHours) || 1;
  const newEndTime = (() => {
    const [h] = booking.endTime.split(":").map(Number);
    return `${String(h + extra).padStart(2, "0")}:00`;
  })();

  return (
    <div className="space-y-4">
      <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-0.5">
        <p className="font-semibold">{booking.customerName}</p>
        <p className="text-muted-foreground">{booking.orderNumber} · {booking.facilityName}</p>
        <p className="text-muted-foreground">{booking.bookingDate} · {booking.startTime}–<span className="font-semibold text-foreground">{booking.endTime}</span></p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-2">Mengecek ketersediaan slot...</p>
      ) : availableHours.length === 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 text-center">
          Tidak ada slot tersedia — jadwal berikutnya sudah penuh atau telah mencapai jam tutup.
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label>Tambah Durasi</Label>
            <Select value={extendHours} onValueChange={setExtendHours}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableHours.map((n) => (
                  <SelectItem key={n} value={String(n)}>+ {n} jam</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm">
            <p className="text-xs text-primary font-semibold mb-1">Jadwal setelah diperpanjang</p>
            <p>
              <span className="text-muted-foreground line-through">{booking.endTime}</span>
              {" → "}
              <span className="font-bold text-primary">{newEndTime}</span>
            </p>
          </div>
        </>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isPending}>
          Batal
        </Button>
        {availableHours.length > 0 && (
          <Button
            className="flex-1 bg-primary hover:bg-primary/90"
            disabled={isPending}
            onClick={() => onSubmit(extra)}
          >
            {isPending ? "Menyimpan..." : "Perpanjang"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ─── Merge Group Dialog ─────────────────────────────────────────── */

function MergeGroupDialog({
  open,
  onClose,
  selectedBookings,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  selectedBookings: any[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const autoTotal = selectedBookings.reduce((s, b) => s + Number(b.grandTotal ?? b.totalPrice), 0);
  const [totalInput, setTotalInput] = useState(String(autoTotal));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTotalInput(String(selectedBookings.reduce((s, b) => s + Number(b.grandTotal ?? b.totalPrice), 0)));
    setNotes("");
  }, [selectedBookings]);

  const handleSubmit = async () => {
    if (!selectedBookings.length) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/bookings/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          customer_phone: selectedBookings[0].customerPhone,
          booking_ids: selectedBookings.map((b) => b.orderNumber),
          total_payment: Number(totalInput),
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal membuat grup");
      toast({ title: `Grup ${data.groupRef} berhasil dibuat`, description: `${selectedBookings.length} booking digabung` });
      onCreated();
      onClose();
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers size={18} className="text-primary" /> Gabung Pembayaran
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
            {selectedBookings.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-3 py-2.5">
                <div>
                  <div className="font-mono text-xs font-bold text-slate-600 dark:text-slate-400">{b.orderNumber}</div>
                  <div className="text-xs text-slate-500">{b.facilityName} · {b.bookingDate} {b.startTime?.slice(0,5)}–{b.endTime?.slice(0,5)}</div>
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {formatCurrency(Number(b.grandTotal ?? b.totalPrice))}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50 dark:bg-slate-800/50">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Subtotal otomatis</span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{formatCurrency(autoTotal)}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Total Pembayaran (bisa diubah)</Label>
            <Input
              type="number"
              value={totalInput}
              onChange={(e) => setTotalInput(e.target.value)}
              className="text-sm"
              placeholder="Total yang harus dibayar customer"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Catatan (opsional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs resize-none"
              rows={2}
              placeholder="Misal: Bayar sekalian untuk 2 sesi..."
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>Batal</Button>
            <Button className="flex-1 bg-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Memproses..." : "Buat Grup Bayar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Component ────────────────────────────────────────────── */

export default function AdminBookings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [verifyBooking, setVerifyBooking] = useState<any>(null);
  const [fixDiscountId, setFixDiscountId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [extendBooking, setExtendBooking] = useState<any>(null);
  const [extendHours, setExtendHours] = useState("1");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [dissolvingRef, setDissolvingRef] = useState<string | null>(null);
  const [reapplyingRef, setReapplyingRef] = useState<string | null>(null);
  const [waAlertOpen, setWaAlertOpen] = useState(true);
  const [sendingWaId, setSendingWaId] = useState<number | null>(null);

  const {
    data: rawBookings,
    isLoading,
    error: bookingsError,
    refetch: refetchBookings,
  } = useListBookings();
  const bookings = rawBookings ?? [];
  const bookingErrorMessage =
    (bookingsError as any)?.message ?? "Gagal mengambil data booking dari server.";

  const { data: paymentSettings } = useQuery<any>({
    queryKey: ["paylabs-settings-payment-methods"],
    queryFn: async () => {
      const response = await fetch("/api/admin/paylabs/settings", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) throw new Error("Gagal mengambil metode pembayaran");
      return response.json();
    },
    staleTime: 60_000,
  });

  const paymentMethodOptions = useMemo<PaymentMethodOption[]>(() => {
    const options: PaymentMethodOption[] = [
      { value: "Transfer Bank", label: "Transfer Bank" },
      { value: "QRIS", label: "QRIS" },
      { value: "Cash", label: "Cash / Tunai" },
    ];
    const configured = Array.isArray(paymentSettings?.paymentMethodsConfig)
      ? paymentSettings.paymentMethodsConfig
      : [];

    for (const method of configured) {
      if (!method?.active || typeof method.name !== "string" || !method.name.trim()) continue;
      const id = String(method.id ?? "").trim().toLowerCase();
      const label = method.name.trim();
      if (!options.some((option) => option.value === label)) {
        options.push({ value: label, label, providerCode: id });
      }
    }
    return options;
  }, [paymentSettings]);

  const {
    data: waUnnotified = [],
    isLoading: waUnnotifiedLoading,
    refetch: refetchWaUnnotified,
  } = useQuery<any[]>({
    queryKey: ["wa-unnotified"],
    queryFn: () =>
      fetch("/api/admin/bookings/wa-unnotified", {
        headers: { Authorization: `Bearer ${getToken()}` },
      }).then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const handleResendWa = async (bookingId: number) => {
    setSendingWaId(bookingId);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/resend-wa`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast({ title: "WA berhasil dikirim ke admin" });
      refetchWaUnnotified();
    } catch (err: any) {
      toast({ title: "Gagal kirim WA", description: err?.message, variant: "destructive" });
    } finally {
      setSendingWaId(null);
    }
  };

  const { data: groupsData, refetch: refetchGroups } = useQuery({
    queryKey: ["booking-groups"],
    queryFn: () =>
      fetch("/api/bookings/groups", { headers: { Authorization: `Bearer ${getToken()}` } }).then((r) => r.json()),
    staleTime: 30_000,
  });
  const groups: any[] = Array.isArray(groupsData) ? groupsData : [];

  const groupsByRef = useMemo(() => {
    const m: Record<string, any> = {};
    for (const g of groups) m[g.groupRef] = g;
    return m;
  }, [groups]);

  const bookingCountByGroupRef = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of bookings as any[]) {
      if (b.groupRef) m[b.groupRef] = (m[b.groupRef] ?? 0) + 1;
    }
    return m;
  }, [bookings]);

  const dissolveGroup = async (groupRef: string) => {
    setDissolvingRef(groupRef);
    try {
      const res = await fetch(`/api/bookings/groups/${groupRef}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Gagal membubarkan grup");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() }),
        refetchGroups(),
      ]);
      toast({ title: `Grup ${groupRef} dibubarkan` });
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    } finally {
      setDissolvingRef(null);
    }
  };

  const reapplyGroupDiscount = async (groupRef: string) => {
    setReapplyingRef(groupRef);
    try {
      const res = await fetch(`/api/bookings/groups/${groupRef}/reapply-discount`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      toast({
        title: `Diskon diterapkan ke ${data.updatedCount} sesi`,
        description: data.message,
      });
    } catch (err: any) {
      toast({ title: "Gagal re-apply diskon", description: err.message, variant: "destructive" });
    } finally {
      setReapplyingRef(null);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleFixDiscount = async (booking: any) => {
    if (fixDiscountId !== null) return;
    const isMultiguna = `${booking.facilityName ?? ""} ${booking.facilityCategory ?? ""}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .includes("multiguna");
    const priceLabel = isMultiguna ? "Rp300.000/jam" : "diskon AP 20%";
    const confirmed = window.confirm(
      `Terapkan Fix Diskon untuk ${booking.orderNumber}?\n\n` +
      `Harga akan diubah menjadi ${priceLabel}. Status verifikasi ID Card tetap ${booking.verificationStatus ?? "pending"} ` +
      `dan tindakan ini dicatat sebagai override admin.`,
    );
    if (!confirmed) return;

    setFixDiscountId(booking.id);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/fix-discount`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menerapkan fix diskon");
      await queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      toast({
        title: "Fix Diskon berhasil",
        description: data.message ?? "Harga AP sudah diterapkan.",
      });
    } catch (err: any) {
      toast({
        title: "Fix Diskon gagal",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setFixDiscountId(null);
    }
  };


  const updateBookingMutation = useUpdateBooking({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Status booking diperbarui" });
        setSelectedBooking(data);
      },
      onError: () => toast({ title: "Gagal memperbarui booking", variant: "destructive" }),
    },
  });

  const updatePaymentMutation = useUpdatePayment({
    mutation: {
      onSuccess: (data, variables) => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Pembayaran diperbarui" });
        if (variables.data.paymentMethod !== undefined) {
          setSelectedBooking((current: any) => {
            if (!current) return current;
            const currentPayments = current.payments ?? (current.payment ? [current.payment] : []);
            const updatedPayments = currentPayments.map((payment: any) =>
              payment.id === data.id ? data : payment,
            );
            return {
              ...current,
              payments: updatedPayments,
              payment: current.payment?.id === data.id ? data : current.payment,
            };
          });
        } else {
          setSelectedBooking(null);
        }
      },
      onError: (error: any) =>
        toast({
          title: "Gagal memperbarui pembayaran",
          description: error?.message?.replace(/^HTTP \d+ [^:]+:\s*/, "") || "Terjadi kesalahan pada server.",
          variant: "destructive",
        }),
    },
  });

  // Edit metadata pembayaran (metode/provider) memakai endpoint khusus yang
  // tidak menyentuh status, konfirmasi, settlement, atau akuntansi finansial.
  const updatePaymentMetadataMutation = useUpdatePaymentMetadata({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Metadata pembayaran diperbarui" });
        setSelectedBooking((current: any) => {
          if (!current) return current;
          const currentPayments = current.payments ?? (current.payment ? [current.payment] : []);
          const updatedPayments = currentPayments.map((payment: any) =>
            payment.id === data.id ? data : payment,
          );
          return {
            ...current,
            payments: updatedPayments,
            payment: current.payment?.id === data.id ? data : current.payment,
          };
        });
      },
      onError: (error: any) =>
        toast({
          title: "Gagal memperbarui metadata pembayaran",
          description: error?.message?.replace(/^HTTP \d+ [^:]+:\s*/, "") || "Terjadi kesalahan pada server.",
          variant: "destructive",
        }),
    },
  });

  const updateDates = async (
    bookingId: number,
    bookingDate?: string,
    paymentDate?: string,
    startTime?: string,
    endTime?: string,
  ) => {
    const response = await fetch(`${API_BASE}/bookings/${bookingId}/dates`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        ...(bookingDate !== undefined ? { bookingDate } : {}),
        ...(paymentDate !== undefined ? { paymentDate } : {}),
        ...(startTime !== undefined ? { startTime } : {}),
        ...(endTime !== undefined ? { endTime } : {}),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error ?? "Gagal memperbarui tanggal";
      toast({ title: "Tanggal tidak dapat diperbarui", description: message, variant: "destructive" });
      throw new Error(message);
    }
    queryClient.setQueryData(getListBookingsQueryKey(), (current: any) =>
      Array.isArray(current)
        ? current.map((item) => item.id === data.id ? data : item)
        : current,
    );
    setSelectedBooking(data);
    toast({ title: "Tanggal berhasil diperbarui" });
  };

  const clearProofMutation = useMutation({
    mutationFn: async (paymentId: number) => {
      const res = await fetch(`${API_BASE}/payments/${paymentId}/proof`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Gagal menghapus bukti transfer");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      toast({ title: "Bukti transfer berhasil dihapus" });
      setSelectedBooking(null);
    },
    onError: (err: Error) =>
      toast({ title: err.message, variant: "destructive" }),
  });

  const checkInMutation = useCheckInBooking({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Check-in berhasil dicatat" });
      },
      onError: () => toast({ title: "Gagal check-in", variant: "destructive" }),
    },
  });

  const filtered = useMemo(() => {
    return bookings.filter((b: any) => {
      if (statusFilter !== "all") {
        const match =
          statusFilter === "completed"
            ? b.status === "completed" || b.status === "confirmed"
            : statusFilter === "waiting_confirmation"
            ? b.status === "waiting_confirmation" || b.status === "paid"
            : statusFilter === "cancelled"
            ? b.status === "cancelled" || b.status === "refunded"
            : b.status === statusFilter;
        if (!match) return false;
      }
      if (dateFrom && b.bookingDate < dateFrom) return false;
      if (dateTo && b.bookingDate > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          b.customerName?.toLowerCase().includes(q) ||
          b.companyName?.toLowerCase().includes(q) ||
          b.orderNumber?.toLowerCase().includes(q) ||
          b.facilityName?.toLowerCase().includes(q) ||
          b.customerPhone?.toLowerCase().includes(q)
        );
      }
      return true;
    }).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [bookings, statusFilter, search, dateFrom, dateTo]);

  const handleStatusUpdate = (status: string, adminNotes?: string) => {
    if (!selectedBooking) return;
    updateBookingMutation.mutate({
      id: selectedBooking.id,
      data: { status: status as any, adminNotes },
    });
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const token = getToken();
      const res = await fetch(`/api/bookings/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      toast({ title: "Booking berhasil dihapus" });
      setSelectedBooking(null);
    } catch (err: any) {
      toast({
        title: "Gagal menghapus booking",
        description: err?.message ?? "Terjadi kesalahan",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  // --- CSV Export with month filter ---
  const now = new Date();
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMonth, setExportMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [exportYear, setExportYear] = useState(String(now.getFullYear()));
  const [exportAllData, setExportAllData] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    const token = getToken();
    setIsExporting(true);
    try {
      let url = "/api/admin/bookings/export";
      let filename = "bookings.csv";
      if (!exportAllData) {
        const y = exportYear;
        const m = exportMonth;
        const lastDay = new Date(Number(y), Number(m), 0).getDate();
        const startDate = `${y}-${m}-01`;
        const endDate = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
        const monthNames = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
        filename = `bookings-${monthNames[Number(m) - 1]}-${y}.csv`;
        url += `?startDate=${startDate}&endDate=${endDate}`;
      }
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setShowExportModal(false);
    } finally {
      setIsExporting(false);
    }
  };

  const MONTHS = [
    { value: "01", label: "Januari" }, { value: "02", label: "Februari" },
    { value: "03", label: "Maret" }, { value: "04", label: "April" },
    { value: "05", label: "Mei" }, { value: "06", label: "Juni" },
    { value: "07", label: "Juli" }, { value: "08", label: "Agustus" },
    { value: "09", label: "September" }, { value: "10", label: "Oktober" },
    { value: "11", label: "November" }, { value: "12", label: "Desember" },
  ];
  const YEARS = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - 2 + i));

  const [isSyncing, setIsSyncing] = useState(false);
  const { data: syncPendingData, refetch: refetchPending } = useQuery({
    queryKey: ["sync-bizportal-pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sync-bizportal-payments/pending", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      return res.ok ? res.json() : { pending: 0 };
    },
    refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 min
    staleTime: 60 * 1000,
  });
  const pendingSyncCount: number = syncPendingData?.pending ?? 0;
  const handleSyncBizportal = async () => {
    setIsSyncing(true);
    try {
      const token = getToken();

      // 1. Sync booking data
      const bookingRes = await fetch("/api/admin/sync-bizportal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const bookingData = await bookingRes.json();
      if (!bookingRes.ok) throw new Error(bookingData.error || "Sync booking gagal");

      // 2. Sync payment data (jalankan di background, polling sampai selesai)
      await fetch("/api/admin/sync-bizportal-payments", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      let paymentDone = false;
      let paymentResult: any = {};
      for (let i = 0; i < 30 && !paymentDone; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch("/api/admin/sync-bizportal-payments/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        paymentResult = await statusRes.json();
        if (!paymentResult.running) paymentDone = true;
      }

      const pushedPayments = paymentResult.pushed ?? 0;
      const desc = pushedPayments > 0
        ? `${bookingData.total} booking + ${pushedPayments} payment baru dikirim ke Bizportal.`
        : `${bookingData.total} booking tersinkronkan (payment sudah up-to-date).`;
      toast({ title: "Sync ke Bizportal selesai", description: desc });
    } catch (err: any) {
      toast({ title: "Sync gagal", description: err.message, variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };


  const extendMutation = useMutation({
    mutationFn: ({ id, extraHours }: { id: number; extraHours: number }) =>
      fetch(`/api/bookings/${id}/extend-direct`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ extraHours }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Gagal memperpanjang");
        return data;
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      toast({ title: `Waktu diperpanjang +${extendHours} jam`, description: `Selesai pukul ${data.booking?.endTime ?? ""}` });
      setExtendBooking(null);
      setExtendHours("1");
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const isUpdating = updateBookingMutation.isPending || updatePaymentMutation.isPending || updatePaymentMetadataMutation.isPending || deletingId !== null;
  const pendingVerification = bookings.filter((b: any) => b.status === "paid").length;

  const mergeSelectedBookings = useMemo(
    () => filtered.filter((b: any) => selectedIds.has(b.id)),
    [filtered, selectedIds],
  );

  const canMerge = useMemo(() => {
    if (mergeSelectedBookings.length < 2) return false;
    const phones = new Set(mergeSelectedBookings.map((b: any) => b.customerPhone));
    return phones.size === 1;
  }, [mergeSelectedBookings]);

  const revenueStats = useMemo(() => {
    const getAmount = (b: any) =>
      b.grandTotal != null ? Number(b.grandTotal) : Number(b.totalPrice);
    // Konsisten dengan dashboard: lunas = uang sudah diterima
    // - Pribadi: status confirmed/completed
    // - Perusahaan: billingStatus = paid (invoice sudah lunas)
    const lunasBookings = filtered.filter((b: any) =>
      b.payerType === "company"
        ? b.billingStatus === "paid"
        : b.status === "confirmed" || b.status === "completed"
    );
    // Perusahaan: sudah confirmed/completed tapi invoice belum lunas
    const companyBelumInvoiceBookings = filtered.filter((b: any) =>
      b.payerType === "company" &&
      (b.status === "confirmed" || b.status === "completed") &&
      b.billingStatus !== "paid"
    );
    const menungguBookings = filtered.filter((b: any) =>
      b.status === "waiting_confirmation" || b.status === "paid"
    );
    const belumBayarBookings = filtered.filter((b: any) =>
      b.status === "pending_payment"
    );
    const totalLunas = lunasBookings.reduce((s: number, b: any) => s + getAmount(b), 0);
    const totalCompanyBelumInvoice = companyBelumInvoiceBookings.reduce((s: number, b: any) => s + getAmount(b), 0);
    const totalMenunggu = menungguBookings.reduce((s: number, b: any) => s + getAmount(b), 0);
    const totalBelumBayar = belumBayarBookings.reduce((s: number, b: any) => s + getAmount(b), 0);
    return {
      lunas: totalLunas,
      companyBelumInvoice: totalCompanyBelumInvoice,
      menunggu: totalMenunggu,
      belumBayar: totalBelumBayar,
      total: totalLunas + totalMenunggu + totalBelumBayar + totalCompanyBelumInvoice,
      lunasCount: lunasBookings.length,
      companyBelumInvoiceCount: companyBelumInvoiceBookings.length,
      menungguCount: menungguBookings.length,
      belumBayarCount: belumBayarBookings.length,
    };
  }, [filtered]);

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Pemesanan
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Kelola semua booking dan verifikasi pembayaran
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingVerification > 0 && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle size={12} />
              {pendingVerification} perlu verifikasi
            </motion.div>
          )}
          <button
            onClick={() => { handleSyncBizportal().then(() => refetchPending()); }}
            disabled={isSyncing}
            className="relative flex items-center gap-1.5 h-9 px-3 rounded-xl border border-blue-200 dark:border-blue-700 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? "Syncing..." : "Sync Bizportal"}
            {!isSyncing && pendingSyncCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                {pendingSyncCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Download size={13} />
            Ekspor CSV
          </button>
        </div>
      </motion.div>

      {/* Export CSV Modal */}
      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Download size={16} className="text-slate-500" />
              Ekspor CSV Pemesanan
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {/* Toggle: per-bulan vs semua */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <input
                type="checkbox"
                id="export-all"
                checked={exportAllData}
                onChange={(e) => setExportAllData(e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-500"
              />
              <Label htmlFor="export-all" className="text-sm cursor-pointer">
                Ekspor semua data (tanpa filter bulan)
              </Label>
            </div>

            {/* Month / Year pickers */}
            {!exportAllData && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Bulan</Label>
                    <Select value={exportMonth} onValueChange={setExportMonth}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Tahun</Label>
                    <Select value={exportYear} onValueChange={setExportYear}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={y}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Akan mengekspor booking dengan tanggal bermain di bulan {MONTHS.find(m => m.value === exportMonth)?.label} {exportYear}.
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1 h-9 text-sm"
                onClick={() => setShowExportModal(false)}
              >
                Batal
              </Button>
              <Button
                className="flex-1 h-9 text-sm gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                onClick={handleExport}
                disabled={isExporting}
              >
                <Download size={14} />
                {isExporting ? "Mengunduh..." : "Unduh CSV"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      {!isLoading && !bookingsError && (
        <SummaryStats
          bookings={bookings}
          activeFilter={statusFilter}
          onStatClick={(filter) => {
            setStatusFilter(filter);
            setTimeout(() => {
              document.getElementById("bookings-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 80);
          }}
        />
      )}

      {bookingsError && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <AlertCircle size={19} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Data booking gagal dimuat</p>
            <p className="mt-0.5 truncate text-sm text-red-700/80 dark:text-red-300/80">
              {bookingErrorMessage}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-red-300 bg-transparent text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/60"
            onClick={() => refetchBookings()}
          >
            <RefreshCw size={14} className="mr-1.5" />
            Coba lagi
          </Button>
        </div>
      )}

      {/* Revenue Summary */}
      {!isLoading && !bookingsError && filtered.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="rounded-2xl border border-emerald-200/70 dark:border-emerald-800/50 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30 px-5 py-4"
        >
          <div className="flex flex-wrap items-center gap-4 justify-between">
            {/* Total utama */}
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/15 dark:bg-emerald-500/20">
                <Receipt size={18} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
                  Total Revenue ({filtered.length} booking)
                </div>
                <div className="text-2xl font-black text-emerald-800 dark:text-emerald-300">
                  {formatCurrency(revenueStats.total)}
                </div>
              </div>
            </div>

            {/* Breakdown */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {revenueStats.lunas > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                    Lunas
                  </span>
                  <span className="font-black text-emerald-800 dark:text-emerald-200">
                    {formatCurrency(revenueStats.lunas)}
                  </span>
                  <span className="text-emerald-500 dark:text-emerald-500">
                    ({revenueStats.lunasCount})
                  </span>
                </div>
              )}
              {revenueStats.companyBelumInvoice > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800">
                  <CreditCard size={12} className="text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="text-blue-700 dark:text-blue-300 font-medium">
                    Perusahaan Belum Invoice
                  </span>
                  <span className="font-black text-blue-800 dark:text-blue-200">
                    {formatCurrency(revenueStats.companyBelumInvoice)}
                  </span>
                  <span className="text-blue-500 dark:text-blue-500">
                    ({revenueStats.companyBelumInvoiceCount})
                  </span>
                </div>
              )}
              {revenueStats.menunggu > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800">
                  <Clock size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="text-amber-700 dark:text-amber-300 font-medium">
                    Menunggu Konfirmasi
                  </span>
                  <span className="font-black text-amber-800 dark:text-amber-200">
                    {formatCurrency(revenueStats.menunggu)}
                  </span>
                  <span className="text-amber-500 dark:text-amber-500">
                    ({revenueStats.menungguCount})
                  </span>
                </div>
              )}
              {revenueStats.belumBayar > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <CreditCard size={12} className="text-slate-500 dark:text-slate-400 shrink-0" />
                  <span className="text-slate-600 dark:text-slate-400 font-medium">
                    Belum Bayar
                  </span>
                  <span className="font-black text-slate-700 dark:text-slate-300">
                    {formatCurrency(revenueStats.belumBayar)}
                  </span>
                  <span className="text-slate-400">
                    ({revenueStats.belumBayarCount})
                  </span>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* WA Belum Terkirim Panel */}
      {!waUnnotifiedLoading && waUnnotified.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-orange-200 dark:border-orange-800/60 bg-orange-50 dark:bg-orange-950/30 overflow-hidden"
        >
          {/* Header */}
          <button
            onClick={() => setWaAlertOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-orange-100/60 dark:hover:bg-orange-900/20 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
                <MessageSquare size={14} className="text-white" />
              </div>
              <div>
                <span className="font-bold text-sm text-orange-800 dark:text-orange-200">
                  WA Belum Terkirim
                </span>
                <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500 text-white">
                  {waUnnotified.length}
                </span>
              </div>
              <span className="text-xs text-orange-600 dark:text-orange-400 hidden sm:block">
                — Booking menunggu konfirmasi namun notifikasi WA ke admin belum terkirim
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); refetchWaUnnotified(); }}
                className="p-1.5 rounded-lg text-orange-500 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={13} />
              </button>
              {waAlertOpen ? (
                <ChevronUp size={16} className="text-orange-500 shrink-0" />
              ) : (
                <ChevronDown size={16} className="text-orange-500 shrink-0" />
              )}
            </div>
          </button>

          {/* List */}
          <AnimatePresence>
            {waAlertOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="divide-y divide-orange-100 dark:divide-orange-900/40 border-t border-orange-200 dark:border-orange-800/60">
                  {waUnnotified.map((b: any) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-orange-50/80 dark:hover:bg-orange-950/40"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="shrink-0 w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-slate-800 dark:text-white">
                              {b.orderNumber}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {b.customerName}
                            </span>
                            <span className="text-xs text-slate-400">·</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {b.facilityName}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {b.bookingDate} · {b.startTime}–{b.endTime} ·{" "}
                            <span className="font-semibold text-slate-600 dark:text-slate-300">
                              Rp {Number(b.totalPrice).toLocaleString("id-ID")}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setSelectedBooking(bookings.find((bk: any) => bk.id === b.id) ?? b)}
                          className="h-7 px-2.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
                        >
                          <Eye size={11} />
                          Detail
                        </button>
                        <button
                          onClick={() => handleResendWa(b.id)}
                          disabled={sendingWaId === b.id}
                          className="h-7 px-3 text-xs font-bold rounded-lg bg-orange-500 hover:bg-orange-600 text-white flex items-center gap-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {sendingWaId === b.id ? (
                            <>
                              <RefreshCw size={11} className="animate-spin" />
                              Mengirim...
                            </>
                          ) : (
                            <>
                              <Send size={11} />
                              Kirim WA
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Table Card */}
      <motion.div
        id="bookings-table"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="rounded-2xl border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm"
      >
        {/* Filters — sticky saat scroll */}
        <div className="sticky top-0 z-20 rounded-t-2xl px-4 lg:px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap gap-2.5 items-center">
          <div className="relative flex-1 min-w-44">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <Input
              className="pl-8 h-8 text-xs rounded-lg border-slate-200 dark:border-slate-700"
              placeholder="Cari nama, order, fasilitas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-44 text-xs rounded-lg border-slate-200 dark:border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <CalendarDays size={13} className="text-slate-400 shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <span className="text-xs text-slate-400">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <span className="text-xs text-slate-400 ml-auto shrink-0">
            {bookingsError ? "Data tidak tersedia" : `${filtered.length} booking`}
          </span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="p-5 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : bookingsError ? (
          <div className="flex min-h-40 items-center justify-center px-5 text-sm text-slate-500">
            Perbaiki koneksi server lalu tekan &quot;Coba lagi&quot;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 dark:border-slate-600 accent-primary w-3.5 h-3.5 cursor-pointer"
                      checked={filtered.length > 0 && filtered.every((b: any) => selectedIds.has(b.id))}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(new Set(filtered.map((b: any) => b.id)));
                        else setSelectedIds(new Set());
                      }}
                    />
                  </th>
                  {["Order", "Customer", "Fasilitas", "Tanggal & Waktu", "Durasi", "Metode", "Tgl Bayar", "Total", "Pembayaran", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {filtered.map((b: any, i: number) => (
                    <motion.tr
                      key={b.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.2 }}
                      className={`border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors group ${selectedIds.has(b.id) ? "bg-primary/5 dark:bg-primary/10" : ""}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 dark:border-slate-600 accent-primary w-3.5 h-3.5 cursor-pointer"
                          checked={selectedIds.has(b.id)}
                          onChange={() => toggleSelect(b.id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-400">
                          {b.orderNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {b.customerName?.charAt(0)?.toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs leading-tight">
                              {b.payerType === "company" && (b as any).companyName
                                ? (b as any).companyName
                                : b.customerName}
                            </div>
                            {b.payerType === "company" && (b as any).companyName && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                                a/n {b.customerName}
                              </div>
                            )}
                            <div className="text-[11px] text-slate-400">{b.customerPhone}</div>
                            {b.customerType === "angkasa_pura" && (
                              <div className="mt-0.5 flex items-center gap-1">
                                <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] px-1 py-0 gap-0.5 font-semibold">
                                  <Plane size={9} /> AP
                                </Badge>
                                {b.verificationStatus === "verified" && <span className="text-[9px] text-green-600 font-semibold">✓ Terverifikasi</span>}
                                {b.verificationStatus === "pending" && <span className="text-[9px] text-amber-600 font-semibold">Menunggu</span>}
                                {b.verificationStatus === "rejected" && <span className="text-[9px] text-red-500 font-semibold">Ditolak</span>}
                              </div>
                            )}
                            {(b as any).bookingType === "event" && (
                              <div className="mt-0.5 flex items-center gap-1">
                                <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[9px] px-1 py-0 gap-0.5 font-semibold">
                                  <PartyPopper size={9} /> Event
                                </Badge>
                              </div>
                            )}
                            {b.payerType === "company" && (
                              <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                                <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[9px] px-1 py-0 gap-0.5 font-semibold">
                                  <Building2 size={9} /> Perusahaan
                                </Badge>
                                {b.billingStatus === "unbilled" && <span className="text-[9px] text-amber-600 font-semibold">Belum Ditagih</span>}
                                {b.billingStatus === "billed" && <span className="text-[9px] text-blue-600 font-semibold">Sudah Ditagih</span>}
                                {b.billingStatus === "paid" && <span className="text-[9px] text-green-600 font-semibold">✓ Lunas</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {b.facilityName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {b.bookingDate}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {b.startTime?.slice(0, 5)} – {b.endTime?.slice(0, 5)}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                          {b.durationHours} jam
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                         <PaymentMethodSelect
                           payment={b.payment}
                           options={paymentMethodOptions}
                           onChange={(paymentId, paymentMethod) =>
                             updatePaymentMetadataMutation.mutate({
                               id: paymentId,
                               data: { paymentMethod },
                             })
                           }
                           disabled={updatePaymentMetadataMutation.isPending}
                         />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {b.payment?.confirmedAt ? (
                          <div>
                            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                              {new Date(b.payment.confirmedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {new Date(b.payment.confirmedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                        ) : b.payment?.updatedAt ? (
                          <span className="text-[11px] text-slate-400">
                            {new Date(b.payment.updatedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {/* Nominal utama: total grup jika group booking, individual jika bukan */}
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            {b.groupRef && groupsByRef[b.groupRef]
                              ? formatCurrency(groupsByRef[b.groupRef].totalPayment)
                              : formatCurrency(b.grandTotal ?? b.totalPrice)}
                          </span>
                          {b.groupRef && (
                            <div className="flex flex-col gap-0.5 mt-0.5">
                              {/* Badge Group Booking + jumlah booking */}
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-600 text-white dark:bg-violet-500">
                                  Group Booking
                                </span>
                                {bookingCountByGroupRef[b.groupRef] && (
                                  <span className="text-[10px] text-violet-500 dark:text-violet-400 font-semibold">
                                    {bookingCountByGroupRef[b.groupRef]} Booking
                                  </span>
                                )}
                              </div>
                              {/* Ref grup + nominal sesi ini */}
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700">
                                  <Link2 size={9} /> {b.groupRef}
                                </span>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                  sesi ini: {formatCurrency(b.grandTotal ?? b.totalPrice)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <InlineStatusSelect
                          bookingId={b.id}
                          status={b.status}
                          onUpdate={(id, status) =>
                            updateBookingMutation.mutate({ id, data: { status: status as any } })
                          }
                          isUpdating={updateBookingMutation.isPending && updateBookingMutation.variables?.id === b.id}
                        />
                        {b.status === "paid" && b.payment?.proofUrl && (
                          <div className="text-[10px] text-blue-500 mt-0.5 font-medium">
                            Bukti diterima ↗
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {(b.status === "confirmed" || b.status === "completed" || b.checkedInAt) ? (
                          <InlineCheckInSelect
                            booking={b}
                            onCheckIn={(id) => checkInMutation.mutate({ id })}
                            onComplete={(id) => updateBookingMutation.mutate({ id, data: { status: "completed" } })}
                            isCheckingIn={checkInMutation.isPending && checkInMutation.variables?.id === b.id}
                            isCompleting={updateBookingMutation.isPending && updateBookingMutation.variables?.id === b.id}
                          />
                        ) : b.status === "pending_payment" ? (
                          b.isDpPaid ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-800">
                              <CreditCard size={11} />
                              Sisa DP
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                              <Clock size={11} />
                              Menunggu Bayar
                            </span>
                          )
                        ) : b.status === "waiting_confirmation" || b.status === "paid" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800">
                            <CreditCard size={11} />
                            Verifikasi
                          </span>
                        ) : b.status === "cancelled" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
                            <XCircle size={11} />
                            Dibatalkan
                          </span>
                        ) : b.status === "refunded" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800">
                            <RotateCcw size={11} />
                            Refund
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <motion.button
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setSelectedBooking(b)}
                            className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Eye size={12} />
                            Detail
                          </motion.button>
                          {(b.status === "confirmed" || b.status === "paid") && (
                            <motion.button
                              whileHover={{ scale: 1.04 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => { setExtendBooking(b); setExtendHours("1"); }}
                              className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold text-orange-600 border border-orange-300 hover:bg-orange-50 transition-colors whitespace-nowrap"
                            >
                              <Clock size={12} />
                              +Waktu
                            </motion.button>
                          )}
                          {b.customerType === "angkasa_pura" && b.verificationStatus !== "verified" && (
                            <motion.button
                              whileHover={{ scale: 1.04 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => setVerifyBooking(b)}
                              className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold text-primary border border-primary/30 hover:bg-primary/10 transition-colors whitespace-nowrap"
                            >
                              <ShieldCheck size={12} />
                              {b.verificationStatus === "rejected" ? "Verifikasi Ulang" : "Verifikasi ID"}
                            </motion.button>
                          )}
                          {b.customerType === "angkasa_pura"
                            && b.verificationStatus !== "verified"
                            && !["cancelled", "expired", "refunded"].includes(b.status)
                            && (
                              <motion.button
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                onClick={() => void handleFixDiscount(b)}
                                disabled={fixDiscountId === b.id}
                                className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold text-emerald-600 border border-emerald-300 hover:bg-emerald-50 transition-colors whitespace-nowrap disabled:opacity-50"
                              >
                                {fixDiscountId === b.id ? (
                                  <span className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <CheckCircle2 size={12} />
                                )}
                                {fixDiscountId === b.id ? "Memproses..." : "Fix Diskon"}
                              </motion.button>
                            )}
                          {b.groupRef && (
                            <>
                              <motion.button
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                title={`Invoice Grup ${b.groupRef}`}
                                className="flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-semibold text-violet-700 border border-violet-400 bg-violet-50 hover:bg-violet-100 dark:border-violet-600 dark:bg-violet-900/30 dark:hover:bg-violet-900/50 transition-colors opacity-0 group-hover:opacity-100 whitespace-nowrap"
                                onClick={() => {
                                  const win = window.open("about:blank", "_blank");
                                  if (!win) return;
                                  fetch(`/api/invoices/group/${b.groupRef}/html`, {
                                    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
                                  })
                                    .then(r => {
                                      if (!r.ok) throw new Error(`HTTP ${r.status}`);
                                      return r.text();
                                    })
                                    .then(html => {
                                      win.document.open();
                                      win.document.write(html);
                                      win.document.close();
                                      try { win.opener = null; } catch { /* abaikan */ }
                                    })
                                    .catch(() => {
                                      win.document.write("<h2 style='font-family:sans-serif;padding:40px;color:#dc2626'>Gagal memuat invoice. Silakan coba lagi.</h2>");
                                      win.document.close();
                                    });
                                }}
                              >
                                <FileText size={12} />
                                Inv. Grup
                              </motion.button>
                              {b.customerType === "angkasa_pura" && (
                                <motion.button
                                  whileHover={{ scale: 1.04 }}
                                  whileTap={{ scale: 0.96 }}
                                  onClick={() => reapplyGroupDiscount(b.groupRef!)}
                                  disabled={reapplyingRef === b.groupRef}
                                  title="Terapkan ulang diskon AP ke semua sesi grup"
                                  className="flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-semibold text-emerald-700 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 transition-colors opacity-0 group-hover:opacity-100 whitespace-nowrap disabled:opacity-50"
                                >
                                  {reapplyingRef === b.groupRef ? (
                                    <span className="w-3 h-3 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <ShieldCheck size={12} />
                                  )}
                                  Fix Diskon
                                </motion.button>
                              )}
                              <motion.button
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                onClick={() => dissolveGroup(b.groupRef!)}
                                disabled={dissolvingRef === b.groupRef}
                                title="Bubarkan grup bayar"
                                className="flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-semibold text-violet-600 border border-violet-300 hover:bg-violet-50 dark:border-violet-700 dark:hover:bg-violet-900/20 transition-colors opacity-0 group-hover:opacity-100 whitespace-nowrap disabled:opacity-50"
                              >
                                {dissolvingRef === b.groupRef ? (
                                  <span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Unlink size={12} />
                                )}
                                Pisah
                              </motion.button>
                            </>
                          )}
                          {deleteConfirmId === b.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { handleDelete(b.id); setDeleteConfirmId(null); }}
                                disabled={deletingId === b.id}
                                className="h-7 px-2 rounded-lg text-[11px] font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                Hapus?
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="h-7 px-1.5 rounded-lg text-[11px] border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ) : (
                            <motion.button
                              whileHover={{ scale: 1.04 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => setDeleteConfirmId(b.id)}
                              title="Hapus booking"
                              disabled={deletingId === b.id}
                              className="flex items-center justify-center h-7 w-7 rounded-lg border border-red-200 dark:border-red-900/50 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                            >
                              {deletingId === b.id ? (
                                <span className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                            </motion.button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={13} className="py-16 text-center text-slate-400 text-sm">
                      <CalendarCheck size={32} className="mx-auto mb-3 opacity-30" />
                      Tidak ada booking yang ditemukan
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Floating Action Bar for bulk-select */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl bg-slate-900 dark:bg-slate-800 text-white border border-slate-700"
          >
            <span className="text-sm font-semibold">{selectedIds.size} booking dipilih</span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="flex items-center justify-center h-8 w-8 rounded-xl border border-slate-600 hover:bg-slate-700 transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail Drawer */}
      {selectedBooking && (
        <BookingDetailDrawer
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onUpdateStatus={handleStatusUpdate}
          onConfirmPayment={(paymentId) =>
            updatePaymentMutation.mutate({ id: paymentId, data: { status: "confirmed" } })
          }
          onRejectPayment={(paymentId) =>
            updatePaymentMutation.mutate({ id: paymentId, data: { status: "rejected" } })
          }
           paymentMethodOptions={paymentMethodOptions}
           onUpdatePaymentMethod={(paymentId, paymentMethod) =>
             updatePaymentMetadataMutation.mutate({ id: paymentId, data: { paymentMethod } })
           }
          onClearProof={(paymentId) => clearProofMutation.mutate(paymentId)}
          onDelete={handleDelete}
          isUpdating={isUpdating || clearProofMutation.isPending}
           onUpdateDates={updateDates}
        />
      )}

      <VerifyIdDialog booking={verifyBooking} onClose={() => setVerifyBooking(null)} />

      <MergeGroupDialog
        open={showMergeDialog}
        onClose={() => setShowMergeDialog(false)}
        selectedBookings={mergeSelectedBookings}
        onCreated={() => {
          setSelectedIds(new Set());
          queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
          refetchGroups();
        }}
      />

      {/* Extend Time Dialog */}
      <Dialog open={!!extendBooking} onOpenChange={(o) => !o && setExtendBooking(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock size={18} className="text-primary" /> Tambah Waktu Booking
            </DialogTitle>
          </DialogHeader>
          {extendBooking && (
            <ExtendDialogBody
              booking={extendBooking}
              extendHours={extendHours}
              setExtendHours={setExtendHours}
              onCancel={() => setExtendBooking(null)}
              onSubmit={(extraHours) => extendMutation.mutate({ id: extendBooking.id, extraHours })}
              isPending={extendMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
