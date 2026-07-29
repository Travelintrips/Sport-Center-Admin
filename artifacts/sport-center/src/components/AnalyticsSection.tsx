import { useQuery } from "@tanstack/react-query";
import { Users, Eye, TrendingUp, Activity } from "lucide-react";
import { useLang } from "@/lib/i18n";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";

interface PublicStats {
  users30d: number;
  pageViews30d: number;
  sessions30d: number;
  activeUsers: number;
  configured: boolean;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export function AnalyticsSection() {
  const { t } = useLang();

  const { data, isLoading, isError } = useQuery<PublicStats>({
    queryKey: ["public-analytics-stats"],
    queryFn: async () => {
      const res = await fetch(`${API}/analytics/public-stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Only hide when API explicitly says not configured (after successful fetch)
  if (!isLoading && !isError && data && !data.configured) return null;

  const loading = isLoading || isError || !data;

  const stats = [
    {
      icon: Users,
      value: loading ? null : formatNumber(data!.users30d),
      label: t("Pengguna 30 Hari", "Users (30 Days)"),
      sublabel: t("Pengunjung unik", "Unique visitors"),
      color: "text-blue-500",
      bg: "bg-blue-50 dark:bg-blue-950/40",
    },
    {
      icon: Eye,
      value: loading ? null : formatNumber(data!.pageViews30d),
      label: t("Halaman Dilihat", "Page Views"),
      sublabel: t("30 hari terakhir", "Last 30 days"),
      color: "text-emerald-500",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
    },
    {
      icon: TrendingUp,
      value: loading ? null : formatNumber(data!.sessions30d),
      label: t("Sesi", "Sessions"),
      sublabel: t("Kunjungan aktif", "Active visits"),
      color: "text-orange-500",
      bg: "bg-orange-50 dark:bg-orange-950/40",
    },
    {
      icon: Activity,
      value: loading ? null : formatNumber(data!.activeUsers),
      label: t("Aktif Sekarang", "Active Now"),
      sublabel: t("Pengguna realtime", "Realtime users"),
      color: "text-primary",
      bg: "bg-primary/10",
      pulse: !loading && (data?.activeUsers ?? 0) > 0,
    },
  ];

  return (
    <section className="py-16 md:py-20 bg-white dark:bg-slate-900 border-t border-border/40">
      <div className="container px-4 md:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-bold text-sm mb-4 border border-primary/20">
            <Activity className="w-4 h-4" />
            {t("Statistik Website", "Website Statistics")}
          </div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-secondary dark:text-white mb-3">
            {t("Dipercaya Ribuan Pengunjung", "Trusted by Thousands of Visitors")}
          </h2>
          <p className="text-muted-foreground font-medium">
            {t(
              "Data real dari Google Analytics — transparansi adalah prioritas kami.",
              "Real data from Google Analytics — transparency is our priority."
            )}
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 max-w-4xl mx-auto">
          {stats.map(({ icon: Icon, value, label, sublabel, color, bg, pulse }) => (
            <div
              key={label}
              className="rounded-2xl border border-border/60 p-5 md:p-6 flex flex-col items-center text-center gap-3 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center`}>
                <div className="relative">
                  <Icon className={`w-6 h-6 ${color}`} />
                  {pulse && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500">
                      <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75" />
                    </span>
                  )}
                </div>
              </div>
              <div>
                {value === null ? (
                  /* Skeleton */
                  <div className="h-8 w-16 bg-muted animate-pulse rounded-lg mx-auto mb-1" />
                ) : (
                  <div className="text-2xl md:text-3xl font-black tracking-tight text-secondary dark:text-white">
                    {value}
                  </div>
                )}
                <div className="font-bold text-sm text-secondary dark:text-white mt-0.5">{label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Powered by note */}
        <p className="text-center text-xs text-muted-foreground mt-8 flex items-center justify-center gap-1.5">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {t("Powered by Google Analytics", "Powered by Google Analytics")}
        </p>
      </div>
    </section>
  );
}
