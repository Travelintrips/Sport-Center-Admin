import { Link, useLocation } from "wouter";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, CalendarPlus, List, ChevronRight, Clock, CheckCircle2, XCircle, AlertCircle, TrendingUp } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";

const API_BASE = "/api";

async function fetchTenantBookings() {
  const token = getToken();
  const res = await fetch(`${API_BASE}/tenant/bookings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

async function fetchTenantMe() {
  const token = getToken();
  const res = await fetch(`${API_BASE}/tenant/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch tenant profile");
  return res.json();
}

const STATUS_CONFIG: Record<string, { label: string; labelEn: string; badge: string; icon: typeof Clock }> = {
  pending:   { label: "Menunggu Review",  labelEn: "Pending Review",  badge: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Clock },
  approved:  { label: "Disetujui",        labelEn: "Approved",        badge: "bg-green-100 text-green-700 border-green-200",  icon: CheckCircle2 },
  rejected:  { label: "Ditolak",          labelEn: "Rejected",        badge: "bg-red-100 text-red-700 border-red-200",        icon: XCircle },
  active:    { label: "Aktif",            labelEn: "Active",          badge: "bg-blue-100 text-blue-700 border-blue-200",     icon: CheckCircle2 },
  expired:   { label: "Kadaluarsa",       labelEn: "Expired",         badge: "bg-gray-100 text-gray-600 border-gray-200",    icon: AlertCircle },
};

export default function TenantDashboard() {
  const { t } = useLang();
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });

  const { data: tenant, isLoading: tenantLoading } = useQuery({
    queryKey: ["tenant-me"],
    queryFn: fetchTenantMe,
    enabled: user?.role === "tenant",
    retry: false,
  });

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery({
    queryKey: ["tenant-bookings"],
    queryFn: fetchTenantBookings,
    enabled: user?.role === "tenant",
    retry: false,
  });

  if (userLoading) {
    return (
      <div className="container mx-auto px-4 md:px-8 py-12">
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!user || user.role !== "tenant") {
    return (
      <div className="container mx-auto px-4 md:px-8 py-24 text-center">
        <Building2 size={48} className="text-muted-foreground mx-auto mb-4" />
        <h2 className="text-2xl font-black mb-2">{t("Akses Terbatas", "Restricted Access")}</h2>
        <p className="text-muted-foreground mb-6">{t("Halaman ini hanya untuk Penyewa Tenan.", "This page is for Tenants only.")}</p>
        <Button asChild><Link href="/login">{t("Login", "Login")}</Link></Button>
      </div>
    );
  }

  const pending = bookings.filter((b: any) => b.status === "pending").length;
  const active = bookings.filter((b: any) => b.status === "active").length;
  const approved = bookings.filter((b: any) => b.status === "approved").length;
  const recent = [...bookings].slice(0, 5);

  return (
    <div className="container mx-auto px-4 md:px-8 py-10 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-primary mb-1">{t("Portal Tenant", "Tenant Portal")}</div>
          <h1 className="text-3xl font-black">{t("Dashboard Saya", "My Dashboard")}</h1>
          {tenant && (
            <p className="text-muted-foreground mt-1 text-sm">{tenant.businessName} · {user.email}</p>
          )}
        </div>
        <Button asChild className="rounded-full px-6 font-bold shadow-md shadow-primary/20">
          <Link href="/tenant/booking">
            <CalendarPlus size={15} className="mr-2" /> {t("Ajukan Booking Baru", "New Booking")}
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { n: bookings.length, l: t("Total Booking", "Total Bookings"), icon: List, color: "text-primary" },
          { n: pending, l: t("Menunggu Review", "Pending Review"), icon: Clock, color: "text-yellow-600" },
          { n: approved, l: t("Disetujui", "Approved"), icon: CheckCircle2, color: "text-green-600" },
          { n: active, l: t("Aktif", "Active"), icon: TrendingUp, color: "text-blue-600" },
        ].map((s) => (
          <Card key={s.l} className="border-border/60">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-black">{bookingsLoading ? "—" : s.n}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.l}</div>
                </div>
                <s.icon size={18} className={s.color} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tenant info card */}
      {(tenantLoading || tenant) && (
        <Card className="border-border/60 mb-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-black flex items-center gap-2">
              <Building2 size={16} className="text-primary" /> {t("Profil Bisnis", "Business Profile")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tenantLoading ? (
              <div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-64" /></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">{t("Nama Bisnis", "Business Name")}</div>
                  <div className="font-bold">{tenant.businessName}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">{t("Pemilik", "Owner")}</div>
                  <div className="font-bold">{tenant.ownerName}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">{t("Kategori", "Category")}</div>
                  <div className="font-semibold">{tenant.businessCategory || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">{t("Status Akun", "Account Status")}</div>
                  <Badge variant="outline" className={tenant.status === "active" ? "bg-green-100 text-green-700 border-green-200" : "bg-yellow-100 text-yellow-700 border-yellow-200"}>
                    {tenant.status}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent bookings */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-black">{t("Booking Terbaru", "Recent Bookings")}</CardTitle>
            <Button asChild variant="ghost" size="sm" className="text-xs text-primary">
              <Link href="/tenant/bookings">{t("Lihat Semua", "View All")} <ChevronRight size={13} /></Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bookingsLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : recent.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <List size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t("Belum ada booking.", "No bookings yet.")}</p>
              <Button asChild size="sm" className="mt-4 rounded-full"><Link href="/tenant/booking">{t("Ajukan Booking", "Submit Booking")}</Link></Button>
            </div>
          ) : (
            <div className="space-y-2">
              {recent.map((b: any) => {
                const cfg = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.pending;
                return (
                  <Link key={b.id} href={`/tenant/bookings/${b.orderNumber}`}
                    className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/60 transition-colors group border border-transparent hover:border-border/40">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                        <cfg.icon size={16} />
                      </div>
                      <div>
                        <div className="font-bold text-sm">{b.orderNumber}</div>
                        <div className="text-xs text-muted-foreground capitalize">{b.bookingType.replace("_", " ")} · {b.startDate} – {b.endDate}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] font-bold ${cfg.badge}`}>{t(cfg.label, cfg.labelEn)}</Badge>
                      <ChevronRight size={14} className="text-muted-foreground group-hover:text-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
