import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  Search,
  RefreshCw,
  Send,
  CreditCard,
  MessageSquare,
  Clock,
  User,
  CalendarDays,
  ChevronRight,
  Bot,
  Phone,
} from "lucide-react";
import { getToken } from "@/lib/auth";

/* ─── Types ─────────────────────────────────────────────────────────────────── */
type WaBooking = {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  facilityId: number;
  facilityName: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: string;
  grandTotal: string | null;
  status: string;
  source: string;
  adminNotes: string | null;
  approvedByAdminPhone: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  paidAt: string | null;
  paymentDeadline: string | null;
  createdAt: string;
};

type DetailData = {
  booking: Record<string, any>;
  facility: Record<string, any> | null;
  session: Record<string, any> | null;
  messages: any[];
  history: any[];
  auditLogs: any[];
};

/* ─── Status config ─────────────────────────────────────────────────────────── */
const STATUS_TABS = [
  { value: "all", label: "Semua" },
  { value: "waiting_admin_approval", label: "Menunggu Persetujuan" },
  { value: "pending_payment", label: "Menunggu Bayar" },
  { value: "waiting_confirmation", label: "Menunggu Konfirmasi" },
  { value: "confirmed", label: "Dikonfirmasi" },
  { value: "rejected", label: "Ditolak" },
  { value: "cancelled", label: "Dibatalkan" },
];

