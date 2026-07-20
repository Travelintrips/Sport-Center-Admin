import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useCart } from "@/lib/cart";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import { getToken } from "@/lib/auth";
import { format, parseISO } from "date-fns";
import { id as idLocale, enUS } from "date-fns/locale";
import {
  ShoppingCart, Trash2, ChevronLeft, CheckCircle2, Loader2,
  Calendar, Clock, ShieldCheck, AlertCircle, Plane, Building2, User,
  ChevronsUpDown, Check, RefreshCw, Tag,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";

function formatCurrency(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDate(dateStr: string, lang: string) {
  try {
    return format(parseISO(dateStr), "EEE, d MMM yyyy", { locale: lang === "en" ? enUS : idLocale });
  } catch {
    return dateStr;
  }
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMin = h * 60 + (m || 0) + hours * 60;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}

function normalizePhone(raw: string) {
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (!p.startsWith("62")) p = p ? "62" + p : "";
  return p;
}

export default function Cart() {
  const { t, lang } = useLang();
  const { items, removeItem, clearCart, totalPrice } = useCart();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: currentUser, isLoading: isLoadingUser } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 },
  });
  const isLoggedIn = !!currentUser && currentUser.role !== "admin";
  // Operator: bisa booking atas nama customer lain
  const isAdminBooking = currentUser?.role === "admin_booking";

  // Customer list untuk operator
  const [customers, setCustomers] = useState<{ id: number; name: string; email: string | null; phone: string | null; accountType?: string | null }[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState("");

  useEffect(() => {
    if (!isAdminBooking) return;
    const token = getToken();
    if (!token) return;
    fetch("/api/customers/simple", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCustomers(data); })
      .catch(() => {});
  }, [isAdminBooking]);

  // Operator memilih customer: apakah customer itu sendiri sudah berupa akun perusahaan?
  const selectedCustomer = isAdminBooking
    ? customers.find((c) => String(c.id) === selectedCustomerId)
    : undefined;
  const isCompanyAccount = isAdminBooking
    ? selectedCustomer?.accountType === "company"
    : (currentUser as any)?.accountType === "company";

  // Cek status tagihan perusahaan (karyawan yang terhubung) — untuk operator,
  // cek eligibility milik customer yang dipilih, bukan akun operator sendiri.
  const billingCustomerId = isAdminBooking
    ? (selectedCustomerId && parseInt(selectedCustomerId) > 0 ? selectedCustomerId : undefined)
    : undefined;
  const { data: billingStatus } = useQuery({
    queryKey: ["billing-status", isAdminBooking ? billingCustomerId : "self"],
    queryFn: async () => {
      const token = getToken();
      const url = billingCustomerId
        ? `/api/company-verifications/billing-status?customerId=${billingCustomerId}`
        : "/api/company-verifications/billing-status";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { eligible: false } as { eligible: boolean; companyId?: number; companyName?: string };
      return res.json() as Promise<{ eligible: boolean; companyId?: number; companyName?: string }>;
    },
    enabled: isLoggedIn && !isCompanyAccount && (!isAdminBooking || !!billingCustomerId),
    staleTime: 60_000,
  });

  // Apakah user bisa tagih ke perusahaan?
  const canCompanyBilling = isCompanyAccount || (billingStatus?.eligible === true);
  const companyId = isCompanyAccount
    ? (isAdminBooking ? selectedCustomer?.id : (currentUser as any)?.id)
    : billingStatus?.companyId;
  const companyName = isCompanyAccount
    ? (isAdminBooking ? selectedCustomer?.name : ((currentUser as any)?.companyName ?? currentUser?.name))
    : billingStatus?.companyName;

  // Mode booking
  type BookingMode = "umum" | "angkasa_pura" | "perusahaan" | "event";
  const EVENT_DISCOUNT_RATE = 3 / 14; // ≈ 21.43%
  const [bookingMode, setBookingMode] = useState<BookingMode>("umum");
  const isAP = bookingMode === "angkasa_pura";
  const isCompanyMode = bookingMode === "perusahaan";
  const isEvent = bookingMode === "event";

  // Auto-set mode perusahaan jika company account
  useEffect(() => {
    if (isCompanyAccount) setBookingMode("perusahaan");
  }, [isCompanyAccount]);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [idCardNumber, setIdCardNumber] = useState("");
  const [bookedForName, setBookedForName] = useState("");
  const [bookedForPhone, setBookedForPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [createdOrders, setCreatedOrders] = useState<string[]>([]);

  // Repeat booking — ulangi semua lapangan di keranjang secara mingguan/bulanan
  // State di-persist ke localStorage agar tidak hilang saat navigasi "+ Tambah Lapangan Lagi"
  type RepeatType = "weekly" | "monthly";
  const [isRepeat, setIsRepeat] = useState<boolean>(() => {
    try { return localStorage.getItem("sc_cart_repeat_on") === "1"; } catch { return false; }
  });
  const [repeatType, setRepeatType] = useState<RepeatType>(() => {
    try {
      const v = localStorage.getItem("sc_cart_repeat_type");
      return (v === "monthly" ? "monthly" : "weekly") as RepeatType;
    } catch { return "weekly"; }
  });
  const [repeatCount, setRepeatCount] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem("sc_cart_repeat_count") ?? "4");
      return isNaN(v) ? 4 : Math.min(52, Math.max(1, v));
    } catch { return 4; }
  });

  // Sync repeat booking state ke localStorage setiap kali berubah
  useEffect(() => {
    try { localStorage.setItem("sc_cart_repeat_on", isRepeat ? "1" : "0"); } catch {}
  }, [isRepeat]);
  useEffect(() => {
    try { localStorage.setItem("sc_cart_repeat_type", repeatType); } catch {}
  }, [repeatType]);
  useEffect(() => {
    try { localStorage.setItem("sc_cart_repeat_count", String(repeatCount)); } catch {}
  }, [repeatCount]);

  // Auto-fill dari user yang login (skip jika operator — mereka isi data customer)
  useEffect(() => {
    if (!currentUser) return;
    if (isAdminBooking) {
      // Operator: auto-fill dari customer yang dipilih di dropdown
      if (selectedCustomerId) {
        const picked = customers.find((c) => String(c.id) === selectedCustomerId);
        if (picked) {
          setName(picked.name);
          setEmail(picked.email ?? "");
          setPhone(picked.phone ?? "");
        }
      }
      // Jika belum pilih customer, biarkan fields kosong (operator isi manual)
    } else {
      setName(currentUser.name ?? "");
      setEmail(currentUser.email ?? "");
      setPhone((currentUser as any).phone ?? "");
    }
  }, [currentUser, isAdminBooking, selectedCustomerId, customers]);

  // Redirect ke login jika belum login
  useEffect(() => {
    if (!isLoadingUser && !currentUser) {
      toast({
        title: t("Login diperlukan", "Login required"),
        description: t("Silakan login dulu untuk checkout.", "Please log in to checkout."),
        variant: "destructive",
      });
      setLocation("/login?redirect=/cart");
    }
  }, [isLoadingUser, currentUser, setLocation, toast, t]);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;
    if (!name.trim() || !phone.trim()) {
      toast({ title: t("Form tidak lengkap", "Incomplete form"), variant: "destructive" });
      return;
    }

    const normalizedPhone = normalizePhone(phone);
    if (!/^62[0-9]{7,13}$/.test(normalizedPhone)) {
      toast({
        title: t("Format nomor tidak valid", "Invalid phone format"),
        description: t("Gunakan format Indonesia, contoh: 08123456789", "Use Indonesian format, e.g. 08123456789"),
        variant: "destructive",
      });
      return;
    }

    if (isAP && !idCardNumber.trim()) {
      toast({
        title: t("Nomor ID Card wajib", "ID Card number required"),
        description: t("Masukkan nomor ID Card Angkasa Pura kamu.", "Enter your Angkasa Pura ID Card number."),
        variant: "destructive",
      });
      return;
    }

    // Guard: company mode tapi companyId tidak tersedia (data belum load / session bermasalah)
    if (isCompanyMode && !companyId) {
      toast({
        title: t("Data perusahaan tidak ditemukan", "Company data not found"),
        description: t(
          "Tidak dapat memproses tagihan perusahaan saat ini. Coba refresh halaman atau pilih tipe Umum.",
          "Cannot process company billing right now. Try refreshing the page or select General type."
        ),
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    const token = getToken();
    const orders: string[] = [];
    const successItemIds: string[] = [];

    // Group ref untuk semua booking dari satu keranjang
    const cartRef = items.length > 1
      ? `CART-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      : null;

    // Tentukan nama & phone pemesan efektif (untuk company: bookedForName/Phone bisa berbeda)
    const effBookedForName = isCompanyMode && bookedForName.trim() ? bookedForName.trim() : name.trim();
    const effBookedForPhone = isCompanyMode && bookedForPhone.trim()
      ? normalizePhone(bookedForPhone.trim())
      : normalizedPhone;

    // Repeat booking hanya berlaku untuk item dengan slot waktu (butuh startTime + durasi)
    const useRepeat = isRepeat && items.every((it) => it.mode === "time_slot");

    for (const item of items) {
      try {
        const body: Record<string, unknown> = {
          customerName: name.trim(),
          customerPhone: normalizedPhone,
          facilityId: item.facilityId,
          source: "cart",
          ...(cartRef && !useRepeat ? { groupRef: cartRef } : {}),
        };

        if (email.trim()) body.customerEmail = email.trim();
        if (notes.trim()) body.notes = notes.trim();

        if (item.mode === "time_slot") {
          body.startTime = item.startTime;
          body.durationHours = item.duration;
          if (item.activityType) body.activityType = item.activityType;
        } else {
          body.numberOfPeople = 1;
        }

        // ── Tipe Booking ────────────────────────────────────────────
        if (isAP) {
          // Angkasa Pura: customerType angkasa_pura + ID card
          body.customerType = "angkasa_pura";
          body.payerType = "personal";
          body.idCardNumber = idCardNumber.trim();
        } else if (isEvent) {
          // Event: diskon 21,43%
          body.customerType = "umum";
          body.payerType = "personal";
          body.bookingType = "event";
        } else if (isCompanyMode && companyId) {
          // Tagihan perusahaan
          body.customerType = "umum";
          body.payerType = "company";
          body.companyCustomerId = companyId;
          body.bookedForName = effBookedForName;
          body.bookedForPhone = effBookedForPhone;
        } else {
          // Umum
          body.customerType = "umum";
          body.payerType = "personal";
        }

        if (useRepeat) {
          // Booking berulang: satu request /bookings/recurring per lapangan di keranjang
          body.startDate = item.date;
          body.repeatType = repeatType;
          body.repeatCount = repeatCount;

          const res = await fetch("/api/bookings/recurring", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          });

          const data = await res.json() as { created?: { orderNumber: string }[]; skipped?: string[]; error?: string };
          if (res.ok && data.created) {
            orders.push(...data.created.map((b) => b.orderNumber));
            successItemIds.push(item.id);
            if (data.skipped && data.skipped.length > 0) {
              toast({
                title: t(`${data.skipped.length} sesi dilewati: ${item.facilityName}`, `${data.skipped.length} session(s) skipped: ${item.facilityName}`),
                description: t("Sudah ada booking lain pada tanggal tersebut.", "Another booking already exists on those dates."),
              });
            }
          } else {
            toast({
              title: t(`Gagal: ${item.facilityName}`, `Failed: ${item.facilityName}`),
              description: data.error || t("Terjadi kesalahan", "An error occurred"),
              variant: "destructive",
            });
          }
          continue;
        }

        body.bookingDate = item.date;
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });

        const data = await res.json() as { orderNumber?: string; error?: string };
        if (res.ok && data.orderNumber) {
          orders.push(data.orderNumber);
          successItemIds.push(item.id);
        } else {
          toast({
            title: t(`Gagal: ${item.facilityName}`, `Failed: ${item.facilityName}`),
            description: data.error || t("Terjadi kesalahan", "An error occurred"),
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t(`Gagal: ${item.facilityName}`, `Failed: ${item.facilityName}`),
          variant: "destructive",
        });
      }
    }

    setIsSubmitting(false);

    // Hanya hapus item yang berhasil dibooking dari keranjang
    for (const id of successItemIds) {
      removeItem(id);
    }

    if (orders.length > 0) {
      setCreatedOrders(orders);
      setIsSuccess(true);
    }
  };

  // ── Halaman sukses ──────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="text-green-600 w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{t("Booking Berhasil!", "Booking Successful!")}</h1>
        <p className="text-muted-foreground mb-6">
          {t(
            `${createdOrders.length} booking berhasil dibuat. Silakan lanjutkan pembayaran.`,
            `${createdOrders.length} booking(s) created. Please proceed to payment.`
          )}
        </p>
        <div className="space-y-2 mb-8">
          {createdOrders.map((orderNumber) => (
            <button
              key={orderNumber}
              onClick={() => setLocation(`/booking/${orderNumber}`)}
              className="w-full flex items-center justify-between px-4 py-3 bg-primary/5 border border-primary/20 rounded-xl hover:bg-primary/10 transition-colors"
            >
              <span className="font-mono font-bold text-primary">{orderNumber}</span>
              <span className="text-xs text-muted-foreground">{t("Lihat Detail →", "View Details →")}</span>
            </button>
          ))}
        </div>
        <Button className="w-full" onClick={() => setLocation("/my-bookings")}>
          {t("Lihat Semua Booking Saya", "View My Bookings")}
        </Button>
      </div>
    );
  }

  // ── Keranjang kosong ────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-32 text-center max-w-md">
        <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
          <ShoppingCart className="w-10 h-10 text-muted-foreground opacity-40" />
        </div>
        <h2 className="text-2xl font-black mb-3">{t("Keranjang Kosong", "Your Cart is Empty")}</h2>
        <p className="text-muted-foreground mb-8">
          {t("Tambahkan lapangan ke keranjang dari halaman fasilitas.", "Add courts to your cart from the facilities page.")}
        </p>
        <Button asChild size="lg" className="rounded-full">
          <Link href="/facilities">{t("Jelajahi Fasilitas", "Browse Facilities")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Button variant="ghost" onClick={() => window.history.back()} className="mb-6 -ml-4">
        <ChevronLeft className="mr-2 h-4 w-4" /> {t("Kembali", "Back")}
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight flex items-center gap-3">
          <ShoppingCart className="w-8 h-8 text-primary" />
          {t("Keranjang Booking", "Booking Cart")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t(`${items.length} lapangan dipilih`, `${items.length} court(s) selected`)}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Kiri — Form & Item List */}
        <div className="lg:col-span-2 space-y-6">

          {/* Daftar item keranjang */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{t("Lapangan yang Dipilih", "Selected Courts")}</span>
                <button
                  onClick={clearCart}
                  className="text-xs text-destructive hover:underline font-medium"
                >
                  {t("Hapus Semua", "Clear All")}
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item) => {
                const itemPrice = item.mode === "walk_in"
                  ? item.facilityPricePerHour
                  : item.facilityPricePerHour * item.duration;
                const endTime = item.mode === "time_slot" && item.startTime
                  ? addHours(item.startTime, item.duration)
                  : null;

                return (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border/60 bg-muted/20"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-foreground">{item.facilityName}</div>
                      <Badge variant="outline" className="text-xs mt-1 mb-2">{item.facilityCategory}</Badge>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDate(item.date, lang)}
                        </div>
                        {item.mode === "walk_in" ? (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {t("Akses bebas (06:00–22:00)", "Open access (06:00–22:00)")}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {item.startTime} – {endTime} · {item.duration} {t("jam", "hr")}
                            {item.activityType && ` · ${item.activityType}`}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="font-bold text-primary text-sm">{formatCurrency(itemPrice)}</span>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-destructive hover:bg-destructive/10 rounded-lg p-1.5 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Pilih Tipe Pembayaran */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("Tipe Booking", "Booking Type")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {/* Umum */}
                <button
                  type="button"
                  onClick={() => setBookingMode("umum")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
                    bookingMode === "umum"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-foreground hover:border-primary/50"
                  }`}
                >
                  <User size={14} />
                  {t("Umum", "General")}
                </button>

                {/* Angkasa Pura */}
                <button
                  type="button"
                  onClick={() => setBookingMode("angkasa_pura")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
                    bookingMode === "angkasa_pura"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-border text-foreground hover:border-blue-400"
                  }`}
                >
                  <Plane size={14} />
                  {t("Angkasa Pura", "Angkasa Pura")}
                </button>

                {/* Event — diskon 21,43% */}
                <button
                  type="button"
                  onClick={() => setBookingMode("event")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
                    isEvent
                      ? "bg-purple-600 text-white border-purple-600"
                      : "border-border text-foreground hover:border-purple-400"
                  }`}
                >
                  <Tag size={14} />
                  {t("Event", "Event")}
                </button>

                {/* Tagihan Perusahaan — tampil jika eligible ATAU operator */}
                {(canCompanyBilling || isAdminBooking) && (
                  <button
                    type="button"
                    onClick={() => setBookingMode("perusahaan")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
                      bookingMode === "perusahaan"
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "border-border text-foreground hover:border-emerald-400"
                    }`}
                  >
                    <Building2 size={14} />
                    {t("Tagihan Perusahaan", "Company Billing")}
                  </button>
                )}
              </div>

              {/* Info per mode */}
              {isAP && (
                <div className="mt-3 flex items-start gap-2 text-xs text-blue-700 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                  <Plane className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{t("Tarif khusus karyawan Angkasa Pura berlaku. ID Card wajib diisi.", "Special Angkasa Pura employee rate applies. ID Card is required.")}</span>
                </div>
              )}
              {isEvent && (
                <div className="mt-3 flex items-start gap-2 text-xs text-purple-700 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-xl p-3">
                  <Tag className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{t("Diskon Event 21,43% otomatis diterapkan pada semua lapangan di keranjang.", "21.43% Event discount automatically applied to all courts in the cart.")}</span>
                </div>
              )}
              {isCompanyMode && companyName && (
                <div className="mt-3 flex items-start gap-2 text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                  <Building2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {t(
                      `Booking akan ditagihkan ke perusahaan: ${companyName}. Tidak perlu bayar sekarang.`,
                      `Booking will be billed to: ${companyName}. No payment required now.`
                    )}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Repeat Booking — ulangi semua lapangan di keranjang */}
          <Card className={isRepeat ? "border-primary/40 bg-primary/5" : ""}>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="cart-repeat-check"
                  checked={isRepeat}
                  onCheckedChange={(v) => setIsRepeat(!!v)}
                />
                <Label htmlFor="cart-repeat-check" className="text-base font-semibold cursor-pointer flex items-center gap-2">
                  <RefreshCw size={16} className={isRepeat ? "text-primary" : "text-muted-foreground"} />
                  {t("Repeat Booking", "Repeat Booking")}
                  {isRepeat && <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{t("Aktif", "Active")}</Badge>}
                </Label>
              </div>
              {!isRepeat && (
                <p className="text-xs text-muted-foreground ml-7">
                  {t("Aktifkan untuk mengulang semua lapangan di keranjang secara mingguan/bulanan.", "Enable to repeat all facilities in the cart weekly/monthly.")}
                </p>
              )}
              {isRepeat && items.some((it) => it.mode !== "time_slot") && (
                <p className="text-xs text-amber-600 ml-7">
                  {t("Hanya berlaku untuk lapangan dengan slot waktu.", "Only applies to facilities with a time slot.")}
                </p>
              )}
            </CardHeader>

            {isRepeat && (
              <CardContent className="space-y-5 pt-0">
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

                <div>
                  <Label htmlFor="cart-repeat-count" className="text-sm font-semibold mb-2 block">
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
                      id="cart-repeat-count"
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
              </CardContent>
            )}
          </Card>

          {/* Form Data Pemesan */}
          <Card>
            <CardHeader>
              <CardTitle>{t("Data Pemesan", "Booker Details")}</CardTitle>
            </CardHeader>
            <form onSubmit={handleCheckout} id="cart-checkout-form">
              <CardContent className="space-y-4">

                {/* Operator: selector customer + form nama manual */}
                {isAdminBooking ? (
                  <>
                    <div className="space-y-2">
                      <Label>{t("Nama Customer", "Customer Name")} <span className="text-destructive">*</span></Label>
                      <Popover open={comboOpen} onOpenChange={(open) => { setComboOpen(open); if (!open) setComboQuery(""); }}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-expanded={comboOpen}
                            className="w-full justify-between font-normal h-10"
                          >
                            <span className="truncate">
                              {selectedCustomerId
                                ? (() => {
                                    const c = customers.find((c) => String(c.id) === selectedCustomerId);
                                    return c ? `${c.name}${c.phone ? ` — ${c.phone}` : ""}` : name || t("Pilih customer...", "Select customer...");
                                  })()
                                : name
                                  ? <span className="flex items-center gap-1.5"><span className="text-xs bg-primary/15 text-primary rounded px-1.5 py-0.5 font-medium">Baru</span>{name}</span>
                                  : t("Pilih atau ketik nama customer baru...", "Select or type new customer...")}
                            </span>
                            <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command filter={(value, search) => {
                            if (value === "__create__") return 1;
                            return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                          }}>
                            <CommandInput
                              placeholder={t("Cari nama / nomor, atau ketik nama baru...", "Search name/phone or type new name...")}
                              value={comboQuery}
                              onValueChange={setComboQuery}
                            />
                            <CommandList>
                              <CommandEmpty>{t("Tidak ditemukan", "No results found")}</CommandEmpty>
                              <CommandGroup>
                                {customers
                                  .filter((c) => !comboQuery.trim() || `${c.name} ${c.phone ?? ""}`.toLowerCase().includes(comboQuery.toLowerCase()))
                                  .map((c) => (
                                    <CommandItem
                                      key={c.id}
                                      value={`${c.name} ${c.phone ?? ""}`}
                                      onSelect={() => {
                                        setSelectedCustomerId(String(c.id));
                                        setComboQuery("");
                                        setComboOpen(false);
                                      }}
                                    >
                                      <Check size={14} className={`mr-2 shrink-0 ${String(c.id) === selectedCustomerId ? "opacity-100" : "opacity-0"}`} />
                                      <span>{c.name}{c.phone ? ` — ${c.phone}` : ""}</span>
                                    </CommandItem>
                                  ))}
                              </CommandGroup>
                              {comboQuery.trim() && (
                                <CommandGroup>
                                  <CommandItem
                                    value="__create__"
                                    onSelect={() => {
                                      setSelectedCustomerId("");
                                      setName(comboQuery.trim());
                                      setEmail("");
                                      setPhone("");
                                      setComboQuery("");
                                      setComboOpen(false);
                                    }}
                                    className="text-primary font-medium"
                                  >
                                    <span className="mr-2 text-base">＋</span>
                                    {t(`Buat customer baru: "${comboQuery.trim()}"`, `Create new customer: "${comboQuery.trim()}"`)}
                                  </CommandItem>
                                </CommandGroup>
                              )}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* Jika customer baru (belum terdaftar), tampilkan input nama yang bisa diedit */}
                    {!selectedCustomerId && name && (
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t("Nama lengkap customer", "Customer full name")}
                      />
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">{t("Email", "Email")}</Label>
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="email@customer.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">{t("No. WhatsApp", "WhatsApp No.")} <span className="text-destructive">*</span></Label>
                        <Input
                          id="phone"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="08123456789"
                        />
                      </div>
                    </div>

                    {/* Nama operator yang sedang login (sebagai info) */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border rounded-lg px-3 py-2">
                      <ShieldCheck size={13} className="text-primary shrink-0" />
                      <span>{t(`Diinput oleh operator: ${currentUser?.name}`, `Entered by operator: ${currentUser?.name}`)}</span>
                    </div>
                  </>
                ) : (
                  /* Customer biasa */
                  <>
                    {isLoggedIn && (
                      <div className="space-y-2">
                        <Label>{t("Nama Akun", "Account Name")}</Label>
                        <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50 text-foreground font-medium text-sm cursor-not-allowed select-none">
                          <ShieldCheck size={14} className="text-primary shrink-0" />
                          <span>{currentUser?.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{t("Nama akun tidak dapat diubah.", "Account name cannot be changed.")}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">{t("Email", "Email")} <span className="text-destructive">*</span></Label>
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="email@kamu.com"
                          readOnly={isLoggedIn}
                          className={isLoggedIn ? "bg-muted/50 cursor-not-allowed" : ""}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">{t("No. WhatsApp", "WhatsApp No.")} <span className="text-destructive">*</span></Label>
                        <Input
                          id="phone"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="08123456789"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Field khusus Angkasa Pura: ID Card */}
                {isAP && (
                  <div className="space-y-2">
                    <Label htmlFor="idCard">
                      {t("Nomor ID Card Angkasa Pura", "Angkasa Pura ID Card No.")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="idCard"
                      value={idCardNumber}
                      onChange={(e) => setIdCardNumber(e.target.value.toUpperCase())}
                      placeholder={t("Contoh: AP-12345", "e.g. AP-12345")}
                      className="font-mono tracking-wider"
                    />
                  </div>
                )}

                {/* Field khusus Perusahaan: Booking atas nama siapa */}
                {isCompanyMode && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200/60 dark:border-emerald-800/40">
                    <div className="space-y-2">
                      <Label htmlFor="bookedForName">
                        {t("Nama Pengguna Lapangan", "Court User's Name")}
                        <span className="text-xs text-muted-foreground ml-1">({t("opsional", "optional")})</span>
                      </Label>
                      <Input
                        id="bookedForName"
                        value={bookedForName}
                        onChange={(e) => setBookedForName(e.target.value)}
                        placeholder={t("Kosongkan jika sama dengan pemesan", "Leave blank if same as booker")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bookedForPhone">
                        {t("No. WA Pengguna Lapangan", "Court User's WhatsApp")}
                        <span className="text-xs text-muted-foreground ml-1">({t("opsional", "optional")})</span>
                      </Label>
                      <Input
                        id="bookedForPhone"
                        value={bookedForPhone}
                        onChange={(e) => setBookedForPhone(e.target.value)}
                        placeholder="08123456789"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="notes">{t("Catatan (Opsional)", "Notes (Optional)")}</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("Permintaan khusus...", "Special requests...")}
                    rows={2}
                  />
                </div>

                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    {t(
                      "Semua lapangan di keranjang akan dibuat sebagai booking terpisah dengan masing-masing nomor order. Pembayaran dilakukan per booking.",
                      "Each court in the cart will be created as a separate booking with its own order number. Payment is done per booking."
                    )}
                  </span>
                </div>
              </CardContent>
            </form>
          </Card>
        </div>

        {/* Kanan — Ringkasan */}
        <div>
          <Card className="sticky top-28">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("Ringkasan", "Summary")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item) => {
                const itemPrice = item.mode === "walk_in"
                  ? item.facilityPricePerHour
                  : item.facilityPricePerHour * item.duration;
                return (
                  <div key={item.id} className="flex justify-between text-sm gap-2">
                    <span className="text-muted-foreground truncate">{item.facilityName}</span>
                    <span className="font-semibold shrink-0">{formatCurrency(itemPrice)}</span>
                  </div>
                );
              })}

              {isEvent && (
                <div className="flex justify-between text-purple-700 text-sm font-medium">
                  <span className="flex items-center gap-1"><Tag size={12} /> {t("Diskon Event 21,43%", "Event Discount 21.43%")}</span>
                  <span>−{formatCurrency(Math.round(totalPrice * EVENT_DISCOUNT_RATE))}</span>
                </div>
              )}

              <div className="border-t pt-3 flex justify-between font-black text-lg">
                <span>{t("Total", "Total")}</span>
                <span className="text-primary">
                  {isEvent
                    ? formatCurrency(Math.round(totalPrice * (1 - EVENT_DISCOUNT_RATE)))
                    : formatCurrency(totalPrice)}
                </span>
              </div>

              {isCompanyMode && companyId ? (
                <p className="text-xs text-emerald-700 font-semibold">
                  ✓ {t("Ditagihkan ke perusahaan — tidak perlu bayar sekarang.", "Billed to company — no payment needed now.")}
                </p>
              ) : isCompanyMode && !companyId ? (
                <p className="text-xs text-destructive font-semibold">
                  ⚠ {t("Data perusahaan tidak ditemukan. Coba refresh halaman.", "Company data not found. Try refreshing the page.")}
                </p>
              ) : isEvent ? (
                <p className="text-xs text-purple-700 font-semibold">
                  ✓ {t("Harga sudah termasuk diskon event 21,43%.", "Price includes 21.43% event discount.")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("*Belum termasuk pajak dan diskon yang berlaku.", "*Before applicable taxes and discounts.")}
                </p>
              )}

              <Button
                className="w-full h-12 font-bold rounded-full mt-2"
                form="cart-checkout-form"
                type="submit"
                disabled={isSubmitting || items.length === 0}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("Memproses...", "Processing...")}
                  </>
                ) : (
                  t(`Checkout ${items.length} Lapangan`, `Checkout ${items.length} Court(s)`)
                )}
              </Button>

              <Button variant="outline" className="w-full" asChild>
                <Link href="/facilities">
                  {t("+ Tambah Lapangan Lagi", "+ Add More Courts")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
