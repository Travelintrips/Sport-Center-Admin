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
import { Loader2, ShoppingCart, CheckCircle2, ArrowLeft } from "lucide-react";
import { getToken, getCurrentRole } from "@/lib/auth";

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
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<string | null>(null);
  const [createdBookingId, setCreatedBookingId] = useState<number | null>(null);
  const [createdBookingAmount, setCreatedBookingAmount] = useState<number>(0);
  const [paymentChoice, setPaymentChoice] = useState<"paid" | "unpaid" | null>(null);
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paidMethod, setPaidMethod] = useState("Transfer Bank");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);

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
        setLocation("/admin/memberships?memberId=" + encodeURIComponent(String(data.id)) + (memberAction === "renew" ? "&payment=paid" : ""));
        return;
      }
      setMembershipResult(memberAction === "checkin" ? "Kunjungan berhasil dicatat tanpa tagihan baru."
        : "Permintaan membership tercatat. Selesaikan pembayaran melalui alur verifikasi Membership; belum dianggap lunas.");
      toast({title:"Berhasil",description:"Periksa detail pada modul Membership."});
    } catch(e) {toast({title:"Membership gagal",description:e instanceof Error ? e.message : "Terjadi kesalahan",variant:"destructive"});}
    finally {setIsSubmitting(false);}
  }

  async function submitBookingPayment() {
    if (!createdBookingId || !paymentProof || paymentBusy || paymentSubmitted) return;
    setPaymentBusy(true);
    try {
      const fileForm = new FormData();
      fileForm.append("proof", paymentProof);
      const headers = {Authorization: "Bearer " + (getToken() ?? "")};
      const uploaded = await fetch("/api/payments/proof-upload", {method:"POST",headers,body:fileForm});
      const fileResult = await uploaded.json();
      if (!uploaded.ok) throw Error(fileResult.error || "Upload bukti gagal");
      const detected = String(fileResult.ocrScan?.paymentMethod ?? "").toLowerCase();
      if (fileResult.ocrScan?.confidence === "high" && detected &&
          ((detected === "qris") !== (paidMethod === "QRIS"))) {
        throw Error("Metode terpilih tidak sesuai OCR. Periksa bukti lalu pilih metode yang benar sebelum mengirim ulang.");
      }
      const payload = {
        bookingId:createdBookingId, amount:createdBookingAmount, paymentType:"full_payment",
        paymentMethod:paidMethod,
        ...(paidMethod === "QRIS" ? {paymentProvider:"mandiri_direct"} : {}),
        proofUrl:fileResult.objectPath ?? fileResult.url,
        ocrScanToken:fileResult.ocrScanToken,
      };
      const saved = await fetch("/api/payments", {method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(payload)});
      const result = await saved.json();
      if (!saved.ok) throw Error(result.error || "Gagal mencatat pembayaran");

      const currentRole = getCurrentRole();
      if (currentRole && currentRole !== "staff") {
        const confirmed = await fetch(`/api/payments/${result.id}`, {
          method: "PATCH",
          headers: {"Content-Type":"application/json", ...headers},
          body: JSON.stringify({ status: "confirmed" }),
        });
        const confirmedResult = await confirmed.json();
        if (!confirmed.ok) {
          throw Error(confirmedResult.error || "Bukti tersimpan, tetapi konfirmasi pembayaran gagal");
        }
        setPaymentSubmitted(true);
        toast({title:"Pembayaran dikonfirmasi",description:"Bukti tersimpan dan booking telah selesai dikonfirmasi."});
      } else {
        setPaymentSubmitted(true);
        toast({title:"Bukti pembayaran dicatat",description:"Menunggu verifikasi oleh admin/finance."});
      }
    } catch(err) {
      toast({title:"Pembayaran belum tercatat",description:err instanceof Error ? err.message : "Silakan periksa bukti",variant:"destructive"});
    } finally {setPaymentBusy(false);}
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
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({
          customerId: guestBooking ? null : Number(selectedCustomerId),
          customerName: isGuest ? guestName.trim() : selectedCustomer.name,
          customerPhone: isGuest ? guestPhone.trim() : selectedCustomer.phone,
          customerEmail: isGuest ? guestEmail.trim() : (selectedCustomer.email ?? ""),
          facilityId: Number(selectedFacilityId),
          bookingDate: selectedDate,
          ...(!isWalkIn ? { startTime: startTime.slice(11, 16), durationHours: Number(duration) } : { numberOfPeople: 1 }),
          bookingType: bookingKind === "event" ? "event" : "regular",
          payerType: corporate ? "company" : "personal",
          ...(corporate ? { companyCustomerId: Number(selectedCustomerId) } : {}),
          source: "admin",
          notes: notes || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({ title: "Booking gagal", description: data.error ?? "Terjadi kesalahan", variant: "destructive" });
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
      setCreatedOrder(order);
      setCreatedBookingId(bookingId);
      setCreatedBookingAmount(Number(created.grandTotal ?? created.totalPrice ?? 0));
      setPaymentChoice(null);
      setPaymentProof(null);
      setPaymentSubmitted(false);
      toast({ title: "Booking berhasil dibuat!", description: `Order: ${order}` });

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
          <p className="font-semibold">Status pembayaran pelanggan</p>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={paymentChoice === "paid" ? "default" : "outline"} onClick={() => setPaymentChoice("paid")}>Sudah Dibayar</Button>
            <Button type="button" variant={paymentChoice === "unpaid" ? "default" : "outline"} onClick={() => setPaymentChoice("unpaid")}>Belum Dibayar</Button>
          </div>
          {paymentChoice === "unpaid" && <p className="text-sm text-muted-foreground">Booking tetap menunggu pembayaran. Tidak ada pembayaran baru yang dicatat.</p>}
          {paymentChoice === "paid" && (paymentSubmitted ?
            <p className="text-sm font-medium text-green-700">{getCurrentRole()==="staff" ? "Bukti diterima untuk verifikasi. Status lunas belum ditetapkan." : "Bukti diterima dan pembayaran sudah dikonfirmasi."}</p>
            : <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Unggah bukti pembayaran. OCR membantu pengecekan metode, tetapi tidak otomatis mengonfirmasi uang diterima.</p>
                <Label>Metode Pembayaran</Label>
                <Select value={paidMethod} onValueChange={setPaidMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Transfer Bank">Transfer Bank</SelectItem>
                    <SelectItem value="QRIS">QRIS Mandiri Direct</SelectItem>
                  </SelectContent>
                </Select>
                <Label htmlFor="booking-payment-proof">Bukti pembayaran *</Label>
                <Input id="booking-payment-proof" type="file" accept="image/*,.pdf" onChange={e => setPaymentProof(e.target.files?.[0] ?? null)} />
                <p className="text-sm">Nominal booking: <strong>{formatRupiah(createdBookingAmount)}</strong></p>
                <Button type="button" className="w-full" disabled={paymentBusy || !paymentProof || !createdBookingId || !(createdBookingAmount > 0)} onClick={submitBookingPayment}>
                  {paymentBusy ? "Memproses bukti..." : (getCurrentRole()==="staff" ? "Unggah Bukti & Kirim Verifikasi" : "Unggah Bukti & Konfirmasi")}
                </Button>
              </div>)}
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
            <div className="space-y-2">
              <Label>Jenis pemesanan</Label>
              <Select value={bookingKind} onValueChange={setBookingKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal / Umum</SelectItem>
                  <SelectItem value="corporate">Perusahaan / Corporate</SelectItem>
                  <SelectItem value="membership">Membership Gym (kelola di Membership)</SelectItem>
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
              {isMembership && <p className="text-xs text-amber-700">Pilih member aktif dan catat kunjungan melalui modul Membership. Kunjungan member tidak dikenakan tagihan Rp30.000.</p>}
            </div>

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
            {!isMembership && selectedFacilityId && selectedDate && (isWalkIn || slotValid) && <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
              <p className="font-semibold">Ringkasan Booking</p>
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
            </div>}
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

            {isMembership && <div className="rounded-lg border p-4 space-y-3">
              <p className="font-semibold">Pengelolaan Member Gym</p>
              <Label>Tindakan Membership</Label>
              <Select value={memberAction} onValueChange={(v) => {setMemberAction(v);setMemberId("");setMembershipResult("");}}>
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
                <p className="text-sm">Estimasi biaya membership: <strong>{formatRupiah(Number(memberMonths) * 300000)}</strong>. Verifikasi pembayaran dilakukan terpisah.</p>
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
                {matchedMember && <p className="text-sm">Status: <strong>{matchedMember.status}</strong> · Berlaku hingga {matchedMember.endDate}</p>}
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
              <Button type="button" disabled={!membershipReady || isSubmitting} className="w-full" onClick={() => setMembershipConfirmOpen(true)}>
                {isSubmitting ? "Memproses..." : memberAction === "new" ? "Daftarkan Member" : memberAction === "renew" ? "Perpanjang Membership" : "Catat Kunjungan (Rp0)"}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => setLocation("/admin/memberships")}>Lihat Riwayat Membership & Pembayaran</Button>
            </div>}
          </CardContent>

          <CardFooter className="border-t pt-5">
            {!isMembership && <Button type="submit" className="w-full h-11 text-base font-bold" disabled={isSubmitting || !slotValid}>
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
                    <p>Setelah dikonfirmasi, sistem membuat perpanjangan dan langsung membuka detail member untuk proses pembayaran.</p>
                  </>
                ) : (
                  <p>Proses ini akan dicatat di sistem. Pastikan data yang dipilih sudah benar.</p>
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
