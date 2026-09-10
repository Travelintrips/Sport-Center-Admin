import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { 
  useGetFacility, 
  getGetFacilityQueryKey,
  useCheckAvailability,
  getCheckAvailabilityQueryKey,
  useGetReviews,
  useGetReviewsSummary,
  useGetSettings,
  useGetMe,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { id, enUS } from "date-fns/locale";
import { 
  Clock, 
  Users, 
  MapPin, 
  ChevronLeft,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  Star,
  MessageCircle,
  ShoppingCart,
  Dumbbell,
  RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import AvailabilityCalendar from "@/components/AvailabilityCalendar";
import { getFacilityImage } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { useCart } from "@/lib/cart";
import { useToast } from "@/hooks/use-toast";

const MULTIGUNA_ACTIVITIES = [
  { value: "futsal", label: "Futsal", icon: "⚽" },
  { value: "basket", label: "Basket", icon: "🏀" },
  { value: "voli", label: "Voli", icon: "🏐" },
];

const OPERATIONAL_BOOKING_ROLES = new Set([
  "admin",
  "super_admin",
  "admin_booking",
  "staff",
]);

function effectiveCloseTime(facility: { name?: string | null; category?: string | null; closeTime: string }) {
  return "00:00";
}

function addHoursToDisplayTime(time: string, hours: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour * 60 + minute + hours * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function FacilityDetail() {
  const { t, lang } = useLang();
  const { addItem, items } = useCart();
  const { toast } = useToast();
  const [, params] = useRoute("/facilities/:id");
  const [, setLocation] = useLocation();
  const facilityId = params?.id ? parseInt(params.id) : 0;

  const { data: meData } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });
  const isOperationalAccount =
    !!meData && OPERATIONAL_BOOKING_ROLES.has((meData as { role?: string }).role ?? "");

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [duration, setDuration] = useState<string>("1");
  const [activityType, setActivityType] = useState<string>("");
  
  const { data: facility, isLoading: isLoadingFacility } = useGetFacility(facilityId, {
    query: {
      enabled: !!facilityId,
      queryKey: getGetFacilityQueryKey(facilityId)
    }
  });
  const minDuration = Math.max(1, facility?.minDuration ?? 1);
  const durationHours = Number.parseInt(duration, 10);
  const hasValidDuration =
    Number.isInteger(durationHours) && durationHours >= minDuration;

  const { data: reviews } = useGetReviews({ facilityId }, { query: { enabled: !!facilityId, queryKey: ["getReviews", facilityId] } });
  const { data: reviewsSummary } = useGetReviewsSummary();
  const facilitySummary = reviewsSummary?.find((s) => s.facilityId === facilityId);
  const avgRating = facilitySummary?.avgRating ?? 0;
  const reviewCount = facilitySummary?.count ?? 0;

  const formattedDate = date ? format(date, "yyyy-MM-dd") : "";

  const {
    data: slots,
    isLoading: isLoadingSlots,
    isError: isSlotsError,
  } = useCheckAvailability(
    { facilityId, date: formattedDate },
    {
      query: {
        enabled: !!facilityId && !!formattedDate,
        queryKey: getCheckAvailabilityQueryKey({ facilityId, date: formattedDate })
      }
    }
  );

  // Some older Gym records are still stored with booking_mode = time_slot.
  // Keep the customer experience aligned with the business rule based on the
  // facility identity as well as the persisted mode.
  const isGymFacility = Boolean(
    facility && (
      /gym|fitness/i.test(facility.name ?? "") ||
      /gym|fitness/i.test(facility.category ?? "")
    )
  );
  const isWalkIn = facility?.bookingMode === "walk_in" || isGymFacility;
  const isMultiguna = facility?.category === "Multiguna";

  const { data: settings } = useGetSettings();

  const getWaBookingLink = () => {
    if (!settings?.whatsapp || !facility || !date) return "#";
    let phone = settings.whatsapp;
    if (phone.startsWith("0")) phone = "62" + phone.substring(1);

    const durationNum = durationHours;
    const endTime = addHoursToDisplayTime(selectedTime, durationNum);
    const totalPrice = isWalkIn ? facility.pricePerHour : facility.pricePerHour * durationNum;
    const dateStr = format(date, "EEEE, d MMMM yyyy", { locale: lang === "en" ? enUS : id });
    const actLabel = isMultiguna && activityType ? ` (${activityType})` : "";

    let message: string;
    if (isWalkIn) {
      message =
        `Halo Sport Center, saya ingin booking:\n\n` +
        `📍 Fasilitas: *${facility.name}*\n` +
        `📅 Tanggal: *${dateStr}*\n` +
        `💰 Total: *Rp ${totalPrice.toLocaleString("id-ID")}*\n\n` +
        `Mohon konfirmasi ketersediaan. Terima kasih!`;
    } else {
      message =
        `Halo Sport Center, saya ingin booking:\n\n` +
        `📍 Fasilitas: *${facility.name}${actLabel}*\n` +
        `📅 Tanggal: *${dateStr}*\n` +
        `⏰ Jam: *${selectedTime} – ${endTime} WIB*\n` +
        `⏱ Durasi: *${durationNum} jam*\n` +
        `💰 Total: *Rp ${totalPrice.toLocaleString("id-ID")}*\n\n` +
        `Mohon konfirmasi ketersediaan. Terima kasih!`;
    }
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  const isWaBookingReady =
    !!date &&
    (isWalkIn || (hasValidDuration && !!selectedTime && (!isMultiguna || !!activityType)));

  const handleBook = () => {
    if (!facility || !date) return;
    
    if (isWalkIn) {
      const searchParams = new URLSearchParams({
        facilityId: facility.id.toString(),
        date: formattedDate,
        mode: "walk_in",
      });
      setLocation(`/booking?${searchParams.toString()}`);
      return;
    }

    if (!selectedTime) return;
    if (!hasValidDuration) return;
    if (isMultiguna && !activityType) return;

    const searchParams = new URLSearchParams({
      facilityId: facility.id.toString(),
      date: formattedDate,
      startTime: selectedTime,
      duration: duration,
      ...(isMultiguna && activityType ? { activityType } : {}),
    });
    
    setLocation(`/booking?${searchParams.toString()}`);
  };

  const handleAddToCart = () => {
    if (!facility || !date) return;
    if (!isWalkIn && (!selectedTime || (isMultiguna && !activityType))) return;

    addItem({
      facilityId: facility.id,
      facilityName: facility.name,
      facilityCategory: facility.category,
      facilityPricePerHour: facility.pricePerHour,
      date: formattedDate,
      startTime: isWalkIn ? "" : selectedTime,
      duration: parseInt(duration),
      activityType: isMultiguna && activityType ? activityType : undefined,
      mode: isWalkIn ? "walk_in" : "time_slot",
    });

    toast({
      title: t("Ditambahkan ke Keranjang!", "Added to Cart!"),
      description: t(
        `${facility.name} berhasil ditambahkan. Lanjut pilih lapangan lain atau checkout sekarang.`,
        `${facility.name} added. Keep selecting or checkout now.`
      ),
    });
  };

  const isInCart = items.some(
    (item) =>
      item.facilityId === facilityId &&
      item.date === formattedDate &&
      (isWalkIn ? item.mode === "walk_in" : item.startTime === selectedTime && item.mode === "time_slot")
  );

  if (isLoadingFacility) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Skeleton className="h-10 w-40 mb-8 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          <div className="lg:col-span-7 space-y-6">
            <Skeleton className="w-full aspect-[4/3] md:aspect-[16/9] rounded-3xl" />
            <Skeleton className="h-12 w-3/4 rounded-xl mt-8" />
            <Skeleton className="h-6 w-1/2 rounded-lg" />
            <div className="space-y-3 mt-8">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
          <div className="lg:col-span-5">
            <Skeleton className="w-full h-[600px] rounded-3xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="container mx-auto px-4 py-32 text-center max-w-md">
        <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-10 h-10 text-muted-foreground opacity-50" />
        </div>
        <h2 className="text-3xl font-black mb-4">{t("Fasilitas Tidak Ditemukan", "Facility Not Found")}</h2>
        <p className="text-muted-foreground mb-8">{t("Maaf, data fasilitas yang Anda cari tidak dapat ditemukan atau telah dihapus.", "Sorry, the facility you are looking for could not be found or has been removed.")}</p>
        <Button size="lg" asChild className="rounded-full font-bold h-14 px-8 w-full"><Link href="/facilities">{t("Kembali ke Daftar Fasilitas", "Back to Facilities List")}</Link></Button>
      </div>
    );
  }

  const totalPrice = isWalkIn
    ? facility.pricePerHour
    : hasValidDuration
      ? facility.pricePerHour * durationHours
      : 0;

  return (
    <div className="bg-[#F8FAFC] dark:bg-slate-950 min-h-screen pb-24">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Link href="/facilities" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors mb-8 bg-white dark:bg-slate-900 px-4 py-2 rounded-full border shadow-sm">
          <ChevronLeft className="w-4 h-4" /> {t("Kembali ke Daftar", "Back to List")}
        </Link>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* Left Column - Details */}
          <div className="lg:col-span-7 xl:col-span-8">
            {/* Main Image */}
            <div className="aspect-[4/3] md:aspect-[16/9] bg-muted rounded-3xl overflow-hidden relative shadow-lg group">
              <img 
                src={getFacilityImage(facility.category, facility.images)} 
                alt={facility.name} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
              
              <div className="absolute top-6 left-6 bg-white/90 backdrop-blur-md text-primary px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider shadow-md">
                {facility.category}
              </div>
            </div>

            <div className="mt-10 bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm border border-border/50">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
                <div>
                  <h1 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4 leading-tight">{facility.name}</h1>
                  
                  <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-muted-foreground">
                    <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-lg text-foreground/80">
                      <Clock className="w-4 h-4 text-primary" /> {facility.openTime.substring(0,5)} - {effectiveCloseTime(facility)} {t("WIB", "WIB")}
                    </div>
                    {facility.capacity && (
                      <div className="flex items-center gap-2 bg-muted/50 px-3 py-1.5 rounded-lg text-foreground/80">
                        <Users className="w-4 h-4 text-primary" /> {t("Kapasitas", "Capacity")} {facility.capacity} {t("pax", "pax")}
                      </div>
                    )}
                    {reviewCount > 0 && (
                      <div className="flex items-center gap-1 text-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-1.5 rounded-lg">
                        <Star className="w-4 h-4 fill-yellow-500" />
                        <span className="font-bold">{avgRating.toFixed(1)}/5</span>
                        <span className="text-xs text-muted-foreground font-normal ml-1">({reviewCount} {t("ulasan", "reviews")})</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="h-px w-full bg-border/50 my-8" />
              
              <div>
                <h2 className="text-xl font-black mb-4 text-secondary dark:text-white flex items-center gap-2">
                  <div className="w-1.5 h-6 bg-primary rounded-full"></div>
                  {t("Tentang Lapangan Ini", "About This Court")}
                </h2>
                <div className="text-foreground/80 font-medium leading-relaxed prose dark:prose-invert max-w-none">
                  <p className="whitespace-pre-line">{facility.description || t("Fasilitas premium berstandar internasional yang dirawat dengan sangat baik. Cocok untuk semua kalangan dari pemula hingga profesional.", "A premium international-standard facility that is exceptionally well maintained. Suitable for everyone from beginners to professionals.")}</p>
                </div>
                
                <div className="mt-8 grid grid-cols-2 gap-4">
                  {[
                    t("Lantai berstandar internasional", "International-standard flooring"),
                    t("Penerangan LED maksimal", "Maximum LED lighting"),
                    t("Sirkulasi udara baik", "Good air circulation"),
                    t("Loker & Shower room gratis", "Free locker & shower room")
                  ].map((feat, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm font-medium">
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-green-600 shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      {feat}
                    </div>
                  ))}
                </div>

                {/* Reviews Section */}
                {reviews && reviews.length > 0 && (
                  <div className="mt-10">
                    <h2 className="text-xl font-black mb-5 text-secondary dark:text-white flex items-center gap-2">
                      <div className="w-1.5 h-6 bg-primary rounded-full"></div>
                      {t("Ulasan Pelanggan", "Customer Reviews")}
                      <span className="text-sm font-normal text-muted-foreground ml-1">({reviewCount})</span>
                    </h2>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map((s) => (
                          <Star key={s} className={`w-5 h-5 ${s <= Math.round(avgRating) ? "fill-yellow-400 text-yellow-400" : "text-gray-200"}`} />
                        ))}
                      </div>
                      <span className="text-2xl font-black">{avgRating.toFixed(1)}</span>
                      <span className="text-muted-foreground text-sm">{t("dari 5", "out of 5")}</span>
                    </div>
                    <div className="space-y-4">
                      {reviews.slice(0, 5).map((review) => (
                        <div key={review.id} className="border border-border/60 rounded-2xl p-4 bg-muted/20">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-bold text-sm">{review.reviewerName}</div>
                            <div className="flex gap-0.5">
                              {[1,2,3,4,5].map((s) => (
                                <Star key={s} className={`w-3.5 h-3.5 ${s <= review.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-200"}`} />
                              ))}
                            </div>
                          </div>
                          {review.comment && <p className="text-sm text-foreground/70 leading-relaxed">"{review.comment}"</p>}
                          <p className="text-xs text-muted-foreground mt-2">
                            {review.bookingDate ? new Date(review.bookingDate).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Booking Widget */}
          <div className="lg:col-span-5 xl:col-span-4">
            <Card className="sticky top-28 border-0 shadow-2xl shadow-primary/5 rounded-3xl overflow-hidden">
              <div className="bg-secondary dark:bg-slate-900 p-6 text-white text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full blur-[40px]" />
                <div className="relative z-10">
                  <div className="text-sm font-bold text-white/70 uppercase tracking-widest mb-1">
                    {isWalkIn ? t("Tarif Masuk", "Entry Rate") : t("Tarif Sewa", "Rental Rate")}
                  </div>
                  <div className="text-3xl md:text-4xl font-black text-white mb-1">
                    <span className="text-xl mr-1 text-primary">Rp</span>
                    {facility.pricePerHour.toLocaleString('id-ID')}
                  </div>
                   <div className="text-sm font-medium text-white/70">
                     {isWalkIn ? t("per orang / kunjungan", "per person / visit") : t("per jam bermain", "per playing hour")}
                   </div>
                </div>
              </div>
              
              <CardContent className="p-6 md:p-8 bg-white dark:bg-slate-950">
                <h3 className="text-lg font-black mb-6 flex items-center gap-2 text-secondary dark:text-white">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <CalendarDays className="w-4 h-4" />
                  </div>
                  {isWalkIn
                    ? t("Atur Kunjungan", "Plan Your Visit")
                    : t("Atur Jadwal Bermain", "Set Your Playing Schedule")}
                </h3>
                
                <div className="space-y-6">
                  {/* Step 1 - Date Picker (always shown) */}
                  <div className="space-y-3">
                    <label className="text-sm font-bold text-foreground/80 block">
                      {t("1. Pilih Tanggal", "1. Choose Date")}
                    </label>
                    <div className="border rounded-2xl p-3 flex justify-center bg-[#F8FAFC] dark:bg-slate-900 shadow-inner">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={(nextDate) => {
                          setDate(nextDate);
                          setSelectedTime("");
                        }}
                        disabled={isOperationalAccount ? undefined : (d) => d < new Date(new Date().setHours(0,0,0,0))}
                        className="rounded-xl bg-transparent"
                        locale={lang === "en" ? enUS : id}
                      />
                    </div>
                    {isOperationalAccount && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        {t(
                          "Akun operasional dapat mencatat booking untuk tanggal dan jam yang sudah lewat.",
                          "Operational accounts can record bookings for past dates and times."
                        )}
                      </p>
                    )}
                  </div>

                  {/* Walk-in (Gym) info block */}
                  {isWalkIn && (
                    <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 text-sm text-blue-800 dark:text-blue-200">
                      <div className="font-bold mb-1">🏋️ {t("Akses Bebas Jam Operasional", "Open Access During Operating Hours")}</div>
                      <p className="text-blue-700/80 dark:text-blue-300/80">
                        {t(
                          "Gym bisa diakses kapan saja antara 06:00–22:00 WIB. Tidak ada slot jam — datang dan nikmati fasilitas.",
                          "Gym is accessible anytime between 06:00–22:00 WIB. No time slot needed — just come and enjoy."
                        )}
                      </p>
                    </div>
                  )}

                  {/* Gym membership actions */}
                  {isGymFacility && (
                    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <Dumbbell className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-bold text-foreground">
                            {t("Sudah punya atau ingin jadi member?", "Already a member or want to join?")}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t(
                              "Daftar membership bulanan dan nikmati akses Gym tanpa perlu membayar setiap kunjungan.",
                              "Register for monthly membership and enjoy Gym access without paying per visit."
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Button asChild variant="outline" className="w-full border-primary/30 text-primary hover:bg-primary/10">
                          <Link href="/membership?mode=register">
                            <Dumbbell className="w-4 h-4 mr-2" />
                            {t("Daftar Member Gym", "Register Gym Member")}
                          </Link>
                        </Button>
                        <Button asChild variant="outline" className="w-full border-primary/30 text-primary hover:bg-primary/10">
                          <Link href="/membership?mode=renew">
                            <RefreshCw className="w-4 h-4 mr-2" />
                            {t("Perpanjang Membership", "Renew Membership")}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Multiguna: activity type selector */}
                  {!isWalkIn && isMultiguna && (
                    <div className="space-y-3">
                      <label className="text-sm font-bold text-foreground/80 block">
                        {t("2. Pilih Jenis Olahraga", "2. Choose Sport Type")}
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {MULTIGUNA_ACTIVITIES.map((act) => (
                          <button
                            key={act.value}
                            type="button"
                            onClick={() => setActivityType(act.value)}
                            className={`flex flex-col items-center gap-1 p-3 rounded-xl border font-bold text-sm transition-all ${
                              activityType === act.value
                                ? "bg-primary text-primary-foreground border-primary shadow-lg scale-105"
                                : "bg-[#F8FAFC] dark:bg-slate-900 border-border hover:border-primary/50 text-foreground/80"
                            }`}
                          >
                            <span className="text-xl">{act.icon}</span>
                            <span>{act.label}</span>
                          </button>
                        ))}
                      </div>
                      {activityType && (
                        <div className="text-xs text-primary bg-primary/10 px-3 py-1.5 rounded-lg font-medium">
                          ⚠️ {t("Lapangan yang sama digunakan semua olahraga. Slot yang terisi oleh olahraga lain tidak bisa dipesan.", "Same court for all sports. Slots booked by other sports are unavailable.")}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Duration (non-gym only) */}
                  {!isWalkIn && (
                    <div className="space-y-3">
                      <label className="text-sm font-bold text-foreground/80 block">
                        {isMultiguna ? t("3. Durasi Bermain", "3. Playing Duration") : t("2. Durasi Bermain", "2. Playing Duration")}
                      </label>
                      <Input
                        id="playing-duration"
                        type="number"
                        min={minDuration}
                        step="1"
                        inputMode="numeric"
                        value={duration}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          if (nextValue === "" || /^\d+$/.test(nextValue)) {
                            setDuration(nextValue);
                          }
                          setSelectedTime("");
                        }}
                        className="h-14 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-bold"
                        placeholder={t("Ketik durasi dalam jam", "Enter duration in hours")}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t(
                          `Ketik jumlah jam (minimal ${minDuration} jam). Durasi mengikuti jam operasional fasilitas.`,
                          `Enter the number of hours (minimum ${minDuration} hours). Duration follows facility operating hours.`
                        )}
                      </p>
                      {duration !== "" && !hasValidDuration && (
                        <p className="text-xs text-destructive">
                          {t(
                            `Durasi minimal ${minDuration} jam.`,
                            `Minimum duration is ${minDuration} hours.`
                          )}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Time slot picker (non-gym only) */}
                  {!isWalkIn && (
                    <div className="space-y-3">
                      <label className="text-sm font-bold text-foreground/80 block flex justify-between items-end">
                        <span>
                          {isMultiguna ? t("4. Jam Tersedia", "4. Available Times") : t("3. Jam Tersedia", "3. Available Times")}
                        </span>
                        {selectedTime && <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-md">{t("Terpilih", "Selected")}: {selectedTime}</span>}
                      </label>
                      
                      {!date ? (
                        <div className="text-sm text-center font-medium text-muted-foreground py-10 border-2 border-dashed rounded-2xl bg-muted/30">
                          {t("Pilih tanggal terlebih dahulu", "Please choose a date first")}
                        </div>
                      ) : !hasValidDuration ? (
                        <div className="text-sm text-center font-medium text-muted-foreground py-10 border-2 border-dashed rounded-2xl bg-muted/30">
                          {t("Masukkan durasi yang valid terlebih dahulu", "Enter a valid duration first")}
                        </div>
                      ) : (
                        <div className="bg-[#F8FAFC] dark:bg-slate-900 rounded-2xl p-4 border shadow-inner max-h-[250px] overflow-y-auto">
                          <AvailabilityCalendar
                            facilityId={facilityId}
                            date={formattedDate}
                            slots={slots as any}
                            isLoading={isLoadingSlots}
                            isError={isSlotsError}
                            selectedTime={selectedTime}
                            duration={parseInt(duration)}
                            onSelectTime={setSelectedTime}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-6 mt-4 border-t border-dashed">
                    <div className="flex justify-between items-end mb-6 bg-primary/5 p-4 rounded-2xl border border-primary/10">
                      <span className="font-bold text-foreground/80">{t("Total Tagihan", "Total Bill")}</span>
                      <span className="text-2xl font-black text-primary">
                        Rp {totalPrice.toLocaleString('id-ID')}
                      </span>
                    </div>
                    
                    <div className="space-y-3">
                      {/* Tombol langsung checkout */}
                      <Button 
                        size="lg" 
                        className="w-full text-base font-bold h-14 rounded-full shadow-lg shadow-primary/20 transition-all hover:-translate-y-1" 
                        onClick={handleBook}
                        disabled={
                          !date || 
                          !hasValidDuration ||
                          (!isWalkIn && !selectedTime) ||
                          (isMultiguna && !activityType)
                        }
                      >
                        {isWalkIn
                          ? (date ? t("Booking Masuk Gym", "Book Gym Entry") : t("Pilih Tanggal Dulu", "Choose Date First"))
                          : (!selectedTime
                            ? t("Lengkapi Jadwal Dulu", "Complete the Schedule First")
                            : (isMultiguna && !activityType)
                              ? t("Pilih Jenis Olahraga", "Choose Sport Type")
                              : t("Lanjut ke Pembayaran", "Continue to Payment"))
                        }
                      </Button>

                      {/* Tombol tambah ke keranjang (hanya untuk time_slot) */}
                      {!isWalkIn && (
                        <Button
                          size="lg"
                          variant="outline"
                          className={`w-full text-base font-bold h-14 rounded-full transition-all hover:-translate-y-1 flex items-center justify-center gap-2 ${
                            isInCart
                              ? "border-green-500 text-green-600 bg-green-50 dark:bg-green-950/20 hover:bg-green-100"
                              : "border-primary/50 text-primary hover:bg-primary/5"
                          }`}
                          onClick={() => {
                            if (isInCart) {
                              setLocation("/cart");
                            } else {
                              handleAddToCart();
                            }
                          }}
                          disabled={!date || !selectedTime || (isMultiguna && !activityType)}
                        >
                          <ShoppingCart className="w-4 h-4" />
                          {isInCart
                            ? t("Sudah di Keranjang → Lihat", "In Cart → View Cart")
                            : t("Tambah ke Keranjang", "Add to Cart")
                          }
                        </Button>
                      )}
                    </div>

                    {/* WhatsApp Booking Button */}
                    {settings?.whatsapp && (
                      <a
                        href={isWaBookingReady ? getWaBookingLink() : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center justify-center gap-2.5 w-full h-14 rounded-full border-2 font-bold text-base transition-all
                          ${isWaBookingReady
                            ? "border-[#25D366] text-[#25D366] hover:bg-[#25D366] hover:text-white hover:-translate-y-1 cursor-pointer"
                            : "border-muted text-muted-foreground cursor-not-allowed opacity-50 pointer-events-none"
                          }`}
                        onClick={(e) => { if (!isWaBookingReady) e.preventDefault(); }}
                      >
                        <MessageCircle className="w-5 h-5" />
                        {t("Pesan via WhatsApp", "Book via WhatsApp")}
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}