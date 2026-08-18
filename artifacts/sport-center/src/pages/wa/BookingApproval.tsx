import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle, Clock, ShieldCheck, XCircle, CalendarDays, User, Building2, Timer, Banknote } from "lucide-react";

interface BookingData {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  facilityName: string;
  facilityCategory: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: number;
  grandTotal: number | null;
  status: string;
  notes: string | null;
  source: string | null;
}

function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr + "T00:00:00+07:00").toLocaleDateString("id-ID", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  } catch { return dateStr; }
}

function formatExpiry(dtStr: string) {
  try {
    return new Date(dtStr).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " WIB";
  } catch { return dtStr; }
}

export default function WaBookingApproval() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [booking, setBooking] = useState<BookingData | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alreadyUsed, setAlreadyUsed] = useState(false);
  const [expired, setExpired] = useState(false);

  const [decision, setDecision] = useState<"approved" | "rejected" | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch(`/api/wa/booking-approval/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error?.includes("sudah digunakan")) { setAlreadyUsed(true); setError(d.error); return; }
        if (d.error?.includes("kedaluwarsa")) { setExpired(true); setError(d.error); return; }
        if (d.error) { setError(d.error); return; }
        setBooking(d.booking);
        setExpiresAt(d.expiresAt ?? null);
      })
      .catch(() => setError("Tidak dapat memuat data. Cek koneksi internet."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit() {
    if (!decision) return;
    if (decision === "rejected" && !note.trim()) return;

    setSubmitting(true);
    setError("");
    try {
      const resp = await fetch("/api/wa/booking-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, status: decision, note: note.trim() || undefined }),
      });
      const d = await resp.json();
      if (!resp.ok) { setError(d.error ?? "Gagal memproses. Coba lagi."); return; }
      setResult({ success: true, message: d.message });
    } catch {
      setError("Terjadi kesalahan. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (alreadyUsed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardContent className="pt-8 pb-6 text-center space-y-3">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
              <Clock className="w-9 h-9 text-gray-400" />
            </div>
            <h2 className="font-black text-xl text-gray-700">Link Sudah Digunakan</h2>
            <p className="text-gray-500 text-sm">Booking ini sudah diproses sebelumnya. Cek status di Admin Portal.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardContent className="pt-8 pb-6 text-center space-y-3">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
              <Clock className="w-9 h-9 text-amber-400" />
            </div>
            <h2 className="font-black text-xl text-amber-700">Link Kedaluwarsa</h2>
            <p className="text-gray-500 text-sm">Link approval ini sudah tidak berlaku (masa aktif 24 jam). Proses approval melalui Admin Portal.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <p className="font-bold text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (result) {
    const isApproved = result.message.includes("disetujui");
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${isApproved ? "bg-green-100" : "bg-red-100"}`}>
              {isApproved
                ? <CheckCircle className="w-9 h-9 text-green-600" />
                : <XCircle className="w-9 h-9 text-red-600" />}
            </div>
            <div>
              <h2 className={`font-black text-xl ${isApproved ? "text-green-700" : "text-red-700"}`}>
                {isApproved ? "Booking Disetujui!" : "Booking Ditolak"}
              </h2>
              <p className="text-gray-600 text-sm mt-1">{result.message}</p>
            </div>
            {isApproved && (
              <p className="text-xs text-gray-400">Customer akan menerima notifikasi WA dengan instruksi pembayaran.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!booking) return null;

  const total = booking.grandTotal ?? booking.totalPrice;

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 pt-8 pb-6">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-2">
            <ShieldCheck className="w-4 h-4" />
            Admin Approval — Sport Center
          </div>
          <h1 className="font-black text-2xl leading-tight">🔔 Booking Baru<br />Perlu Persetujuan</h1>
          {expiresAt && (
            <p className="text-white/70 text-xs mt-2">Link berlaku hingga: {formatExpiry(expiresAt)}</p>
          )}
        </div>
      </div>

      <div className="px-4 pt-4 max-w-md mx-auto space-y-4">
        {/* Booking detail */}
        <Card className="shadow-sm border-0">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-xs font-bold text-gray-500 uppercase tracking-widest">Detail Booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            <div className="flex items-start gap-3">
              <span className="text-orange-500 mt-0.5"><Building2 className="w-4 h-4" /></span>
              <div>
                <p className="text-xs text-gray-500">Fasilitas</p>
                <p className="font-bold text-gray-800">{booking.facilityName}</p>
                <p className="text-xs text-gray-400">{booking.facilityCategory}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-orange-500 mt-0.5"><User className="w-4 h-4" /></span>
              <div>
                <p className="text-xs text-gray-500">Customer</p>
                <p className="font-bold text-gray-800">{booking.customerName}</p>
                <p className="text-xs text-gray-400">{booking.customerPhone}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-orange-500 mt-0.5"><CalendarDays className="w-4 h-4" /></span>
              <div>
                <p className="text-xs text-gray-500">Jadwal</p>
                <p className="font-bold text-gray-800">{formatDate(booking.bookingDate)}</p>
                <p className="text-sm text-gray-600">{booking.startTime} – {booking.endTime}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-orange-500 mt-0.5"><Timer className="w-4 h-4" /></span>
              <div>
                <p className="text-xs text-gray-500">Durasi</p>
                <p className="font-bold text-gray-800">{booking.durationHours} jam</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-orange-500 mt-0.5"><Banknote className="w-4 h-4" /></span>
              <div>
                <p className="text-xs text-gray-500">Total Pembayaran</p>
                <p className="font-black text-xl text-orange-600">{formatIDR(total)}</p>
              </div>
            </div>
            {booking.notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
                <span className="font-semibold">Catatan customer:</span> {booking.notes}
              </div>
            )}
            {booking.source && booking.source !== "portal" && (
              <div className="text-xs text-gray-400 flex items-center gap-1">
                Sumber: <span className="font-semibold uppercase">{booking.source}</span>
              </div>
            )}
            <div className="bg-gray-50 rounded-lg px-3 py-1.5 text-xs text-gray-500 flex justify-between">
              <span>Order</span>
              <span className="font-mono font-bold">{booking.orderNumber}</span>
            </div>
          </CardContent>
        </Card>

        {/* Decision form */}
        <Card className="shadow-sm border-0">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-xs font-bold text-gray-500 uppercase tracking-widest">Keputusan Admin</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-4">
            {/* Decision radio buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDecision("approved")}
                className={`flex flex-col items-center gap-1.5 py-4 rounded-xl border-2 font-bold text-sm transition-all ${
                  decision === "approved"
                    ? "border-green-500 bg-green-50 text-green-700"
                    : "border-gray-200 bg-white text-gray-500 hover:border-green-300 hover:bg-green-50/50"
                }`}
              >
                <CheckCircle className={`w-7 h-7 ${decision === "approved" ? "text-green-500" : "text-gray-300"}`} />
                ✅ Setujui
              </button>
              <button
                type="button"
                onClick={() => setDecision("rejected")}
                className={`flex flex-col items-center gap-1.5 py-4 rounded-xl border-2 font-bold text-sm transition-all ${
                  decision === "rejected"
                    ? "border-red-500 bg-red-50 text-red-700"
                    : "border-gray-200 bg-white text-gray-500 hover:border-red-300 hover:bg-red-50/50"
                }`}
              >
                <XCircle className={`w-7 h-7 ${decision === "rejected" ? "text-red-500" : "text-gray-300"}`} />
                ❌ Tolak
              </button>
            </div>

            {/* Notes field */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-gray-700">
                Catatan Admin{decision === "rejected" ? " *" : " (opsional)"}
              </Label>
              <Textarea
                placeholder={
                  decision === "rejected"
                    ? "Wajib — jelaskan alasan penolakan..."
                    : "Catatan tambahan (opsional)"
                }
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="resize-none"
              />
              {decision === "rejected" && !note.trim() && (
                <p className="text-xs text-red-500">Alasan penolakan wajib diisi</p>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Summary preview */}
            {decision && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium border ${
                decision === "approved"
                  ? "bg-green-50 border-green-200 text-green-800"
                  : "bg-red-50 border-red-200 text-red-800"
              }`}>
                {decision === "approved"
                  ? `✅ Booking akan disetujui → Customer menerima instruksi pembayaran via WA`
                  : `❌ Booking akan ditolak → Customer menerima notifikasi penolakan via WA`}
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!decision || submitting || (decision === "rejected" && !note.trim())}
              className={`w-full font-black text-base py-6 rounded-xl text-white transition-all ${
                decision === "approved"
                  ? "bg-green-600 hover:bg-green-700"
                  : decision === "rejected"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-gray-300 cursor-not-allowed"
              }`}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Memproses...
                </span>
              ) : !decision ? "Pilih keputusan terlebih dahulu" : decision === "approved" ? "✅ Setujui Booking" : "❌ Tolak Booking"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
