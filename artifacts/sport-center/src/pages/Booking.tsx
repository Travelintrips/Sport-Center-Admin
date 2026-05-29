import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useGetFacility,
  getGetFacilityQueryKey,
  useCreateBooking,
  useCheckRecurringBooking,
  useCreateRecurringBooking,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { format, parseISO } from "date-fns";
import { id as idLocale, enUS } from "date-fns/locale";
import {
  MapPin, Calendar, Clock, Receipt, ChevronLeft,
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, Loader2, Pencil, X as IconX
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";

function formatCurrency(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDate(dateStr: string, lang: string = "id") {
  try {
    return format(parseISO(dateStr), "EEEE, d MMMM yyyy", { locale: lang === "en" ? enUS : idLocale });
  } catch {
    return dateStr;
  }
}

type RepeatType = "weekly" | "monthly";

export default function Booking() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { t, lang } = useLang();

  const queryParams = new URLSearchParams(search);
  const facilityId = queryParams.get("facilityId") ? parseInt(queryParams.get("facilityId")!) : 0;
  const date = queryParams.get("date") || "";
  const startTime = queryParams.get("startTime") || "";
  const durationStr = queryParams.get("duration") || "1";
  const duration = parseInt(durationStr) || 1;

  const { data: facility, isLoading: isLoadingFacility } = useGetFacility(facilityId, {
    query: { enabled: !!facilityId, queryKey: getGetFacilityQueryKey(facilityId) },
  });

  // --- Customer form ---
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // --- Repeat Booking state ---
  const [isRepeat, setIsRepeat] = useState(false);
  const [repeatType, setRepeatType] = useState<RepeatType>("weekly");
  const [repeatCount, setRepeatCount] = useState(4);
  const [checkResult, setCheckResult] = useState<{
    dates: { date: string; available: boolean; reason?: string | null }[];
    pricePerSession: number;
    validCount: number;
    totalPrice: number;
  } | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [skippedDates, setSkippedDates] = useState<Set<string>>(new Set());
  // overriddenDates: index → { date, available, checking }
  const [overriddenDates, setOverriddenDates] = useState<Record<number, { date: string; available: boolean | null; checking: boolean }>>({});
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // --- Coupon ---
  const [couponInput, setCouponInput] = useState("");
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);
  const [couponResult, setCouponResult] = useState<{
    valid: boolean;
    code: string;
    title: string;
    discountType: string;
    discountPercent: number | null;
    discountAmount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // --- Submit success ---
  const [recurringResult, setRecurringResult] = useState<{
    totalBookings: number;
    grandTotal: number;
    skipped: string[];
    firstOrder?: string;
  } | null>(null);

  // ---- Single booking ----
  const createBooking = useCreateBooking({
    mutation: {
      onSuccess: (data) => {
        toast({ title: t("Booking Berhasil", "Booking Successful"), description: t("Silakan lanjutkan ke pembayaran.", "Please proceed to payment.") });
        setLocation(`/booking/${data.orderNumber}`);
      },
      onError: (error: any) => {
        toast({ title: t("Booking Gagal", "Booking Failed"), description: error?.message || t("Gagal membuat booking", "Failed to create booking"), variant: "destructive" });
      },
    },
  });

  // ---- Recurring check ----
  const checkRecurring = useCheckRecurringBooking();
  const checkRecurringMutate = checkRecurring.mutate;

  // ---- Recurring create ----
  const createRecurring = useCreateRecurringBooking({
    mutation: {
      onSuccess: (data) => {
        setRecurringResult({
          totalBookings: data.totalBookings,
          grandTotal: data.grandTotal,
          skipped: data.skipped,
          firstOrder: data.created[0]?.orderNumber,
        });
      },
      onError: (error: any) => {
        toast({ title: t("Gagal membuat booking berulang", "Failed to create recurring booking"), description: error?.message || t("Terjadi kesalahan", "An error occurred"), variant: "destructive" });
      },
    },
  });

  // Auto-check whenever repeat settings change and all params ready
  useEffect(() => {
    if (!isRepeat || !facilityId || !date || !startTime || !duration) {
      setCheckResult(null);
      setIsChecking(false);
      return;
    }
    setIsChecking(true);
    setCheckResult(null);
    const timer = setTimeout(() => {
      checkRecurringMutate(
        {
          data: {
            facilityId,
            startDate: date,
            startTime,
            durationHours: duration,
            repeatType,
            repeatCount,
          },
        },
        {
          onSuccess: (data) => {
            setCheckResult(data);
            setSkippedDates(new Set());
            setOverriddenDates({});
            setEditingIdx(null);
            setIsChecking(false);
          },
          onError: () => {
            setIsChecking(false);
            toast({ title: t("Gagal cek jadwal", "Failed to check schedule"), variant: "destructive" });
          },
        }
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [isRepeat, repeatType, repeatCount, facilityId, date, startTime, duration, checkRecurringMutate, toast]);

  // Redirect if missing params
  useEffect(() => {
    if (search && (!facilityId || !date || !startTime)) {
      toast({ title: t("Detail booking tidak lengkap", "Incomplete booking details"), description: t("Silakan pilih fasilitas dan waktu terlebih dahulu.", "Please select a facility and time first."), variant: "destructive" });
      setLocation("/facilities");
    }
  }, [search, facilityId, date, startTime, setLocation, toast]);

  // --- Validate coupon ---
  const validateCoupon = async () => {
    if (!couponInput.trim()) return;
    setIsValidatingCoupon(true);
    setCouponError(null);
    setCouponResult(null);
    try {
      const baseAmt = facility ? facility.pricePerHour * duration : 0;
      const purchaseAmount = isRepeat ? baseAmt * effectiveCount : baseAmt;
      const res = await fetch("/api/promos/validate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim().toUpperCase(), purchaseAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCouponError(data.error || t("Kode tidak valid", "Invalid code"));
      } else {
        setCouponResult(data);
      }
    } catch {
      setCouponError(t("Gagal menghubungi server", "Failed to reach server"));
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityId || !date || !startTime || !duration) return;
    if (!name || !email || !phone) {
      toast({ title: t("Form tidak lengkap", "Incomplete form"), description: t("Harap isi semua field yang wajib.", "Please fill in all required fields."), variant: "destructive" });
      return;
    }

    const discountPerSession = couponResult?.discountAmount
      ? isRepeat
        ? Math.round(couponResult.discountAmount / (effectiveCount || 1))
        : couponResult.discountAmount
      : 0;

    if (isRepeat) {
      if (!checkResult || effectiveCount === 0) {
        toast({ title: t("Tidak ada slot dipilih", "No slot selected"), description: t("Pilih setidaknya satu tanggal untuk booking.", "Select at least one date for booking."), variant: "destructive" });
        return;
      }
      createRecurring.mutate({
        data: {
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          facilityId,
          startDate: date,
          startTime,
          durationHours: duration,
          repeatType,
          repeatCount,
          notes,
          specificDates: selectedDates,
          promoCode: couponResult?.code || undefined,
          discountAmountPerSession: discountPerSession || undefined,
        } as any,
      });
    } else {
      createBooking.mutate({
        data: {
          customerName: name,
          customerEmail: email,
          customerPhone: phone,
          facilityId,
          bookingDate: date,
          startTime,
          durationHours: duration,
          notes,
          promoCode: couponResult?.code || undefined,
          discountAmount: discountPerSession || undefined,
        } as any,
      });
    }
  };

  // --- Check availability for a specific overridden date ---
  const checkOverrideDate = (idx: number, newDate: string) => {
    if (!newDate || !facilityId || !startTime || !duration) return;
    setOverriddenDates((prev) => ({ ...prev, [idx]: { date: newDate, available: null, checking: true } }));
    setEditingIdx(null);
    checkRecurringMutate(
      { data: { facilityId, startDate: newDate, startTime, durationHours: duration, repeatType, repeatCount: 1 } },
      {
        onSuccess: (data) => {
          const available = data.dates[0]?.available ?? false;
          setOverriddenDates((prev) => ({ ...prev, [idx]: { date: newDate, available, checking: false } }));
        },
        onError: () => {
          setOverriddenDates((prev) => ({ ...prev, [idx]: { date: newDate, available: null, checking: false } }));
          toast({ title: t("Gagal cek tanggal", "Failed to check date"), variant: "destructive" });
        },
      }
    );
  };

  // --- Derived selected dates (available and not manually skipped) ---
  const selectedDates = checkResult
    ? checkResult.dates
        .map((d, idx) => overriddenDates[idx] ?? d)
        .filter((d) => d.available && !skippedDates.has(d.date))
        .map((d) => d.date)
    : [];
  const effectiveCount = selectedDates.length;
  const effectiveTotalPrice = checkResult ? checkResult.pricePerSession * effectiveCount : 0;

  // --- End time ---
  const [hours, minutes] = startTime ? startTime.split(":").map(Number) : [0, 0];
  const endHours = hours + duration;
  const endTime = `${endHours.toString().padStart(2, "0")}:${(minutes || 0).toString().padStart(2, "0")}`;

  const totalPrice = facility ? facility.pricePerHour * duration : 0;

  if (isLoadingFacility) {
    return (
      <div className="container py-20 flex justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!facility) return null;

  // --- Recurring success screen ---
  if (recurringResult) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="text-green-600 w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{t("Booking Berhasil Dibuat!", "Booking Created Successfully!")}</h1>
        <p className="text-muted-foreground mb-6">
          <span className="font-semibold text-foreground">{recurringResult.totalBookings}</span> {t("booking berhasil dibuat untuk", "bookings successfully created for")} <span className="font-semibold text-foreground">{facility.name}</span>.
        </p>
        <Card className="mb-6 text-left">
          <CardContent className="p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("Total Booking Dibuat", "Total Bookings Created")}</span>
              <span className="font-semibold">{recurringResult.totalBookings} {t("booking", "bookings")}</span>
            </div>
            {recurringResult.skipped.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("Dilewati (konflik)", "Skipped (conflict)")}</span>
                <span className="text-orange-600 font-semibold">{recurringResult.skipped.length} {t("booking", "bookings")}</span>
              </div>
            )}
            <div className="border-t pt-3 flex justify-between font-bold text-lg">
              <span>{t("Grand Total", "Grand Total")}</span>
              <span className="text-primary">{formatCurrency(recurringResult.grandTotal)}</span>
            </div>
          </CardContent>
        </Card>
        {recurringResult.skipped.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 text-left">
            <div className="flex items-center gap-2 text-orange-700 font-semibold text-sm mb-2">
              <AlertTriangle size={15} /> {t("Slot yang dilewati karena konflik:", "Slots skipped due to conflict:")}
            </div>
            {recurringResult.skipped.map((d) => (
              <div key={d} className="text-sm text-orange-600">{formatDate(d, lang)}</div>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          {recurringResult.firstOrder && (
            <Button className="flex-1" onClick={() => setLocation(`/booking/${recurringResult.firstOrder}`)}>
              {t("Lihat Detail Pembayaran", "View Payment Details")}
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={() => setLocation("/my-bookings")}>
            {t("Booking Saya", "My Bookings")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Button variant="ghost" onClick={() => window.history.back()} className="mb-6 -ml-4">
        <ChevronLeft className="mr-2 h-4 w-4" /> {t("Kembali", "Back")}
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">{t("Checkout", "Checkout")}</h1>
        <p className="text-muted-foreground">{t("Lengkapi detail booking kamu di bawah ini.", "Complete your booking details below.")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left - Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Details */}
          <Card>
            <CardHeader>
              <CardTitle>{t("Data Pemesan", "Customer Details")}</CardTitle>
            </CardHeader>
            <form onSubmit={handleSubmit} id="booking-form">
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t("Nama Lengkap", "Full Name")} <span className="text-destructive">*</span></Label>
                  <Input id="name" required value={name} onChange={e => setName(e.target.value)} placeholder="John Doe" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">{t("Alamat Email", "Email Address")} <span className="text-destructive">*</span></Label>
                    <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="john@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">{t("No. WhatsApp", "WhatsApp No.")} <span className="text-destructive">*</span></Label>
                    <Input id="phone" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="08123456789" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">{t("Catatan Tambahan (Opsional)", "Additional Notes (Optional)")}</Label>
                  <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("Permintaan khusus...", "Special requests...")} />
                </div>
              </CardContent>
            </form>
          </Card>

          {/* Coupon Code */}
          <Card className={couponResult ? "border-green-300 bg-green-50/50" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt size={16} className="text-primary" /> {t("Kode Kupon", "Coupon Code")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {couponResult ? (
                <div className="flex items-center justify-between bg-green-100 border border-green-300 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-green-800 text-sm">{couponResult.code}</div>
                      <div className="text-xs text-green-700">{couponResult.title}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-green-700">−{formatCurrency(couponResult.discountAmount)}</span>
                    <button
                      type="button"
                      onClick={() => { setCouponResult(null); setCouponInput(""); setCouponError(null); }}
                      className="text-green-600 hover:text-green-800 p-1 rounded hover:bg-green-200 transition-colors"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), validateCoupon())}
                    placeholder={t("Masukkan kode kupon...", "Enter coupon code...")}
                    className={`font-mono tracking-wider ${couponError ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                    disabled={isValidatingCoupon}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={validateCoupon}
                    disabled={!couponInput.trim() || isValidatingCoupon}
                    className="shrink-0"
                  >
                    {isValidatingCoupon ? <Loader2 size={15} className="animate-spin" /> : t("Terapkan", "Apply")}
                  </Button>
                </div>
              )}
              {couponError && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <XCircle size={14} /> {couponError}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Repeat Booking */}
          <Card className={isRepeat ? "border-primary/40 bg-primary/5" : ""}>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="repeat-check"
                  checked={isRepeat}
                  onCheckedChange={(v) => setIsRepeat(!!v)}
                />
                <Label htmlFor="repeat-check" className="text-base font-semibold cursor-pointer flex items-center gap-2">
                  <RefreshCw size={16} className={isRepeat ? "text-primary" : "text-muted-foreground"} />
                  {t("Repeat Booking", "Repeat Booking")}
                  {isRepeat && <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{t("Aktif", "Active")}</Badge>}
                </Label>
              </div>
              {!isRepeat && (
                <p className="text-xs text-muted-foreground ml-7">
                  {t("Aktifkan untuk membuat booking berulang secara otomatis (mingguan / bulanan).", "Enable to automatically create recurring bookings (weekly / monthly).")}
                </p>
              )}
            </CardHeader>

            {isRepeat && (
              <CardContent className="space-y-5 pt-0">
                {/* Repeat Type */}
                <div>
                  <Label className="text-sm font-semibold mb-2 block">{t("Tipe Pengulangan", "Repeat Type")}</Label>
                  <div className="flex gap-2">
                    {(["weekly", "monthly"] as RepeatType[]).map((rt) => (
                      <button
                        key={rt}
                        type="button"
                        onClick={() => setRepeatType(rt)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${repeatType === rt ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}
                      >
                        {rt === "weekly" ? t("🗓 Weekly (Mingguan)", "🗓 Weekly") : t("📅 Monthly (Bulanan)", "📅 Monthly")}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Repeat Count */}
                <div>
                  <Label htmlFor="repeat-count" className="text-sm font-semibold mb-2 block">
                    {t("Jumlah Pengulangan", "Number of Repeats")}
                    <span className="text-muted-foreground font-normal ml-1">{t("(maks. 52)", "(max. 52)")}</span>
                  </Label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setRepeatCount(Math.max(1, repeatCount - 1))}
                      className="w-10 h-10 rounded-lg border border-border hover:bg-accent flex items-center justify-center text-lg font-bold"
                    >−</button>
                    <Input
                      id="repeat-count"
                      type="number"
                      min={1}
                      max={52}
                      value={repeatCount}
                      onChange={e => setRepeatCount(Math.min(52, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-20 text-center font-bold text-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setRepeatCount(Math.min(52, repeatCount + 1))}
                      className="w-10 h-10 rounded-lg border border-border hover:bg-accent flex items-center justify-center text-lg font-bold"
                    >+</button>
                    <span className="text-sm text-muted-foreground">
                      {repeatType === "weekly" ? t("minggu", "weeks") : t("bulan", "months")}
                    </span>
                  </div>
                </div>

                {/* Preview */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-semibold">{t("Preview Jadwal Booking", "Booking Schedule Preview")}</Label>
                    {isChecking && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 size={13} className="animate-spin" /> {t("Mengecek ketersediaan...", "Checking availability...")}
                      </div>
                    )}
                  </div>

                  {isChecking && (
                    <div className="space-y-2">
                      {[...Array(repeatCount > 6 ? 6 : repeatCount)].map((_, i) => (
                        <div key={i} className="h-11 rounded-lg bg-muted animate-pulse" />
                      ))}
                    </div>
                  )}

                  {!isChecking && checkResult && (
                    <div className="space-y-2">
                      {checkResult.dates.map((original, idx) => {
                        const override = overriddenDates[idx];
                        const item = override ?? original;
                        const isManuallySkipped = skippedDates.has(item.date);
                        const isEditing = editingIdx === idx;
                        const isCheckingOverride = override?.checking === true;
                        const wasOverridden = !!override && !override.checking;

                        let rowBg = "bg-green-50 border-green-200";
                        if (isCheckingOverride) rowBg = "bg-blue-50 border-blue-200";
                        else if (item.available === null) rowBg = "bg-muted border-border";
                        else if (!item.available) rowBg = "bg-red-50 border-red-200 opacity-70";
                        else if (isManuallySkipped) rowBg = "bg-muted border-border opacity-50";

                        return (
                          <div key={idx} className="space-y-1.5">
                            <div className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-all ${rowBg}`}>
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isCheckingOverride
                                  ? <Loader2 size={16} className="text-blue-500 shrink-0 animate-spin" />
                                  : item.available === null
                                    ? <AlertTriangle size={16} className="text-muted-foreground shrink-0" />
                                    : !item.available
                                      ? <XCircle size={16} className="text-red-500 shrink-0" />
                                      : isManuallySkipped
                                        ? <XCircle size={16} className="text-muted-foreground shrink-0" />
                                        : <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                                }
                                <div className="min-w-0">
                                  <span className={`font-medium ${
                                    isCheckingOverride ? "text-blue-700" :
                                    item.available === null ? "text-muted-foreground" :
                                    !item.available ? "text-red-700" :
                                    isManuallySkipped ? "text-muted-foreground line-through" :
                                    "text-green-800"
                                  }`}>
                                    {formatDate(item.date)}
                                  </span>
                                  {wasOverridden && <span className="ml-2 text-xs text-blue-500">{t("(diubah)", "(changed)")}</span>}
                                  {isCheckingOverride && <span className="ml-2 text-xs text-blue-500">{t("Mengecek...", "Checking...")}</span>}
                                  {!item.available && (item as any).reason && !isCheckingOverride && (
                                    <span className="ml-2 text-xs text-red-500">({(item as any).reason})</span>
                                  )}
                                  {isManuallySkipped && <span className="ml-2 text-xs text-muted-foreground">{t("(dilewati)", "(skipped)")}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="text-xs font-medium text-muted-foreground">{startTime} – {endTime}</span>
                                {!isCheckingOverride && (
                                  <button
                                    type="button"
                                    title={t("Ubah tanggal", "Change date")}
                                    onClick={() => { setEditingIdx(isEditing ? null : idx); setEditingValue(item.date); }}
                                    className="p-1 rounded hover:bg-black/5 text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {isEditing ? <IconX size={14} /> : <Pencil size={14} />}
                                  </button>
                                )}
                                {!isCheckingOverride && (
                                  <button
                                    type="button"
                                    disabled={!item.available && !isManuallySkipped}
                                    onClick={() => setSkippedDates((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(item.date)) next.delete(item.date); else next.add(item.date);
                                      return next;
                                    })}
                                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                                      isManuallySkipped ? "border-green-300 text-green-700 hover:bg-green-50" :
                                      !item.available ? "border-gray-200 text-gray-400 cursor-not-allowed" :
                                      "border-red-200 text-red-500 hover:bg-red-50"
                                    }`}
                                  >
                                    {isManuallySkipped ? t("Sertakan", "Include") : t("Lewati", "Skip")}
                                  </button>
                                )}
                              </div>
                            </div>

                            {isEditing && (
                              <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                                <Calendar size={14} className="text-blue-500 shrink-0" />
                                <input
                                  type="date"
                                  value={editingValue}
                                  min={new Date().toISOString().split("T")[0]}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  className="flex-1 text-sm bg-transparent border-none outline-none text-blue-800"
                                />
                                <button
                                  type="button"
                                  disabled={!editingValue || editingValue === item.date}
                                  onClick={() => checkOverrideDate(idx, editingValue)}
                                  className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  {t("Cek & Simpan", "Check & Save")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingIdx(null)}
                                  className="text-xs px-2 py-1 border border-blue-200 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                                >
                                  {t("Batal", "Cancel")}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {effectiveCount < checkResult.dates.length && effectiveCount > 0 && (
                        <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
                          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                          <span>
                            {t("Hanya", "Only")} <strong>{effectiveCount} {t("dari", "of")} {checkResult.dates.length} {t("sesi", "sessions")}</strong> {t("yang akan dibooking.", "will be booked.")}
                          </span>
                        </div>
                      )}

                      {effectiveCount === 0 && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                          <XCircle size={15} />
                          <span>{t("Tidak ada sesi yang dipilih. Aktifkan minimal satu tanggal.", "No sessions selected. Enable at least one date.")}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Submit Button (mobile) */}
          <div className="lg:hidden">
            <Button
              type="submit"
              form="booking-form"
              size="lg"
              className="w-full text-base font-bold h-12"
              disabled={createBooking.isPending || createRecurring.isPending || (isRepeat && isChecking)}
              onClick={handleSubmit}
            >
              {(createBooking.isPending || createRecurring.isPending)
                ? t("Memproses...", "Processing...")
                : isRepeat
                  ? `${t("Konfirmasi", "Confirm")} ${isChecking ? "..." : effectiveCount || (checkResult?.validCount ?? repeatCount)} ${t("Booking", "Bookings")}`
                  : t("Konfirmasi Booking", "Confirm Booking")
              }
            </Button>
          </div>
        </div>

        {/* Right - Summary */}
        <div>
          <Card className="sticky top-24 border-primary/20 shadow-md">
            <CardHeader className="bg-muted/30 pb-4 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Receipt className="text-primary w-5 h-5" />
                {t("Ringkasan Booking", "Booking Summary")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              <div>
                <h4 className="font-bold text-lg mb-1">{facility.name}</h4>
                <div className="text-sm font-medium text-primary uppercase tracking-wider mb-3">{facility.category}</div>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">{t("Tanggal", "Date")}</div>
                      <div className="text-muted-foreground">{date ? formatDate(date) : ""}</div>
                      {isRepeat && (
                        <div className="text-xs text-primary mt-0.5">
                          +{repeatCount - 1} {repeatType === "weekly" ? t("sesi mingguan berikutnya", "more weekly sessions") : t("sesi bulanan berikutnya", "more monthly sessions")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">{t("Waktu & Durasi", "Time & Duration")}</div>
                      <div className="text-muted-foreground">
                        {startTime.substring(0, 5)} – {endTime} ({duration} {t("jam", "hours")})
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">{t("Lokasi", "Location")}</div>
                      <div className="text-muted-foreground">SportCenter Main</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Harga/jam", "Price/hour")}</span>
                  <span>{formatCurrency(facility.pricePerHour)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Durasi", "Duration")}</span>
                  <span>× {duration} {t("jam", "hours")}</span>
                </div>
                {isRepeat && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("Harga/sesi", "Price/session")}</span>
                      <span>{formatCurrency(totalPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("Sesi dipilih", "Sessions selected")}</span>
                      <span>
                        {isChecking
                          ? <span className="text-muted-foreground">...</span>
                          : `× ${effectiveCount > 0 ? effectiveCount : (checkResult?.validCount ?? repeatCount)}`
                        }
                      </span>
                    </div>
                  </>
                )}
                {couponResult && (
                  <div className="flex justify-between text-green-700 font-medium">
                    <span className="flex items-center gap-1">
                      <Receipt size={12} /> {t("Diskon", "Discount")} ({couponResult.code})
                    </span>
                    <span>−{formatCurrency(couponResult.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg pt-3 border-t">
                  <span>{t("Total", "Total")}</span>
                  <span className="text-primary">
                    {(() => {
                      const disc = couponResult?.discountAmount ?? 0;
                      if (isRepeat) {
                        const base = isChecking ? null : (checkResult ? effectiveTotalPrice : totalPrice * repeatCount);
                        return base === null ? "..." : formatCurrency(Math.max(0, base - disc));
                      }
                      return formatCurrency(Math.max(0, totalPrice - disc));
                    })()}
                  </span>
                </div>
                {isRepeat && !isChecking && checkResult && (
                  <div className="text-xs text-muted-foreground text-right">
                    {effectiveCount} {t("sesi", "sessions")} × {duration} {t("jam", "hours")} × {formatCurrency(facility.pricePerHour)}
                    {couponResult ? ` − ${formatCurrency(couponResult.discountAmount)}` : ""}
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter className="bg-muted/30 pt-4 border-t hidden lg:block">
              <Button
                type="submit"
                form="booking-form"
                size="lg"
                className="w-full text-base font-bold h-12"
                disabled={createBooking.isPending || createRecurring.isPending || (isRepeat && isChecking)}
                onClick={handleSubmit}
              >
                {(createBooking.isPending || createRecurring.isPending)
                  ? <><Loader2 size={16} className="mr-2 animate-spin" /> {t("Memproses...", "Processing...")}</>
                  : isRepeat
                    ? `${t("Konfirmasi", "Confirm")} ${isChecking ? "..." : effectiveCount || (checkResult?.validCount ?? repeatCount)} ${t("Booking", "Bookings")}`
                    : t("Konfirmasi Booking", "Confirm Booking")
                }
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
