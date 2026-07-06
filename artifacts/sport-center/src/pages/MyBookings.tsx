import { useState, useEffect, memo } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useGetMyBookings, useGetReviews, useCreateReview, useLogout, getGetMeQueryKey, getGetMyBookingsQueryKey, getGetReviewsQueryKey } from "@workspace/api-client-react";
import { removeToken, getToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import { CalendarDays, Clock, ChevronRight, LogOut, ReceiptText, Star, Trophy, MessageCircle, CalendarClock, UserCheck, Link2, ShoppingCart, ChevronDown, Search, X } from "lucide-react";
import RescheduleDialog from "@/components/RescheduleDialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { Locale } from "date-fns";
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

type BookingItem = { id: number; facilityName: string; facilityCategory: string; status: string; bookingDate: string; startTime: string; endTime: string; totalPrice: number; orderNumber: string; customerName?: string; groupRef?: string | null };
type ReviewItem = { bookingId: number; rating: number; comment?: string | null };
type Rs = { rating: number; comment: string; hover: number };

interface BookingCardProps {
  b: BookingItem;
  review: ReviewItem | undefined;
  rs: Rs;
  lang: string;
  dateLocale: Locale;
  userName?: string;
  onReschedule: (b: BookingItem) => void;
  onSetRating: (id: number, rating: number) => void;
  onSetHover: (id: number, hover: number) => void;
  onCommentChange: (id: number, comment: string) => void;
  onSubmitReview: (id: number) => void;
  submitPending: boolean;
}

const BookingCard = memo(function BookingCard({
  b, review, rs, lang, dateLocale, userName, onReschedule, onSetRating, onSetHover, onCommentChange, onSubmitReview, submitPending,
}: BookingCardProps) {
  const { t } = useLang(); // hook in a top-level memo component — valid
  const cfg = STATUS_CONFIG[b.status] ?? { label: b.status, labelEn: b.status, stripe: "#9ca3af", badge: "bg-gray-100 text-gray-600 border-gray-200" };

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
              {b.customerName && userName && b.customerName.trim().toLowerCase() !== userName.trim().toLowerCase() && (
                <span className="flex items-center gap-1.5 text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5 font-semibold">
                  <UserCheck size={11} />
                  {t("Atas Nama", "On behalf of")}: {b.customerName}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="font-black text-primary">Rp {b.totalPrice.toLocaleString("id-ID")}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono hidden sm:inline">#{b.orderNumber}</span>
                {["pending_payment", "paid", "confirmed", "waiting_confirmation"].includes(b.status) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-orange-600 hover:text-orange-700 hover:bg-orange-50 h-8 px-3"
                    onClick={() => onReschedule(b)}
                  >
                    <CalendarClock size={13} /> {t("Reschedule", "Reschedule")}
                  </Button>
                )}
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
                          onClick={() => onSetRating(b.id, s)}
                          onMouseEnter={() => onSetHover(b.id, s)}
                          onMouseLeave={() => onSetHover(b.id, 0)}
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
                          onChange={(e) => onCommentChange(b.id, e.target.value)}
                        />
                        <Button size="sm" className="bg-primary hover:bg-primary/90 shrink-0"
                          disabled={submitPending}
                          onClick={() => onSubmitReview(b.id)}
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
});

function CartGroupCard({
  group,
  lang,
  dateLocale,
  onReschedule,
}: {
  group: { groupRef: string; items: BookingItem[] };
  lang: string;
  dateLocale: Locale;
  onReschedule: (b: BookingItem) => void;
}) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(true);
  const { items } = group;
  const totalPrice = items.reduce((s, b) => s + b.totalPrice, 0);
  const allStatuses = [...new Set(items.map((b) => b.status))];
  // Warna strip: merah jika ada yang cancelled/expired, hijau jika semua confirmed, kuning selainnya
  const hasInactive = items.some((b) => INACTIVE.includes(b.status));
  const allConfirmed = items.every((b) => b.status === "confirmed" || b.status === "completed");
  const stripeColor = hasInactive && !allConfirmed ? "#9ca3af" : allConfirmed ? "#10b981" : "#f59e0b";

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow border-primary/20">
      <CardContent className="p-0">
        <div className="flex items-stretch">
          <div className="w-1.5 flex-shrink-0 rounded-l-xl" style={{ background: stripeColor }} />
          <div className="flex-1 p-4">
            {/* Header grup */}
            <button
              className="w-full flex items-center justify-between gap-3 text-left"
              onClick={() => setExpanded((v) => !v)}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 font-black text-sm text-primary">
                  <ShoppingCart className="w-4 h-4" />
                  {t("Booking Keranjang", "Cart Booking")}
                </div>
                <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                  {items.length} {t("lapangan", "courts")}
                </Badge>
                <div className="flex gap-1 flex-wrap">
                  {allStatuses.map((s) => {
                    const cfg = STATUS_CONFIG[s] ?? { badge: "bg-gray-100 text-gray-600 border-gray-200", label: s, labelEn: s };
                    return (
                      <span key={s} className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${cfg.badge}`}>
                        {lang === "id" ? cfg.label : cfg.labelEn}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-black text-primary text-sm">Rp {totalPrice.toLocaleString("id-ID")}</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
              </div>
            </button>

            {/* Item list */}
            {expanded && (
              <div className="mt-3 space-y-2">
                {items.map((b) => {
                  const cfg = STATUS_CONFIG[b.status] ?? { label: b.status, labelEn: b.status, stripe: "#9ca3af", badge: "bg-gray-100 text-gray-600 border-gray-200" };
                  return (
                    <div key={b.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border border-border/40">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{b.facilityName}</div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-0.5">
                          <span className="flex items-center gap-1">
                            <CalendarDays size={11} className="text-primary" />
                            {format(new Date(b.bookingDate), "EEE, d MMM", { locale: dateLocale })}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={11} className="text-primary" />
                            {b.startTime.substring(0, 5)} – {b.endTime.substring(0, 5)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={`text-xs border hidden sm:inline-flex ${cfg.badge}`}>
                          {lang === "id" ? cfg.label : cfg.labelEn}
                        </Badge>
                        {["pending_payment", "paid", "confirmed", "waiting_confirmation"].includes(b.status) && (
                          <Button variant="ghost" size="sm" className="gap-1 text-orange-600 hover:text-orange-700 hover:bg-orange-50 h-7 px-2 text-xs" onClick={() => onReschedule(b)}>
                            <CalendarClock size={11} /> {t("Reschedule", "Reschedule")}
                          </Button>
                        )}
                        <Button asChild variant="ghost" size="sm" className="gap-1 text-primary h-7 px-2 text-xs">
                          <Link href={`/booking/${b.orderNumber}`}>
                            {t("Detail", "Detail")} <ChevronRight size={11} />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyBookings() {
  const [, setLocation] = useLocation();
  const { t, lang } = useLang();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dateLocale = lang === "id" ? idLocale : enUS;

  const { data: user, isLoading: userLoading, isError } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });
  const { data: bookings, isLoading: bookingsLoading } = useGetMyBookings({ query: { enabled: !!user, queryKey: getGetMyBookingsQueryKey() } });
  const { data: allReviews } = useGetReviews(undefined, { query: { enabled: !!user, queryKey: getGetReviewsQueryKey() } });

  const [reviewState, setReviewState] = useState<Record<number, { rating: number; comment: string; hover: number }>>({});
  const [rescheduleTarget, setRescheduleTarget] = useState<BookingItem | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimOrder, setClaimOrder] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);

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

  const handleClaim = async () => {
    if (!claimOrder.trim()) return;
    setClaimLoading(true);
    try {
      const token = getToken();
      const res = await fetch("/api/bookings/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderNumber: claimOrder.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mengklaim booking");
      toast({ title: t("Berhasil diklaim!", "Claimed!"), description: t(`Booking ${data.orderNumber} berhasil ditambahkan ke riwayat Anda.`, `Booking ${data.orderNumber} has been added to your history.`) });
      setClaimOpen(false);
      setClaimOrder("");
      queryClient.invalidateQueries({ queryKey: getGetMyBookingsQueryKey() });
    } catch (err: any) {
      toast({ title: t("Gagal", "Failed"), description: err.message, variant: "destructive" });
    } finally {
      setClaimLoading(false);
    }
  };

  const getRs = (id: number): Rs => reviewState[id] ?? { rating: 0, comment: "", hover: 0 };
  const setRs = (id: number, patch: Partial<Rs>) =>
    setReviewState((prev) => ({ ...prev, [id]: { ...getRs(id), ...patch } }));

  if (userLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  if (isError || !user) return null;
  if (user.role === "tenant") return null;

  // Filter berdasarkan nama customer (untuk akun operator)
  const isOperator = user.role === "admin" || user.role === "super_admin" || user.role === "admin_booking" || user.role === "staff";
  const searchQuery = customerSearch.trim().toLowerCase();

  // Pisahkan booking individual dan grup
  const allBookings = (bookings ?? []).filter((b) => {
    if (!searchQuery) return true;
    const name = (b.customerName ?? "").toLowerCase();
    return name.includes(searchQuery);
  });

  // Kelompokkan berdasarkan groupRef
  const groupMap = new Map<string, BookingItem[]>();
  const soloBookings: BookingItem[] = [];

  for (const b of allBookings) {
    if (b.groupRef) {
      const list = groupMap.get(b.groupRef) ?? [];
      list.push(b as BookingItem);
      groupMap.set(b.groupRef, list);
    } else {
      soloBookings.push(b as BookingItem);
    }
  }

  // Grup yang hanya punya 1 item diperlakukan sebagai solo
  const cartGroups: { groupRef: string; items: BookingItem[] }[] = [];
  for (const [groupRef, items] of groupMap.entries()) {
    if (items.length > 1) {
      cartGroups.push({ groupRef, items });
    } else {
      soloBookings.push(...items);
    }
  }

  const active = soloBookings.filter((b) => !INACTIVE.includes(b.status));
  const past   = soloBookings.filter((b) =>  INACTIVE.includes(b.status));
  const activeGroups = cartGroups.filter((g) => g.items.some((b) => !INACTIVE.includes(b.status)));
  const pastGroups   = cartGroups.filter((g) => g.items.every((b) =>  INACTIVE.includes(b.status)));

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

      {/* Filter Nama Customer — hanya untuk operator */}
      {isOperator && (
        <div className="mb-6">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 pr-9"
              placeholder={t("Cari nama customer...", "Search customer name...")}
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
            {customerSearch && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setCustomerSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {allBookings.length === 0
                ? t("Tidak ada booking untuk nama ini", "No bookings found for this name")
                : t(`Menampilkan ${allBookings.length} booking untuk "${customerSearch}"`, `Showing ${allBookings.length} bookings for "${customerSearch}"`)}
            </p>
          )}
        </div>
      )}

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
      ) : allBookings.length === 0 && searchQuery ? (
        <Card><CardContent className="py-12 text-center">
          <Search size={36} className="mx-auto text-muted-foreground/30 mb-3" />
          <h3 className="font-bold text-base mb-1">{t("Tidak ditemukan", "No results found")}</h3>
          <p className="text-muted-foreground text-sm">{t(`Tidak ada booking dengan nama "${customerSearch}"`, `No bookings found for "${customerSearch}"`)}</p>
          <Button variant="ghost" size="sm" className="mt-3 text-primary" onClick={() => setCustomerSearch("")}>
            <X size={13} className="mr-1" /> {t("Hapus filter", "Clear filter")}
          </Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-8">
          {(active.length > 0 || activeGroups.length > 0) && (
            <section>
              <h2 className="text-base font-black mb-4 flex items-center gap-2">
                <div className="w-2 h-5 bg-primary rounded-full" />
                {t("Booking Aktif", "Active Bookings")}
                <span className="text-sm font-normal text-muted-foreground">
                  ({active.length + activeGroups.reduce((n, g) => n + g.items.length, 0)})
                </span>
              </h2>
              <div className="space-y-3">
                {activeGroups.map((g) => (
                  <CartGroupCard key={g.groupRef} group={g} lang={lang} dateLocale={dateLocale} onReschedule={setRescheduleTarget} />
                ))}
                {active.map((b) => (
                  <BookingCard
                    key={b.id} b={b}
                    review={allReviews?.find((r) => r.bookingId === b.id)}
                    rs={getRs(b.id)}
                    lang={lang} dateLocale={dateLocale}
                    userName={user?.name ?? undefined}
                    onReschedule={setRescheduleTarget}
                    onSetRating={(id, rating) => setRs(id, { rating })}
                    onSetHover={(id, hover) => setRs(id, { hover })}
                    onCommentChange={(id, comment) => setRs(id, { comment })}
                    onSubmitReview={(id) => {
                      const r = getRs(id);
                      submitReview.mutate({ data: { bookingId: id, rating: r.rating, comment: r.comment || undefined } });
                    }}
                    submitPending={submitReview.isPending}
                  />
                ))}
              </div>
            </section>
          )}
          {(past.length > 0 || pastGroups.length > 0) && (
            <section>
              <h2 className="text-base font-black mb-4 flex items-center gap-2">
                <div className="w-2 h-5 bg-muted-foreground/40 rounded-full" />
                {t("Riwayat", "History")}
                <span className="text-sm font-normal text-muted-foreground">
                  ({past.length + pastGroups.reduce((n, g) => n + g.items.length, 0)})
                </span>
              </h2>
              <div className="space-y-3">
                {pastGroups.map((g) => (
                  <CartGroupCard key={g.groupRef} group={g} lang={lang} dateLocale={dateLocale} onReschedule={setRescheduleTarget} />
                ))}
                {past.map((b) => (
                  <BookingCard
                    key={b.id} b={b}
                    review={allReviews?.find((r) => r.bookingId === b.id)}
                    rs={getRs(b.id)}
                    lang={lang} dateLocale={dateLocale}
                    userName={user?.name ?? undefined}
                    onReschedule={setRescheduleTarget}
                    onSetRating={(id, rating) => setRs(id, { rating })}
                    onSetHover={(id, hover) => setRs(id, { hover })}
                    onCommentChange={(id, comment) => setRs(id, { comment })}
                    onSubmitReview={(id) => {
                      const r = getRs(id);
                      submitReview.mutate({ data: { bookingId: id, rating: r.rating, comment: r.comment || undefined } });
                    }}
                    submitPending={submitReview.isPending}
                  />
                ))}
              </div>
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
        <Button variant="outline" size="sm" onClick={() => setClaimOpen(true)}>
          <Link2 size={14} className="mr-2" /> {t("Klaim Booking", "Claim Booking")}
        </Button>
        <Button asChild variant="outline" size="sm" className="border-[#25D366] text-[#25D366] hover:bg-[#25D366] hover:text-white">
          <a href="https://wa.me/6281288195206" target="_blank" rel="noopener noreferrer">
            <MessageCircle size={14} className="mr-2" /> {t("Chat Admin", "Chat Admin")}
          </a>
        </Button>
      </div>

      <Dialog open={claimOpen} onOpenChange={(o) => { setClaimOpen(o); if (!o) setClaimOrder(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 size={18} className="text-primary" /> {t("Klaim Booking", "Claim Booking")}</DialogTitle>
            <DialogDescription>
              {t("Masukkan nomor order booking yang ingin Anda hubungkan ke akun ini.", "Enter the order number of the booking you want to link to this account.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("Nomor Order", "Order Number")}</label>
              <Input
                placeholder="Contoh: SC-20240611-001"
                value={claimOrder}
                onChange={(e) => setClaimOrder(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleClaim()}
                className="font-mono tracking-wider"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setClaimOpen(false)} disabled={claimLoading}>
                {t("Batal", "Cancel")}
              </Button>
              <Button size="sm" onClick={handleClaim} disabled={claimLoading || !claimOrder.trim()} className="bg-primary hover:bg-primary/90">
                {claimLoading ? t("Memproses...", "Processing...") : t("Klaim", "Claim")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {rescheduleTarget && (
        <RescheduleDialog
          open={!!rescheduleTarget}
          onOpenChange={(open) => !open && setRescheduleTarget(null)}
          bookingId={rescheduleTarget.id}
          orderNumber={rescheduleTarget.orderNumber}
          currentDate={rescheduleTarget.bookingDate}
          currentStart={rescheduleTarget.startTime}
          currentEnd={rescheduleTarget.endTime}
          facilityName={rescheduleTarget.facilityName}
        />
      )}
    </div>
  );
}
