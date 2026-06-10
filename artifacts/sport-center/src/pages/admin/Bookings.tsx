import { useState, useMemo, useEffect } from "react";
import {
  useListBookings,
  useUpdateBooking,
  useUpdatePayment,
  useCheckInBooking,
  getListBookingsQueryKey,
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
  Building2,
  Hash,
  CalendarDays,
  AlertTriangle,
  FileImage,
  Trash2,
  FileText,
  Receipt,
  Plane,
  ShieldCheck,
  RefreshCw,
  LogIn,
} from "lucide-react";
import { getToken } from "@/lib/auth";
import VerifyIdDialog from "@/components/admin/VerifyIdDialog";

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

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as BookingStatus] ?? STATUS_CONFIG.pending_payment;
  const Icon = cfg.icon;
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

/* ─── Invoice / Kwitansi Print ──────────────────────────────────── */

function printInvoice(booking: any, settings?: any) {
  const centerName = settings?.centerName ?? "Sport Center";
  const address = settings?.address ?? "";
  const phone = settings?.phone ?? "";
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <title>Invoice ${booking.orderNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 680px; margin: auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #f97316; padding-bottom: 20px; margin-bottom: 28px; }
    .brand { font-size: 24px; font-weight: 900; color: #f97316; letter-spacing: -0.5px; }
    .brand-sub { font-size: 12px; color: #777; margin-top: 2px; }
    .invoice-meta { text-align: right; }
    .invoice-title { font-size: 28px; font-weight: 900; color: #111; letter-spacing: -1px; }
    .invoice-num { font-size: 13px; color: #555; margin-top: 4px; font-family: monospace; }
    .invoice-date { font-size: 12px; color: #777; margin-top: 2px; }
    .section { margin-bottom: 22px; }
    .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 8px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
    .info-item label { font-size: 11px; color: #888; display: block; margin-bottom: 1px; }
    .info-item value, .info-item span { font-size: 13px; font-weight: 600; color: #222; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    thead tr { background: #f8f8f8; }
    th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #666; border-bottom: 2px solid #eee; }
    td { padding: 12px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
    .total-row { background: #fff8f4; }
    .total-row td { font-weight: 900; font-size: 15px; color: #f97316; border-top: 2px solid #f97316; border-bottom: none; }
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
      <div class="invoice-num">${booking.orderNumber}</div>
      <div class="invoice-date">Tanggal: ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Informasi Customer</div>
    <div class="info-grid">
      <div class="info-item"><label>Nama</label><span>${booking.customerName}</span></div>
      <div class="info-item"><label>No. HP</label><span>${booking.customerPhone || "-"}</span></div>
      <div class="info-item"><label>Email</label><span>${booking.customerEmail || "-"}</span></div>
      <div class="info-item"><label>Status</label><span class="status-badge ${
        booking.status === "completed" || booking.status === "confirmed" ? "status-completed" :
        booking.status === "cancelled" ? "status-cancelled" : "status-pending"
      }">${STATUS_CONFIG[booking.status as BookingStatus]?.label ?? booking.status}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Detail Pemesanan</div>
    <table>
      <thead>
        <tr>
          <th>Fasilitas</th>
          <th>Tanggal</th>
          <th>Jam</th>
          <th>Durasi</th>
          <th style="text-align:right">Harga</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${booking.facilityName}</td>
          <td>${formatDate(booking.bookingDate)}</td>
          <td>${booking.startTime?.slice(0,5)} – ${booking.endTime?.slice(0,5)}</td>
          <td>${booking.durationHours} jam</td>
          <td style="text-align:right;font-weight:600">${formatCurrency(booking.totalPrice)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="4" style="text-align:right;padding-right:16px">Total</td>
          <td style="text-align:right">${formatCurrency(booking.totalPrice)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${booking.notes ? `<div class="section"><div class="section-title">Catatan</div><p style="font-size:13px;color:#555">${booking.notes}</p></div>` : ""}

  <div class="footer">
    Dokumen ini dicetak secara otomatis oleh sistem ${centerName}. Terima kasih atas kepercayaan Anda.
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
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

function printKwitansi(booking: any, settings?: any) {
  const centerName = settings?.centerName ?? "Sport Center";
  const address = settings?.address ?? "";
  const phone = settings?.phone ?? "";
  const bankName = settings?.bankName ?? "";
  const bankAccount = settings?.bankAccount ?? "";
  const bankAccountName = settings?.bankAccountName ?? "";
  const logoUrl = settings?.logoUrl ?? "";
  const now = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  const dpp = Math.round(Number(booking.totalPrice));
  const ppn = Math.round(dpp * 0.12);
  const total = dpp + ppn;
  const terbilangText = terbilang(total) + " Rupiah";

  const statusLabel = booking.status === "completed" ? "Lunas" :
    booking.status === "confirmed" ? "Dikonfirmasi" :
    booking.status === "cancelled" ? "Dibatalkan" : booking.status;

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #e5e7eb;" />`
    : `<div style="width:56px;height:56px;border-radius:50%;background:#f97316;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;flex-shrink:0;">SC</div>`;

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
      <div class="kwitansi-num">${booking.orderNumber}</div>
      <div class="kwitansi-date">Tanggal Kwitansi</div>
      <div style="font-size:11px;color:#333;margin-top:2px;">${now}</div>
    </div>
  </div>

  <hr class="divider"/>

  <div class="section-title">Informasi Customer</div>
  <div class="info-grid">
    <div class="info-cell">
      <div class="info-label">Nama</div>
      <div class="info-value">${booking.customerName}</div>
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
  </div>

  <div class="section-title">Detail Pemesanan</div>
  <table>
    <thead>
      <tr>
        <th>Fasilitas</th>
        <th>Tanggal</th>
        <th>Jam</th>
        <th>Durasi</th>
        <th>Harga</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${booking.facilityName}</td>
        <td>${formatDate(booking.bookingDate)}</td>
        <td>${booking.startTime?.slice(0,5)} – ${booking.endTime?.slice(0,5)}</td>
        <td>${booking.durationHours} Jam</td>
        <td>${formatCurrency(dpp)}</td>
      </tr>
      <tr><td colspan="5" style="padding:4px;background:#fff7f3;"></td></tr>
    </tbody>
  </table>

  <div class="totals-section">
    <table class="totals-table">
      <tr>
        <td>DPP</td>
        <td>${formatCurrency(dpp)}</td>
      </tr>
      <tr>
        <td>PPN 12%</td>
        <td>${formatCurrency(ppn)}</td>
      </tr>
      <tr class="grand-total">
        <td>Total DPP + PPN</td>
        <td>${formatCurrency(total)}</td>
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

/* ─── Booking Detail Drawer ─────────────────────────────────────── */

function BookingDetailDrawer({
  booking,
  onClose,
  onUpdateStatus,
  onConfirmPayment,
  onRejectPayment,
  onDelete,
  isUpdating,
  settings,
}: {
  booking: any;
  onClose: () => void;
  onUpdateStatus: (status: string, notes?: string) => void;
  onConfirmPayment: (paymentId: number) => void;
  onRejectPayment: (paymentId: number) => void;
  onDelete: (id: number) => void;
  isUpdating: boolean;
  settings?: any;
}) {
  const [adminNotes, setAdminNotes] = useState(booking.adminNotes ?? "");
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const isPaymentPending = booking.payment?.status === "pending";
  const hasPaymentProof = !!booking.payment?.proofUrl;
  const isCompleted = booking.status === "completed" || booking.status === "confirmed";

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

          {/* Customer Info */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Informasi Customer</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 text-sm">
              <InfoRow icon={User} label="Nama" value={booking.customerName} span />
              <InfoRow icon={Building2} label="Fasilitas" value={booking.facilityName} span />
              <InfoRow icon={CalendarDays} label="Tanggal" value={formatDate(booking.bookingDate)} />
              <InfoRow icon={Clock} label="Waktu" value={`${booking.startTime?.slice(0, 5)} – ${booking.endTime?.slice(0, 5)}`} />
              <InfoRow icon={Hash} label="Durasi" value={`${booking.durationHours} jam`} />
              <InfoRow
                icon={CreditCard}
                label="Total"
                value={formatCurrency(booking.totalPrice)}
                highlight
              />
            </div>
          </div>

          {booking.notes && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Catatan Customer</div>
              <div className="text-sm text-slate-700 dark:text-slate-300">{booking.notes}</div>
            </div>
          )}

          {/* Payment Proof Section */}
          {booking.payment && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bukti Pembayaran</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  booking.payment.status === "confirmed"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : booking.payment.status === "rejected"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                }`}>
                  {booking.payment.status === "confirmed" ? "Dikonfirmasi" : booking.payment.status === "rejected" ? "Ditolak" : "Menunggu"}
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Jumlah Transfer</span>
                  <span className="font-bold">{formatCurrency(booking.payment.amount)}</span>
                </div>
                {booking.payment.proofUrl && (
                  <ProofImage proofUrl={booking.payment.proofUrl} />
                )}

                {/* Payment Action Buttons */}
                {isPaymentPending && hasPaymentProof && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => onConfirmPayment(booking.payment.id)}
                      disabled={isUpdating}
                      className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle2 size={13} />
                      Konfirmasi → Completed
                    </button>
                    <button
                      onClick={() => onRejectPayment(booking.payment.id)}
                      disabled={isUpdating}
                      className="flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                    >
                      <XCircle size={13} />
                      Tolak
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Actions - Invoice / Kwitansi */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Dokumen</span>
            </div>
            <div className="p-3 flex flex-col gap-2">
              <button
                onClick={() => printInvoice(booking, settings)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-blue-200 dark:border-blue-800 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <FileText size={15} className="text-blue-500 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cetak Invoice</div>
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
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [extendBooking, setExtendBooking] = useState<any>(null);
  const [extendHours, setExtendHours] = useState("1");

  const { data: rawBookings, isLoading } = useListBookings();
  const bookings = rawBookings ?? [];

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
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Pembayaran diperbarui" });
        setSelectedBooking(null);
      },
      onError: () => toast({ title: "Gagal memperbarui pembayaran", variant: "destructive" }),
    },
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

  const handleExport = () => {
    const token = getToken();
    fetch("/api/admin/bookings/export", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "bookings.csv";
        a.click();
      });
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const handleSyncBizportal = async () => {
    setIsSyncing(true);
    try {
      const token = getToken();
      const res = await fetch("/api/admin/sync-bizportal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Sync ke Bizportal berhasil",
          description: `${data.synced} dari ${data.total} booking berhasil disinkronkan.`,
        });
      } else {
        throw new Error(data.error || "Sync gagal");
      }
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

  const isUpdating = updateBookingMutation.isPending || updatePaymentMutation.isPending || deletingId !== null;
  const pendingVerification = bookings.filter((b: any) => b.status === "paid").length;

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
            onClick={handleSyncBizportal}
            disabled={isSyncing}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-blue-200 dark:border-blue-700 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? "Syncing..." : "Sync Bizportal"}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Download size={13} />
            Ekspor CSV
          </button>
        </div>
      </motion.div>

      {/* Stats */}
      {!isLoading && (
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
            {filtered.length} booking
          </span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="p-5 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
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
                      className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors group"
                    >
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
                              {b.customerName}
                            </div>
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
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          {b.payment?.paymentMethod ?? (b.payment ? "Transfer Bank" : "—")}
                        </span>
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
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {formatCurrency(b.totalPrice)}
                        </span>
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
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                            <Clock size={11} />
                            Menunggu Bayar
                          </span>
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
                              Verifikasi ID
                            </motion.button>
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
                    <td colSpan={12} className="py-16 text-center text-slate-400 text-sm">
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
          onDelete={handleDelete}
          isUpdating={isUpdating}
        />
      )}

      <VerifyIdDialog booking={verifyBooking} onClose={() => setVerifyBooking(null)} />

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
