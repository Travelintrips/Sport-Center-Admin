import { useState, useMemo } from "react";
import {
  useListBookings,
  useUpdateBooking,
  useUpdatePayment,
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
} from "lucide-react";

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
    label: "Pending Payment",
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
    label: "Completed",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    icon: CheckCircle2,
    pill: "border-emerald-200 dark:border-emerald-800",
  },
  completed: {
    label: "Completed",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    icon: CheckCircle2,
    pill: "border-emerald-200 dark:border-emerald-800",
  },
  cancelled: {
    label: "Cancelled",
    color: "text-red-700 dark:text-red-300",
    bg: "bg-red-100 dark:bg-red-900/30",
    icon: XCircle,
    pill: "border-red-200 dark:border-red-800",
  },
  refunded: {
    label: "Refunded",
    color: "text-purple-700 dark:text-purple-300",
    bg: "bg-purple-100 dark:bg-purple-900/30",
    icon: RotateCcw,
    pill: "border-purple-200 dark:border-purple-800",
  },
};

const FILTER_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "pending_payment", label: "Pending Payment" },
  { value: "paid", label: "Menunggu Verifikasi" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
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

/* ─── Summary Stats ─────────────────────────────────────────────── */

function SummaryStats({ bookings }: { bookings: any[] }) {
  const today = new Date().toISOString().split("T")[0];
  const stats = [
    {
      label: "Total Booking",
      value: bookings.length,
      icon: CalendarCheck,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-900/20",
      border: "border-blue-200/60 dark:border-blue-800/40",
    },
    {
      label: "Perlu Verifikasi",
      value: bookings.filter((b) => b.status === "paid").length,
      icon: CreditCard,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-900/20",
      border: "border-amber-200/60 dark:border-amber-800/40",
    },
    {
      label: "Completed",
      value: bookings.filter((b) => b.status === "completed" || b.status === "confirmed").length,
      icon: CheckCircle2,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
      border: "border-emerald-200/60 dark:border-emerald-800/40",
    },
    {
      label: "Cancelled / Refunded",
      value: bookings.filter((b) => b.status === "cancelled" || b.status === "refunded").length,
      icon: Ban,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-900/20",
      border: "border-red-200/60 dark:border-red-800/40",
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
        return (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            whileHover={{ y: -1 }}
            className={`rounded-2xl border ${s.border} ${s.bg} bg-white dark:bg-slate-900 p-4 shadow-sm`}
          >
            <div className={`p-2 rounded-xl ${s.bg} w-fit mb-3`}>
              <Icon size={16} className={s.color} />
            </div>
            <div className={`text-3xl font-black ${s.color} mb-0.5`}>{s.value}</div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{s.label}</div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

/* ─── Booking Detail Drawer ─────────────────────────────────────── */

function BookingDetailDrawer({
  booking,
  onClose,
  onUpdateStatus,
  onConfirmPayment,
  onRejectPayment,
  isUpdating,
}: {
  booking: any;
  onClose: () => void;
  onUpdateStatus: (status: string, notes?: string) => void;
  onConfirmPayment: (paymentId: number) => void;
  onRejectPayment: (paymentId: number) => void;
  isUpdating: boolean;
}) {
  const [adminNotes, setAdminNotes] = useState(booking.adminNotes ?? "");
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

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
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={15} />
          </button>
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
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-500">Bukti Transfer</div>
                    {/\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(booking.payment.proofUrl) ? (
                      <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 group">
                        <img
                          src={booking.payment.proofUrl}
                          alt="Bukti transfer"
                          className="w-full max-h-52 object-contain bg-slate-50 dark:bg-slate-800"
                        />
                        <a
                          href={booking.payment.proofUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors"
                        >
                          <span className="opacity-0 group-hover:opacity-100 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-opacity">
                            <ExternalLink size={11} /> Buka penuh
                          </span>
                        </a>
                      </div>
                    ) : (
                      <a
                        href={booking.payment.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      >
                        <FileImage size={14} /> Lihat File Bukti
                        <ExternalLink size={11} className="ml-auto" />
                      </a>
                    )}
                  </div>
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

          {/* Admin Notes */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Admin Notes (internal)
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
                      { value: "pending_payment", label: "⏳ Pending Payment" },
                      { value: "paid",            label: "💳 Menunggu Verifikasi" },
                      { value: "completed",       label: "✅ Completed" },
                      { value: "cancelled",       label: "❌ Cancelled" },
                      { value: "refunded",        label: "↩️ Refunded" },
                    ].map((o) => (
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

                {/* Cancel */}
                {booking.status !== "cancelled" && booking.status !== "refunded" && (
                  <ActionButton
                    action="cancelled"
                    label="Batalkan Booking"
                    description="Set status → Cancelled"
                    icon={XCircle}
                    confirmAction={confirmAction}
                    onClick={() => handleAction("cancelled")}
                    isUpdating={isUpdating}
                    variant="danger"
                  />
                )}

                {/* Refund */}
                {(booking.status === "completed" || booking.status === "confirmed" || booking.status === "cancelled") && (
                  <ActionButton
                    action="refunded"
                    label="Kembalikan Dana"
                    description="Set status → Refunded"
                    icon={RotateCcw}
                    confirmAction={confirmAction}
                    onClick={() => handleAction("refunded")}
                    isUpdating={isUpdating}
                    variant="purple"
                  />
                )}

                {/* Manual complete */}
                {booking.status === "paid" && (
                  <ActionButton
                    action="completed"
                    label="Tandai Completed"
                    description="Bypass verifikasi payment → Completed"
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
      : "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20",
    purple: isPending
      ? "bg-purple-600 text-white border-purple-600"
      : "border-purple-200 text-purple-600 hover:bg-purple-50 dark:border-purple-800 dark:hover:bg-purple-900/20",
    success: isPending
      ? "bg-emerald-600 text-white border-emerald-600"
      : "border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-900/20",
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
  { value: "pending_payment", label: "⏳ Pending Payment" },
  { value: "paid",            label: "💳 Menunggu Verifikasi" },
  { value: "completed",       label: "✅ Completed" },
  { value: "cancelled",       label: "❌ Cancelled" },
  { value: "refunded",        label: "↩️ Refunded" },
];

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

  const filtered = useMemo(() => {
    return bookings.filter((b: any) => {
      if (statusFilter !== "all") {
        const match =
          statusFilter === "completed"
            ? b.status === "completed" || b.status === "confirmed"
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

  const handleExport = () => {
    const token = localStorage.getItem("sport_center_token");
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

  const isUpdating = updateBookingMutation.isPending || updatePaymentMutation.isPending;

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
            Bookings
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
            onClick={handleExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>
      </motion.div>

      {/* Stats */}
      {!isLoading && <SummaryStats bookings={bookings} />}

      {/* Table Card */}
      <motion.div
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
                  {["Order", "Customer", "Fasilitas", "Tanggal & Waktu", "Total", "Status", ""].map((h) => (
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
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
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
                        <motion.button
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => setSelectedBooking(b)}
                          className="flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Eye size={12} />
                          Detail
                        </motion.button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400 text-sm">
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
          isUpdating={isUpdating}
        />
      )}
    </div>
  );
}
