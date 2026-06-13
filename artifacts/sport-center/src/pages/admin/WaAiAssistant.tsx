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
  RefreshCw,
  Send,
  CreditCard,
  MessageSquare,
  Clock,
  User,
  CalendarDays,
  Bot,
  Phone,
  AlertTriangle,
  Zap,
  Activity,
  Users,
} from "lucide-react";
import { getToken } from "@/lib/auth";

/* ─── Types ─────────────────────────────────────────────────────────────────── */
type AiBooking = {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  facilityName: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice: string;
  grandTotal: string | null;
  status: string;
  source: string;
  approvedByAdminPhone: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  paidAt: string | null;
  paymentDeadline: string | null;
  createdAt: string;
};

type Session = {
  id: number;
  phone: string;
  customerName: string | null;
  currentStep: string;
  facilityName: string | null;
  bookingDate: string | null;
  startTime: string | null;
  status: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

type IntentLog = {
  id: number;
  action: string;
  after: Record<string, any> | null;
  createdAt: string;
};

type Stats = {
  totalSessions: number;
  activeSessions: number;
  totalAiBookings: number;
  pendingApproval: number;
  errorCount: number;
  topIntents: { intent: string; count: number }[];
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
    active:                 { label: "Aktif",                class: "bg-green-100 text-green-800 border-green-300" },
    expired:                { label: "Expired",              class: "bg-gray-100 text-gray-500 border-gray-300" },
    completed_session:      { label: "Selesai",              class: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    admin_takeover:         { label: "Admin Takeover",       class: "bg-purple-100 text-purple-800 border-purple-300" },
  };
  const cfg = map[status] ?? { label: status, class: "bg-gray-100 text-gray-700 border-gray-300" };
  return <Badge variant="outline" className={`text-xs font-semibold ${cfg.class}`}>{cfg.label}</Badge>;
}

function intentBadge(intent: string) {
  const colors: Record<string, string> = {
    booking_intent: "bg-blue-100 text-blue-800",
    status_check: "bg-green-100 text-green-800",
    price_inquiry: "bg-orange-100 text-orange-800",
    availability_check: "bg-purple-100 text-purple-800",
    talk_to_admin: "bg-red-100 text-red-800",
    ask_reschedule_policy: "bg-yellow-100 text-yellow-800",
    admin_action_attempt: "bg-red-200 text-red-900",
    general_info: "bg-gray-100 text-gray-700",
  };
  return (
    <Badge className={`text-xs ${colors[intent] ?? "bg-gray-100 text-gray-700"} border-0`}>
      {intent.replace(/_/g, " ")}
    </Badge>
  );
}

function formatIDR(n: string | number | null) {
  if (n === null || n === undefined) return "-";
  return "Rp " + Number(n).toLocaleString("id-ID");
}

function formatDate(s: string | null) {
  if (!s) return "-";
  return new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatShort(s: string | null) {
  if (!s) return "-";
  return new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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

/* ─── Stat card ─────────────────────────────────────────────────────────────── */
function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border bg-card p-4 flex items-center gap-3`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>{icon}</div>
      <div>
        <div className="text-2xl font-black">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────────────────── */
export default function AdminWaAiAssistant() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"bookings" | "sessions" | "intents" | "errors">("bookings");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ orderNumber: string; open: boolean }>({ orderNumber: "", open: false });
  const [rejectReason, setRejectReason] = useState("");
  const [takeoverDialog, setTakeoverDialog] = useState<{ sessionId: number; phone: string; open: boolean }>({ sessionId: 0, phone: "", open: false });
  const [takeoverMsg, setTakeoverMsg] = useState("");

  /* ── Stats ── */
  const { data: stats } = useQuery<Stats>({
    queryKey: ["wa-ai-stats"],
    queryFn: () => apiFetch("/admin/wa-ai/stats"),
    refetchInterval: 30000,
  });

  /* ── Bookings ── */
  const bookingsKey = ["wa-ai-bookings", statusFilter, search];
  const { data: bookingsData, isLoading: loadingBookings, refetch: refetchBookings } = useQuery({
    queryKey: bookingsKey,
    queryFn: () => {
      const p = new URLSearchParams({ limit: "50" });
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (search) p.set("search", search);
      return apiFetch(`/admin/wa-ai/bookings?${p}`);
    },
    enabled: activeTab === "bookings",
  });

  /* ── Booking detail sheet ── */
  const { data: detail } = useQuery({
    queryKey: ["wa-booking-detail", selectedOrder],
    queryFn: () => apiFetch(`/admin/wa-bookings/${selectedOrder}/detail`),
    enabled: !!selectedOrder,
  });

  /* ── Sessions ── */
  const { data: sessionsData, isLoading: loadingSessions, refetch: refetchSessions } = useQuery({
    queryKey: ["wa-ai-sessions", search],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "50" });
      if (search) p.set("search", search);
      return apiFetch(`/admin/wa-ai/sessions?${p}`);
    },
    enabled: activeTab === "sessions",
  });

  /* ── Session detail ── */
  const { data: sessionDetail, isLoading: loadingSessionDetail } = useQuery({
    queryKey: ["wa-ai-session", selectedSession],
    queryFn: () => apiFetch(`/admin/wa-ai/sessions/${selectedSession}`),
    enabled: !!selectedSession,
  });

  /* ── Intent logs ── */
  const { data: intentData, isLoading: loadingIntents } = useQuery({
    queryKey: ["wa-ai-intents"],
    queryFn: () => apiFetch("/admin/wa-ai/intent-logs?limit=100"),
    enabled: activeTab === "intents",
  });

  /* ── Error logs ── */
  const { data: errorData, isLoading: loadingErrors } = useQuery({
    queryKey: ["wa-ai-errors"],
    queryFn: () => apiFetch("/admin/wa-ai/error-logs?limit=100"),
    enabled: activeTab === "errors",
  });

  function mutate(path: string, body?: object) {
    return apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
  }

  const approveMutation = useMutation({
    mutationFn: (orderNumber: string) => mutate(`/admin/wa-bookings/${orderNumber}/approve`),
    onSuccess: (_d, orderNumber) => {
      toast({ title: `✅ ${orderNumber} disetujui`, description: "Customer diberitahu untuk melakukan pembayaran." });
      qc.invalidateQueries({ queryKey: ["wa-ai-bookings"] });
      qc.invalidateQueries({ queryKey: ["wa-booking-detail", orderNumber] });
      qc.invalidateQueries({ queryKey: ["wa-ai-stats"] });
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
      qc.invalidateQueries({ queryKey: ["wa-ai-bookings"] });
      qc.invalidateQueries({ queryKey: ["wa-booking-detail", orderNumber] });
      qc.invalidateQueries({ queryKey: ["wa-ai-stats"] });
    },
    onError: (e: any) => toast({ title: "Gagal reject", description: e.message, variant: "destructive" }),
  });

  const paidMutation = useMutation({
    mutationFn: (orderNumber: string) => mutate(`/admin/wa-bookings/${orderNumber}/paid`),
    onSuccess: (_d, orderNumber) => {
      toast({ title: `💰 ${orderNumber} dikonfirmasi LUNAS`, description: "Customer diberitahu via WA." });
      qc.invalidateQueries({ queryKey: ["wa-ai-bookings"] });
      qc.invalidateQueries({ queryKey: ["wa-booking-detail", orderNumber] });
      qc.invalidateQueries({ queryKey: ["wa-ai-stats"] });
    },
    onError: (e: any) => toast({ title: "Gagal konfirmasi paid", description: e.message, variant: "destructive" }),
  });

  const resendMutation = useMutation({
    mutationFn: (orderNumber: string) => mutate(`/admin/wa-bookings/${orderNumber}/resend`),
    onSuccess: (d, orderNumber) => {
      toast({ title: `📨 Resend ${orderNumber}`, description: `WA dikirim ke ${d.sentTo}` });
    },
    onError: (e: any) => toast({ title: "Gagal resend", description: e.message, variant: "destructive" }),
  });

  const takeoverMutation = useMutation({
    mutationFn: ({ sessionId, message }: { sessionId: number; message: string }) =>
      mutate(`/admin/wa-ai/sessions/${sessionId}/takeover`, { message }),
    onSuccess: (d) => {
      toast({ title: "✅ Pesan terkirim", description: `Dikirim ke ${d.sentTo}` });
      setTakeoverDialog({ sessionId: 0, phone: "", open: false });
      setTakeoverMsg("");
      qc.invalidateQueries({ queryKey: ["wa-ai-sessions"] });
    },
    onError: (e: any) => toast({ title: "Gagal kirim pesan", description: e.message, variant: "destructive" }),
  });

  const bookings: AiBooking[] = bookingsData?.bookings ?? [];
  const sessions: Session[] = sessionsData?.sessions ?? [];

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bot className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black">AI WA Assistant</h1>
            <p className="text-muted-foreground text-sm">Monitor chat AI, booking otomatis, dan ambil alih percakapan</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          qc.invalidateQueries({ queryKey: ["wa-ai-stats"] });
          if (activeTab === "bookings") refetchBookings();
          if (activeTab === "sessions") refetchSessions();
        }} className="gap-2 w-fit">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard icon={<Users className="w-5 h-5 text-blue-600" />} label="Total Session" value={stats.totalSessions} color="bg-blue-100" />
          <StatCard icon={<Activity className="w-5 h-5 text-green-600" />} label="Session Aktif" value={stats.activeSessions} color="bg-green-100" />
          <StatCard icon={<Bot className="w-5 h-5 text-primary" />} label="Booking via AI" value={stats.totalAiBookings} color="bg-orange-100" />
          <StatCard icon={<Clock className="w-5 h-5 text-yellow-600" />} label="Menunggu Approve" value={stats.pendingApproval} color="bg-yellow-100" />
          <StatCard icon={<AlertTriangle className="w-5 h-5 text-red-600" />} label="AI Errors/Fallback" value={stats.errorCount} color="bg-red-100" />
        </div>
      )}

      {/* Top intents */}
      {stats && stats.topIntents.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Intent Teratas</p>
          <div className="flex flex-wrap gap-2">
            {stats.topIntents.map((t) => (
              <div key={t.intent} className="flex items-center gap-1.5">
                {intentBadge(t.intent)}
                <span className="text-xs text-muted-foreground font-medium">×{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main tabs */}
      <div className="flex gap-1 flex-wrap border-b pb-0">
        {[
          { key: "bookings", label: "Booking AI", icon: <Bot className="w-4 h-4" /> },
          { key: "sessions", label: "Histori Chat", icon: <MessageSquare className="w-4 h-4" /> },
          { key: "intents", label: "Intent Log", icon: <Zap className="w-4 h-4" /> },
          { key: "errors", label: "Error Log", icon: <AlertTriangle className="w-4 h-4" /> },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Search bar (bookings + sessions) */}
      {(activeTab === "bookings" || activeTab === "sessions") && (
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-sm">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
      )}

      {/* ── BOOKINGS TAB ───────────────────────────────────────────────────────── */}
      {activeTab === "bookings" && (
        <>
          <div className="flex gap-1 flex-wrap">
            {STATUS_TABS.map((t) => (
              <button key={t.value} onClick={() => setStatusFilter(t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === t.value ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {loadingBookings ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
          ) : bookings.length === 0 ? (
            <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">
              <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Belum ada booking dari AI WA Assistant</p>
            </div>
          ) : (
            <div className="rounded-xl border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-3 text-left font-semibold">Order</th>
                    <th className="px-4 py-3 text-left font-semibold">Customer</th>
                    <th className="px-4 py-3 text-left font-semibold">Fasilitas</th>
                    <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                    <th className="px-4 py-3 text-left font-semibold">Total</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          className="font-mono text-xs font-bold text-primary hover:underline"
                          onClick={() => setSelectedOrder(b.orderNumber)}
                        >
                          {b.orderNumber}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{b.customerName}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" />{b.customerPhone}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{b.facilityName ?? "-"}</td>
                      <td className="px-4 py-3 text-xs">
                        <div>{b.bookingDate}</div>
                        <div className="text-muted-foreground">{b.startTime}–{b.endTime}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold">{formatIDR(b.grandTotal ?? b.totalPrice)}</td>
                      <td className="px-4 py-3">{statusBadge(b.status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end flex-wrap">
                          {b.status === "waiting_admin_approval" && (
                            <>
                              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700"
                                onClick={() => approveMutation.mutate(b.orderNumber)}
                                disabled={approveMutation.isPending}>
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="destructive" className="h-7 text-xs"
                                onClick={() => setRejectDialog({ orderNumber: b.orderNumber, open: true })}>
                                <XCircle className="w-3 h-3 mr-1" /> Reject
                              </Button>
                            </>
                          )}
                          {["pending_payment", "waiting_confirmation", "waiting_admin_approval"].includes(b.status) && (
                            <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                              onClick={() => paidMutation.mutate(b.orderNumber)}
                              disabled={paidMutation.isPending}>
                              <CreditCard className="w-3 h-3 mr-1" /> Paid
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => resendMutation.mutate(b.orderNumber)}
                            disabled={resendMutation.isPending}>
                            <Send className="w-3 h-3 mr-1" /> Resend
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── SESSIONS TAB ──────────────────────────────────────────────────────── */}
      {activeTab === "sessions" && (
        <>
          {loadingSessions ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Belum ada sesi chat AI</p>
            </div>
          ) : (
            <div className="rounded-xl border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-3 text-left font-semibold">Phone</th>
                    <th className="px-4 py-3 text-left font-semibold">Nama</th>
                    <th className="px-4 py-3 text-left font-semibold">Fasilitas</th>
                    <th className="px-4 py-3 text-left font-semibold">Step</th>
                    <th className="px-4 py-3 text-left font-semibold">Pesan</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Waktu</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-mono text-xs text-primary">{s.phone}</td>
                      <td className="px-4 py-3 text-xs">{s.customerName ?? "-"}</td>
                      <td className="px-4 py-3 text-xs">{s.facilityName ?? "-"}</td>
                      <td className="px-4 py-3 text-xs">
                        <Badge variant="outline" className="text-xs">{s.currentStep.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-center">{s.messageCount}</td>
                      <td className="px-4 py-3">{statusBadge(s.status)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatShort(s.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => setSelectedSession(s.id)}>
                            <MessageSquare className="w-3 h-3 mr-1" /> Chat
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs border-primary text-primary hover:bg-primary hover:text-white"
                            onClick={() => setTakeoverDialog({ sessionId: s.id, phone: s.phone, open: true })}>
                            <Send className="w-3 h-3 mr-1" /> Ambil Alih
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── INTENT LOGS TAB ───────────────────────────────────────────────────── */}
      {activeTab === "intents" && (
        <>
          {loadingIntents ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>
          ) : (
            <div className="rounded-xl border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-3 text-left font-semibold">Waktu</th>
                    <th className="px-4 py-3 text-left font-semibold">Phone</th>
                    <th className="px-4 py-3 text-left font-semibold">Intent</th>
                    <th className="px-4 py-3 text-left font-semibold">Pesan</th>
                  </tr>
                </thead>
                <tbody>
                  {(intentData?.logs ?? []).map((log: IntentLog) => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatShort(log.createdAt)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-primary">{log.after?.phone ?? "-"}</td>
                      <td className="px-4 py-3">{intentBadge(log.after?.intent ?? "unknown")}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">{log.after?.message ?? "-"}</td>
                    </tr>
                  ))}
                  {(intentData?.logs ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Belum ada log intent</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── ERROR LOGS TAB ────────────────────────────────────────────────────── */}
      {activeTab === "errors" && (
        <>
          {loadingErrors ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>
          ) : (
            <div className="rounded-xl border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-3 text-left font-semibold">Waktu</th>
                    <th className="px-4 py-3 text-left font-semibold">Aksi</th>
                    <th className="px-4 py-3 text-left font-semibold">Phone</th>
                    <th className="px-4 py-3 text-left font-semibold">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {(errorData?.logs ?? []).map((log: IntentLog) => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatShort(log.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`text-xs ${
                          log.action === "unauthorized_admin_command" ? "bg-red-100 text-red-800 border-red-300" :
                          log.action === "ai_fallback_to_admin" ? "bg-orange-100 text-orange-800 border-orange-300" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          {log.action.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-primary">{log.after?.phone ?? "-"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs">
                        {log.after?.message ? (
                          <span className="truncate block max-w-xs">{String(log.after.message).slice(0, 80)}</span>
                        ) : log.after?.reason ? (
                          <span>{log.after.reason}</span>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                  {(errorData?.logs ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Tidak ada log error AI</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Booking Detail Sheet ─────────────────────────────────────────────── */}
      <Sheet open={!!selectedOrder} onOpenChange={(o) => !o && setSelectedOrder(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              Detail Booking AI — {selectedOrder}
            </SheetTitle>
          </SheetHeader>
          {!detail ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
          ) : (
            <div className="space-y-4">
              {/* Booking info */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span>{statusBadge(detail.booking.status)}</div>
                <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-semibold">{detail.booking.customerName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">HP</span><span>{detail.booking.customerPhone}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fasilitas</span><span>{detail.facility?.name ?? "-"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tanggal</span><span>{detail.booking.bookingDate}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Jam</span><span>{detail.booking.startTime}–{detail.booking.endTime}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-bold text-primary">{formatIDR(detail.booking.grandTotal ?? detail.booking.totalPrice)}</span></div>
                {detail.booking.rejectedReason && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Alasan Tolak</span><span className="text-red-600">{detail.booking.rejectedReason}</span></div>
                )}
              </div>

              {/* Action buttons */}
              {["waiting_admin_approval"].includes(detail.booking.status) && (
                <div className="flex gap-2">
                  <Button className="flex-1 bg-green-600 hover:bg-green-700"
                    onClick={() => approveMutation.mutate(detail.booking.orderNumber)}
                    disabled={approveMutation.isPending}>
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Approve
                  </Button>
                  <Button variant="destructive" className="flex-1"
                    onClick={() => { setRejectDialog({ orderNumber: detail.booking.orderNumber, open: true }); setSelectedOrder(null); }}>
                    <XCircle className="w-4 h-4 mr-2" /> Reject
                  </Button>
                </div>
              )}
              {["pending_payment", "waiting_confirmation", "waiting_admin_approval"].includes(detail.booking.status) && (
                <Button className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={() => paidMutation.mutate(detail.booking.orderNumber)}
                  disabled={paidMutation.isPending}>
                  <CreditCard className="w-4 h-4 mr-2" /> Konfirmasi LUNAS
                </Button>
              )}
              <Button variant="outline" className="w-full"
                onClick={() => resendMutation.mutate(detail.booking.orderNumber)}
                disabled={resendMutation.isPending}>
                <Send className="w-4 h-4 mr-2" /> Resend WA
              </Button>

              {/* Chat history */}
              {detail.messages?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Histori Chat AI</p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {detail.messages.map((m: any, i: number) => (
                      <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`rounded-xl px-3 py-2 max-w-[80%] text-xs ${
                          m.role === "user" ? "bg-primary text-white" : "bg-muted"
                        }`}>
                          <div>{m.text}</div>
                          <div className={`text-[10px] mt-1 ${m.role === "user" ? "text-white/70" : "text-muted-foreground"}`}>
                            {m.at ? new Date(m.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Audit logs */}
              {detail.auditLogs?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audit Log</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {detail.auditLogs.map((log: any) => (
                      <div key={log.id} className="flex items-start gap-2 text-xs">
                        <span className="text-muted-foreground whitespace-nowrap">{formatShort(log.createdAt)}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{log.action.replace(/_/g, " ")}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Session Chat Detail Sheet ─────────────────────────────────────────── */}
      <Sheet open={!!selectedSession} onOpenChange={(o) => !o && setSelectedSession(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Histori Chat — {sessionDetail?.session?.phone}
            </SheetTitle>
          </SheetHeader>
          {loadingSessionDetail ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : sessionDetail ? (
            <div className="space-y-4">
              {/* Session info */}
              <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Status Sesi</span>
                  {statusBadge(sessionDetail.session.status)}
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Step</span>
                  <Badge variant="outline" className="text-xs">{sessionDetail.session.currentStep.replace(/_/g, " ")}</Badge>
                </div>
                {sessionDetail.facility && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Fasilitas</span>
                    <span>{sessionDetail.facility.name}</span>
                  </div>
                )}
                {sessionDetail.latestBooking && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Booking</span>
                    <span className="font-mono font-bold text-primary">{sessionDetail.latestBooking.orderNumber}</span>
                  </div>
                )}
              </div>

              {/* Takeover button */}
              <Button variant="outline" className="w-full border-primary text-primary hover:bg-primary hover:text-white"
                onClick={() => setTakeoverDialog({ sessionId: sessionDetail.session.id, phone: sessionDetail.session.phone, open: true })}>
                <Send className="w-4 h-4 mr-2" /> Ambil Alih Chat
              </Button>

              {/* Messages */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Percakapan ({sessionDetail.messages?.length ?? 0} pesan)
                </p>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {(sessionDetail.messages ?? []).map((m: any, i: number) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`rounded-xl px-3 py-2 max-w-[85%] text-xs ${
                        m.role === "user" ? "bg-primary text-white" : "bg-muted"
                      }`}>
                        <div className="font-semibold mb-0.5 text-[10px] opacity-70">
                          {m.role === "user" ? "Customer" : "AI Bot"}
                        </div>
                        <div>{m.text}</div>
                        <div className={`text-[10px] mt-1 ${m.role === "user" ? "text-white/70" : "text-muted-foreground"}`}>
                          {m.at ? new Date(m.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(sessionDetail.messages ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">Belum ada pesan</p>
                  )}
                </div>
              </div>

              {/* AI audit logs for this session */}
              {sessionDetail.aiLogs?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">AI Logs</p>
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {sessionDetail.aiLogs.map((log: any) => (
                      <div key={log.id} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground whitespace-nowrap">{formatShort(log.createdAt)}</span>
                        <Badge variant="outline" className="text-[10px]">{log.action.replace(/_/g, " ")}</Badge>
                        {log.after?.intent && intentBadge(log.after.intent)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ── Reject Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={rejectDialog.open} onOpenChange={(o) => setRejectDialog((d) => ({ ...d, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Booking {rejectDialog.orderNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Berikan alasan penolakan (akan dikirim ke customer via WA):</p>
            <Textarea
              placeholder="Contoh: Slot sudah penuh pada jam tersebut"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectDialog((d) => ({ ...d, open: false }))}>Batal</Button>
            <Button variant="destructive"
              onClick={() => rejectMutation.mutate({ orderNumber: rejectDialog.orderNumber, reason: rejectReason })}
              disabled={rejectMutation.isPending}>
              Tolak Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Takeover Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={takeoverDialog.open} onOpenChange={(o) => setTakeoverDialog((d) => ({ ...d, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" /> Ambil Alih Chat
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Kirim pesan ke <span className="font-mono font-bold text-primary">{takeoverDialog.phone}</span> sebagai Admin Sport Center:
            </p>
            <Textarea
              placeholder="Halo! Saya admin Sport Center, ada yang bisa saya bantu?"
              value={takeoverMsg}
              onChange={(e) => setTakeoverMsg(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTakeoverDialog((d) => ({ ...d, open: false }))}>Batal</Button>
            <Button
              onClick={() => takeoverMutation.mutate({ sessionId: takeoverDialog.sessionId, message: takeoverMsg })}
              disabled={takeoverMutation.isPending || !takeoverMsg.trim()}>
              <Send className="w-4 h-4 mr-2" /> Kirim Pesan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
