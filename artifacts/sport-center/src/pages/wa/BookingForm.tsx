import { useState, useEffect, useRef } from "react";
import { Link, useParams, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, ArrowRight, ArrowLeft, Building2, CalendarDays, CheckCircle, Clock, CreditCard, Download, MapPin, Phone, QrCode, ShieldCheck, Upload, ZoomIn } from "lucide-react";
import buildingImg from "@assets/1780087062_1780089778393.png";

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
  proofStatus?: "waiting_confirmation" | null;
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

interface BookingProofOcrPreview {
  amount: number | null;
  engine: string;
  amountMatch: boolean;
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

function extractProofToken(uploadProofUrl: string): string | null {
  try {
    const url = new URL(uploadProofUrl, window.location.origin);
    const match = url.pathname.match(/\/(?:bukti|wa\/proof|bayar)\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

// Indonesia stays the default; visitors with a foreign WhatsApp can opt into another dial code.
const WHATSAPP_COUNTRIES = [
  { code: "62", label: "🇮🇩 Indonesia (+62)" },
  { code: "65", label: "🇸🇬 Singapura (+65)" },
  { code: "60", label: "🇲🇾 Malaysia (+60)" },
  { code: "1", label: "🇺🇸/🇨🇦 AS/Kanada (+1)" },
  { code: "44", label: "🇬🇧 Inggris (+44)" },
  { code: "61", label: "🇦🇺 Australia (+61)" },
  { code: "81", label: "🇯🇵 Jepang (+81)" },
  { code: "82", label: "🇰🇷 Korea Selatan (+82)" },
  { code: "86", label: "🇨🇳 Tiongkok (+86)" },
  { code: "91", label: "🇮🇳 India (+91)" },
  { code: "66", label: "🇹🇭 Thailand (+66)" },
  { code: "63", label: "🇵🇭 Filipina (+63)" },
  { code: "971", label: "🇦🇪 UEA (+971)" },
  { code: "966", label: "🇸🇦 Arab Saudi (+966)" },
] as const;

function initialWhatsappCountry(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!value.trim() || digits.startsWith("0")) return "62";
  return [...WHATSAPP_COUNTRIES].sort((a, b) => b.code.length - a.code.length)
    .find(({ code }) => digits.startsWith(code))?.code ?? "62";
}

function localWhatsappDigits(value: string, countryCode: string): string {
  const digits = value.replace(/\D/g, "");
  const withoutCountry = (value.trim().startsWith("+") || digits.startsWith(countryCode))
    && digits.startsWith(countryCode) ? digits.slice(countryCode.length) : digits;
  return withoutCountry.replace(/^0+/, "");
}

function normalizedWhatsappNumber(value: string, countryCode: string): string {
  const local = localWhatsappDigits(value, countryCode).slice(0, 14);
  return local ? `${countryCode}${local}` : "";
}

function validWhatsappNumber(value: string): boolean {
  return /^[1-9][0-9]{7,14}$/.test(value);
}

export default function WaBookingForm() {
  const params = useParams<{ facilityId: string }>();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const phoneFromWA = searchParams.get("phone") ?? "";
  const initialCountryCode = initialWhatsappCountry(phoneFromWA);
  const dedicatedNonmember = searchParams.get("nonmember") === "1";
  const publicGymGuest = dedicatedNonmember && searchParams.get("self") === "1";
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
  const [showQrisDialog, setShowQrisDialog] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofUploadError, setProofUploadError] = useState("");
  // The payment is not submitted merely because a local image passed OCR.
  // The backend must acknowledge a persisted payment before the confirmation
  // screen may say the proof awaits administrative review.
  const [proofUploadState, setProofUploadState] = useState<"idle" | "uploading" | "received" | "confirmed" | "failed">("idle");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofScanning, setProofScanning] = useState(false);
  const [proofOcrPreview, setProofOcrPreview] = useState<BookingProofOcrPreview | null>(null);
  const [x904IdentityType, setX904IdentityType] = useState<"pin" | "card">("pin");
  const [x904IdentityValue, setX904IdentityValue] = useState("");
  const [x904VerifiedName, setX904VerifiedName] = useState("");
  const [x904VerificationError, setX904VerificationError] = useState("");
  const [x904Verifying, setX904Verifying] = useState(false);
  const [guestIdentityRoute, setGuestIdentityRoute] = useState<"idle" | "checking" | "registered" | "expired_member" | "recognized_review" | "visitor_card" | "staff_review" | "unavailable">("idle");
  const [guestLookupError, setGuestLookupError] = useState("");
  const guestLookupAbort = useRef<AbortController | null>(null);

  const [whatsappCountryCode, setWhatsappCountryCode] = useState(initialCountryCode);
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: normalizedWhatsappNumber(phoneFromWA, initialCountryCode),
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

  useEffect(() => {
    setX904VerifiedName("");
    setX904VerificationError("");
    if (publicGymGuest || !dedicatedNonmember || !x904IdentityValue.trim()) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setX904Verifying(true);
      try {
        const query = new URLSearchParams({ type: x904IdentityType, value: x904IdentityValue.trim() });
        const response = await fetch("/api/wa/x904-identity?" + query, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.valid || !data.displayName) throw new Error(data.error || "Identitas tidak valid.");
        setX904VerifiedName(data.displayName);
        setForm(previous => ({ ...previous, customerName: data.displayName }));
      } catch (err) {
        if (!controller.signal.aborted) setX904VerificationError(err instanceof Error ? err.message : "Gagal memverifikasi identitas.");
      } finally {
        if (!controller.signal.aborted) setX904Verifying(false);
      }
    }, 400);
    return () => { window.clearTimeout(timeout); controller.abort(); setX904Verifying(false); };
  }, [dedicatedNonmember, publicGymGuest, x904IdentityType, x904IdentityValue]);

  // Debounce name-only lookup: never reveal a stored PIN or grant door access.
  useEffect(() => {
    if (!publicGymGuest) return;
    guestLookupAbort.current?.abort();
    setGuestIdentityRoute("idle");
    setGuestLookupError("");
    const name=form.customerName.trim();
    if(name.length<3)return;
    const controller=new AbortController();
    guestLookupAbort.current=controller;
    const timer=window.setTimeout(async()=>{
      setGuestIdentityRoute("checking");
      try {
        const response=await fetch("/api/wa/gym-name-route",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({customerName:name}),signal:controller.signal
        });
        if(controller.signal.aborted)return;
        if(!response.ok){
          setGuestIdentityRoute("unavailable");
          setGuestLookupError(response.status===429
            ? "Pemeriksaan nama dibatasi sementara. Coba lagi setelah 15 menit."
            : "Pemeriksaan nama X904 belum tersedia. Hubungi petugas jika diperlukan.");
          return;
        }
        const result=await response.json();
        if(controller.signal.aborted)return;
        setGuestIdentityRoute(["registered","expired_member","recognized_review","visitor_card","staff_review"].includes(result.route)?result.route:"unavailable");
      }catch{
        if(!controller.signal.aborted){
          setGuestIdentityRoute("unavailable");
          setGuestLookupError("Pemeriksaan nama sedang tidak tersedia.");
        }
      }
    },1600);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[publicGymGuest,form.customerName]);

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

  useEffect(() => {
    if (proofOcrPreview && proofOcrPreview.amount != null) {
      const stillMatches = Number(proofOcrPreview.amount) === Number(totalPrice);
      if (proofOcrPreview.amountMatch !== stillMatches) {
        setProofOcrPreview((current) =>
          current ? { ...current, amountMatch: stillMatches } : current,
        );
      }
    }
  }, [totalPrice, proofOcrPreview?.amount, proofOcrPreview?.amountMatch]);

  async function handleDownloadQris() {
    const imageUrl = paymentSettings?.qrisImageUrl;
    if (!imageUrl) return;

    const safeFacilityName = (facility?.name || "Sport-Center")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");
    const fileName = `QRIS-${safeFacilityName || "Sport-Center"}.png`;

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("QRIS image download failed");

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      // Cross-origin storage can prevent fetch/download. Opening the original
      // image still lets the customer save it from the browser/device.
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = fileName;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }

  async function handleProofFile(file: File | null) {
    if (!file) {
      setProofFile(null);
      if (proofPreview) URL.revokeObjectURL(proofPreview);
      setProofPreview(null);
      setProofUploadError("");
      setProofOcrPreview(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setProofUploadError("Gunakan foto atau screenshot bukti pembayaran.");
      setProofOcrPreview(null);
      return;
    }

    if (proofPreview) URL.revokeObjectURL(proofPreview);
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
    setProofUploadError("");
    setProofOcrPreview(null);
    setProofScanning(true);

    try {
      const fd = new FormData();
      fd.append("proof", file);
      fd.append("expectedAmount", String(totalPrice));

      const response = await fetch("/api/wa/booking/proof-scan", {
        method: "POST",
        body: fd,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProofUploadError(data?.error ?? "Bukti pembayaran belum dapat diperiksa.");
        return;
      }

      const preview = data?.ocrScan as BookingProofOcrPreview | undefined;
      if (!preview) {
        setProofUploadError("Nominal pada bukti belum terbaca.");
        return;
      }
      setProofOcrPreview(preview);

      if (!preview.amountMatch) {
        setProofUploadError(
          preview.amount == null
            ? "Nominal pada bukti belum terbaca. Ganti foto bukti pembayaran."
            : `Nominal bukti Rp ${Number(preview.amount).toLocaleString("id-ID")} tidak sama dengan tagihan Rp ${totalPrice.toLocaleString("id-ID")}.`,
        );
      }
    } catch {
      setProofUploadError("Pengecekan OCR gagal. Silakan coba foto bukti yang lain.");
    } finally {
      setProofScanning(false);
    }
  }

  async function uploadProofForBooking(booking: BookingResult): Promise<void> {
    // This is a retry of the proof on the ORIGINAL booking, never another booking
    // or payment instruction. Do not mistake an OCR preview for an uploaded proof.
    if (!proofFile || !form.paymentMethod) {
      setProofUploadState("failed");
      setProofUploadError("Foto bukti dan metode pembayaran diperlukan untuk mengirim bukti.");
      return;
    }
    const token = extractProofToken(booking.uploadProofUrl);
    if (!token) {
      setProofUploadState("failed");
      setProofUploadError("Link upload bukti tidak valid. Gunakan Upload Bukti Pembayaran pada booking ini.");
      return;
    }

    setUploadingProof(true);
    setProofUploadState("uploading");
    setProofUploadError("");
    try {
      const fd = new FormData();
      fd.append("proof", proofFile);
      fd.append("paymentMethod", form.paymentMethod === "qris" ? "QRIS" : "Transfer Bank");
      const response = await fetch(`/api/wa/proof/${encodeURIComponent(token)}`, {
        method: "POST",
        body: fd,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProofUploadError(data?.error ?? "Bukti belum tersimpan. Gunakan Coba Upload Lagi pada booking yang sama.");
        setProofUploadState("failed");
        return;
      }
      // A successful proof does not imply confirmed funds. The Gym guest flow
      // returns waiting_confirmation until an authorized operator verifies it.
      if (data?.success !== true ||
          !["waiting_confirmation", "confirmed"].includes(String(data?.status))) {
        setProofUploadError("Server belum mengonfirmasi penyimpanan bukti. Periksa status booking atau upload ulang.");
        setProofUploadState("failed");
        return;
      }
      setProofUploadState(data.status === "confirmed" ? "confirmed" : "received");
    } catch {
      setProofUploadError("Upload bukti gagal. Booking tetap tercatat; coba upload ulang tanpa membuat booking baru.");
      setProofUploadState("failed");
    } finally {
      setUploadingProof(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (dedicatedNonmember && !gymWalkIn) {
      setError("Halaman ini hanya untuk akses harian Gym nonmember.");
      return;
    }
    if (dedicatedNonmember && !validWhatsappNumber(form.customerPhone.trim())) {
      setError("Masukkan nomor WhatsApp internasional yang valid sesuai kode negara.");
      return;
    }
    // The public form never requires or knows the X904 PIN.
    // The server resolves identity and holds any grant for physical staff review.
    if (dedicatedNonmember && !publicGymGuest && (!x904VerifiedName || x904Verifying)) {
      setError("Verifikasi PIN/kartu X904 harus berhasil sebelum booking.");
      return;
    }
    if (dedicatedNonmember && (!form.paymentMethod || paymentOptions.length === 0)) {
      setError("Pilih QRIS atau transfer bank yang tersedia sebelum mengunggah bukti.");
      return;
    }
    if (dedicatedNonmember && !proofFile) {
      setError("Unggah foto bukti pembayaran sebelum mengirim untuk verifikasi.");
      return;
    }
    if (gymWalkIn && !publicGymGuest && !x904IdentityValue.trim()) {
      setError("Masukkan PIN X904 atau pilih kartu VIS001–VIS006.");
      return;
    }
    if (paymentOptions.length > 0 && !form.paymentMethod) {
      setError("Pilih metode pembayaran: QRIS atau Transfer Bank.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        facilityId: params.facilityId,
        bookingDate: form.bookingDate,
        startTime: form.startTime,
        durationHours: gymWalkIn ? gymDurationHours : Number(form.durationHours),
        notes: form.notes,
        paymentMethod: form.paymentMethod || undefined,
        ...(publicGymGuest ? { publicGymGuest: true } : {}),
        ...(!publicGymGuest && gymWalkIn && x904IdentityValue.trim()
          ? { x904IdentityType, x904IdentityValue: x904IdentityValue.trim().toUpperCase() } : {}),
      };
      // Public Gym sends the proof and booking together. The backend commits
      // both in a single transaction; there is no second upload to lose.
      const requestOptions: RequestInit = publicGymGuest
        ? (() => {
            const fd = new FormData();
            for (const [key, value] of Object.entries(payload)) {
              if (value !== undefined && value !== null) fd.append(key, String(value));
            }
            if (proofFile) fd.append("proof", proofFile);
            return { method: "POST", body: fd };
          })()
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          };
      const resp = await fetch("/api/wa/booking", requestOptions);
      const data = await resp.json();
      if (!resp.ok) { setError(data.error ?? "Bukti dan booking belum tersimpan. Coba lagi tanpa membayar ulang."); return; }
      const bookingResult = data as BookingResult;
      if (publicGymGuest) {
        // Fail closed: a partial success must never be reported to the customer.
        if (bookingResult.proofStatus !== "waiting_confirmation") {
          setError("Server belum mengonfirmasi penyimpanan bukti. Jangan membuat booking lagi; periksa status melalui petugas.");
          return;
        }
        setProofUploadState("received");
        setResult(bookingResult);
      } else {
        setProofUploadState(proofFile && form.paymentMethod ? "uploading" : "idle");
        setResult(bookingResult);
        if (proofFile && form.paymentMethod) await uploadProofForBooking(bookingResult);
      }
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
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center p-4 sm:p-8">
        <Card className="max-w-xl w-full overflow-hidden rounded-3xl border-slate-200 shadow-[0_20px_70px_rgba(15,23,42,0.10)]">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="w-9 h-9 text-green-600" />
            </div>
            <CardTitle className="text-green-700 font-black text-2xl">
              Booking Berhasil Dibuat!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-slate-50 rounded-2xl p-5 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="block text-xs text-gray-500">Nomor Booking</span>
                  <strong className="text-lg text-slate-900">{result.orderNumber}</strong>
                </div>
                <Button type="button" size="sm" variant="outline" aria-label="Salin nomor booking"
                  onClick={() => { void navigator.clipboard?.writeText(result.orderNumber); }}>
                  Salin
                </Button>
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

            {dedicatedNonmember && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Status booking dan akses Gym">
                <h3 className="font-bold text-slate-900">Status Booking Gym</h3>
                <div className="flex items-center justify-between gap-3 text-sm"><span>Booking</span><span className="font-semibold text-green-700">Berhasil Dibuat</span></div>
                <div className="flex items-center justify-between gap-3 text-sm"><span>Pembayaran</span><span className="font-semibold text-amber-700">{proofUploadState === "received" ? "Menunggu Verifikasi Admin" : proofUploadState === "confirmed" ? "Terverifikasi" : proofUploadState === "uploading" ? "Mengunggah Bukti..." : proofUploadState === "failed" ? "Bukti Belum Tersimpan" : "Menunggu Pengiriman Bukti"}</span></div>
                <div className="flex items-center justify-between gap-3 text-sm"><span>Akses X904</span><span className="font-semibold text-slate-600">Belum Aktif</span></div>
                <p className="border-t border-slate-100 pt-3 text-xs text-slate-600">
                  Booking sudah dibuat. Bukti baru dinyatakan diterima jika upload berhasil tercatat di server.
                  Pembayaran tetap harus diverifikasi admin dan identitas diperiksa petugas; akses baru siap jika aktivasi mesin serta read-back berhasil. Gunakan Cek Status Booking untuk status terbaru.
                </p>
              </div>
            )}
            {publicGymGuest && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Pencocokan nama X904 belum merupakan hak akses. Booking dan pembayaran mandiri tidak otomatis membuka pintu. Tunjukkan nomor booking kepada petugas
                untuk verifikasi identitas serta penyerahan kartu VIS / pemeriksaan PIN X904.
              </p>
            )}
            <p className="text-sm text-gray-600 text-center">
              {proofUploadState === "uploading"
                ? "Booking berhasil dibuat. Mengirim bukti pembayaran ke server..."
                : proofUploadState === "failed"
                  ? "Booking sudah dibuat, tetapi bukti belum berhasil tersimpan. Jangan membayar atau membuat booking lagi."
                  : proofUploadState === "received"
                    ? "Bukti pembayaran sudah tercatat dan menunggu verifikasi admin. Booking belum memberi akses pintu."
                    : proofUploadState === "confirmed"
                      ? "Pembayaran sudah terkonfirmasi oleh sistem. Periksa status terbaru sebelum menggunakan fasilitas."
                      : "Booking sudah dibuat, tetapi belum ada bukti pembayaran yang terkonfirmasi tersimpan."}
            </p>

            {proofUploadError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {proofUploadError}
              </div>
            )}

            <div className="space-y-2">
              {proofUploadState === "uploading" && (
                <p role="status" className="rounded-lg bg-blue-50 p-3 text-center text-sm font-semibold text-blue-700">
                  Mengunggah bukti pembayaran. Jangan menutup halaman atau membuat booking baru.
                </p>
              )}
              {proofUploadState === "failed" && proofFile && (
                <Button type="button" onClick={() => { void uploadProofForBooking(result); }}
                  disabled={uploadingProof}
                  className="w-full bg-orange-600 hover:bg-orange-700">
                  Coba Upload Lagi — Booking {result.orderNumber}
                </Button>
              )}
              {proofUploadState !== "received" && proofUploadState !== "confirmed" && proofUploadState !== "uploading" && (
                <a href={result.uploadProofUrl}
                  className="block w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 px-4 rounded-lg text-center text-sm transition-colors">
                  📎 Upload Bukti Pembayaran pada Booking Ini
                </a>
              )}
              {(proofUploadState === "received" || proofUploadState === "confirmed") && (
                <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">
                  Bukti pembayaran sudah diterima sistem. Tidak perlu upload atau membayar ulang.
                </p>
              )}
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
    <main className="min-h-screen bg-[#f7f5f1] pb-16 text-slate-900">
      {/* Premium public checkout header. */}
      <section className="relative overflow-hidden border-b border-amber-100 bg-[#fbf5ec]">
        <div className="pointer-events-none absolute inset-0">
          <img
            src={buildingImg}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-[0.18] blur-[10px] saturate-75"
            decoding="async"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,250,243,0.98)_0%,rgba(255,250,243,0.91)_38%,rgba(255,250,243,0.72)_66%,rgba(255,247,237,0.80)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_44%,rgba(15,91,70,0.10),transparent_25%),radial-gradient(circle_at_12%_18%,rgba(245,158,11,0.14),transparent_30%)]" />
          <div className="absolute -bottom-16 left-0 right-0 h-32 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.95),rgba(255,255,255,0)_68%)]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 sm:pb-12 lg:px-8">
          <Link href="/booking/mandiri" className="mb-7 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-slate-600 transition-colors hover:text-[#0f5b46]">
            <ArrowLeft className="h-4 w-4" /> Semua fasilitas
          </Link>
          <div className="grid items-center gap-7 md:grid-cols-[1fr_260px] lg:grid-cols-[1fr_350px]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white/90 px-3.5 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-amber-800 shadow-sm">
                <ShieldCheck className="h-4 w-4" /> Booking langsung tanpa login
              </span>
              <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.18em] text-[#0f5b46]">Sport Center Bandara Soekarno-Hatta</p>
              <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight text-[#0b3f33] sm:text-5xl">{facility?.name}</h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                Booking mudah, cepat, dan praktis. Pilih jadwal, lakukan pembayaran, lalu dapatkan akses Gym setelah verifikasi.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-700">
                <span className="inline-flex items-center gap-2 rounded-full border border-white bg-white/90 px-4 py-2.5 font-semibold shadow-sm"><Clock className="h-4 w-4 text-amber-600" /> {facility?.openTime}–{facility?.closeTime} WIB</span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white bg-white/90 px-4 py-2.5 font-semibold shadow-sm"><MapPin className="h-4 w-4 text-[#0f5b46]" /> {facility?.category}</span>
                <span className="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 font-extrabold text-white shadow-[0_8px_20px_rgba(245,158,11,0.22)]">
                  Rp {facility?.pricePerHour.toLocaleString("id-ID")}{gymWalkIn ? "/kunjungan" : "/jam"}
                </span>
              </div>
            </div>
            <div className="relative hidden overflow-hidden rounded-[28px] border-[5px] border-white shadow-[0_22px_60px_rgba(15,63,51,0.18)] md:block">
              <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#0b3f33]/20 via-transparent to-transparent" />
              <img src={buildingImg} alt="Gedung Sport Center Bandara Soekarno-Hatta" className="aspect-[5/3] h-full w-full object-cover brightness-105" decoding="async" />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pt-7 sm:px-6 lg:px-8">
        <div className="mb-7 grid grid-cols-3 gap-1 overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-2 text-center shadow-[0_12px_35px_rgba(15,23,42,0.06)] sm:gap-3 sm:p-3">
          {[
            { icon: Phone, title: "Data pemesan", sub: "Identitas" },
            { icon: CalendarDays, title: "Pilih jadwal", sub: "Tanggal & jam" },
            { icon: CreditCard, title: "Pembayaran", sub: "QRIS / transfer" },
          ].map(({ icon: Icon, title, sub }, index) => (
            <div key={title} className="flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2.5 sm:flex-row sm:gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0f5b46] text-white shadow-[0_5px_14px_rgba(15,91,70,0.22)]"><Icon className="h-4 w-4" /></div>
              <div className="text-center sm:text-left">
                <p className="text-xs font-bold text-[#142441] sm:text-sm">{index + 1}. {title}</p>
                <p className="hidden text-xs text-slate-500 sm:block">{sub}</p>
              </div>
            </div>
          ))}
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {publicGymGuest && (
          <div className="mb-6 overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-r from-[#0b3f33] via-[#0f5b46] to-[#176f56] text-white shadow-[0_18px_45px_rgba(15,91,70,0.18)]">
            <div className="relative p-5 sm:p-6">
              <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-amber-300/10 blur-2xl" />
              <div className="relative flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/15 text-amber-200">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-black sm:text-xl">Booking Gym <span className="text-amber-300">lebih mudah</span></p>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 text-emerald-50/90">
                    Ikuti tiga langkah sederhana berikut untuk mendapatkan akses Gym.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {[
                      ["1. Isi Data Diri", "Lengkapi nama dan nomor WhatsApp"],
                      ["2. Pilih Jadwal & Bayar", "Tentukan tanggal, jam, dan metode pembayaran"],
                      ["3. Akses Aktif Otomatis", "Setelah pembayaran diverifikasi, akses akan diaktifkan"],
                    ].map(([title, sub]) => (
                      <div key={title} className="rounded-2xl border border-white/10 bg-white/10 px-3.5 py-3 backdrop-blur-sm">
                        <p className="text-xs font-extrabold text-white sm:text-sm">{title}</p>
                        <p className="mt-1 hidden text-xs leading-5 text-emerald-50/75 sm:block">{sub}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_410px] lg:gap-7">
          <div className="space-y-6">
          <Card className="overflow-hidden rounded-3xl border-slate-200/80 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/70 pb-4 pt-5">
              <CardTitle className="text-sm font-black text-[#0b3f33] uppercase tracking-wide">Data Pemesan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5 sm:p-6">
              {gymWalkIn && !publicGymGuest ? (
                <div className="space-y-1 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <Label className="text-sm font-semibold">Nama sesuai data X904</Label>
                  <p className="text-xs text-blue-800">
                    Nama akan diambil otomatis dari inventaris mesin setelah PIN atau kartu VIS terverifikasi. Petugas tidak perlu mengetik nama.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="name" className="text-sm font-semibold">Nama Lengkap *</Label>
                  <Input
                    id="name"
                    placeholder="Contoh: Budi Santoso"
                    value={form.customerName}
                    className={publicGymGuest && (guestIdentityRoute === "registered" || guestIdentityRoute === "expired_member" || guestIdentityRoute === "recognized_review") ? "font-bold text-green-700 border-green-300 focus-visible:ring-green-400" : undefined}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, customerName: e.target.value }));
                    }}
                    required
                  />
                  {publicGymGuest && guestIdentityRoute === "checking" && <p className="text-xs text-slate-500" role="status">Memeriksa nama...</p>}
                  {publicGymGuest && guestLookupError && <p className="text-xs text-amber-700" role="status">{guestLookupError}</p>}
                  {publicGymGuest && guestIdentityRoute === "registered" && <p className="text-xs font-semibold text-green-700" role="status">Data Anda dikenali. Akses akan aktif setelah pembayaran diverifikasi.</p>}
                  {publicGymGuest && guestIdentityRoute === "expired_member" && <p className="text-xs font-semibold text-green-700" role="status">Data Anda dikenali. Anda dapat melanjutkan booking kunjungan harian.</p>}
                  {publicGymGuest && guestIdentityRoute === "recognized_review" && <p className="text-xs font-semibold text-green-700" role="status">Data Anda dikenali. Silakan lanjutkan booking dan pembayaran.</p>}
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="phone" className="text-sm font-semibold">Nomor WhatsApp *</Label>
                <div className="flex overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-orange-400">
                  <Select value={whatsappCountryCode} onValueChange={(code) => {
                    setWhatsappCountryCode(code);
                    setForm((f) => ({ ...f, customerPhone: normalizedWhatsappNumber(localWhatsappDigits(f.customerPhone, whatsappCountryCode), code) }));
                  }}>
                    <SelectTrigger aria-label="Pilih kode negara WhatsApp" className="w-[110px] shrink-0 rounded-none border-0 border-r border-gray-200 bg-gray-50 px-2 shadow-none focus:ring-0">
                      <Phone className="mr-1 h-4 w-4 shrink-0 text-gray-500" />
                      <SelectValue>{whatsappCountryCode === "62" ? "🇮🇩 +62" : `+${whatsappCountryCode}`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {WHATSAPP_COUNTRIES.map(({ code, label }) => (
                        <SelectItem key={code} value={code}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    className="min-w-0 flex-1 rounded-none border-0 shadow-none focus-visible:ring-0"
                    placeholder={whatsappCountryCode === "62" ? "8123456789" : "Nomor tanpa kode negara"}
                    maxLength={14}
                    value={localWhatsappDigits(form.customerPhone, whatsappCountryCode)}
                    onChange={(e) => setForm((f) => ({ ...f, customerPhone: normalizedWhatsappNumber(e.target.value, whatsappCountryCode) }))}
                    required
                  />
                </div>
                <p className="text-xs text-gray-500">Default +62 Indonesia. Pilih kode negara lain hanya jika nomor WhatsApp Anda dari luar negeri. Ketik tanpa 0 di depan.</p>
              </div>
              {gymWalkIn && !publicGymGuest && (
                <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/50 p-3">
                  <div>
                    <Label className="text-sm font-semibold">Identitas akses X904 (nonmember)</Label>
                    <p className="text-xs text-gray-500 mt-1">Pilih PIN mesin atau kartu pengunjung VIS001–VIS006. Identitas diverifikasi sebelum akses otomatis diproses.</p>
                  </div>
                  <Select value={x904IdentityType} onValueChange={(v) => { setX904IdentityType(v as "pin" | "card"); setX904IdentityValue(""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pin">PIN X904</SelectItem>
                      <SelectItem value="card">Kartu pengunjung VIS</SelectItem>
                    </SelectContent>
                  </Select>
                  {x904IdentityType === "pin" ? (
                    <div className="space-y-1">
                      <Label htmlFor="x904-pin">PIN mesin</Label>
                      <Input id="x904-pin" inputMode="numeric" pattern="[0-9]{1,8}" maxLength={8} placeholder="Masukkan PIN X904" value={x904IdentityValue} onChange={(e) => setX904IdentityValue(e.target.value.replace(/\D/g, ""))} />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label htmlFor="x904-card">Nomor kartu</Label>
                      <Select value={x904IdentityValue} onValueChange={setX904IdentityValue}>
                        <SelectTrigger id="x904-card"><SelectValue placeholder="Pilih VIS001–VIS006" /></SelectTrigger>
                        <SelectContent>
                          {["VIS001","VIS002","VIS003","VIS004","VIS005","VIS006"].map((card) => <SelectItem key={card} value={card}>{card}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {dedicatedNonmember && x904IdentityValue && <p role="status" className={`text-xs ${x904VerifiedName ? "text-green-700" : "text-red-700"}`}>{x904Verifying ? "Memeriksa identitas X904..." : x904VerifiedName ? `Terverifikasi: ${x904VerifiedName}` : x904VerificationError || "Menunggu verifikasi..."}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-3xl border-slate-200/80 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/70 pb-4 pt-5">
              <CardTitle className="text-sm font-black text-[#0b3f33] uppercase tracking-wide">Jadwal Booking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5 sm:p-6">
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

          </div>
          <aside aria-label="Ringkasan dan pembayaran booking" className="space-y-6 lg:sticky lg:top-5">
          {/* Price summary */}
          {(form.startTime || dedicatedNonmember) && (
            <Card className="overflow-hidden rounded-3xl border-amber-200 bg-gradient-to-b from-[#fffaf0] via-white to-white shadow-[0_16px_40px_rgba(180,83,9,0.08)]">
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
                                ? "border-amber-500 bg-gradient-to-br from-amber-50 to-orange-50 text-slate-900 shadow-[0_8px_22px_rgba(245,158,11,0.16)]"
                                : "border-slate-200 bg-white text-gray-700 hover:border-amber-300 hover:bg-amber-50/40"
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
                      <>
                        <div className="rounded-lg border border-orange-200 bg-white p-3 text-center">
                          <p className="mb-2 text-xs font-semibold text-gray-600">
                            Scan gambar QRIS untuk melakukan pembayaran
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowQrisDialog(true)}
                            className="mx-auto block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                            aria-label="Perbesar kode QRIS"
                          >
                            <img
                              src={paymentSettings.qrisImageUrl}
                              alt="QRIS pembayaran"
                              className="mx-auto max-h-64 w-auto max-w-full rounded-md object-contain"
                            />
                            <span className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-orange-700">
                              <ZoomIn className="h-4 w-4" />
                              Ketuk untuk memperbesar
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDownloadQris()}
                            className="mx-auto mt-2 flex items-center justify-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700 transition-colors hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                            aria-label="Download kode QRIS"
                          >
                            <Download className="h-4 w-4" />
                            Download QRIS
                          </button>
                        </div>

                        <Dialog open={showQrisDialog} onOpenChange={setShowQrisDialog}>
                          <DialogContent className="max-h-[92vh] max-w-[min(92vw,560px)] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Kode QRIS Sport Center</DialogTitle>
                              <DialogDescription>
                                Perbesar kode ini agar lebih mudah dipindai dari aplikasi pembayaran.
                              </DialogDescription>
                            </DialogHeader>
                            <img
                              src={paymentSettings.qrisImageUrl}
                              alt="Kode QRIS Sport Center ukuran besar"
                              className="mx-auto max-h-[70vh] w-full object-contain"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
                              onClick={() => void handleDownloadQris()}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Download QRIS
                            </Button>
                          </DialogContent>
                        </Dialog>
                      </>
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

          <Card className="overflow-hidden rounded-3xl border-slate-200/80 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/70 pb-4 pt-5">
              <CardTitle className="text-sm font-black text-[#0b3f33] uppercase tracking-wide">
                Upload Bukti Bayar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5 sm:p-6">
              <p className="text-xs text-gray-600">
                Setelah melakukan pembayaran, upload foto atau screenshot bukti di sini.
                Bukti pembayaran wajib diupload sebelum booking dapat dikirim.
              </p>

              {proofPreview ? (
                <div className="space-y-3">
                  <div className="rounded-lg border bg-gray-50 p-2">
                    <img
                      src={proofPreview}
                      alt="Preview bukti pembayaran"
                      className="mx-auto max-h-64 w-auto max-w-full rounded-md object-contain"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-orange-300 bg-white px-4 py-3 text-sm font-bold text-orange-700 hover:bg-orange-50">
                    <Upload className="h-4 w-4" />
                    Ganti Foto Bukti
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleProofFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-amber-300 bg-gradient-to-br from-amber-50 to-white px-4 py-7 text-sm font-extrabold text-amber-800 transition hover:border-amber-400 hover:bg-amber-50">
                  <Upload className="h-5 w-5" />
                  Pilih Foto Bukti Pembayaran
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleProofFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}

              {proofFile && (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    proofOcrPreview?.amountMatch
                      ? "border-green-200 bg-green-50 text-green-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <p className="font-bold">Hasil pengecekan awal</p>
                  <p className="mt-1">
                    <strong>Nominal tagihan:</strong> Rp {totalPrice.toLocaleString("id-ID")}
                  </p>
                  <p className="mt-1">
                    <strong>Bukti Scan:</strong>{" "}
                    {proofScanning
                      ? "Sedang membaca..."
                      : proofOcrPreview?.amount == null
                        ? "Belum terbaca"
                        : `Rp ${Number(proofOcrPreview.amount).toLocaleString("id-ID")}`}
                  </p>
                </div>
              )}

              {proofUploadError && !result && (
                <p className="text-xs text-red-600">{proofUploadError}</p>
              )}
            </CardContent>
          </Card>

          {(() => {
            const missing: string[] = [];
            if (dedicatedNonmember && !publicGymGuest && !x904VerifiedName) missing.push(x904Verifying ? "Verifikasi PIN/kartu sedang berlangsung" : "PIN/kartu X904 belum terverifikasi");
            if (!form.customerName) missing.push("Nama pemesan belum tersedia");
            if (!form.customerPhone.trim() || (dedicatedNonmember && !validWhatsappNumber(form.customerPhone.trim()))) missing.push("Isi nomor WhatsApp yang valid sesuai kode negara");
            if (!form.bookingDate) missing.push("Pilih tanggal kunjungan");
            if (!form.startTime) missing.push("Pilih jam kunjungan");
            if (!gymWalkIn && (availabilityLoading || !availabilitySlots || !timeSlots.includes(form.startTime))) missing.push("Pilih slot yang tersedia");
            if (!form.paymentMethod) missing.push("Pilih QRIS atau transfer bank");
            if (!proofFile) missing.push("Unggah bukti pembayaran");
            else if (proofScanning) missing.push("Menunggu pemeriksaan bukti");
            else if (!proofOcrPreview?.amountMatch) missing.push("Nominal bukti belum cocok dengan tagihan");
            if (missing.length === 0 || submitting || uploadingProof) return null;
            return <div role="status" aria-live="polite" className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-4 py-3.5 text-sm text-slate-700 shadow-[0_8px_22px_rgba(245,158,11,0.08)]">
              <p className="font-extrabold text-amber-900">Sebelum booking, pastikan:</p>
              <ul className="mt-2 space-y-1.5">{missing.map(reason => <li key={reason} className="flex items-start gap-2"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> <span>{reason}</span></li>)}</ul>
              
            </div>;
          })()}

          <Button
            type="submit"
            disabled={
              submitting ||
              uploadingProof ||
              proofScanning ||
              !proofOcrPreview?.amountMatch ||
              (!gymWalkIn && (
                availabilityLoading ||
                !availabilitySlots ||
                !timeSlots.includes(form.startTime)
              )) ||
              !form.customerName ||
              !form.customerPhone ||
              !form.bookingDate ||
              !form.startTime ||
              !proofFile
            }
            className="min-h-14 w-full rounded-2xl bg-gradient-to-r from-[#0b3f33] to-[#0f5b46] py-4 text-base font-black text-white shadow-[0_14px_30px_rgba(15,91,70,0.24)] transition hover:from-[#0a382d] hover:to-[#0d503f] disabled:opacity-45">
            {submitting || uploadingProof || proofScanning ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {proofScanning
                  ? "Membaca Nominal..."
                  : uploadingProof
                    ? "Memeriksa Bukti..."
                    : "Memproses..."}
              </span>
            ) : "Konfirmasi & Buat Booking"}
          </Button>
          </aside>
        </form>
      </div>
    </main>
  );
}
