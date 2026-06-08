import { useState, useMemo } from "react";
import {
  useListBookings,
  useUpdateBooking,
  useUpdatePayment,
  useCheckInBooking,
  getListBookingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  // /api/storage/objects/* → redirect to working /api/uploads/* path
  if (rawUrl.startsWith("/api/storage/objects/")) {
    const withoutPrefix = rawUrl.replace(/^\/api\/storage\/objects\//, "");
    return `/api/uploads/${withoutPrefix}`;
  }
  // Already a working /api/uploads/ path — serve as-is
  if (rawUrl.startsWith("/api/")) return rawUrl;
  // Old Supabase-style /objects/... → /api/uploads/...
  if (rawUrl.startsWith("/objects/")) {
    return `/api/uploads/${rawUrl.replace(/^\/objects\//, "")}`;
  }
  // External URL — use as-is
  if (rawUrl.startsWith("http")) return rawUrl;
  // Bare filename or relative path — assume it lives in uploads
  return `/api/uploads/${rawUrl.replace(/^\/+/, "")}`;
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
    label: "Menunggu Verifikasi",
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
    label: "Dikembalikan",
    color: "text-purple-700 dark:text-purple-300",
    bg: "bg-purple-100 dark:bg-purple-900/30",
    icon: RotateCcw,
    pill: "border-purple-200 dark:border-purple-800",
  },
};

