import { useEffect, useState } from "react";
import { useListFacilities, useListCustomers } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShoppingCart, CheckCircle2, ArrowLeft, RefreshCw, CalendarDays, XCircle } from "lucide-react";
import { getToken, getCurrentRole } from "@/lib/auth";

function jakartaDateOnly(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function AdminCheckoutForm() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [slotOptions, setSlotOptions] = useState<Array<{time: string; available: boolean; reason: string | null}>>([]);
  const [slotState, setSlotState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [bookingDay, setBookingDay] = useState("");
  const [endTime, setEndTime] = useState("");
  const [duration, setDuration] = useState("1");
  const [bookingKind, setBookingKind] = useState("personal");
  const [eventPayer, setEventPayer] = useState("personal");
  const [memberAction, setMemberAction] = useState("new");
  const [memberId, setMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberMonths, setMemberMonths] = useState("1");
  const [members, setMembers] = useState<Array<{id:number; name:string; phone:string; status:string; endDate:string}>>([]);
  const [memberLoadError, setMemberLoadError] = useState("");
  const [membershipResult, setMembershipResult] = useState("");
  const [membershipConfirmOpen, setMembershipConfirmOpen] = useState(false);
  const [membershipPaymentTarget, setMembershipPaymentTarget] = useState<null | {
    membershipId: number;
    action: "new" | "renew";
    name: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
  }>(null);
  const [membershipPaymentMethod, setMembershipPaymentMethod] = useState("qris");
  const [membershipProofUploaded, setMembershipProofUploaded] = useState(false);
  const [membershipPaymentDate, setMembershipPaymentDate] = useState(jakartaDateOnly);
  const [membershipPaymentFile, setMembershipPaymentFile] = useState<File | null>(null);
  const [membershipPaymentBusy, setMembershipPaymentBusy] = useState(false);
  const [membershipPaymentDone, setMembershipPaymentDone] = useState(false);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<string | null>(null);
  const [createdBookingId, setCreatedBookingId] = useState<number | null>(null);
  const [createdBookingAmount, setCreatedBookingAmount] = useState<number>(0);
  const [paymentChoice, setPaymentChoice] = useState<"paid" | "unpaid" | null>(null);
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paidMethod, setPaidMethod] = useState("Transfer Bank");
  const [bookingPaymentDate, setBookingPaymentDate] = useState(jakartaDateOnly);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  const [createdPaymentId, setCreatedPaymentId] = useState<number | null>(null);
  const [createdPaymentError, setCreatedPaymentError] = useState("");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatType, setRepeatType] = useState<"weekly" | "monthly">("weekly");
  const [repeatCount, setRepeatCount] = useState(4);
  const [repeatPreview, setRepeatPreview] = useState<null | {
    dates: Array<{ date: string; available: boolean; reason: string | null }>;
    validCount: number;
    pricePerSession: number;
    totalPrice: number;
  }>(null);
  const [repeatCheckState, setRepeatCheckState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [repeatPreviewKey, setRepeatPreviewKey] = useState("");
  const [repeatError, setRepeatError] = useState("");
  const [createdRecurringGroupRef, setCreatedRecurringGroupRef] = useState<string | null>(null);
  const [createdRecurringOrders, setCreatedRecurringOrders] = useState<string[]>([]);
  const [createdRecurringSkipped, setCreatedRecurringSkipped] = useState<string[]>([]);
  const [createdRecurringTotal, setCreatedRecurringTotal] = useState(0);

  const { data: facilitiesData } = useListFacilities();
  const { data: customersData } = useListCustomers();

  const facilities = Array.isArray(facilitiesData) ? facilitiesData : [];
  const activeFacilities = facilities.filter((f: any) => f.isActive === true);
  const customers = Array.isArray(customersData) ? customersData : [];
  const isGuest = selectedCustomerId === "__guest__";
  const isPastGuest = selectedCustomerId !== "" && selectedCustomerId !== "__guest__" && Number(selectedCustomerId) < 0;
  const guestBooking = isGuest || isPastGuest;
  const selectedCustomer: any = customers.find((c: any) => String(c.id) === selectedCustomerId);
  const filteredCustomers = customers.filter((c: any) =>
    [c.name, c.phone, c.email].some((field) => String(field ?? "").toLocaleLowerCase("id-ID").includes(customerSearch.trim().toLocaleLowerCase("id-ID")))
  );
  const facility: any = facilities.find((f: any) => String(f.id) === selectedFacilityId);
  const isWalkIn = /gym|fitness/i.test(String(facility?.name ?? "") + " " + String(facility?.category ?? "")) || facility?.bookingMode === "walk_in";
  const selectedDate = bookingDay;
  const isMembership = bookingKind === "membership";
  const hideRegularBookingFields = isMembership && memberAction !== "new";
  const isCompanyPayer = bookingKind === "corporate" || (bookingKind === "event" && eventPayer === "corporate");
  const estimatedBase = Number(facility?.pricePerHour ?? 0) * (isWalkIn ? 1 : Number(duration));
  const estimatedEventDiscount = bookingKind === "event" ? Math.round(estimatedBase * 0.214) : 0;
  const estimatedBeforeTax = Math.max(0, estimatedBase - estimatedEventDiscount);
  const formatRupiah = (amount: number) => "Rp " + amount.toLocaleString("id-ID");
  const slotValid = isMembership || (isWalkIn ? Boolean(selectedDate) : slotState === "ready" && slotOptions.some((x) => x.available && x.time.slice(0, 5) === startTime.slice(11, 16)));
  const repeatCurrentKey = [selectedFacilityId, selectedDate, startTime.slice(11, 16), duration, repeatType, repeatCount].join("|");
  const repeatAllAvailable = Boolean(repeatPreview && repeatPreview.dates.length === repeatCount && repeatPreview.dates.every((row) => row.available));
  const repeatPreviewCurrent = repeatPreviewKey === repeatCurrentKey && repeatCheckState === "ready";
  const customerFormValid = isGuest
    ? Boolean(guestName.trim() && /^\\+?[0-9]{9,15}$/.test(guestPhone.replace(/[\\s()-]/g, "")))
    : Boolean(selectedCustomer?.name && selectedCustomer?.phone);
  const formPaymentValid = paymentChoice === "unpaid" ||
    (paymentChoice === "paid" && Boolean(paymentProof && bookingPaymentDate && bookingPaymentDate <= jakartaDateOnly() &&
      (paidMethod === "Transfer Bank" || paidMethod === "QRIS")));
  const repeatFormValid = !repeatEnabled ||
    (!isWalkIn && repeatCount >= 2 && repeatCount <= 52 && repeatPreviewCurrent && repeatAllAvailable);
  // bookingKind has a valid default; it is intentionally not an additional
  // explicit-completion requirement for enabling the submit button.
  const canSubmitBooking = Boolean(
    selectedCustomerId &&
    customerFormValid &&
    selectedFacilityId &&
    activeFacilities.some((item: any) => String(item.id) === selectedFacilityId) &&
    selectedDate &&
    slotValid &&
    !isSubmitting &&
    paymentChoice !== null &&
    formPaymentValid &&
    repeatFormValid &&
    (!isCompanyPayer || (paymentChoice === "unpaid" && !isGuest && selectedCustomer?.accountType === "company")) &&
    (isCompanyPayer || selectedCustomer?.accountType !== "company")
  );

  useEffect(() => {
    if (!selectedFacilityId || !selectedDate || isWalkIn || !Number.isInteger(Number(duration)) || Number(duration) < 1) {
      setSlotOptions([]);
      setSlotState("idle");
      return;
    }
    const controller = new AbortController();
    setSlotState("loading");
    const q = new URLSearchParams({ facilityId: selectedFacilityId, date: selectedDate, durationHours: duration });
    fetch("/api/availability?" + q.toString(), {
      headers: { Authorization: "Bearer " + (getToken() ?? "") },
      signal: controller.signal,
    }).then(async (r) => {
      if (!r.ok) throw Error("Slot tidak dapat diperiksa");
      return r.json();
    }).then((rows) => {
      if (!controller.signal.aborted) {
        setSlotOptions(Array.isArray(rows) ? rows : []);
        setSlotState("ready");
      }
    }).catch(() => {
      if (!controller.signal.aborted) setSlotState("error");
    });
    return () => controller.abort();
  }, [selectedFacilityId, selectedDate, duration, isWalkIn]);

  useEffect(() => {
    if (!repeatEnabled) {
      setRepeatPreview(null); setRepeatCheckState("idle"); setRepeatPreviewKey(""); setRepeatError("");
      return;
    }
    if (!selectedFacilityId || !selectedDate || !startTime || isWalkIn || !Number.isInteger(Number(duration)) || Number(duration) < 1) {
      setRepeatPreview(null); setRepeatCheckState("idle"); setRepeatPreviewKey("");
      return;
    }
    const controller = new AbortController();
    const previewKey = [selectedFacilityId, selectedDate, startTime.slice(11, 16), duration, repeatType, repeatCount].join("|");
    setRepeatCheckState("loading"); setRepeatPreview(null); setRepeatPreviewKey(""); setRepeatError("");
    fetch("/api/bookings/recurring/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (getToken() ?? "") },
      body: JSON.stringify({
        facilityId: Number(selectedFacilityId), startDate: selectedDate, startTime: startTime.slice(11, 16),
        durationHours: Number(duration), repeatType, repeatCount,
      }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Preview jadwal berulang gagal diperiksa");
      return data;
    }).then((data) => {
      if (controller.signal.aborted) return;
      setRepeatPreview({
        dates: Array.isArray(data.dates) ? data.dates : [],
        validCount: Number(data.validCount ?? 0),
        pricePerSession: Number(data.pricePerSession ?? 0),
        totalPrice: Number(data.totalPrice ?? 0),
      });
      setRepeatPreviewKey(previewKey); setRepeatCheckState("ready");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setRepeatError(error instanceof Error ? error.message : "Preview jadwal berulang gagal diperiksa");
      setRepeatCheckState("error"); setRepeatPreview(null); setRepeatPreviewKey("");
    });
    return () => controller.abort();
  }, [repeatEnabled, selectedFacilityId, selectedDate, startTime, duration, repeatType, repeatCount, isWalkIn]);

  useEffect(() => {
    if (!isMembership) return;
    let active = true;
    fetch("/api/memberships", {headers:{Authorization: "Bearer " + (getToken() ?? "")}})
      .then(async r => { if (!r.ok) throw Error("Tidak dapat membaca daftar membership"); return r.json(); })
      .then(rows => { if(active) {setMembers(Array.isArray(rows) ? rows : []); setMemberLoadError("");} })
      .catch(e => {if(active) setMemberLoadError(String(e.message || e));});
    return () => {active = false;};
  }, [isMembership]);
  const matchedMember = members.find(m => String(m.id) === memberId);
  const membershipReady = memberAction === "new"
    ? Boolean((isGuest ? guestName : selectedCustomer?.name)?.trim() && (isGuest ? guestPhone : selectedCustomer?.phone)?.trim()
      && (isGuest ? guestEmail : selectedCustomer?.email)?.trim() && selectedDate && selectedCustomerId)
    : Boolean(matchedMember && !memberLoadError && (memberAction !== "checkin" || matchedMember.status === "active"));
  async function submitMembership() {
    if (!membershipReady || isSubmitting) return;
    setIsSubmitting(true);
    setMembershipResult("");
    try {
      const endpoint = memberAction === "new" ? "/api/memberships"
        : "/api/memberships/" + memberId + (memberAction === "renew" ? "/renew" : "/checkin");
      const payload = memberAction === "new"
        ? {name:isGuest ? guestName.trim() : selectedCustomer.name,
           phone:isGuest ? guestPhone.trim() : selectedCustomer.phone,
           email:isGuest ? guestEmail.trim() : selectedCustomer.email,
           startDate:selectedDate, months:Number(memberMonths), notes}
        : memberAction === "renew" ? {months:Number(memberMonths)}
          : {checkinDate:selectedDate, notes};
      const response = await fetch(endpoint, {method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer " + (getToken() ?? "")},body:JSON.stringify(payload)});
      const data = await response.json();
      if(!response.ok) throw Error(data.error || "Proses membership gagal");
      if (memberAction !== "checkin" && Number.isInteger(Number(data.id)) && Number(data.id) > 0) {
        const target = memberAction === "renew"
          ? {
              membershipId: Number(data.id),
              action: "renew" as const,
              name: String(data.name ?? matchedMember?.name ?? "Member"),
              periodStart: String(data.renewal?.periodStart ?? renewalStartDate ?? ""),
              periodEnd: String(data.renewal?.periodEnd ?? renewalEndDate ?? ""),
              amount: Number(data.renewal?.amount ?? membershipCharge),
            }
          : {
              membershipId: Number(data.id),
              action: "new" as const,
              name: String(data.name ?? (isGuest ? guestName : selectedCustomer?.name) ?? "Member"),
              periodStart: String(data.startDate ?? selectedDate ?? ""),
              periodEnd: String(data.endDate ?? ""),
              amount: Number(data.totalPrice ?? Number(memberMonths) * 300000),
            };
        setMembershipPaymentTarget(target);
        setMembershipPaymentMethod("qris");
        setMembershipPaymentDate(jakartaDateOnly());
        setMembershipPaymentFile(null);
        setMembershipPaymentDone(false);
        setMembershipResult(memberAction === "renew"
          ? "Perpanjangan berhasil dibuat. Selesaikan pembayaran di bawah ini."
          : "Member berhasil didaftarkan. Selesaikan pembayaran di bawah ini.");
        toast({title:memberAction === "renew" ? "Perpanjangan dibuat" : "Member didaftarkan",description:"Lanjutkan pembayaran pada halaman ini."});
        return;
      }
      setMembershipResult("Kunjungan berhasil dicatat tanpa tagihan baru.");
      toast({title:"Berhasil",description:"Kunjungan member berhasil dicatat."});
    } catch(e) {toast({title:"Membership gagal",description:e instanceof Error ? e.message : "Terjadi kesalahan",variant:"destructive"});}
    finally {setIsSubmitting(false);}
  }

  async function submitMembershipPaymentInline() {
    if (!membershipPaymentTarget || (!membershipPaymentFile && !membershipProofUploaded) || membershipPaymentBusy || membershipPaymentDone) return;
    setMembershipPaymentBusy(true);
    try {
      const token = getToken();
      const form = new FormData();
      if (membershipPaymentFile) form.append("proof", membershipPaymentFile);
      form.append("paymentMethod", membershipPaymentMethod);
      form.append("paymentDate", membershipPaymentDate);
      if (!membershipProofUploaded) {
        const uploaded = await fetch(`/api/memberships/${membershipPaymentTarget.membershipId}/admin-payment-proof-upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token ?? ""}` },
          body: form,
        });
        const uploadResult = await uploaded.json();
        if (!uploaded.ok) throw Error(uploadResult.error || "Upload bukti pembayaran gagal");
        setMembershipProofUploaded(true);
      }

      const role = getCurrentRole();
      if (role && role !== "staff") {
        const confirmed = await fetch(`/api/memberships/${membershipPaymentTarget.membershipId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "active", settlementProviderCode: "mandiri_direct" }),
        });
        const confirmedResult = await confirmed.json();
        if (!confirmed.ok) throw Error(confirmedResult.error || "Bukti tersimpan, tetapi konfirmasi membership gagal");
        setMembershipPaymentDone(true);
        setMembershipResult(membershipPaymentTarget.action === "renew"
          ? "Pembayaran dikonfirmasi. Perpanjangan membership selesai."
          : "Pembayaran dikonfirmasi. Member baru sudah aktif.");
        toast({
          title: "Pembayaran dikonfirmasi",
          description: membershipPaymentTarget.action === "renew"
            ? "Perpanjangan membership selesai."
            : "Pendaftaran member dan pembayaran selesai.",
        });
      } else {
        setMembershipPaymentDone(true);
        setMembershipResult("Bukti pembayaran berhasil dikirim dan menunggu verifikasi.");
        toast({title:"Bukti pembayaran dikirim",description:"Menunggu verifikasi oleh admin/finance."});
      }
      setMembershipPaymentFile(null);
    } catch (err) {
      toast({
        title: "Pembayaran membership gagal",
        description: err instanceof Error ? err.message : "Silakan periksa kembali bukti pembayaran",
        variant: "destructive",
      });
    } finally {
      setMembershipPaymentBusy(false);
    }
  }

  async function recordBookingPayment(
    bookingId: number,
    amount: number,
    proof: File,
    paymentDate: string,
    method: string,
  ): Promise<boolean> {
    if (!bookingId || !(amount > 0) || !proof || !paymentDate || paymentBusy) return false;
    setPaymentBusy(true);
    setCreatedPaymentError("");
    try {
      const headers = { Authorization: "Bearer " + (getToken() ?? "") };
      let paymentId = createdPaymentId;

      // If the payment row already exists but confirmation failed, retry only
      // the confirmation. Never create a second financial payment row.
      if (!paymentId) {
        const fileForm = new FormData();
        fileForm.append("proof", proof);
        const uploaded = await fetch("/api/payments/proof-upload", { method: "POST", headers, body: fileForm });
        const fileResult = await uploaded.json();
        if (!uploaded.ok) throw Error(fileResult.error || "Upload bukti gagal");

        const detected = String(fileResult.ocrScan?.paymentMethod ?? "").toLowerCase();
        if (fileResult.ocrScan?.confidence === "high" && detected &&
          ((detected === "qris") !== (method === "QRIS"))) {
          throw Error("Metode terpilih tidak sesuai OCR. Periksa bukti lalu pilih metode yang benar.");
        }

        const payload = {
          bookingId,
          amount,
          paymentType: "full_payment",
          paymentMethod: method,
          ...(method === "QRIS" ? { paymentProvider: "mandiri_direct" } : {}),
          paymentDate,
          proofUrl: fileResult.objectPath ?? fileResult.url,
          ocrScanToken: fileResult.ocrScanToken,
        };
        const saved = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload),
        });
        const result = await saved.json();
        if (!saved.ok) throw Error(result.error || "Gagal mencatat pembayaran");
        paymentId = Number(result.id);
        if (!Number.isInteger(paymentId) || paymentId <= 0) {
          throw Error("Bukti terkirim, tetapi ID pembayaran tidak diterima. Periksa Detail Pemesanan sebelum mengirim ulang.");
        }
        setCreatedPaymentId(paymentId);
      }

      const currentRole = getCurrentRole();
      if (currentRole && currentRole !== "staff") {
        const confirmed = await fetch(`/api/payments/${paymentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ status: "confirmed" }),
        });
        const confirmedResult = await confirmed.json();
        if (!confirmed.ok) throw Error(confirmedResult.error || "Bukti tersimpan, tetapi konfirmasi pembayaran gagal");
        setPaymentSubmitted(true);
        toast({ title: "Pembayaran dikonfirmasi", description: "Satu pembayaran tercatat untuk booking/grup." });
      } else {
        setPaymentSubmitted(true);
        toast({ title: "Bukti pembayaran dicatat", description: "Menunggu verifikasi admin/finance." });
      }
      setCreatedPaymentError("");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Silakan periksa bukti pembayaran.";
      setCreatedPaymentError(message);
      toast({ title: "Booking dibuat, pembayaran perlu diperiksa", description: message, variant: "destructive" });
      return false;
    } finally {
      setPaymentBusy(false);
    }
  }


  // Auto-compute endTime whenever startTime or duration changes
  const computedEndTime = (() => {
    if (!startTime) return "";
    const dt = new Date(startTime);
    dt.setHours(dt.getHours() + Number(duration || 1));
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const h = String(dt.getHours()).padStart(2, "0");
    const mi = String(dt.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${d}T${h}:${mi}`;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (bookingKind === "membership") {
      setLocation("/admin/memberships");
      return;
    }
    if (!selectedCustomerId) {
      toast({ title: "Pilih customer terlebih dahulu", variant: "destructive" });
      return;
    }
    if (isGuest && (!guestName.trim() || !/^\+?[0-9]{9,15}$/.test(guestPhone.replace(/[\s()-]/g, "")))) {
      toast({ title: "Nama dan nomor WhatsApp tamu wajib valid", variant: "destructive" });
      return;
    }
    if (!selectedFacilityId) {
      toast({ title: "Pilih fasilitas terlebih dahulu", variant: "destructive" });
      return;
    }
    if (!activeFacilities.some((f: any) => String(f.id) === selectedFacilityId)) {
      toast({ title: "Fasilitas sedang maintenance atau tidak tersedia untuk booking", variant: "destructive" });
      return;
    }
    if (!selectedDate || (!isWalkIn && !startTime)) {
      toast({ title: "Pilih tanggal dan jam booking", variant: "destructive" });
      return;
    }

    if (!slotValid) {
      toast({ title: "Slot tidak tersedia atau belum diperiksa", variant: "destructive" });
      return;
    }
    if (paymentChoice !== "paid" && paymentChoice !== "unpaid") {
      toast({ title: "Pilih Sudah Bayar atau Belum Bayar", variant: "destructive" });
      return;
    }
    if (isCompanyPayer && paymentChoice === "paid") {
      toast({ title: "Pembayaran perusahaan mengikuti proses invoice", description: "Pilih Belum Bayar untuk membuat booking perusahaan.", variant: "destructive" });
      return;
    }
    if (paymentChoice === "paid" && (!paymentProof || !bookingPaymentDate || bookingPaymentDate > jakartaDateOnly())) {
      toast({ title: "Bukti pembayaran dan tanggal transaksi wajib diisi dengan benar", variant: "destructive" });
      return;
    }
    const corporate = bookingKind === "corporate" || (bookingKind === "event" && eventPayer === "corporate");
    if (!corporate && selectedCustomer?.accountType === "company") {
      toast({ title: "Untuk akun perusahaan, pilih jenis Corporate atau pembayar perusahaan", variant: "destructive" });
      return;
    }
    if (corporate && (isGuest || selectedCustomer?.accountType !== "company")) {
      toast({ title: "Pilih akun perusahaan yang terdaftar", variant: "destructive" });
      return;
    }
    if (!guestBooking && Number(selectedCustomerId) <= 0) {
      toast({ title: "Pilih customer yang terdaftar; data tamu perlu didaftarkan terlebih dahulu", variant: "destructive" });
      return;
    }
    if (!isGuest && (!selectedCustomer?.name || !selectedCustomer?.phone)) {
      toast({ title: "Customer harus memiliki nama dan nomor WhatsApp", variant: "destructive" });
      return;
    }
    if (repeatEnabled) {
      if (isWalkIn) { toast({ title: "Booking berulang hanya tersedia untuk fasilitas dengan slot waktu", variant: "destructive" }); return; }
      if (repeatCount < 2 || repeatCount > 52) { toast({ title: "Jumlah sesi berulang harus antara 2 sampai 52", variant: "destructive" }); return; }
      if (!repeatPreviewCurrent || !repeatPreview) { toast({ title: "Preview jadwal berulang belum siap", description: "Tunggu pemeriksaan semua tanggal selesai sebelum menyimpan.", variant: "destructive" }); return; }
      if (!repeatAllAvailable) {
        const unavailable = repeatPreview.dates.filter((row) => !row.available).map((row) => row.date);
        toast({ title: "Ada jadwal yang bentrok atau tidak tersedia", description: unavailable.join(", ") || "Periksa kembali preview jadwal.", variant: "destructive" });
        return;
      }
    }
    setIsSubmitting(true);
    try {
      const bookingPayload = {
        customerId: guestBooking ? null : Number(selectedCustomerId),
        customerName: isGuest ? guestName.trim() : selectedCustomer.name,
        customerPhone: isGuest ? guestPhone.trim() : selectedCustomer.phone,
        customerEmail: isGuest ? guestEmail.trim() : (selectedCustomer.email ?? ""),
        facilityId: Number(selectedFacilityId),
        ...(!isWalkIn ? { startTime: startTime.slice(11, 16), durationHours: Number(duration) } : { numberOfPeople: 1 }),
        bookingType: bookingKind === "event" ? "event" : "regular",
        payerType: corporate ? "company" : "personal",
        ...(corporate ? { companyCustomerId: Number(selectedCustomerId) } : {}),
        source: "admin",
        adminPaymentChoice: paymentChoice,
        notes: notes || undefined,
      };
      const res = repeatEnabled
        ? await fetch("/api/bookings/recurring", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
            body: JSON.stringify({
              ...bookingPayload, startDate: selectedDate, repeatType, repeatCount,
              specificDates: repeatPreview!.dates.map((row) => row.date),
            }),
          })
        : await fetch("/api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
            body: JSON.stringify({ ...bookingPayload, bookingDate: selectedDate }),
          });

      const data = await res.json();

      if (!res.ok) {
        toast({ title: "Booking gagal", description: data.error ?? "Terjadi kesalahan", variant: "destructive" });
        return;
      }

      if (repeatEnabled) {
        const createdRows = Array.isArray(data.created) ? data.created : [];
        const orders = createdRows.map((row: any) => String(row.orderNumber ?? "").trim()).filter(Boolean);
        if (orders.length === 0) {
          toast({
            title: "Tidak ada sesi booking yang berhasil dibuat",
            description: Array.isArray(data.skipped) && data.skipped.length ? `Jadwal dilewati: ${data.skipped.join(", ")}` : "Periksa kembali ketersediaan jadwal.",
            variant: "destructive",
          });
          return;
        }
        const firstCreatedBookingId = Number(createdRows[0]?.id);
        const actualGroupTotal = Number(data.grandTotal ?? repeatPreview?.totalPrice ?? 0);
        if (!Number.isInteger(firstCreatedBookingId) || firstCreatedBookingId <= 0) {
          toast({ title: "Booking tersimpan, ID booking tidak diterima", description: "Periksa menu Pemesanan sebelum mengulang pembuatan agar tidak duplikat.", variant: "destructive" });
          return;
        }
        setCreatedRecurringOrders(orders);
        setCreatedRecurringGroupRef(typeof data.groupRef === "string" ? data.groupRef : null);
        setCreatedRecurringSkipped(Array.isArray(data.skipped) ? data.skipped : []);
        setCreatedRecurringTotal(actualGroupTotal);
        setCreatedBookingId(firstCreatedBookingId);
        setCreatedBookingAmount(actualGroupTotal);
        setCreatedOrder(orders[0]);
        setPaymentSubmitted(false);
        setCreatedPaymentId(null);
        if (paymentChoice === "paid" && paymentProof) {
          await recordBookingPayment(firstCreatedBookingId, actualGroupTotal, paymentProof, bookingPaymentDate, paidMethod);
        } else {
          toast({ title: `${orders.length} sesi booking berhasil dibuat`, description: data.groupRef ? `Grup ${data.groupRef} dibuat; belum ada record pembayaran.` : "Booking dibuat tanpa pembayaran." });
        }
        return;
      }

      // POST /api/bookings returns the created booking at the response root.
      // Support nested responses for compatibility, but never show Order: undefined.
      const created = data.booking ?? data;
      const order = typeof created.orderNumber === "string" ? created.orderNumber.trim() : "";
      const bookingId = Number(created.id);
      if (!order || !Number.isInteger(bookingId) || bookingId <= 0) {
        toast({ title: "Booking tersimpan, respons nomor order tidak lengkap", description: "Periksa menu Pemesanan sebelum mencoba lagi agar tidak membuat booking ganda.", variant: "destructive" });
        return;
      }
      const actualBookingAmount = Number(created.grandTotal ?? created.totalPrice ?? 0);
      setCreatedOrder(order);
      setCreatedBookingId(bookingId);
      setCreatedBookingAmount(actualBookingAmount);
      setPaymentSubmitted(false);
      setCreatedPaymentId(null);
      if (paymentChoice === "paid" && paymentProof) {
        await recordBookingPayment(bookingId, actualBookingAmount, paymentProof, bookingPaymentDate, paidMethod);
      } else {
        toast({ title: "Booking berhasil dibuat!", description: `Order: ${order}. Status: belum dibayar; belum ada record pembayaran.` });
      }

      // Reset form
      setSelectedCustomerId("");
      setGuestName("");
      setGuestPhone("");
      setGuestEmail("");
      setSelectedFacilityId("");
      setStartTime("");
      setBookingDay("");
      setEndTime("");
      setDuration("1");

      setNotes("");
    } catch {
      toast({ title: "Gagal menghubungi server", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdOrder && createdRecurringOrders.length > 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="text-green-600 w-10 h-10" />
          </div>
          <h2 className="text-2xl font-black">Booking Berulang Berhasil Dibuat</h2>
          <p className="text-muted-foreground">{createdRecurringOrders.length} sesi berhasil dibuat.</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Ringkasan Grup Booking</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {createdRecurringGroupRef && <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Group ID</span><strong className="font-mono">{createdRecurringGroupRef}</strong></div>}
            <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Total seluruh sesi</span><strong>{formatRupiah(createdRecurringTotal)}</strong></div>
            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-semibold">Nomor booking</p>
              {createdRecurringOrders.map((order) => <div key={order} className="flex items-center justify-between rounded-md border px-3 py-2"><span className="font-mono font-semibold">{order}</span><span className="text-xs text-green-700">Dibuat</span></div>)}
            </div>
            {createdRecurringSkipped.length > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold flex items-center gap-2"><XCircle size={15} /> Sebagian tanggal tidak dibuat</p><p className="mt-1">Periksa tanggal berikut: {createdRecurringSkipped.join(", ")}</p></div>}
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-semibold text-sm">Status pembayaran</p>
              {paymentChoice === "unpaid" ? (
                <p className="text-sm text-muted-foreground">Belum dibayar. Tidak ada record pembayaran yang dibuat. Pembayaran dapat dikelola kemudian dari menu Pemesanan.</p>
              ) : paymentSubmitted ? (
                <p className="text-sm font-medium text-green-700">{getCurrentRole() === "staff" ? "Bukti tercatat dan menunggu verifikasi admin/finance." : "Bukti tercatat dan pembayaran dikonfirmasi."}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-amber-700">Booking sudah dibuat, tetapi pembayaran belum selesai diproses. Periksa Detail Pemesanan sebelum mencoba mengirim ulang.</p>
                  {createdPaymentError && <p className="text-xs text-destructive">{createdPaymentError}</p>}
                  <Button type="button" variant="outline" onClick={() => setLocation(`/admin/bookings?search=${encodeURIComponent(createdOrder ?? "")}`)}>Periksa Detail Pemesanan</Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Untuk grup, satu bukti pembayaran dicatat terhadap satu booking perwakilan; alokasi dan tagihan dihitung untuk seluruh Group ID.</p>
            </div>
          </CardContent>
          <CardFooter><Button type="button" onClick={() => setLocation("/admin/bookings")}>Buka Pemesanan</Button></CardFooter>
        </Card>
      </div>
    );
  }

  if (createdOrder) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="text-green-600 w-10 h-10" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-black mb-1">Booking Berhasil!</h2>
          <p className="text-muted-foreground">Order <span className="font-semibold text-foreground">{createdOrder}</span> telah dibuat.</p>
        </div>
        <div className="w-full max-w-xl rounded-xl border p-4 space-y-3">
          <p className="font-semibold">Status pembayaran</p>
          {paymentChoice === "unpaid" ? (
            <p className="text-sm text-muted-foreground">Belum dibayar. Tidak ada record pembayaran yang dibuat.</p>
          ) : paymentSubmitted ? (
            <p className="text-sm font-medium text-green-700">{getCurrentRole() === "staff" ? "Bukti tercatat dan menunggu verifikasi admin/finance." : "Bukti tercatat dan pembayaran dikonfirmasi."}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-amber-700">Booking berhasil dibuat tetapi pembayaran belum selesai. Periksa Detail Pemesanan sebelum mengirim ulang.</p>
              {createdPaymentError && <p className="text-xs text-destructive">{createdPaymentError}</p>}
              <Button type="button" variant="outline" onClick={() => setLocation(`/admin/bookings?search=${encodeURIComponent(createdOrder ?? "")}`)}>Periksa Detail Pemesanan</Button>
            </div>
          )}

        </div>
        <div className="flex gap-3 flex-wrap justify-center">
          {(paymentChoice === "unpaid" || (paymentSubmitted && getCurrentRole()==="staff")) && (
            <Button onClick={() => setLocation(`/admin/bookings?search=${encodeURIComponent(createdOrder)}`)}>
              {paymentSubmitted ? "Lihat & Konfirmasi Pembayaran" : "Kelola Pembayaran"}
            </Button>
          )}
          <Button variant="outline" onClick={() => setLocation("/admin/bookings")}>Kembali ke Pemesanan</Button>
        </div>
      </div>
    );
  }

  const renewalPeriodPreview = (() => {
    if (memberAction !== "renew" || !matchedMember?.endDate) return { start: "", end: "" };
    const currentEnd = new Date(String(matchedMember.endDate) + "T00:00:00");
    if (Number.isNaN(currentEnd.getTime())) return { start: "", end: "" };
    const start = new Date(currentEnd);
    start.setDate(start.getDate() + 1);
    const months = Number(memberMonths || 1);
    const targetYear = start.getFullYear() + Math.floor((start.getMonth() + months) / 12);
    const targetMonth = (start.getMonth() + months) % 12;
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    const end = new Date(targetYear, targetMonth, Math.min(start.getDate(), lastDay));
    return {
      start: start.toLocaleDateString("id-ID", {day:"2-digit", month:"short", year:"numeric"}),
      end: end.toLocaleDateString("id-ID", {day:"2-digit", month:"short", year:"numeric"}),
    };
  })();
  const renewalStartDate = renewalPeriodPreview.start;
  const renewalEndDate = renewalPeriodPreview.end;
  const membershipCharge = 300000 * Number(memberMonths || 1);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-8">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-0.5 shrink-0"
            onClick={() => setLocation("/admin/bookings")}
            aria-label="Kembali ke halaman Pemesanan"
            title="Kembali ke Pemesanan"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
              <ShoppingCart className="text-primary w-8 h-8" />
              Buat Booking (Admin)
            </h1>
            <p className="text-muted-foreground mt-1">Booking melalui validasi jadwal, harga, pajak dan status pembayaran pada layanan utama.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Detail Booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {!hideRegularBookingFields && <>
            {/* Customer */}
            <div className="space-y-2">
              <Label htmlFor="customer">Nama Pemesan <span className="text-destructive">*</span></Label>
              <Select value={selectedCustomerId} onValueChange={(value) => { setSelectedCustomerId(value); setCustomerSearch(""); }}>
                <SelectTrigger id="customer">
                  <SelectValue placeholder="Pilih customer..." />
                </SelectTrigger>
                <SelectContent>
                  <div className="sticky top-0 z-10 bg-popover px-2 pb-2 pt-2" onKeyDown={(e) => e.stopPropagation()}>
                    <Input autoFocus aria-label="Cari nama atau nomor telepon pemesan" placeholder="Cari nama / nomor telepon..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
                  </div>
                  {customers.length === 0 && (
                    <SelectItem value="__empty__" disabled>Tidak ada customer terdaftar</SelectItem>
                  )}
                  <SelectItem value="__guest__">+ Pemesan belum terdaftar (Tamu)</SelectItem>
                  {filteredCustomers.length === 0 && customers.length > 0 && (
                    <SelectItem value="__no_matches__" disabled>Tidak ada pemesan yang cocok</SelectItem>
                  )}
                  {filteredCustomers.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}{c.phone ? ` (${c.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isGuest && <div className="space-y-3 rounded-lg border p-3">
              <Label htmlFor="guestName">Nama Pemesan Baru *</Label>
              <Input id="guestName" value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
              <Label htmlFor="guestPhone">Nomor WhatsApp *</Label>
              <Input id="guestPhone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} required />
              <Label htmlFor="guestEmail">Email (opsional)</Label>
              <Input id="guestEmail" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">Pemesan tamu disimpan di booking; akun tidak otomatis dibuat.</p>
            </div>}
            {!isGuest && selectedCustomer && <div className="space-y-2">
              <Label>Nomor Telepon / WhatsApp</Label>
              <Input value={selectedCustomer.phone ?? ""} readOnly />
            </div>}
            {/* Facility */}
            <div className="space-y-2">
              <Label htmlFor="facility">Fasilitas <span className="text-destructive">*</span></Label>
              <Select value={selectedFacilityId} onValueChange={(value) => { setSelectedFacilityId(value); setStartTime(""); }}>
                <SelectTrigger id="facility">
                  <SelectValue placeholder="Pilih fasilitas..." />
                </SelectTrigger>
                <SelectContent>
                  {activeFacilities.map((f: any) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name} — Rp {Number(f.pricePerHour).toLocaleString("id-ID")}{/gym|fitness/i.test(String(f.name ?? "") + " " + String(f.category ?? "")) || f.bookingMode === "walk_in" ? "/kunjungan" : "/jam"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Booking date and duration: Gym is per visit, not hourly. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bookingDate">Tanggal Booking *</Label>
                <Input id="bookingDate" type="date" value={bookingDay}
                  onChange={(e) => { setBookingDay(e.target.value); setStartTime(""); }} required={bookingKind !== "membership"} />
              </div>
              {!isWalkIn && <div className="space-y-2">
                <Label htmlFor="duration">Durasi (jam) *</Label>
                <Select value={duration} onValueChange={(v) => { setDuration(v); setStartTime(""); }}>
                  <SelectTrigger id="duration"><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({length: 12}, (_, i) => i + 1).map((n) =>
                    <SelectItem key={n} value={String(n)}>{n} jam</SelectItem>)}</SelectContent>
                </Select>
              </div>}
            </div>
            {isWalkIn && <p className="text-sm text-muted-foreground rounded-lg border p-3">
              Gym reguler menggunakan tarif per kunjungan, tanpa durasi atau pilihan slot jam.
              Member Gym menggunakan alur Membership terpisah agar kunjungan tidak ditagih ulang.
            </p>}
            </>}
            {!isMembership && !isWalkIn && selectedFacilityId && selectedDate && <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Pilih Jam Mulai</Label>
                <span className="text-xs text-muted-foreground">Durasi {duration} jam</span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>● Tersedia</span><span>◯ Tidak tersedia</span><span className="text-orange-600">● Dipilih</span>
              </div>
              {slotState === "loading" && <p className="text-sm">Memeriksa ketersediaan...</p>}
              {slotState === "error" && <p className="text-sm text-destructive">Pemeriksaan gagal; booking tidak dapat disimpan.</p>}
              {slotState === "ready" && <div className="space-y-3">
                {[
                  { label: "Pagi", rows: slotOptions.filter((x) => Number(x.time.slice(0,2)) < 12) },
                  { label: "Siang", rows: slotOptions.filter((x) => Number(x.time.slice(0,2)) >= 12 && Number(x.time.slice(0,2)) < 17) },
                  { label: "Sore & Malam", rows: slotOptions.filter((x) => Number(x.time.slice(0,2)) >= 17) },
                ].filter((section) => section.rows.length > 0).map((section) => <div key={section.label}>
                  <p className="text-xs font-medium text-muted-foreground mb-2">{section.label}</p>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {section.rows.map((slot) => <Button key={slot.time} type="button" size="sm"
                      disabled={!slot.available} title={slot.reason ?? (slot.available ? "Tersedia" : "Tidak tersedia")}
                      className={startTime.slice(11,16) === slot.time.slice(0,5) ? "bg-orange-500 hover:bg-orange-600 text-white" : ""}
                      variant={startTime.slice(11,16) === slot.time.slice(0,5) ? "default" : "outline"}
                      onClick={() => setStartTime(selectedDate + "T" + slot.time.slice(0,5))}>
                      {slot.time.slice(0,5)}
                    </Button>)}
                  </div>
                </div>)}
                {slotOptions.length === 0 && <p className="text-sm">Tidak ada slot dalam jam operasional.</p>}
              </div>}
              <p className="text-xs text-muted-foreground">Status slot dihitung untuk seluruh durasi. Server memeriksa ulang saat menyimpan.</p>
            </div>}
            {!isMembership && !isWalkIn && selectedFacilityId && selectedDate && startTime && (
              <div className={repeatEnabled ? "rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-4" : "rounded-lg border p-4 space-y-3"}>
                <div className="flex items-start gap-3">
                  <Checkbox id="admin-repeat-booking" checked={repeatEnabled} onCheckedChange={(checked) => setRepeatEnabled(Boolean(checked))} />
                  <div className="space-y-1">
                    <Label htmlFor="admin-repeat-booking" className="font-semibold flex items-center gap-2 cursor-pointer"><RefreshCw size={16} /> Booking Berulang</Label>
                    <p className="text-xs text-muted-foreground">Buat beberapa sesi dengan fasilitas, hari, dan jam yang sama dalam satu grup booking.</p>
                  </div>
                </div>
                {repeatEnabled && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Tipe Pengulangan</Label>
                        <Select value={repeatType} onValueChange={(value: "weekly" | "monthly") => setRepeatType(value)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="weekly">Mingguan (setiap hari yang sama)</SelectItem>
                            <SelectItem value="monthly">Bulanan (tanggal yang sama)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="admin-repeat-count">Jumlah Sesi (termasuk tanggal pertama)</Label>
                        <Input id="admin-repeat-count" type="number" min={2} max={52} value={repeatCount}
                          onChange={(event) => setRepeatCount(Math.min(52, Math.max(2, Number.parseInt(event.target.value, 10) || 2)))} />
                      </div>
                    </div>
                    <div className="rounded-md bg-background border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold flex items-center gap-2"><CalendarDays size={15} /> Preview Jadwal</p>
                        {repeatCheckState === "loading" && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Memeriksa...</span>}
                        {repeatCheckState === "ready" && repeatPreviewCurrent && <span className={repeatAllAvailable ? "text-xs font-semibold text-green-700" : "text-xs font-semibold text-amber-700"}>{repeatPreview?.validCount ?? 0}/{repeatPreview?.dates.length ?? 0} tersedia</span>}
                      </div>
                      {repeatCheckState === "error" && <p className="text-sm text-destructive">{repeatError}</p>}
                      {repeatCheckState === "idle" && <p className="text-sm text-muted-foreground">Pilih tanggal dan jam mulai untuk memeriksa sesi.</p>}
                      {repeatPreview && repeatPreviewCurrent && (
                        <div className="space-y-1.5">
                          {repeatPreview.dates.map((row) => (
                            <div key={row.date} className="flex items-center justify-between gap-3 text-sm border-b last:border-0 py-1.5">
                              <span>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(row.date + "T12:00:00+07:00"))}</span>
                              {row.available ? <span className="text-green-700 font-medium">Tersedia</span> : <span className="text-red-700 font-medium text-right">{row.reason || "Tidak tersedia"}</span>}
                            </div>
                          ))}
                          <div className="flex items-center justify-between gap-3 border-t pt-2 text-sm"><span>Estimasi subtotal seluruh sesi</span><strong>{formatRupiah(repeatPreview.totalPrice)}</strong></div>
                          <p className="text-xs text-muted-foreground">Harga akhir dan pajak dihitung ulang server. Preview tidak menyimpan booking.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Jenis pemesanan</Label>
              <Select value={bookingKind} onValueChange={setBookingKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal / Umum</SelectItem>
                  <SelectItem value="corporate">Perusahaan / Corporate</SelectItem>
                  <SelectItem value="membership">Membership Gym</SelectItem>
                  <SelectItem value="event">Event / Grup</SelectItem>
                </SelectContent>
              </Select>
              {bookingKind === "event" && <Select value={eventPayer} onValueChange={setEventPayer}>
                <SelectTrigger><SelectValue placeholder="Pihak pembayar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Dibayar personal</SelectItem>
                  <SelectItem value="corporate">Dibayar perusahaan</SelectItem>
                </SelectContent>
              </Select>}
              {!isMembership && <p className="text-xs text-muted-foreground">{isCompanyPayer ? "Penagihan mengikuti status approval dan konfigurasi invoice perusahaan; bukan otomatis menunggu pembayaran." : "Booking belum dianggap lunas. Bukti pembayaran perlu diverifikasi sebelum konfirmasi."}</p>}
              {bookingKind === "event" && <p className="text-xs text-amber-700">Alur ini untuk satu sesi event. Booking grup multi-sesi harus menggunakan alur grup khusus.</p>}
              {isMembership && <p className="text-xs text-muted-foreground">Kelola pendaftaran, perpanjangan, pembayaran, atau kunjungan member langsung dari halaman ini.</p>}
            </div>

            {!isMembership && selectedFacilityId && selectedDate &&
              (repeatEnabled ? (repeatPreviewCurrent && Boolean(repeatPreview)) : (isWalkIn || slotValid)) && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
                <p className="font-semibold">Ringkasan Booking</p>
                {repeatEnabled && repeatPreview ? (
                  <>
                    <p>{facility?.name} · {startTime.slice(11,16)} – {computedEndTime.slice(11,16)} · {duration} jam per sesi</p>
                    <div className="flex justify-between gap-3"><span>Tarif per sesi</span><strong>{formatRupiah(repeatPreview.pricePerSession)}</strong></div>
                    <div className="flex justify-between gap-3"><span>Jumlah sesi</span><strong>{repeatCount} sesi ({repeatType === "weekly" ? "mingguan" : "bulanan"})</strong></div>
                    <div className="border-t pt-2 space-y-1.5">
                      <p className="font-medium">Jadwal seluruh sesi</p>
                      {repeatPreview.dates.map((row) => (
                        <div key={row.date} className="flex items-center justify-between gap-3 text-xs">
                          <span>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(row.date + "T12:00:00+07:00"))}</span>
                          <span className={row.available ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                            {row.available ? "Tersedia" : (row.reason || "Tidak tersedia")}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between gap-3 border-t pt-2"><span>{repeatAllAvailable ? "Subtotal seluruh sesi" : "Subtotal jika semua sesi tersedia"}</span><strong>{formatRupiah(repeatPreview.pricePerSession * repeatCount)}</strong></div>
                    {bookingKind === "event" && (
                      <div className="flex justify-between gap-3"><span>Estimasi diskon event (21,4%)</span><span>− {formatRupiah(Math.round(repeatPreview.pricePerSession * 0.214) * repeatCount)}</span></div>
                    )}
                    <div className="flex justify-between gap-3 font-semibold text-base">
                      <span>{isCompanyPayer ? "Estimasi sebelum pajak perusahaan" : repeatAllAvailable ? "Estimasi Total Pembayaran" : "Estimasi total jika semua sesi tersedia"}</span>
                      <strong>{formatRupiah(Math.max(0, repeatPreview.pricePerSession * repeatCount - (bookingKind === "event" ? Math.round(repeatPreview.pricePerSession * 0.214) * repeatCount : 0)))}</strong>
                    </div>
                    {!repeatAllAvailable && (
                      <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                        Ada tanggal yang belum tersedia. Booking belum dapat disimpan sampai seluruh sesi lolos pemeriksaan.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {isCompanyPayer
                        ? "Estimasi ini belum termasuk perhitungan pajak dan potongan perusahaan. Nilai final dihitung server untuk setiap sesi."
                        : "Pajak Personal/Umum Rp0. Estimasi berdasarkan tarif dan diskon yang berlaku; server memeriksa ulang ketersediaan dan menghitung nilai final saat disimpan."}
                    </p>
                  </>
                ) : (
                  <>
                    <p>{selectedDate} · {isWalkIn ? "Gym per kunjungan (tanpa durasi)" : startTime.slice(11,16) + " – " + computedEndTime.slice(11,16) + " (" + duration + " jam)"}</p>
                    <div className="flex justify-between gap-3"><span>{isWalkIn ? "Tarif per kunjungan" : "Tarif per jam"}</span><strong>{formatRupiah(Number(facility?.pricePerHour ?? 0))}</strong></div>
                    {!isWalkIn && <div className="flex justify-between gap-3"><span>Durasi</span><span>{duration} jam</span></div>}
                    <div className="flex justify-between gap-3"><span>Subtotal</span><strong>{formatRupiah(estimatedBase)}</strong></div>
                    {bookingKind === "event" && <div className="flex justify-between gap-3"><span>Estimasi diskon event (21,4%)</span><span>− {formatRupiah(estimatedEventDiscount)}</span></div>}
                    <div className="flex justify-between gap-3"><span>{isCompanyPayer ? "Harga sebelum perincian pajak" : "Total Pembayaran"}</span><strong>{formatRupiah(estimatedBeforeTax)}</strong></div>
                    {isCompanyPayer ? <>
                      <p className="text-muted-foreground">DPP, PPN, dan PPh mengikuti konfigurasi perusahaan serta kalkulasi backend; jumlah ini bukan angka invoice final.</p>
                      <p className="text-muted-foreground">Status setelah dibuat: menunggu approval perusahaan atau belum ditagihkan, sesuai akun.</p>
                    </> : <p className="text-muted-foreground">Pajak (Personal / Umum): Rp0</p>}
                  </>
                )}
              </div>
            )}
            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Catatan (Opsional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Permintaan khusus atau informasi tambahan..."
                rows={3}
              />
            </div>

            {!isMembership && (
              <div className="rounded-lg border p-4 space-y-3">
                <p className="font-semibold">Status pembayaran</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" disabled={isCompanyPayer} variant={paymentChoice === "paid" ? "default" : "outline"} aria-pressed={paymentChoice === "paid"} onClick={() => setPaymentChoice("paid")}>Sudah Bayar</Button>
                  <Button type="button" variant={paymentChoice === "unpaid" ? "default" : "outline"} aria-pressed={paymentChoice === "unpaid"} onClick={() => setPaymentChoice("unpaid")}>Belum Bayar</Button>
                </div>
                {paymentChoice === "paid" ? (
                  <div className="space-y-3 border-t pt-3">
                    <p className="text-xs text-muted-foreground">Bukti dan tanggal transaksi akan dicatat setelah booking/grup berhasil dibuat. Pembayaran grup hanya dibuat satu record dengan total seluruh sesi.</p>
                    <div className="space-y-1.5">
                      <Label>Metode Pembayaran *</Label>
                      <Select value={paidMethod} onValueChange={setPaidMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Transfer Bank">Transfer Bank</SelectItem>
                          <SelectItem value="QRIS">QRIS Mandiri Direct</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="checkout-payment-date">Tanggal Pembayaran *</Label>
                      <Input id="checkout-payment-date" type="date" value={bookingPaymentDate} max={jakartaDateOnly()}
                        onChange={(event) => setBookingPaymentDate(event.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="checkout-payment-proof">Bukti Pembayaran *</Label>
                      <Input id="checkout-payment-proof" type="file" accept="image/*,.pdf"
                        onChange={(event) => setPaymentProof(event.target.files?.[0] ?? null)} required />
                      <p className="text-xs text-muted-foreground">OCR membantu pemeriksaan metode, tetapi tidak menggantikan verifikasi dana masuk.</p>
                    </div>
                    {paymentProof && <p className="text-xs text-muted-foreground">File dipilih: {paymentProof.name}</p>}
                  </div>
                ) : paymentChoice === "unpaid" ? (
                  <p className="text-sm text-muted-foreground">
                    {isCompanyPayer
                      ? "Tagihan perusahaan mengikuti alur invoice perusahaan. Tidak ada pembayaran langsung yang dicatat pada saat booking."
                      : "Booking akan dibuat tanpa record pembayaran. Status pembayaran tetap menunggu pembayaran dan bisa dikelola kemudian."}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Pilih Sudah Bayar atau Belum Bayar untuk melanjutkan.</p>
                )}
              </div>
            )}

            {isMembership && <div className="rounded-lg border p-4 space-y-3">
              <p className="font-semibold">Pengelolaan Member Gym</p>
              <Label>Tindakan Membership</Label>
              <Select value={memberAction} onValueChange={(v) => {setMemberAction(v);setMemberId("");setMembershipResult("");setMembershipPaymentTarget(null);setMembershipPaymentDone(false);setMembershipPaymentFile(null);}}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Daftar Member Baru</SelectItem>
                  <SelectItem value="renew">Perpanjang Membership</SelectItem>
                  <SelectItem value="checkin">Catat Kunjungan Member Aktif (Rp0)</SelectItem>
                </SelectContent>
              </Select>
              {memberAction === "new" ? <>
                <p className="text-xs text-muted-foreground">Gunakan Nama Pemesan dan nomor WhatsApp di atas. Email wajib diisi untuk pendaftaran. Pendaftaran tidak otomatis lunas.</p>
                <Label>Paket membership</Label>
                <Select value={memberMonths} onValueChange={setMemberMonths}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,2,3,6,12].map(n => <SelectItem key={n} value={String(n)}>{n} bulan</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-sm">Tagihan membership: <strong>{formatRupiah(Number(memberMonths) * 300000)}</strong>. Pembayaran dapat diselesaikan langsung setelah pendaftaran.</p>
              </> : <>
                <Label>Cari Member Gym</Label>
                <Select value={memberId} onValueChange={setMemberId}>
                  <SelectTrigger><SelectValue placeholder="Pilih member berdasarkan nama / telepon" /></SelectTrigger>
                  <SelectContent position="popper" side="bottom" sideOffset={4} className="max-h-[min(360px,60vh)] overflow-y-auto">
                    <div className="sticky top-0 z-20 bg-popover px-2 py-2" onKeyDown={e => e.stopPropagation()}>
                      <Input aria-label="Cari nama atau nomor telepon member Gym" placeholder="Cari nama / telepon member..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)} onKeyDown={e => e.stopPropagation()} />
                    </div>
                    {members.filter(m => [m.name,m.phone].some(v => String(v).toLowerCase().includes(memberSearch.trim().toLowerCase()))).map(m =>
                      <SelectItem key={m.id} value={String(m.id)}>{m.name} · {m.phone} · {m.status}</SelectItem>)}
                    {members.length > 0 && !members.some(m => [m.name,m.phone].some(v => String(v).toLowerCase().includes(memberSearch.trim().toLowerCase()))) &&
                      <div className="px-3 py-2 text-sm text-muted-foreground">Member tidak ditemukan</div>}
                  </SelectContent>
                </Select>
                {matchedMember && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Member</span>
                      <strong>{matchedMember.name}</strong>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Status</span>
                      <strong>{matchedMember.status}</strong>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Berlaku hingga</span>
                      <strong>{matchedMember.endDate}</strong>
                    </div>
                    {memberAction === "renew" && renewalStartDate && renewalEndDate && (
                      <>
                        <div className="border-t pt-2 flex justify-between gap-4">
                          <span className="text-muted-foreground">Periode baru</span>
                          <strong>{renewalStartDate} – {renewalEndDate}</strong>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Tagihan</span>
                          <strong>{formatRupiah(membershipCharge)}</strong>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {memberAction === "renew" && <>
                  <Label>Perpanjangan</Label>
                  <Select value={memberMonths} onValueChange={setMemberMonths}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{[1,2,3,6,12].map(n => <SelectItem key={n} value={String(n)}>{n} bulan</SelectItem>)}</SelectContent>
                  </Select>
                </>}
                {memberAction === "checkin" && <p className="text-sm">Kunjungan member aktif tidak memerlukan durasi dan tidak menimbulkan tagihan baru.</p>}
              </>}
              {memberLoadError && <p className="text-xs text-destructive">{memberLoadError}</p>}
              {membershipResult && <p className="text-sm font-medium text-green-700">{membershipResult}</p>}
              {membershipPaymentTarget && (
                <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4 space-y-3">
                  <div>
                    <p className="font-semibold">
                      {membershipPaymentTarget.action === "renew" ? "Pembayaran Perpanjangan Membership" : "Pembayaran Member Baru"}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {membershipPaymentTarget.name}
                      {membershipPaymentTarget.periodStart && membershipPaymentTarget.periodEnd
                        ? ` · ${membershipPaymentTarget.periodStart} s/d ${membershipPaymentTarget.periodEnd}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex justify-between gap-4 text-sm">
                    <span>Tagihan</span>
                    <strong>{formatRupiah(membershipPaymentTarget.amount)}</strong>
                  </div>
                  {!membershipPaymentDone ? (
                    <>
                      <Label>Metode pembayaran</Label>
                      <Select value={membershipPaymentMethod} onValueChange={setMembershipPaymentMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="qris">QRIS</SelectItem>
                          <SelectItem value="transfer">Transfer Bank</SelectItem>
                        </SelectContent>
                      </Select>
                      <Label htmlFor="checkout-membership-payment-date">Tanggal pembayaran</Label>
                      <Input
                        id="checkout-membership-payment-date"
                        type="date"
                        value={membershipPaymentDate}
                        max={jakartaDateOnly()}
                        onChange={(e) => setMembershipPaymentDate(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Isi sesuai tanggal transaksi pada bukti pembayaran. Tanggal input/verifikasi tetap tercatat terpisah untuk audit.</p>
                      <Label htmlFor="checkout-membership-proof">Bukti pembayaran</Label>
                      <Input
                        id="checkout-membership-proof"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                        onChange={(e) => setMembershipPaymentFile(e.target.files?.[0] ?? null)}
                      />
                      <Button
                        type="button"
                        className="w-full"
                        disabled={(!membershipPaymentFile && !membershipProofUploaded) || !membershipPaymentDate || membershipPaymentBusy}
                        onClick={submitMembershipPaymentInline}
                      >
                        {membershipPaymentBusy
                          ? "Memproses..."
                          : getCurrentRole() === "staff"
                            ? "Unggah Bukti & Kirim Verifikasi"
                            : "Unggah Bukti & Konfirmasi"}
                      </Button>
                    </>
                  ) : (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-700">
                      {getCurrentRole() === "staff"
                        ? "Bukti sudah dikirim. Menunggu verifikasi petugas berwenang."
                        : membershipPaymentTarget.action === "renew"
                          ? "Perpanjangan dan pembayaran sudah selesai."
                          : "Pendaftaran member dan pembayaran sudah selesai."}
                    </div>
                  )}
                </div>
              )}

              {!membershipPaymentTarget && <Button type="button" disabled={!membershipReady || isSubmitting} className="w-full" onClick={() => setMembershipConfirmOpen(true)}>
                {isSubmitting ? "Memproses..." : memberAction === "new" ? "Lanjutkan Pendaftaran" : memberAction === "renew" ? "Lanjutkan Perpanjangan" : "Catat Kunjungan (Rp0)"}
              </Button>}
              {(!membershipPaymentTarget || membershipPaymentDone) && <Button type="button" variant="outline" className="w-full" onClick={() => setLocation("/admin/memberships")}>Lihat Riwayat Membership & Pembayaran</Button>}
            </div>}
          </CardContent>

          <CardFooter className="border-t pt-5">
            {!isMembership && <Button type="submit" className="w-full h-11 text-base font-bold" disabled={!canSubmitBooking}>
              {isSubmitting
                ? <><Loader2 size={16} className="mr-2 animate-spin" /> Memproses...</>
                : isMembership ? "Buka Modul Membership" : isCompanyPayer ? "Buat Booking Perusahaan" : "Buat Booking"
              }
            </Button>}
          </CardFooter>
        </Card>
      </form>

      <AlertDialog open={membershipConfirmOpen} onOpenChange={setMembershipConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {memberAction === "renew" ? "Konfirmasi Perpanjangan Membership" : memberAction === "new" ? "Konfirmasi Pendaftaran Membership" : "Konfirmasi Kunjungan Member"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {memberAction === "renew" && matchedMember ? (
                  <>
                    <div className="rounded-lg border p-3 space-y-2 text-foreground">
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Member</span><strong>{matchedMember.name} · {matchedMember.phone}</strong></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Perpanjangan</span><strong>{memberMonths} bulan</strong></div>
                      {renewalStartDate && renewalEndDate && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Periode berikutnya</span><strong>{renewalStartDate} – {renewalEndDate}</strong></div>}
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Tagihan</span><strong>{formatRupiah(membershipCharge)}</strong></div>
                    </div>
                    <p>Setelah dikonfirmasi, sistem membuat perpanjangan dan langsung menampilkan pembayaran pada halaman ini.</p>
                  </>
                ) : (
                  <p>{memberAction === "new" ? "Member baru akan dibuat dan pembayaran dapat langsung diselesaikan pada halaman ini." : "Proses ini akan dicatat di sistem. Pastikan data yang dipilih sudah benar."}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={(e) => {
                e.preventDefault();
                setMembershipConfirmOpen(false);
                void submitMembership();
              }}
            >
              {isSubmitting ? "Memproses..." : memberAction === "renew" ? "Ya, Perpanjang Membership" : memberAction === "new" ? "Ya, Daftarkan Member" : "Ya, Catat Kunjungan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