function statusBadge(status: string) {
  const map: Record<string, { label: string; class: string }> = {
    waiting_admin_approval: { label: "Menunggu Persetujuan", class: "bg-yellow-100 text-yellow-800 border-yellow-300" },
    pending_payment:        { label: "Menunggu Bayar",       class: "bg-blue-100 text-blue-800 border-blue-300" },
    waiting_confirmation:   { label: "Menunggu Konfirmasi",  class: "bg-orange-100 text-orange-800 border-orange-300" },
    confirmed:              { label: "Dikonfirmasi",         class: "bg-green-100 text-green-800 border-green-300" },
    rejected:               { label: "Ditolak",              class: "bg-red-100 text-red-800 border-red-300" },
    cancelled:              { label: "Dibatalkan",           class: "bg-gray-100 text-gray-700 border-gray-300" },
    completed:              { label: "Selesai",              class: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  };
  const cfg = map[status] ?? { label: status, class: "bg-gray-100 text-gray-700 border-gray-300" };
  return <Badge variant="outline" className={`text-xs font-semibold ${cfg.class}`}>{cfg.label}</Badge>;
}

function formatIDR(n: string | number | null) {
  if (n === null || n === undefined) return "-";
  return "Rp " + Number(n).toLocaleString("id-ID");
}

function formatDate(s: string | null) {
  if (!s) return "-";
  return new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ─── API helpers ───────────────────────────────────────────────────────────── */
async function apiFetch(path: string, opts?: RequestInit) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/* ─── Main component ──────────────────────────────────────────────────────── */
export default function AdminWaBookings() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ orderNumber: string; open: boolean }>({ orderNumber: "", open: false });
  const [rejectReason, setRejectReason] = useState("");

  const queryKey = ["wa-bookings", activeTab, search];

  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" });
      if (activeTab !== "all") params.set("status", activeTab);
      if (search) params.set("search", search);
      return apiFetch(`/admin/wa-bookings?${params}`);
    },
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ["wa-booking-detail", selectedOrder],
    queryFn: () => apiFetch(`/admin/wa-bookings/${selectedOrder}/detail`),
    enabled: !!selectedOrder,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["wa-bookings"] });
    if (selectedOrder) qc.invalidateQueries({ queryKey: ["wa-booking-detail", selectedOrder] });
  }

  function mutate(path: string, body?: object) {
    return apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
  }

  const approveMutation = useMutation({
    mutationFn: (orderNumber: string) => mutate(`/admin/wa-bookings/${orderNumber}/approve`),
    onSuccess: (_d, orderNumber) => {
      toast({ title: `✅ ${orderNumber} disetujui`, description: "Customer diberitahu untuk melakukan pembayaran." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Gagal approve", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ orderNumber, reason }: { orderNumber: string; reason: string }) =>
      mutate(`/admin/wa-bookings/${orderNumber}/reject`, { reason }),
    onSuccess: (_d, { orderNumber }) => {
      toast({ title: `🚫 ${orderNumber} ditolak`, description: "Customer diberitahu via WA." });
      setRejectDialog({ orderNumber: "", open: false });
      setRejectReason("");
      invalidate();
    },
    onError: (e: any) => toast({ title: "Gagal reject", description: e.message, variant: "destructive" }),
  });

  const paidMutation = useMutation({
    mutationFn: (orderNumber: string) => mutate(`/admin/wa-bookings/${orderNumber}/paid`),
    onSuccess: (_d, orderNumber) => {
      toast({ title: `💰 ${orderNumber} dikonfirmasi LUNAS`, description: "Customer diberitahu via WA." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Gagal konfirmasi paid", description: e.message, variant: "destructive" }),
  });

  const resendMutation = useMutation({
    mutationFn: (orderNumber: string) => mutate(`/admin/wa-bookings/${orderNumber}/resend`),
    onSuccess: (d, orderNumber) => {
      toast({ title: `📨 Resend ${orderNumber}`, description: `WA dikirim ke ${d.sentTo}` });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Gagal resend", description: e.message, variant: "destructive" }),
  });

  const bookings: WaBooking[] = data?.bookings ?? [];
  const total: number = data?.total ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">WA Booking Approval</h1>
          <p className="text-muted-foreground text-sm">Booking masuk via WhatsApp Chat — kelola persetujuan & pembayaran</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 w-fit">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setActiveTab(t.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.value
                ? "bg-primary text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari nama, HP, order..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput); }}
          />
        </div>
        <Button variant="secondary" onClick={() => setSearch(searchInput)}>Cari</Button>
        {search && <Button variant="ghost" onClick={() => { setSearch(""); setSearchInput(""); }}>Reset</Button>}
      </div>

      {/* Count */}
      <p className="text-sm text-muted-foreground">{isLoading ? "Memuat..." : `${total} booking ditemukan`}</p>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-3 text-left font-semibold">Order</th>
              <th className="px-4 py-3 text-left font-semibold">Customer</th>
              <th className="px-4 py-3 text-left font-semibold">Fasilitas</th>
              <th className="px-4 py-3 text-left font-semibold">Jadwal</th>
              <th className="px-4 py-3 text-left font-semibold">Total</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b">
                {Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                ))}
              </tr>
            ))}
            {!isLoading && bookings.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Tidak ada booking WA ditemukan</td></tr>
            )}
            {bookings.map((b) => (
              <tr key={b.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono font-semibold text-primary">{b.orderNumber}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{b.customerName}</div>
                  {b.bookerName && b.bookerName !== b.customerName && (
                    <div className="text-xs text-muted-foreground">Pemesan: {b.bookerName}</div>
                  )}
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3" />{b.customerPhone}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{b.facilityName ?? "-"}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{b.bookingDate}</div>
                  <div className="text-xs text-muted-foreground">{b.startTime}–{b.endTime}</div>
                </td>
                <td className="px-4 py-3 font-semibold">{formatIDR(b.grandTotal ?? b.totalPrice)}</td>
                <td className="px-4 py-3">{statusBadge(b.status)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => setSelectedOrder(b.orderNumber)}
                    >
                      <MessageSquare className="w-3 h-3" /> Detail
                    </Button>
                    {b.status === "waiting_admin_approval" && (
                      <>
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 px-2 text-xs text-green-700 hover:bg-green-50 gap-1"
                          onClick={() => approveMutation.mutate(b.orderNumber)}
                          disabled={approveMutation.isPending}
                        >
                          <CheckCircle2 className="w-3 h-3" /> Setujui
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 px-2 text-xs text-red-700 hover:bg-red-50 gap-1"
                          onClick={() => { setRejectDialog({ orderNumber: b.orderNumber, open: true }); setRejectReason(""); }}
                        >
                          <XCircle className="w-3 h-3" /> Tolak
                        </Button>
                      </>
                    )}
                    {["pending_payment", "waiting_confirmation"].includes(b.status) && (
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 px-2 text-xs text-blue-700 hover:bg-blue-50 gap-1"
                        onClick={() => paidMutation.mutate(b.orderNumber)}
                        disabled={paidMutation.isPending}
                      >
                        <CreditCard className="w-3 h-3" /> Lunas
                      </Button>
                    )}
                    {["waiting_admin_approval", "pending_payment", "confirmed"].includes(b.status) && (
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 px-2 text-xs text-orange-700 hover:bg-orange-50 gap-1"
                        onClick={() => resendMutation.mutate(b.orderNumber)}
                        disabled={resendMutation.isPending}
                      >
                        <Send className="w-3 h-3" /> Resend WA
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedOrder} onOpenChange={(o) => { if (!o) setSelectedOrder(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Detail WA Booking — {selectedOrder}
            </SheetTitle>
          </SheetHeader>

          {loadingDetail && <div className="space-y-3 mt-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}

          {detail && !loadingDetail && (
            <div className="mt-4 space-y-5">
              {/* Booking info */}
              <div className="rounded-xl border p-4 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="font-black text-lg">{detail.booking.orderNumber}</span>
                  {statusBadge(detail.booking.status)}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {detail.booking.bookerName && detail.booking.bookerName !== detail.booking.customerName ? (
                    <>
                      <div><span className="text-muted-foreground">Pemesan:</span> <span className="font-medium">{detail.booking.bookerName}</span></div>
                      <div><span className="text-muted-foreground">Yang Main:</span> <span className="font-medium">{detail.booking.customerName}</span></div>
                    </>
                  ) : (
                    <div><span className="text-muted-foreground">Customer:</span> <span className="font-medium">{detail.booking.customerName}</span></div>
                  )}
                  <div><span className="text-muted-foreground">HP:</span> <span className="font-medium">{detail.booking.customerPhone}</span></div>
                  <div><span className="text-muted-foreground">Fasilitas:</span> <span className="font-medium">{detail.facility?.name ?? "-"}</span></div>
                  <div><span className="text-muted-foreground">Tanggal:</span> <span className="font-medium">{detail.booking.bookingDate}</span></div>
                  <div><span className="text-muted-foreground">Waktu:</span> <span className="font-medium">{detail.booking.startTime}–{detail.booking.endTime}</span></div>
                  <div><span className="text-muted-foreground">Total:</span> <span className="font-semibold text-primary">{formatIDR(detail.booking.grandTotal ?? detail.booking.totalPrice)}</span></div>
                  {detail.booking.approvedByAdminPhone && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Disetujui oleh:</span>{" "}
                      <span className="font-medium">{detail.booking.approvedByAdminPhone}</span>{" "}
                      {detail.booking.approvedAt && <span className="text-xs text-muted-foreground">({formatDate(detail.booking.approvedAt)})</span>}
                    </div>
                  )}
                  {detail.booking.rejectedReason && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Alasan ditolak:</span>{" "}
                      <span className="font-medium text-red-700">{detail.booking.rejectedReason}</span>
                    </div>
                  )}
                  {detail.booking.paidAt && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Dikonfirmasi lunas:</span>{" "}
                      <span className="font-medium text-green-700">{formatDate(detail.booking.paidAt)}</span>
                    </div>
                  )}
                </div>

                {/* Quick actions */}
                <div className="flex gap-2 pt-2 flex-wrap">
                  {detail.booking.status === "waiting_admin_approval" && (
                    <>
                      <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700"
                        onClick={() => { approveMutation.mutate(detail.booking.orderNumber); setSelectedOrder(null); }}
                        disabled={approveMutation.isPending}>
                        <CheckCircle2 className="w-4 h-4" /> Setujui Booking
                      </Button>
                      <Button size="sm" variant="destructive" className="gap-1"
                        onClick={() => { setRejectDialog({ orderNumber: detail.booking.orderNumber, open: true }); setRejectReason(""); setSelectedOrder(null); }}>
                        <XCircle className="w-4 h-4" /> Tolak
                      </Button>
                    </>
                  )}
                  {["pending_payment", "waiting_confirmation"].includes(detail.booking.status) && (
                    <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700"
                      onClick={() => { paidMutation.mutate(detail.booking.orderNumber); setSelectedOrder(null); }}
                      disabled={paidMutation.isPending}>
                      <CreditCard className="w-4 h-4" /> Konfirmasi Lunas
                    </Button>
                  )}
                  {["waiting_admin_approval", "pending_payment", "confirmed"].includes(detail.booking.status) && (
                    <Button size="sm" variant="outline" className="gap-1"
                      onClick={() => resendMutation.mutate(detail.booking.orderNumber)}
                      disabled={resendMutation.isPending}>
                      <Send className="w-4 h-4" /> Resend WA
                    </Button>
                  )}
                </div>
              </div>

              {/* Chat history */}
              {detail.messages && detail.messages.length > 0 && (
                <div>
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <Bot className="w-4 h-4 text-primary" /> Riwayat Chat WA
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto rounded-xl border p-3 bg-muted/20">
                    {detail.messages.map((m: any, i: number) => (
                      <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-xs rounded-xl px-3 py-2 text-sm ${
                          m.role === "user" ? "bg-primary text-white" : "bg-white border text-foreground"
                        }`}>
                          <div>{m.content}</div>
                          {m.timestamp && <div className="text-[10px] opacity-60 mt-0.5">{new Date(m.timestamp).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {detail.session && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Sesi dibuat: {formatDate(detail.session.createdAt)} · Status: {detail.session.status}
                    </p>
                  )}
                </div>
              )}

              {/* Booking history */}
              {detail.history?.length > 0 && (
                <div>
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" /> Riwayat Status
                  </h3>
                  <div className="space-y-2">
                    {detail.history.map((h: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 text-sm">
                        <ChevronRight className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <span className="text-muted-foreground">{h.fromStatus ?? "—"}</span>
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="font-semibold">{h.toStatus}</span>
                          {h.changedByName && <span className="text-xs text-muted-foreground ml-2">oleh {h.changedByName}</span>}
                          {h.note && <div className="text-xs text-muted-foreground mt-0.5">{h.note}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Audit logs */}
              {detail.auditLogs?.length > 0 && (
                <div>
                  <h3 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" /> Audit Log
                  </h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {detail.auditLogs.slice(0, 10).map((a: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs py-1 border-b last:border-0">
                        <span className="font-mono text-muted-foreground">{new Date(a.createdAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="font-semibold">{a.action}</span>
                        {a.userName && <span className="text-muted-foreground">by {a.userName}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject dialog */}
      <Dialog open={rejectDialog.open} onOpenChange={(o) => setRejectDialog(d => ({ ...d, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Booking {rejectDialog.orderNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Alasan penolakan akan dikirim ke customer via WA.</p>
            <Textarea
              placeholder="Contoh: Jadwal sudah penuh, silakan pilih waktu lain..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectDialog(d => ({ ...d, open: false }))}>Batal</Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate({ orderNumber: rejectDialog.orderNumber, reason: rejectReason })}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Menolak..." : "Tolak Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
