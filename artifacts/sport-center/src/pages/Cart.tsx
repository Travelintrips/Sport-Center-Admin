import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useCart } from "@/lib/cart";
import { useGetMe, getGetMeQueryKey, useGetFacility } from "@workspace/api-client-react";
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
  Calendar, Clock, MapPin, ShieldCheck, AlertCircle
} from "lucide-react";

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

export default function Cart() {
  const { t, lang } = useLang();
  const { items, removeItem, clearCart, totalPrice } = useCart();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: currentUser, isLoading: isLoadingUser } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 },
  });
  const isLoggedIn = !!currentUser && currentUser.role !== "admin";

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [createdOrders, setCreatedOrders] = useState<string[]>([]);

  // Auto-fill dari user yang login
  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name ?? "");
      setEmail(currentUser.email ?? "");
      setPhone((currentUser as any).phone ?? "");
    }
  }, [currentUser]);

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

  function normalizePhone(raw: string) {
    let p = raw.replace(/\D/g, "");
    if (p.startsWith("0")) p = "62" + p.slice(1);
    else if (!p.startsWith("62")) p = p ? "62" + p : "";
    return p;
  }

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

    setIsSubmitting(true);
    const token = getToken();
    const orders: string[] = [];
    const successItemIds: string[] = [];

    // Generate a shared group ref untuk semua booking dari sesi keranjang ini
    const cartRef = items.length > 1
      ? `CART-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      : null;

    for (const item of items) {
      try {
        const body: {
          customerName: string;
          customerEmail?: string;
          customerPhone: string;
          facilityId: number;
          bookingDate: string;
          notes?: string;
          customerType: string;
          payerType: string;
          source: string;
          groupRef?: string;
          startTime?: string;
          durationHours?: number;
          activityType?: string;
          numberOfPeople?: number;
        } = {
          customerName: name.trim(),
          customerPhone: normalizedPhone,
          facilityId: item.facilityId,
          bookingDate: item.date,
          customerType: "umum",
          payerType: "personal",
          source: "cart",
          ...(cartRef ? { groupRef: cartRef } : {}),
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

          {/* Form Data Pemesan */}
          <Card>
            <CardHeader>
              <CardTitle>{t("Data Pemesan", "Booker Details")}</CardTitle>
            </CardHeader>
            <form onSubmit={handleCheckout} id="cart-checkout-form">
              <CardContent className="space-y-4">
                {isLoggedIn && (
                  <div className="space-y-2">
                    <Label>{t("Nama Pemesan", "Account Holder")}</Label>
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

              <div className="border-t pt-3 flex justify-between font-black text-lg">
                <span>{t("Total", "Total")}</span>
                <span className="text-primary">{formatCurrency(totalPrice)}</span>
              </div>

              <p className="text-xs text-muted-foreground">
                {t("*Belum termasuk pajak dan diskon yang berlaku.", "*Before applicable taxes and discounts.")}
              </p>

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
