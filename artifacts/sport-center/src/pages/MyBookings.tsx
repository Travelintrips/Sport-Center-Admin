import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useGetMyBookings, useLogout, getGetMeQueryKey, getGetMyBookingsQueryKey } from "@workspace/api-client-react";
import { removeToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/lib/i18n";
import { CalendarDays, Clock, MapPin, ChevronRight, LogOut, ReceiptText, User } from "lucide-react";

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string, lang: string = "id") {
  return new Date(dateStr).toLocaleDateString(lang === "en" ? "en-US" : "id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

const STATUS_CONFIG: Record<string, { label: string; labelEn: string; color: string; bg: string }> = {
  pending_payment: { label: "Menunggu Pembayaran", labelEn: "Awaiting Payment", color: "#d97706", bg: "#fef3c7" },
  paid:            { label: "Sudah Dibayar",       labelEn: "Paid",            color: "#2563eb", bg: "#dbeafe" },
  confirmed:       { label: "Dikonfirmasi",         labelEn: "Confirmed",       color: "#059669", bg: "#d1fae5" },
  completed:       { label: "Selesai",              labelEn: "Completed",       color: "#7c3aed", bg: "#ede9fe" },
  cancelled:       { label: "Dibatalkan",           labelEn: "Cancelled",       color: "#dc2626", bg: "#fee2e2" },
};

export default function MyBookings() {
  const [, setLocation] = useLocation();
  const { t, lang } = useLang();

  const { data: user, isLoading: userLoading, isError } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey() },
  });

  const { data: bookings, isLoading: bookingsLoading } = useGetMyBookings({
    query: { enabled: !!user, queryKey: getGetMyBookingsQueryKey() },
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        removeToken();
        setLocation("/login");
      },
    },
  });

  function doLogout() { logoutMutation.mutate(undefined as void); }

  useEffect(() => {
    if (isError) setLocation("/login");
  }, [isError, setLocation]);

  if (userLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  if (!user) return null;

  const statusOrder = ["pending_payment", "paid", "confirmed", "completed", "cancelled"];
  const sorted = [...(bookings ?? [])].sort((a, b) => {
    const ai = statusOrder.indexOf(a.status ?? "");
    const bi = statusOrder.indexOf(b.status ?? "");
    if (ai !== bi) return ai - bi;
    return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
  });

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black mb-1">{t("Booking Saya", "My Bookings")}</h1>
          <p className="text-muted-foreground">{t("Riwayat dan status pemesanan fasilitas Anda", "History and status of your facility bookings")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="font-semibold text-sm">{user.name}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </div>
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-lg">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <Button variant="ghost" size="sm" onClick={doLogout} className="text-muted-foreground hover:text-foreground gap-1">
            <LogOut size={14} /> {t("Keluar", "Log out")}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-black text-primary">{bookings?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t("Total Booking", "Total Bookings")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-black text-green-600">
              {bookings?.filter((b) => b.status === "confirmed" || b.status === "completed").length ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{t("Terkonfirmasi", "Confirmed")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-black text-amber-600">
              {bookings?.filter((b) => b.status === "pending_payment").length ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{t("Menunggu Bayar", "Awaiting Payment")}</div>
          </CardContent>
        </Card>
      </div>

      {/* Booking list */}
      {bookingsLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ReceiptText size={40} className="mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="font-bold text-lg mb-1">{t("Belum ada booking", "No bookings yet")}</h3>
            <p className="text-muted-foreground text-sm mb-6">{t("Mulai pesan fasilitas favoritmu sekarang!", "Start booking your favorite facility now!")}</p>
            <Button asChild>
              <Link href="/facilities">{t("Lihat Fasilitas", "View Facilities")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sorted.map((booking) => {
            const cfg = STATUS_CONFIG[booking.status] ?? { label: booking.status, labelEn: booking.status, color: "#6b7280", bg: "#f3f4f6" };
            return (
              <Card key={booking.id} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-0">
                  <div className="flex items-stretch">
                    {/* Color stripe */}
                    <div className="w-1.5 flex-shrink-0" style={{ background: cfg.color }} />

                    <div className="flex-1 p-5">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="font-black text-lg leading-tight">{booking.facilityName}</div>
                          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mt-0.5">
                            {booking.facilityCategory}
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className="text-xs font-semibold px-2.5 py-1"
                          style={{ background: cfg.bg, color: cfg.color }}
                        >
                          {t(cfg.label, cfg.labelEn)}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CalendarDays size={14} className="flex-shrink-0" />
                          <span>{formatDate(booking.bookingDate, lang)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock size={14} className="flex-shrink-0" />
                          <span>{booking.startTime} – {booking.endTime}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                          <span>{formatCurrency(booking.totalPrice)}</span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-mono">#{booking.orderNumber}</span>
                        <Button asChild variant="ghost" size="sm" className="gap-1 text-primary hover:text-primary">
                          <Link href={`/booking/${booking.orderNumber}`}>
                            {t("Lihat Detail", "View Details")} <ChevronRight size={14} />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* CTA */}
      <div className="mt-8 text-center">
        <Button asChild variant="outline" size="lg">
          <Link href="/facilities">{t("+ Pesan Fasilitas Baru", "+ Book a New Facility")}</Link>
        </Button>
      </div>
    </div>
  );
}
