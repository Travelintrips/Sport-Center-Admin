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
import { id as idLocale } from "date-fns/locale";
import {
  MapPin, Calendar, Clock, Receipt, ChevronLeft,
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function formatCurrency(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDate(dateStr: string) {
  try {
    return format(parseISO(dateStr), "EEEE, d MMMM yyyy", { locale: idLocale });
  } catch {
    return dateStr;
  }
}

type RepeatType = "weekly" | "monthly";

export default function Booking() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

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
        toast({ title: "Booking Berhasil", description: "Silakan lanjutkan ke pembayaran." });
        setLocation(`/booking/${data.orderNumber}`);
      },
      onError: (error: any) => {
        toast({ title: "Booking Gagal", description: error?.message || "Gagal membuat booking", variant: "destructive" });
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
        toast({ title: "Gagal membuat booking berulang", description: error?.message || "Terjadi kesalahan", variant: "destructive" });
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
            setIsChecking(false);
          },
          onError: () => {
            setIsChecking(false);
            toast({ title: "Gagal cek jadwal", variant: "destructive" });
          },
        }
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [isRepeat, repeatType, repeatCount, facilityId, date, startTime, duration, checkRecurringMutate, toast]);

  // Redirect if missing params
  useEffect(() => {
    if (search && (!facilityId || !date || !startTime)) {
      toast({ title: "Detail booking tidak lengkap", description: "Silakan pilih fasilitas dan waktu terlebih dahulu.", variant: "destructive" });
      setLocation("/facilities");
    }
  }, [search, facilityId, date, startTime, setLocation, toast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityId || !date || !startTime || !duration) return;
    if (!name || !email || !phone) {
      toast({ title: "Form tidak lengkap", description: "Harap isi semua field yang wajib.", variant: "destructive" });
      return;
    }

    if (isRepeat) {
      if (!checkResult || checkResult.validCount === 0) {
        toast({ title: "Tidak ada slot tersedia", description: "Semua slot pada jadwal yang dipilih sudah terisi.", variant: "destructive" });
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
        },
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
        },
      });
    }
  };

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
        <h1 className="text-2xl font-bold mb-2">Booking Berhasil Dibuat!</h1>
        <p className="text-muted-foreground mb-6">
          <span className="font-semibold text-foreground">{recurringResult.totalBookings}</span> booking berhasil dibuat untuk <span className="font-semibold text-foreground">{facility.name}</span>.
        </p>
        <Card className="mb-6 text-left">
          <CardContent className="p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Booking Dibuat</span>
              <span className="font-semibold">{recurringResult.totalBookings} booking</span>
            </div>
            {recurringResult.skipped.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Dilewati (konflik)</span>
                <span className="text-orange-600 font-semibold">{recurringResult.skipped.length} booking</span>
              </div>
            )}
            <div className="border-t pt-3 flex justify-between font-bold text-lg">
              <span>Grand Total</span>
              <span className="text-primary">{formatCurrency(recurringResult.grandTotal)}</span>
            </div>
          </CardContent>
        </Card>
        {recurringResult.skipped.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 text-left">
            <div className="flex items-center gap-2 text-orange-700 font-semibold text-sm mb-2">
              <AlertTriangle size={15} /> Slot yang dilewati karena konflik:
            </div>
            {recurringResult.skipped.map((d) => (
              <div key={d} className="text-sm text-orange-600">{formatDate(d)}</div>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          {recurringResult.firstOrder && (
            <Button className="flex-1" onClick={() => setLocation(`/booking/${recurringResult.firstOrder}`)}>
              Lihat Detail Pembayaran
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={() => setLocation("/my-bookings")}>
            Booking Saya
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Button variant="ghost" onClick={() => window.history.back()} className="mb-6 -ml-4">
        <ChevronLeft className="mr-2 h-4 w-4" /> Kembali
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">Checkout</h1>
        <p className="text-muted-foreground">Lengkapi detail booking kamu di bawah ini.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left - Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Details */}
          <Card>
            <CardHeader>
              <CardTitle>Data Pemesan</CardTitle>
            </CardHeader>
            <form onSubmit={handleSubmit} id="booking-form">
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nama Lengkap <span className="text-destructive">*</span></Label>
                  <Input id="name" required value={name} onChange={e => setName(e.target.value)} placeholder="John Doe" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Alamat Email <span className="text-destructive">*</span></Label>
                    <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="john@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">No. WhatsApp <span className="text-destructive">*</span></Label>
                    <Input id="phone" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="08123456789" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Catatan Tambahan (Opsional)</Label>
                  <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Permintaan khusus..." />
                </div>
              </CardContent>
            </form>
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
                  Repeat Booking
                  {isRepeat && <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">Aktif</Badge>}
                </Label>
              </div>
              {!isRepeat && (
                <p className="text-xs text-muted-foreground ml-7">
                  Aktifkan untuk membuat booking berulang secara otomatis (mingguan / bulanan).
                </p>
              )}
            </CardHeader>

            {isRepeat && (
              <CardContent className="space-y-5 pt-0">
                {/* Repeat Type */}
                <div>
                  <Label className="text-sm font-semibold mb-2 block">Tipe Pengulangan</Label>
                  <div className="flex gap-2">
                    {(["weekly", "monthly"] as RepeatType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setRepeatType(t)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${repeatType === t ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}
                      >
                        {t === "weekly" ? "🗓 Weekly (Mingguan)" : "📅 Monthly (Bulanan)"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Repeat Count */}
                <div>
                  <Label htmlFor="repeat-count" className="text-sm font-semibold mb-2 block">
                    Jumlah Pengulangan
                    <span className="text-muted-foreground font-normal ml-1">(maks. 52)</span>
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
                      {repeatType === "weekly" ? "minggu" : "bulan"}
                    </span>
                  </div>
                </div>

                {/* Preview */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-semibold">Preview Jadwal Booking</Label>
                    {isChecking && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 size={13} className="animate-spin" /> Mengecek ketersediaan...
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
                      {checkResult.dates.map((item, idx) => (
                        <div
                          key={item.date}
                          className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm ${item.available
                            ? "bg-green-50 border-green-200"
                            : "bg-red-50 border-red-200 opacity-80"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {item.available
                              ? <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                              : <XCircle size={16} className="text-red-500 shrink-0" />
                            }
                            <div>
                              <span className={`font-medium ${item.available ? "text-green-800" : "text-red-700"}`}>
                                {formatDate(item.date)}
                              </span>
                              {!item.available && item.reason && (
                                <span className="ml-2 text-xs text-red-500">({item.reason})</span>
                              )}
                            </div>
                          </div>
                          <div className="text-xs font-medium text-muted-foreground">
                            {startTime} – {endTime}
                          </div>
                        </div>
                      ))}

                      {checkResult.validCount < checkResult.dates.length && (
                        <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
                          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                          <span>
                            <strong>{checkResult.dates.length - checkResult.validCount} slot</strong> tidak tersedia.
                            Booking yang valid ({checkResult.validCount} slot) tetap akan diproses.
                          </span>
                        </div>
                      )}

                      {checkResult.validCount === 0 && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                          <XCircle size={15} />
                          <span>Semua slot sudah terbooked. Silakan pilih waktu lain.</span>
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
                ? "Memproses..."
                : isRepeat
                  ? `Konfirmasi ${checkResult?.validCount ?? repeatCount} Booking`
                  : "Konfirmasi Booking"
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
                Ringkasan Booking
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
                      <div className="font-medium">Tanggal</div>
                      <div className="text-muted-foreground">{date ? formatDate(date) : ""}</div>
                      {isRepeat && (
                        <div className="text-xs text-primary mt-0.5">
                          +{repeatCount - 1} sesi {repeatType === "weekly" ? "mingguan" : "bulanan"} berikutnya
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Waktu & Durasi</div>
                      <div className="text-muted-foreground">
                        {startTime.substring(0, 5)} – {endTime} ({duration} {duration === 1 ? "jam" : "jam"})
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Lokasi</div>
                      <div className="text-muted-foreground">SportCenter Main</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Harga/jam</span>
                  <span>{formatCurrency(facility.pricePerHour)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Durasi</span>
                  <span>× {duration} jam</span>
                </div>
                {isRepeat && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Harga/sesi</span>
                      <span>{formatCurrency(totalPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Sesi valid
                      </span>
                      <span>
                        {isChecking
                          ? <span className="text-muted-foreground">...</span>
                          : `× ${checkResult?.validCount ?? repeatCount}`
                        }
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-bold text-lg pt-3 border-t">
                  <span>Total</span>
                  <span className="text-primary">
                    {isRepeat
                      ? (isChecking ? "..." : formatCurrency(checkResult?.totalPrice ?? totalPrice * repeatCount))
                      : formatCurrency(totalPrice)
                    }
                  </span>
                </div>
                {isRepeat && !isChecking && checkResult && (
                  <div className="text-xs text-muted-foreground text-right">
                    {checkResult.validCount} sesi × {duration} jam × {formatCurrency(facility.pricePerHour)}
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
                  ? <><Loader2 size={16} className="mr-2 animate-spin" /> Memproses...</>
                  : isRepeat
                    ? `Konfirmasi ${isChecking ? "..." : checkResult?.validCount ?? repeatCount} Booking`
                    : "Konfirmasi Booking"
                }
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
