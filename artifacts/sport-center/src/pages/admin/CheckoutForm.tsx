import { useState } from "react";
import { useListFacilities, useListCustomers } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShoppingCart, CheckCircle2 } from "lucide-react";
import { getToken } from "@/lib/auth";

export default function AdminCheckoutForm() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [duration, setDuration] = useState("1");
  const [bookingKind, setBookingKind] = useState("personal");
  const [eventPayer, setEventPayer] = useState("personal");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<string | null>(null);

  const { data: facilitiesData } = useListFacilities();
  const { data: customersData } = useListCustomers();

  const facilities = Array.isArray(facilitiesData) ? facilitiesData : [];
  const customers = Array.isArray(customersData) ? customersData : [];
  const selectedCustomer: any = customers.find((c: any) => String(c.id) === selectedCustomerId);

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
    if (!selectedFacilityId) {
      toast({ title: "Pilih fasilitas terlebih dahulu", variant: "destructive" });
      return;
    }
    if (!startTime) {
      toast({ title: "Masukkan waktu mulai", variant: "destructive" });
      return;
    }

    const corporate = bookingKind === "corporate" || (bookingKind === "event" && eventPayer === "corporate");
    if (corporate && selectedCustomer?.accountType !== "company") {
      toast({ title: "Pilih akun perusahaan yang terdaftar", variant: "destructive" });
      return;
    }
    if (Number(selectedCustomerId) <= 0) {
      toast({ title: "Pilih customer yang terdaftar; data tamu perlu didaftarkan terlebih dahulu", variant: "destructive" });
      return;
    }
    if (!selectedCustomer?.name || !selectedCustomer?.phone) {
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
          customerId: Number(selectedCustomerId),
          customerName: selectedCustomer.name,
          customerPhone: selectedCustomer.phone,
          customerEmail: selectedCustomer.email ?? "",
          facilityId: Number(selectedFacilityId),
          bookingDate: startTime.slice(0, 10),
          startTime: startTime.slice(11, 16),
          durationHours: Number(duration),
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

      setCreatedOrder(data.booking?.orderNumber ?? null);
      toast({ title: "Booking berhasil dibuat!", description: `Order: ${data.booking?.orderNumber}` });

      // Reset form
      setSelectedCustomerId("");
      setSelectedFacilityId("");
      setStartTime("");
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
        <div className="flex gap-3">
          <Button onClick={() => setLocation(`/admin/bookings`)}>Lihat Semua Booking</Button>
          <Button variant="outline" onClick={() => setCreatedOrder(null)}>Buat Booking Lagi</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
          <ShoppingCart className="text-primary w-8 h-8" />
          Buat Booking (Admin)
        </h1>
        <p className="text-muted-foreground mt-1">Booking melalui validasi jadwal, harga, pajak dan status pembayaran pada layanan utama.</p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Detail Booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Customer */}
            <div className="space-y-2">
              <Label htmlFor="customer">Nama Pemesan <span className="text-destructive">*</span></Label>
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger id="customer">
                  <SelectValue placeholder="Pilih customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.length === 0 && (
                    <SelectItem value="__empty__" disabled>Tidak ada customer terdaftar</SelectItem>
                  )}
                  {customers.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}{c.phone ? ` (${c.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Facility */}
            <div className="space-y-2">
              <Label htmlFor="facility">Fasilitas <span className="text-destructive">*</span></Label>
              <Select value={selectedFacilityId} onValueChange={setSelectedFacilityId}>
                <SelectTrigger id="facility">
                  <SelectValue placeholder="Pilih fasilitas..." />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((f: any) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name} — Rp {Number(f.pricePerHour).toLocaleString("id-ID")}/jam
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Time row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startTime">Waktu Mulai <span className="text-destructive">*</span></Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Durasi (jam) <span className="text-destructive">*</span></Label>
                <Input
                  id="duration"
                  type="number"
                  min={1}
                  max={12}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">Waktu Selesai</Label>
                <Input
                  id="endTime"
                  type="datetime-local"
                  value={endTime || computedEndTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  placeholder="Auto dari durasi"
                />
              </div>
            </div>

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
              <p className="text-xs text-muted-foreground">Booking tidak langsung dianggap lunas. Unggah bukti pada detail pembayaran setelah booking dibuat; metode dapat dibantu OCR dan tetap memerlukan verifikasi.</p>
              {bookingKind === "event" && <p className="text-xs text-amber-700">Alur ini untuk satu sesi event. Booking grup multi-sesi harus menggunakan alur grup khusus.</p>}
              {bookingKind === "membership" && <p className="text-xs text-amber-700">Membership wajib dibuat melalui modul Membership untuk mencegah duplikasi pembayaran.</p>}
            </div>

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

            {/* Price preview */}
            {selectedFacilityId && duration && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 text-sm flex justify-between items-center">
                <span className="text-muted-foreground">Estimasi total</span>
                <span className="font-bold text-primary text-base">
                  Rp {(
                    Number(facilities.find((f: any) => String(f.id) === selectedFacilityId)?.pricePerHour ?? 0) *
                    Number(duration)
                  ).toLocaleString("id-ID")}
                </span>
              </div>
            )}
          </CardContent>

          <CardFooter className="border-t pt-5">
            <Button type="submit" className="w-full h-11 text-base font-bold" disabled={isSubmitting}>
              {isSubmitting
                ? <><Loader2 size={16} className="mr-2 animate-spin" /> Memproses...</>
                : bookingKind === "membership" ? "Buka Modul Membership" : "Buat Booking (Menunggu Pembayaran)"
              }
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