const FILTER_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "pending_payment", label: "Menunggu Pembayaran" },
  { value: "paid", label: "Menunggu Verifikasi" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
  { value: "refunded", label: "Dikembalikan" },
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

function printKwitansi(booking: any, settings?: any) {
  const centerName = settings?.centerName ?? "Sport Center";
  const address = settings?.address ?? "";
  const phone = settings?.phone ?? "";
  const now = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <title>Kwitansi ${booking.orderNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 600px; margin: auto; }
    .outer { border: 2px solid #1a1a1a; border-radius: 8px; padding: 28px 32px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #1a1a1a; }
    .brand { font-size: 20px; font-weight: 900; color: #f97316; }
    .brand-sub { font-size: 11px; color: #777; }
    .kwitansi-title { font-size: 22px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase; }
    .num-row { display: flex; justify-content: space-between; font-size: 12px; color: #666; margin-bottom: 20px; }
    .row { display: flex; margin-bottom: 12px; align-items: flex-start; }
    .row label { width: 160px; font-size: 12px; color: #888; flex-shrink: 0; padding-top: 1px; }
    .row span { font-size: 14px; font-weight: 600; flex: 1; }
    .amount-box { background: #fff8f4; border: 2px solid #f97316; border-radius: 6px; padding: 14px 18px; margin: 20px 0; text-align: center; }
    .amount-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 4px; }
    .amount-value { font-size: 28px; font-weight: 900; color: #f97316; letter-spacing: -1px; }
    .sig { display: flex; justify-content: flex-end; margin-top: 32px; }
    .sig-box { text-align: center; }
    .sig-box .line { border-bottom: 1px solid #aaa; width: 160px; margin: 48px auto 4px; }
    .sig-box .name { font-size: 12px; font-weight: 700; }
    .sig-box .title { font-size: 11px; color: #888; }
    .stamp { display: inline-block; border: 3px solid #059669; border-radius: 50%; padding: 6px 12px; color: #059669; font-weight: 900; font-size: 13px; letter-spacing: 2px; transform: rotate(-15deg); margin-bottom: 8px; }
    .footer { margin-top: 20px; font-size: 10px; color: #aaa; text-align: center; }
    @media print { body { padding: 10px; } }
  </style>
</head>
<body>
  <div class="outer">
    <div class="header">
      <div>
        <div class="brand">${centerName}</div>
        <div class="brand-sub">${address}</div>
        <div class="brand-sub">${phone}</div>
      </div>
      <div class="kwitansi-title">Kwitansi</div>
    </div>

    <div class="num-row">
      <span>No: <strong>${booking.orderNumber}</strong></span>
      <span>Tanggal: <strong>${now}</strong></span>
    </div>

    <div class="row"><label>Diterima dari</label><span>${booking.customerName}</span></div>
    <div class="row"><label>No. HP</label><span>${booking.customerPhone || "-"}</span></div>
    <div class="row"><label>Untuk pembayaran</label><span>Sewa ${booking.facilityName}</span></div>
    <div class="row"><label>Tanggal booking</label><span>${formatDate(booking.bookingDate)}</span></div>
    <div class="row"><label>Waktu</label><span>${booking.startTime?.slice(0,5)} – ${booking.endTime?.slice(0,5)} (${booking.durationHours} jam)</span></div>

    <div class="amount-box">
      <div class="amount-label">Jumlah Pembayaran</div>
      <div class="amount-value">${formatCurrency(booking.totalPrice)}</div>
    </div>

    <div class="sig">
      <div class="sig-box">
        <div class="stamp">LUNAS</div>
        <div class="line"></div>
        <div class="name">Admin</div>
        <div class="title">${centerName}</div>
      </div>
    </div>
  </div>
  <div class="footer">Kwitansi ini sah tanpa tanda tangan basah. Dicetak ${now}.</div>
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
                {(booking.status === "completed" || booking.status === "confirmed") && "Pembayaran sudah diverifikasi, booking aktif"}
                {booking.status === "cancelled" && "Booking telah dibatalkan"}
                {booking.status === "refunded" && "Dana telah dikembalikan ke customer"}
              </div>
            </div>
          </div>

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
  { value: "paid",            label: "💳 Menunggu Verifikasi" },
  { value: "completed",       label: "✅ Selesai" },
  { value: "cancelled",       label: "❌ Dibatalkan" },
  { value: "refunded",        label: "↩️ Dikembalikan" },
];

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
  const todayJKT = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const isToday = booking.bookingDate === todayJKT;
  const isLoading = isCheckingIn || isCompleting;

  const currentLabel = booking.checkedInAt
    ? `✓ ${new Date(booking.checkedInAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
    : "— Pilih";

  const triggerClass = booking.checkedInAt
    ? "h-7 min-w-[80px] gap-1.5 border rounded-full px-2.5 text-[11px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800"
    : "h-7 min-w-[80px] gap-1.5 border rounded-full px-2.5 text-[11px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/30 dark:text-slate-400 dark:border-slate-700";

  return (
    <Select
      value=""
      onValueChange={(val) => {
        if (val === "checkin") onCheckIn(booking.id);
        else if (val === "complete") onComplete(booking.id);
      }}
      disabled={isLoading}
    >
      <SelectTrigger className={triggerClass} style={{ outline: "none" }}>
        {isLoading ? (
          <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />
        ) : null}
        <span>{currentLabel}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          value="checkin"
          disabled={!!booking.checkedInAt || !isToday}
          className="text-xs"
        >
          <span className="flex items-center gap-1.5">
            <LogIn size={11} className="text-emerald-600" />
            {booking.checkedInAt ? "Sudah Check-in" : !isToday ? `Check-in (${booking.bookingDate})` : "Check-in"}
          </span>
        </SelectItem>
        <SelectItem value="complete" className="text-xs">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={11} className="text-blue-600" />
            Selesai
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
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

/* ─── Main Component ────────────────────────────────────────────── */

export default function AdminBookings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [verifyBooking, setVerifyBooking] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

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
    });
  }, [bookings, statusFilter, search]);

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
        className="rounded-2xl border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      >
        {/* Filters */}
        <div className="px-4 lg:px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-2.5 items-center">
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
            <SelectTrigger className="h-8 w-48 text-xs rounded-lg border-slate-200 dark:border-slate-700">
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
                  {["Order", "Customer", "Fasilitas", "Tanggal & Waktu", "Durasi", "Metode", "Tgl Bayar", "Check-In", "Total", "Status", ""].map((h) => (
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
                      <td className="px-4 py-3 whitespace-nowrap">
                        {(b.status === "confirmed" || b.status === "completed" || b.checkedInAt) ? (
                          <InlineCheckInSelect
                            booking={b}
                            onCheckIn={(id) => checkInMutation.mutate({ id })}
                            onComplete={(id) => updateBookingMutation.mutate({ id, data: { status: "completed" } })}
                            isCheckingIn={checkInMutation.isPending && checkInMutation.variables?.id === b.id}
                            isCompleting={updateBookingMutation.isPending && updateBookingMutation.variables?.id === b.id}
                          />
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
    </div>
  );
}
