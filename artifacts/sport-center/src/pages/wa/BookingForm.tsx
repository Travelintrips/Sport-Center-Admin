import { useState, useEffect } from "react";
import { useParams, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Building2, CheckCircle, Clock, MapPin, Phone, QrCode } from "lucide-react";

interface Facility {
  id: number;
  name: string;
  category: string;
  pricePerHour: number;
  openTime: string;
  closeTime: string;
  bookingMode: string;
  minDuration: number;
  maxDuration: number | null;
}

interface BookingResult {
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice: number;
  statusUrl: string;
  uploadProofUrl: string;
}

interface AvailabilitySlot {
  time: string;
  available: boolean;
  reason: string | null;
}

interface PaymentSettings {
  bankName?: string | null;
  bankAccount?: string | null;
  bankAccountName?: string | null;
  qrisImageUrl?: string | null;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function addHoursToTime(time: string, hours: number): string {
  const total = timeToMinutes(time) + hours * 60;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function minutesToTime(total: number): string {
  const normalized = Math.max(0, Math.min(total, 23 * 60 + 59));
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function isGymWalkInFacility(facility: Facility | null): boolean {
  if (!facility || facility.bookingMode !== "walk_in") return false;
  return /\bgym\b|fitness/i.test(`${facility.name} ${facility.category}`);
}

export default function WaBookingForm() {
  const params = useParams<{ facilityId: string }>();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const phoneFromWA = searchParams.get("phone") ?? "";
  const dateFromWA = searchParams.get("date") ?? "";
  const startTimeFromWA = searchParams.get("startTime") ?? "";
  const durationFromWA = searchParams.get("duration") ?? "1";

  const [facility, setFacility] = useState<Facility | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [error, setError] = useState("");
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[] | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: phoneFromWA,
    bookingDate: dateFromWA,
    startTime: startTimeFromWA,
    durationHours: durationFromWA,
    notes: "",
    paymentMethod: "" as "" | "qris" | "transfer",
  });

  useEffect(() => {
    fetch(`/api/wa/facility/${params.facilityId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setFacility(data);
      })
      .catch(() => setError("Gagal memuat data fasilitas"))
      .finally(() => setLoading(false));
  }, [params.facilityId]);

  // Manual payment options are read from the public production settings.
  // This flow does not use the Paylabs/sandbox configuration.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PaymentSettings | null) => {
        if (data) setPaymentSettings(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!facility || !form.bookingDate || isGymWalkInFacility(facility)) {
      setAvailabilitySlots(null);
      setAvailabilityLoading(false);
      setAvailabilityError("");
      return;
    }

    const controller = new AbortController();
    setAvailabilitySlots(null);
    setAvailabilityLoading(true);
    setAvailabilityError("");

    const query = new URLSearchParams({
      facilityId: String(facility.id),
      date: form.bookingDate,
      durationHours: form.durationHours,
    });

    fetch(`/api/availability?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(data)) {
          throw new Error("availability_request_failed");
        }
        return data as AvailabilitySlot[];
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setAvailabilitySlots(data);
        setForm((current) => {
          if (!current.startTime) return current;
          const selectedSlot = data.find(
            (slot) => slot.time === current.startTime && slot.available,
          );
          return selectedSlot ? current : { ...current, startTime: "" };
        });
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setAvailabilitySlots([]);
        setAvailabilityError(
          requestError instanceof Error && requestError.message === "availability_request_failed"
            ? "Gagal memeriksa ketersediaan jam. Coba lagi."
            : "Gagal memeriksa ketersediaan jam. Coba pilih tanggal lagi.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setAvailabilityLoading(false);
      });

    return () => controller.abort();
  }, [facility, form.bookingDate, form.durationHours]);

  const today = new Date().toISOString().split("T")[0];
  const gymWalkIn = isGymWalkInFacility(facility);
  const gymDurationHours = 1;
  const gymLatestStart = facility
    ? minutesToTime(timeToMinutes(facility.closeTime) - gymDurationHours * 60)
    : "";
  const maxDuration = facility?.maxDuration ?? 8;
  const minDuration = facility?.minDuration ?? 1;
  const durationOptions = Array.from(
    { length: maxDuration - minDuration + 1 },
    (_, i) => String(i + minDuration)
  );

  const timeSlots = availabilitySlots?.filter((slot) => slot.available).map((slot) => slot.time) ?? [];

  const effectiveDurationHours = gymWalkIn ? gymDurationHours : Number(form.durationHours);
  const totalPrice = facility
    ? facility.pricePerHour * effectiveDurationHours
    : 0;

  const paymentOptions: Array<{
    id: "qris" | "transfer";
    label: string;
    detail: string;
  }> = [
    ...(paymentSettings?.qrisImageUrl
      ? [{ id: "qris" as const, label: "QRIS", detail: "Scan & bayar" }]
      : []),
    ...(paymentSettings?.bankName && paymentSettings?.bankAccount
      ? [{
          id: "transfer" as const,
          label: "Transfer Bank",
          detail: paymentSettings.bankName,
        }]
      : []),
  ];

