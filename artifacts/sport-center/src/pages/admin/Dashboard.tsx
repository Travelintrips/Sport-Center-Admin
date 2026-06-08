import { useState } from "react";
import { useGetDashboard, useListBookings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { CalendarDays, DollarSign, Clock, TrendingUp, X, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  pending_payment:    "#f59e0b",
  waiting_confirmation: "#f97316",
  paid:               "#3b82f6",
  confirmed:          "#10b981",
  cancelled:          "#ef4444",
  completed:          "#6366f1",
  expired:            "#94a3b8",
  rejected:           "#e11d48",
  refunded:           "#8b5cf6",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Menunggu Pembayaran",
  paid: "Menunggu Verifikasi",
  confirmed: "Dikonfirmasi",
  cancelled: "Dibatalkan",
  completed: "Selesai",
  pending_payment:      "Pending Payment",
  waiting_confirmation: "Menunggu Konfirmasi",
  paid:                 "Paid",
  confirmed:            "Confirmed",
  cancelled:            "Cancelled",
  completed:            "Completed",
  expired:              "Expired",
  rejected:             "Rejected",
  refunded:             "Refunded",
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(n);
}

function getTodayWIB() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
}

type StatId = "total" | "revenue" | "today" | "pending";

interface StatModalBooking {
  id: number;
  orderNumber: string;
  customerName: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
  totalPrice: number;
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#94a3b8";
  return (
    <Badge
      variant="secondary"
      className="shrink-0 text-xs font-semibold"
      style={{ background: color + "20", color }}
    >
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

function StatModal({
  open,
  onClose,
  statId,
  bookings,
}: {
  open: boolean;
  onClose: () => void;
  statId: StatId | null;
  bookings: StatModalBooking[];
}) {
  const [, navigate] = useLocation();

  const today = getTodayWIB();

  const filtered = (() => {
    if (!statId) return [];
    switch (statId) {
      case "total":
        return bookings;
      case "revenue":
        return bookings.filter((b) =>
          ["confirmed", "completed", "paid", "waiting_confirmation"].includes(b.status)
        );
      case "today":
        return bookings.filter((b) => b.bookingDate === today);
      case "pending":
        return bookings.filter((b) => b.status === "pending_payment");
      default:
        return [];
    }
  })();

  const titles: Record<StatId, string> = {
    total:   "Semua Booking",
    revenue: "Booking Berevenue",
    today:   "Booking Hari Ini",
    pending: "Menunggu Pembayaran",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <DialogTitle className="text-lg font-black">
            {statId ? titles[statId] : ""}
            <span className="ml-2 text-sm font-semibold text-muted-foreground">
              ({filtered.length})
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Tidak ada data</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{b.orderNumber}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="font-semibold text-sm mt-0.5 truncate">{b.customerName}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {b.facilityName} · {b.bookingDate} · {b.startTime}–{b.endTime}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(b.totalPrice)}
                    </div>
                    <button
                      onClick={() => { onClose(); navigate("/admin/bookings"); }}
                      className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Lihat <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {statId === "revenue" && filtered.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 shrink-0 flex justify-between items-center">
            <span className="text-sm text-muted-foreground font-medium">Total Revenue</span>
            <span className="text-base font-black text-primary">
              {formatCurrency(filtered.reduce((s, b) => s + b.totalPrice, 0))}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminDashboard() {
  const { data, isLoading } = useGetDashboard();
  const { data: allBookingsData } = useListBookings();
  const [selectedStat, setSelectedStat] = useState<StatId | null>(null);

  const allBookings: StatModalBooking[] = (allBookingsData ?? []).map((b: any) => ({
    id: b.id,
    orderNumber: b.orderNumber,
    customerName: b.customerName,
    facilityName: b.facilityName ?? b.facility?.name ?? "—",
    bookingDate: b.bookingDate,
    startTime: b.startTime,
    endTime: b.endTime,
    status: b.status,
    totalPrice: Number(b.totalPrice),
  }));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black">Dashboard</h1>
          <p className="text-muted-foreground">Ringkasan operasional sport center Anda</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      </div>
    );
  }

  const stats: { id: StatId; label: string; value: number | string; icon: typeof CalendarDays; raw: number }[] = [
    {
      id: "total",
      label: "Total Bookings",
      value: data?.totalBookings ?? 0,
      raw: data?.totalBookings ?? 0,
      icon: CalendarDays,
    },
    {
      id: "revenue",
      label: "Total Revenue",
      value: formatCurrency(data?.totalRevenue ?? 0),
      raw: data?.totalRevenue ?? 0,
      icon: DollarSign,
    },
    {
      id: "today",
      label: "Booking Hari Ini",
      value: data?.todayBookings ?? 0,
      raw: data?.todayBookings ?? 0,
      icon: TrendingUp,
    },
    {
      id: "pending",
      label: "Pending Payment",
      value: data?.pendingBookings ?? 0,
      raw: data?.pendingBookings ?? 0,
      icon: Clock,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Dashboard</h1>
        <p className="text-muted-foreground">Ringkasan operasional sport center Anda</p>
      </div>

      {/* Stat cards — clickable */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const isActive = selectedStat === stat.id;
          return (
            <button
              key={stat.id}
              onClick={() => setSelectedStat(stat.id)}
              className={`text-left rounded-xl border transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isActive
                  ? "border-primary/40 shadow-md bg-primary/5 dark:bg-primary/10"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isActive ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary"
                  }`}>
                    <Icon size={20} />
                  </div>
                  <ArrowRight
                    size={14}
                    className={`text-muted-foreground transition-opacity mt-1 ${
                      isActive ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-60"
                    }`}
                  />
                </div>
                <div className="text-2xl font-black">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Booking by status pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Pemesanan per Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data?.bookingsByStatus?.filter((s) => s.count > 0)}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) =>
                      `${STATUS_LABELS[name] ?? name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {data?.bookingsByStatus?.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any, name: any) => [v, STATUS_LABELS[name as string] ?? name]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Revenue by month */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Pendapatan per Bulan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => [formatCurrency(Number(v)), "Pendapatan"]} />
                  <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip formatter={(v) => [formatCurrency(Number(v)), "Revenue"]} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top facilities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Fasilitas Terpopuler</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.topFacilities} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="facilityName" type="category" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip formatter={(v: any) => [v, "Pemesanan"]} />
                  <YAxis
                    dataKey="facilityName"
                    type="category"
                    tick={{ fontSize: 11 }}
                    width={100}
                  />
                  <Tooltip formatter={(v) => [v, "Bookings"]} />
                  <Bar dataKey="bookingCount" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent bookings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Pemesanan Terbaru</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data?.recentBookings?.slice(0, 5).map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between text-sm gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.customerName}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {b.facilityName} — {b.bookingDate}
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-xs"
                    style={{
                      background: STATUS_COLORS[b.status] + "20",
                      color: STATUS_COLORS[b.status],
                    }}
                  >
                    {STATUS_LABELS[b.status] ?? b.status}
                  </Badge>
                </div>
              ))}
              {!data?.recentBookings?.length && (
                <p className="text-sm text-muted-foreground text-center py-4">Belum ada pemesanan</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stat detail modal */}
      <StatModal
        open={selectedStat !== null}
        onClose={() => setSelectedStat(null)}
        statId={selectedStat}
        bookings={allBookings}
      />
    </div>
  );
}
