import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useGetMyBookings, useGetReviews, useCreateReview, useLogout, getGetMeQueryKey, getGetMyBookingsQueryKey } from "@workspace/api-client-react";
import { removeToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/lib/i18n";
import { CalendarDays, Clock, ChevronRight, LogOut, ReceiptText, Star, Trophy, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { id as idLocale, enUS } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { label: string; labelEn: string; stripe: string; badge: string }> = {
  pending_payment:      { label: "Menunggu Pembayaran",   labelEn: "Awaiting Payment",        stripe: "#f59e0b", badge: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  waiting_confirmation: { label: "Menunggu Konfirmasi",   labelEn: "Awaiting Confirmation",   stripe: "#f97316", badge: "bg-orange-100 text-orange-800 border-orange-200" },
  paid:                 { label: "Sedang Diverifikasi",   labelEn: "Being Verified",          stripe: "#3b82f6", badge: "bg-blue-100 text-blue-800 border-blue-200" },
  confirmed:            { label: "Dikonfirmasi",           labelEn: "Confirmed",               stripe: "#10b981", badge: "bg-green-100 text-green-800 border-green-200" },
  completed:            { label: "Selesai",                labelEn: "Completed",               stripe: "#7c3aed", badge: "bg-violet-100 text-violet-800 border-violet-200" },
  cancelled:            { label: "Dibatalkan",             labelEn: "Cancelled",               stripe: "#ef4444", badge: "bg-red-100 text-red-800 border-red-200" },
  rejected:             { label: "Pembayaran Ditolak",     labelEn: "Payment Rejected",        stripe: "#ef4444", badge: "bg-red-100 text-red-800 border-red-200" },
  expired:              { label: "Expired",                labelEn: "Expired",                 stripe: "#9ca3af", badge: "bg-gray-100 text-gray-600 border-gray-200" },
  refunded:             { label: "Dana Dikembalikan",      labelEn: "Refunded",                stripe: "#8b5cf6", badge: "bg-purple-100 text-purple-800 border-purple-200" },
};

const INACTIVE = ["completed", "cancelled", "expired", "rejected", "refunded"];

export default function MyBookings() {
  const [, setLocation] = useLocation();
  const { t, lang } = useLang();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dateLocale = lang === "id" ? idLocale : enUS;

  const { data: user, isLoading: userLoading, isError } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });
  const { data: bookings, isLoading: bookingsLoading } = useGetMyBookings({ query: { enabled: !!user, queryKey: getGetMyBookingsQueryKey() } });
  const { data: allReviews } = useGetReviews(undefined, { query: { enabled: !!user } });

  const [reviewState, setReviewState] = useState<Record<number, { rating: number; comment: string; hover: number }>>({});

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        removeToken();
        queryClient.clear();
        setLocation("/");
      },
    },
  });

  const submitReview = useCreateReview({
    mutation: {
      onSuccess: () => {
        toast({ title: t("Terima kasih atas ulasan Anda!", "Thank you for your review!") });
        queryClient.invalidateQueries({ queryKey: ["getReviews"] });
      },
      onError: (error: any) => {
        toast({ title: t("Gagal mengirim ulasan", "Failed to submit"), description: error?.message, variant: "destructive" });
      },
    },
  });

  const getRs = (id: number) => reviewState[id] ?? { rating: 0, comment: "", hover: 0 };
  const setRs = (id: number, patch: Partial<{ rating: number; comment: string; hover: number }>) =>
    setReviewState((prev) => ({ ...prev, [id]: { ...getRs(id), ...patch } }));

  useEffect(() => {
    if (!userLoading && (isError || !user)) {
      setLocation("/login");
    }
  }, [userLoading, isError, user, setLocation]);

  useEffect(() => {
    if (user?.role === "tenant") {
      setLocation("/tenant/bookings");
    }
  }, [user, setLocation]);

  if (userLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  if (isError || !user) return null;

  if (user.role === "tenant") return null;

  const active = (bookings ?? []).filter((b) => !INACTIVE.includes(b.status));
  const past   = (bookings ?? []).filter((b) =>  INACTIVE.includes(b.status));

  const BookingCard = ({ b }: { b: NonNullable<typeof bookings>[number] }) => {
    const cfg = STATUS_CONFIG[b.status] ?? { label: b.status, labelEn: b.status, stripe: "#9ca3af", badge: "bg-gray-100 text-gray-600 border-gray-200" };
    const review = allReviews?.find((r) => r.bookingId === b.id);
    const rs = getRs(b.id);

    return (
      <Card className="overflow-hidden hover:shadow-md transition-shadow">
        <CardContent className="p-0">
          <div className="flex items-stretch">
            <div className="w-1.5 flex-shrink-0 rounded-l-xl" style={{ background: cfg.stripe }} />
            <div className="flex-1 p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div>
                  <div className="font-black text-lg leading-tight">{b.facilityName}</div>
                  <div className="text-xs text-primary font-semibold uppercase tracking-wide mt-0.5">{b.facilityCategory}</div>
                </div>
                <Badge className={`text-xs font-bold border ${cfg.badge}`}>
                  {lang === "id" ? cfg.label : cfg.labelEn}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mb-4">
                <span className="flex items-center gap-1.5">
                  <CalendarDays size={13} className="text-primary" />
                  {format(new Date(b.bookingDate), "EEE, d MMM yyyy", { locale: dateLocale })}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock size={13} className="text-primary" />
                  {b.startTime.substring(0, 5)} – {b.endTime.substring(0, 5)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="font-black text-primary">Rp {b.totalPrice.toLocaleString("id-ID")}</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono hidden sm:inline">#{b.orderNumber}</span>
                  <Button asChild variant="ghost" size="sm" className="gap-1 text-primary hover:text-primary h-8 px-3">
                    <Link href={`/booking/${b.orderNumber}`}>
                      {t("Detail", "Detail")} <ChevronRight size={13} />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Inline review form for completed bookings */}
              {b.status === "completed" && (
                <div className="mt-4 pt-4 border-t border-border/60">
                  {review ? (
                    <div className="flex items-center gap-3">
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map((s) => (
                          <Star key={s} className={`w-4 h-4 ${s <= review.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-200"}`} />
                        ))}
                      </div>
                      {review.comment && <p className="text-xs text-muted-foreground italic flex-1 truncate">"{review.comment}"</p>}
                      <span className="text-xs text-green-600 font-semibold shrink-0">✓ {t("Sudah diulas", "Reviewed")}</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{t("Beri Ulasan", "Leave a Review")}</p>
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map((s) => (
                          <button key={s} type="button"
                            onClick={() => setRs(b.id, { rating: s })}
                            onMouseEnter={() => setRs(b.id, { hover: s })}
                            onMouseLeave={() => setRs(b.id, { hover: 0 })}
                            className="focus:outline-none"
                          >
                            <Star className={`w-6 h-6 transition-colors ${s <= (rs.hover || rs.rating) ? "fill-yellow-400 text-yellow-400" : "text-gray-200 hover:text-yellow-300"}`} />
                          </button>
                        ))}
                      </div>
                      {rs.rating > 0 && (
                        <div className="flex gap-2 mt-2">
                          <input
                            className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary bg-background"
                            placeholder={t("Komentar (opsional)...", "Comment (optional)...")}
                            value={rs.comment}
                            onChange={(e) => setRs(b.id, { comment: e.target.value })}
                          />
                          <Button size="sm" className="bg-primary hover:bg-primary/90 shrink-0"
                            disabled={submitReview.isPending}
                            onClick={() => submitReview.mutate({ data: { bookingId: b.id, rating: rs.rating, comment: rs.comment || undefined } })}
                          >
                            {t("Kirim", "Submit")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-black mb-1">{t("Booking Saya", "My Bookings")}</h1>
          <p className="text-muted-foreground text-sm">{t("Riwayat dan status pemesanan fasilitas Anda", "History and status of your facility bookings")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="font-semibold text-sm">{user.name}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </div>
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-black text-lg shrink-0">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <Button variant="ghost" size="sm" onClick={() => logoutMutation.mutate(undefined as void)} className="text-muted-foreground hover:text-foreground gap-1">
            <LogOut size={14} /> {t("Keluar", "Log out")}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-black text-primary">{bookings?.length ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{t("Total Booking", "Total Bookings")}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-black text-green-600">
            {bookings?.filter((b) => b.status === "confirmed" || b.status === "completed").length ?? 0}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{t("Terkonfirmasi", "Confirmed")}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-black text-amber-500">
            {bookings?.filter((b) => b.status === "pending_payment" || b.status === "waiting_confirmation").length ?? 0}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{t("Menunggu", "Pending")}</div>
        </CardContent></Card>
      </div>

      {/* Booking List */}
      {bookingsLoading ? (
        <div className="space-y-4">{[1,2,3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : !bookings || bookings.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <Trophy size={40} className="mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-bold text-lg mb-1">{t("Belum ada booking", "No bookings yet")}</h3>
          <p className="text-muted-foreground text-sm mb-6">{t("Mulai pesan fasilitas favoritmu sekarang!", "Start booking your favorite facility now!")}</p>
          <Button asChild className="bg-primary hover:bg-primary/90">
            <Link href="/facilities">{t("Lihat Fasilitas", "View Facilities")}</Link>
          </Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-8">
          {active.length > 0 && (
            <section>
              <h2 className="text-base font-black mb-4 flex items-center gap-2">
                <div className="w-2 h-5 bg-primary rounded-full" />
                {t("Booking Aktif", "Active Bookings")}
                <span className="text-sm font-normal text-muted-foreground">({active.length})</span>
              </h2>
              <div className="space-y-3">{active.map((b) => <BookingCard key={b.id} b={b} />)}</div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-base font-black mb-4 flex items-center gap-2">
                <div className="w-2 h-5 bg-muted-foreground/40 rounded-full" />
                {t("Riwayat", "History")}
                <span className="text-sm font-normal text-muted-foreground">({past.length})</span>
              </h2>
              <div className="space-y-3">{past.map((b) => <BookingCard key={b.id} b={b} />)}</div>
            </section>
          )}
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-border flex flex-col sm:flex-row gap-3 items-center justify-center">
        <Button asChild variant="outline" size="sm">
          <Link href="/facilities">
            <ReceiptText size={14} className="mr-2" /> {t("+ Pesan Fasilitas Baru", "+ Book a New Facility")}
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="border-[#25D366] text-[#25D366] hover:bg-[#25D366] hover:text-white">
          <a href="https://wa.me/6281288195206" target="_blank" rel="noopener noreferrer">
            <MessageCircle size={14} className="mr-2" /> {t("Chat Admin", "Chat Admin")}
          </a>
        </Button>
      </div>
    </div>
  );
}
