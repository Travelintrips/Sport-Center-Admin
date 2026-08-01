import { useQuery } from "@tanstack/react-query";
import { Users, UserPlus, Clock, Activity, BarChart3, ExternalLink } from "lucide-react";
import { useLang } from "@/lib/i18n";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";

interface TopPage {
  title: string;
  views: number;
  activeUsers: number;
  events: number;
  bounceRate: number;
}

interface AnalyticsReport {
  configured: boolean;
  dateRange: string;
  activeUsers: number;
  newUsers30d: number;
  avgEngagementTimeSec: number;
  totalEvents30d: number;
  totalUsers30d: number;
  pageViews30d: number;
  sessions30d: number;
  topPages: TopPage[];
}

function formatDuration(seconds: number): string {
  if (seconds == null || isNaN(seconds) || seconds === 0) return "0d";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}d`;
  return `${m}m ${s}d`;
}

function formatNumber(n: number): string {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded-lg ${className}`} />;
}

export function AnalyticsReportSection() {
  const { t } = useLang();

  const { data, isLoading } = useQuery<AnalyticsReport>({
    queryKey: ["analytics-report"],
    queryFn: async () => {
      const res = await fetch(`${API}/analytics/public-stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const loading = isLoading || !data;
  const configured = !loading && data.configured;

  const metrics = [
    {
      icon: Users,
      value: loading ? null : formatNumber(data.activeUsers),
      label: t("Pengguna Aktif", "Active Users"),
      sublabel: t("Realtime sekarang", "Right now"),
      color: "text-blue-600",
      bg: "bg-blue-50",
      pulse: configured && (data?.activeUsers ?? 0) > 0,
    },
    {
      icon: UserPlus,
      value: loading ? null : formatNumber(data.newUsers30d),
      label: t("Pengguna Baru", "New Users"),
      sublabel: t("28 hari terakhir", "Last 28 days"),
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      icon: Clock,
      value: loading ? null : formatDuration(data.avgEngagementTimeSec),
      label: t("Waktu Engagement", "Avg Engagement"),
      sublabel: t("Rata-rata per sesi", "Per session avg"),
      color: "text-orange-500",
      bg: "bg-orange-50",
    },
    {
      icon: Activity,
      value: loading ? null : formatNumber(data.totalEvents30d),
      label: t("Jumlah Peristiwa", "Total Events"),
      sublabel: t("28 hari terakhir", "Last 28 days"),
      color: "text-primary",
      bg: "bg-primary/10",
    },
  ];

  return (
    <section id="ringkasan-laporan" className="py-16 md:py-20 bg-[#F8FAFC] dark:bg-slate-900 border-t border-border/40">
      <div className="container px-4 md:px-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-bold text-sm mb-3 border border-primary/20">
              <BarChart3 className="w-4 h-4" />
              {t("Ringkasan Laporan", "Report Summary")}
            </div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-secondary dark:text-white">
              {t("Statistik Pengunjung Website", "Website Visitor Statistics")}
            </h2>
            <p className="text-muted-foreground font-medium mt-1 text-sm">
              {loading
                ? t("Memuat data...", "Loading data...")
                : configured
                ? t(`Periode: ${data.dateRange}`, `Period: ${data.dateRange}`) + " · " + t("Semua Pengguna", "All Users")
                : t("Menghubungkan ke Google Analytics...", "Connecting to Google Analytics...")}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google Analytics
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {metrics.map(({ icon: Icon, value, label, sublabel, color, bg, pulse }) => (
            <div
              key={label}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-border/60 p-5 flex flex-col items-center text-center gap-3 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                <div className="relative">
                  <Icon className={`w-5 h-5 ${color}`} />
                  {pulse && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500">
                      <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75" />
                    </span>
                  )}
                </div>
              </div>
              <div>
                {value === null ? (
                  <Skeleton className="h-8 w-16 mx-auto mb-1" />
                ) : (
                  <div className="text-2xl md:text-3xl font-black tracking-tight text-secondary dark:text-white">
                    {value}
                  </div>
                )}
                <div className="font-bold text-sm text-secondary dark:text-white mt-0.5">{label}</div>
                <div className="text-xs text-muted-foreground">{sublabel}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Top Pages Table */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-border/60 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
            <h3 className="font-bold text-sm text-secondary dark:text-white flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
              {t("Halaman / Layar Teratas", "Top Pages / Screens")}
            </h3>
            {configured && (
              <span className="text-xs text-muted-foreground font-medium">
                {t("28 hari terakhir", "Last 28 days")}
              </span>
            )}
          </div>

          {/* Table header */}
          <div className="hidden md:grid grid-cols-[1fr_80px_90px_90px_90px] gap-2 px-5 py-2.5 bg-muted/40 text-xs font-bold uppercase tracking-wide text-muted-foreground border-b border-border/30">
            <span>{t("Judul Halaman", "Page Title")}</span>
            <span className="text-right">{t("Tampilan", "Views")}</span>
            <span className="text-right">{t("Pengguna Aktif", "Active Users")}</span>
            <span className="text-right">{t("Peristiwa", "Events")}</span>
            <span className="text-right">{t("Rasio Pantulan", "Bounce Rate")}</span>
          </div>

          {/* Table rows */}
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5 border-b border-border/20 last:border-0 flex items-center gap-4">
                <Skeleton className="h-4 flex-1 max-w-xs" />
                <Skeleton className="h-4 w-12 ml-auto" />
              </div>
            ))
          ) : !configured || data.topPages.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              {t("Belum ada data halaman tersedia.", "No page data available yet.")}
            </div>
          ) : (
            data.topPages.map((page, i) => {
              const maxViews = data.topPages[0].views || 1;
              const barPct = Math.round((page.views / maxViews) * 100);
              return (
                <div
                  key={i}
                  className="grid grid-cols-1 md:grid-cols-[1fr_80px_90px_90px_90px] gap-1 md:gap-2 px-5 py-3.5 border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors items-center"
                >
                  {/* Title + bar */}
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-sm font-semibold text-secondary dark:text-white truncate">
                      {page.title}
                    </span>
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-primary/60 rounded-full"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between md:justify-end gap-1">
                    <span className="md:hidden text-xs text-muted-foreground">{t("Tampilan", "Views")}:</span>
                    <span className="text-sm font-bold text-secondary dark:text-white">{formatNumber(page.views)}</span>
                  </div>
                  <div className="flex items-center justify-between md:justify-end gap-1">
                    <span className="md:hidden text-xs text-muted-foreground">{t("Pengguna", "Users")}:</span>
                    <span className="text-sm text-muted-foreground">{formatNumber(page.activeUsers)}</span>
                  </div>
                  <div className="flex items-center justify-between md:justify-end gap-1">
                    <span className="md:hidden text-xs text-muted-foreground">{t("Peristiwa", "Events")}:</span>
                    <span className="text-sm text-muted-foreground">{formatNumber(page.events)}</span>
                  </div>
                  <div className="flex items-center justify-between md:justify-end gap-1">
                    <span className="md:hidden text-xs text-muted-foreground">{t("Pantulan", "Bounce")}:</span>
                    <span className="text-sm text-muted-foreground">{(page.bounceRate * 100).toFixed(1)}%</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </section>
  );
}
