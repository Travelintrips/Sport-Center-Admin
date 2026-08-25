import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPlus, Clock, CheckCircle2, XCircle, AlertCircle, ChevronRight, List } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

const STATUS_CONFIG: Record<string, { label: string; labelEn: string; badge: string; icon: typeof Clock }> = {
  pending:   { label: "Menunggu Review",  labelEn: "Pending Review",  badge: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Clock },
  approved:  { label: "Disetujui",        labelEn: "Approved",        badge: "bg-green-100 text-green-700 border-green-200",  icon: CheckCircle2 },
  rejected:  { label: "Ditolak",          labelEn: "Rejected",        badge: "bg-red-100 text-red-700 border-red-200",        icon: XCircle },
  active:    { label: "Aktif",            labelEn: "Active",          badge: "bg-blue-100 text-blue-700 border-blue-200",     icon: CheckCircle2 },
  expired:   { label: "Kadaluarsa",       labelEn: "Expired",         badge: "bg-gray-100 text-gray-600 border-gray-200",    icon: AlertCircle },
};

const PAYMENT_CONFIG: Record<string, { label: string; labelEn: string; badge: string }> = {
  pending:   { label: "Belum Bayar",     labelEn: "Unpaid",           badge: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  uploaded:  { label: "Bukti Dikirim",   labelEn: "Proof Uploaded",   badge: "bg-blue-100 text-blue-700 border-blue-200" },
  verified:  { label: "Pembayaran OK",   labelEn: "Payment Verified", badge: "bg-green-100 text-green-700 border-green-200" },
  rejected:  { label: "Pembayaran Tolak",labelEn: "Payment Rejected", badge: "bg-red-100 text-red-700 border-red-200" },
};

async function fetchTenantBookings() {
  const token = getToken();
  const res = await fetch(`/api/tenant/bookings`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

export default function TenantBookings() {
  const { t } = useLang();
  const { data: user } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });
  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["tenant-bookings"],
    queryFn: fetchTenantBookings,
    enabled: user?.role === "tenant",
    retry: false,
  });

  if (!user || user.role !== "tenant") {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <p className="text-muted-foreground">{t("Login sebagai Tenant untuk melihat booking.", "Login as Tenant to view bookings.")}</p>
        <Button asChild className="mt-4"><Link href="/login">{t("Login", "Login")}</Link></Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 md:px-8 py-10 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-primary mb-1">{t("Tenant Portal", "Tenant Portal")}</div>
          <h1 className="text-3xl font-black">{t("Riwayat Booking", "Booking History")}</h1>
        </div>
        <Button asChild className="rounded-full px-6 font-bold shadow-md shadow-primary/20">
          <Link href="/tenant/booking">
            <CalendarPlus size={14} className="mr-2" /> {t("Booking Baru", "New Booking")}
          </Link>
        </Button>
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-black">{t("Semua Booking", "All Bookings")} {!isLoading && <span className="text-muted-foreground font-normal text-sm ml-1">({bookings.length})</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <List size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm mb-4">{t("Belum ada booking.", "No bookings yet.")}</p>
              <Button asChild size="sm" className="rounded-full"><Link href="/tenant/booking">{t("Ajukan Booking Pertama", "Submit First Booking")}</Link></Button>
            </div>
          ) : (
            <div className="space-y-2">
              {bookings.map((b: any) => {
                const cfg = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.pending;
                const pcfg = PAYMENT_CONFIG[b.paymentStatus] ?? PAYMENT_CONFIG.pending;
                return (
                  <Link key={b.id} href={`/tenant/bookings/${b.orderNumber}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl hover:bg-muted/60 transition-colors group border border-border/40 hover:border-border gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <cfg.icon size={18} />
                      </div>
                      <div>
                        <div className="font-black text-sm">{b.orderNumber}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 capitalize">
                          {b.bookingType.replace("_", " ")} · {b.startDate} – {b.endDate}
                          {b.requestedArea && <span> · {b.requestedArea}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-13 sm:ml-0">
                      <Badge variant="outline" className={`text-[10px] font-bold ${cfg.badge}`}>{t(cfg.label, cfg.labelEn)}</Badge>
                      <Badge variant="outline" className={`text-[10px] font-bold ${pcfg.badge}`}>{t(pcfg.label, pcfg.labelEn)}</Badge>
                      <ChevronRight size={14} className="text-muted-foreground ml-1 group-hover:text-foreground hidden sm:block" />
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