  const endTime = form.startTime
    ? addHoursToTime(form.startTime, effectiveDurationHours)
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (paymentOptions.length > 0 && !form.paymentMethod) {
      setError("Pilih metode pembayaran: QRIS atau Transfer Bank.");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/wa/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.customerName,
          customerPhone: form.customerPhone,
          facilityId: params.facilityId,
          bookingDate: form.bookingDate,
          startTime: form.startTime,
          durationHours: gymWalkIn ? gymDurationHours : Number(form.durationHours),
          notes: form.notes,
          paymentMethod: form.paymentMethod || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) { setError(data.error ?? "Terjadi kesalahan"); return; }
      setResult(data);
    } catch {
      setError("Gagal mengirim booking. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-600">Memuat...</p>
        </div>
      </div>
    );
  }

  if (error && !facility) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <p className="font-semibold text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="w-9 h-9 text-green-600" />
            </div>
            <CardTitle className="text-green-700 font-black text-xl">Booking Berhasil!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Order</span>
                <span className="font-bold">{result.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Fasilitas</span>
                <span className="font-semibold">{result.facilityName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tanggal</span>
                <span className="font-semibold">{result.bookingDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{gymWalkIn ? "Jam Mulai" : "Jam"}</span>
                <span className="font-semibold">
                  {gymWalkIn ? result.startTime : `${result.startTime} – ${result.endTime}`}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1.5">
                <span className="font-bold text-gray-700">Grand Total</span>
                <span className="font-black text-orange-600">Rp {result.totalPrice.toLocaleString("id-ID")}</span>
              </div>
            </div>

            <p className="text-sm text-gray-600 text-center">
              Detail & instruksi pembayaran sudah dikirim ke WhatsApp kamu.
            </p>

            <div className="space-y-2">
              <a href={result.uploadProofUrl}
                className="block w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-lg text-center text-sm transition-colors">
                📎 Upload Bukti Pembayaran
              </a>
              <a href={result.statusUrl}
                className="block w-full border border-orange-300 text-orange-700 font-semibold py-3 px-4 rounded-lg text-center text-sm hover:bg-orange-50 transition-colors">
                🔍 Cek Status Booking
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-orange-50 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 pt-8 pb-6">
        <p className="text-orange-100 text-sm font-medium uppercase tracking-wide mb-1">Form Booking</p>
        <h1 className="font-black text-2xl">{facility?.name}</h1>
        <div className="flex items-center gap-3 mt-2 text-sm text-orange-100">
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            {facility?.openTime} – {facility?.closeTime}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            {facility?.category}
          </span>
        </div>
        <div className="mt-3">
          <Badge className="bg-white/20 text-white border-white/30 font-bold text-base">
            Rp {facility?.pricePerHour.toLocaleString("id-ID")}{gymWalkIn ? "" : "/jam"}
          </Badge>
        </div>
      </div>

      <div className="px-4 pt-4 max-w-md mx-auto">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Data Pemesan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="name" className="text-sm font-semibold">Nama Lengkap *</Label>
                <Input
                  id="name"
                  placeholder="Contoh: Budi Santoso"
                  value={form.customerName}
                  onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone" className="text-sm font-semibold">Nomor WhatsApp *</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="phone"
                    className="pl-9"
                    placeholder="628123456789"
                    value={form.customerPhone}
                    onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
                    required
                  />
                </div>
                <p className="text-xs text-gray-500">Format: 628xxx (tanpa + atau 0 di depan)</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Jadwal Booking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!gymWalkIn && (
                <div className="space-y-1">
                  <Label className="text-sm font-semibold">Durasi *</Label>
                  <Select
                    value={form.durationHours}
                    onValueChange={(v) => {
                      setAvailabilitySlots(null);
                      setAvailabilityError("");
                      setForm((f) => ({ ...f, durationHours: v, startTime: "" }));
                    }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {durationOptions.map((d) => (
                        <SelectItem key={d} value={d}>{d} jam</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="date" className="text-sm font-semibold">Tanggal *</Label>
                <Input
                  id="date"
                  type="date"
                  min={today}
                  value={form.bookingDate}
                  onChange={(e) => {
                    setAvailabilitySlots(null);
                    setAvailabilityError("");
                    setForm((f) => ({
                      ...f,
                      bookingDate: e.target.value,
                      startTime: gymWalkIn ? f.startTime : "",
                    }));
                  }}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-sm font-semibold">Jam Mulai *</Label>
                {gymWalkIn ? (
                  <>
                    <Input
                      type="time"
                      min={facility?.openTime ?? undefined}
                      max={gymLatestStart || undefined}
                      value={form.startTime}
                      onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                      required
                    />
                    <p className="text-xs text-gray-500">
                      Pilih jam mulai antara {facility?.openTime}–{gymLatestStart}. Tidak ada pengecekan slot untuk Gym.
                    </p>
                  </>
                ) : (
                  <>
                    <Select
                      value={form.startTime}
                      onValueChange={(v) => setForm((f) => ({ ...f, startTime: v }))}>
                      <SelectTrigger disabled={availabilityLoading || !form.bookingDate || availabilitySlots === null || timeSlots.length === 0}>
                        <SelectValue
                          placeholder={
                            availabilityLoading
                              ? "Memeriksa ketersediaan..."
                              : !form.bookingDate
                                ? "Pilih tanggal terlebih dahulu"
                                : availabilitySlots === null
                                  ? "Memeriksa ketersediaan..."
                                  : timeSlots.length === 0
                                    ? "Tidak ada jam tersedia"
                                    : "Pilih jam mulai"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {timeSlots.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {availabilityLoading && (
                      <p className="text-xs text-gray-500">Sedang memeriksa ketersediaan untuk tanggal dan durasi ini...</p>
                    )}
                    {!availabilityLoading && availabilityError && (
                      <p className="text-xs text-red-600">{availabilityError}</p>
                    )}
                    {!availabilityLoading && !availabilityError && availabilitySlots && timeSlots.length === 0 && (
                      <p className="text-xs text-red-600">Tidak ada jam yang tersedia untuk tanggal dan durasi tersebut.</p>
                    )}
                    {form.startTime && endTime && (
                      <p className="text-xs text-gray-500">Selesai jam: <strong>{endTime}</strong></p>
                    )}
                  </>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="notes" className="text-sm font-semibold">Catatan (Opsional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Contoh: untuk latihan tim, butuh bola, dll"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Price summary */}
          {form.startTime && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="pt-4 pb-3 space-y-1.5">
                {paymentOptions.length > 0 && (
                  <div className="space-y-2.5 pb-3">
                    <div className="text-sm font-bold text-gray-700">Pilih Metode Pembayaran</div>
                    <div className="grid grid-cols-2 gap-2">
                      {paymentOptions.map((method) => {
                        const selected = form.paymentMethod === method.id;
                        return (
                          <button
                            key={method.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setForm((current) => ({ ...current, paymentMethod: method.id }))}
                            className={`flex min-h-16 items-center gap-2 rounded-lg border-2 px-2.5 py-2 text-left transition-colors ${
                              selected
                                ? "border-orange-500 bg-orange-500 text-white"
                                : "border-orange-200 bg-white text-gray-700 hover:border-orange-400"
                            }`}
                          >
                            {method.id === "qris" ? (
                              <QrCode className={`h-6 w-6 shrink-0 ${selected ? "text-white" : "text-orange-600"}`} />
                            ) : (
                              <Building2 className={`h-6 w-6 shrink-0 ${selected ? "text-white" : "text-blue-600"}`} />
                            )}
                            <span className="min-w-0">
                              <span className="block text-xs font-bold">{method.label}</span>
                              <span className={`block truncate text-[10px] ${selected ? "text-white/80" : "text-gray-500"}`}>
                                {method.detail}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {form.paymentMethod === "qris" && paymentSettings?.qrisImageUrl && (
                      <div className="rounded-lg border border-orange-200 bg-white p-3 text-center">
                        <p className="mb-2 text-xs font-semibold text-gray-600">
                          Scan gambar QRIS untuk melakukan pembayaran
                        </p>
                        <img
                          src={paymentSettings.qrisImageUrl}
                          alt="QRIS pembayaran"
                          className="mx-auto max-h-64 w-auto max-w-full rounded-md object-contain"
                        />
                      </div>
                    )}
                    {form.paymentMethod === "transfer" &&
                      paymentSettings?.bankName &&
                      paymentSettings?.bankAccount && (
                        <div className="rounded-lg border border-orange-200 bg-white p-3 text-sm text-gray-700">
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-gray-500">Nama Bank</span>
                            <span className="text-right font-bold">{paymentSettings.bankName}</span>
                          </div>
                          <div className="mt-2 flex items-start justify-between gap-4">
                            <span className="text-gray-500">Nomor Tujuan</span>
                            <span className="text-right font-bold">{paymentSettings.bankAccount}</span>
                          </div>
                          <div className="mt-2 flex items-start justify-between gap-4">
                            <span className="text-gray-500">Nama Akun</span>
                            <span className="text-right font-bold">
                              {paymentSettings.bankAccountName || "-"}
                            </span>
                          </div>
                        </div>
                      )}
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-orange-200 pt-1.5">
                  <span className="text-gray-700 font-bold">Grand Total</span>
                  <span className="text-orange-600 font-black text-xl">
                    Rp {totalPrice.toLocaleString("id-ID")}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  {gymWalkIn
                    ? `Tarif Gym / Fitness Center: Rp ${facility?.pricePerHour.toLocaleString("id-ID")}`
                    : `${facility?.pricePerHour.toLocaleString("id-ID")}/jam × ${form.durationHours} jam`}
                </p>
              </CardContent>
            </Card>
          )}

          <Button
            type="submit"
            disabled={
              submitting ||
              (!gymWalkIn && (
                availabilityLoading ||
                !availabilitySlots ||
                !timeSlots.includes(form.startTime)
              )) ||
              !form.customerName ||
              !form.customerPhone ||
              !form.bookingDate ||
              !form.startTime
            }
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-base py-6 rounded-xl">
            {submitting ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Memproses...
              </span>
            ) : "🏅 Booking Sekarang"}
          </Button>
        </form>
      </div>
    </div>
  );
}
