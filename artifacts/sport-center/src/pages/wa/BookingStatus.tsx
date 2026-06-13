import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Clock, Upload, MessageCircle, CalendarCheck } from "lucide-react";

interface BookingStatus {
  orderNumber: string;
  customerName: string;
  facilityName: string;
  facilityCategory: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: number;
  ppnRate?: number | null;
  ppnAmount?: number | null;
  grandTotal?: number | null;
  status: string;
  source: string;
  notes: string | null;
  paymentDeadline: string | null;
  checkedInAt: string | null;
  completedAt: string | null;
  createdAt: string;
  payment: {
    status: string;
    proofUrl: string | null;
    confirmedAt: string | null;
  } | null;
  uploadProofUrl: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Menunggu Pembayaran",
  waiting_confirmation: "Menunggu Konfirmasi Admin",
  paid: "Pembayaran Diterima",
  confirmed: "Booking Dikonfirmasi",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  rejected: "Ditolak",
  expired: "Kedaluwarsa",
  refunded: "Refund",
};

const STATUS_COLOR: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-800 border-yellow-200",
  waiting_confirmation: "bg-blue-100 text-blue-800 border-blue-200",
  paid: "bg-green-100 text-green-800 border-green-200",
  confirmed: "bg-green-100 text-green-800 border-green-200",
  completed: "bg-gray-100 text-gray-800 border-gray-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  expired: "bg-red-100 text-red-800 border-red-200",
  refunded: "bg-purple-100 text-purple-800 border-purple-200",
};

function StatusIcon({ status }: { status: string }) {
  if (["confirmed", "paid"].includes(status)) return <CheckCircle className="w-8 h-8 text-green-500" />;
  if (["completed"].includes(status)) return <CalendarCheck className="w-8 h-8 text-green-600" />;
  if (["cancelled", "rejected", "expired"].includes(status)) return <AlertCircle className="w-8 h-8 text-red-500" />;
  if (["waiting_confirmation"].includes(status)) return <Clock className="w-8 h-8 text-blue-500" />;
  return <Clock className="w-8 h-8 text-yellow-500" />;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("id-ID", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  } catch { return dateStr; }
}

function formatDateTime(dtStr: string): string {
  try {
    return new Date(dtStr).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " WIB";
  } catch { return dtStr; }
}

export default function WaBookingStatus() {
  const params = useParams<{ orderNumber: string }>();
  const [booking, setBooking] = useState<BookingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/wa/status/${params.orderNumber}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setBooking(data);
      })
      .catch(() => setError("Gagal memuat data booking"))
      .finally(() => setLoading(false));
  }, [params.orderNumber]);

  if (loading) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-600">Memuat status booking...</p>
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <p className="font-bold text-red-600">{error || "Booking tidak ditemukan"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canUploadProof = ["pending_payment", "waiting_confirmation"].includes(booking.status) && booking.uploadProofUrl;

  return (
    <div className="min-h-screen bg-orange-50 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 pt-8 pb-6">
        <p className="text-orange-100 text-sm font-medium uppercase tracking-wide mb-1">Status Booking</p>
        <h1 className="font-black text-2xl">{booking.facilityName}</h1>
        <p className="text-orange-100 text-sm mt-1">{booking.orderNumber}</p>
      </div>

      <div className="px-4 pt-4 max-w-md mx-auto space-y-4">
        {/* Status card */}
        <Card className="shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-4">
              <StatusIcon status={booking.status} />
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Status Booking</p>
                <Badge className={`font-bold text-sm border ${STATUS_COLOR[booking.status] ?? "bg-gray-100 text-gray-700"}`}>
                  {STATUS_LABEL[booking.status] ?? booking.status}
                </Badge>
              </div>
            </div>

            {booking.status === "pending_payment" && booking.paymentDeadline && (
              <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">
                ⏰ Deadline pembayaran: <strong>{formatDateTime(booking.paymentDeadline)}</strong>
              </div>
            )}

            {booking.checkedInAt && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800">
                ✅ Check-in: <strong>{formatDateTime(booking.checkedInAt)}</strong>
              </div>
            )}

            {booking.completedAt && (
              <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700">
                🏁 Selesai: <strong>{formatDateTime(booking.completedAt)}</strong>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Booking details */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Detail Booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Row label="Pemesan" value={booking.customerName} />
            <Row label="Fasilitas" value={`${booking.facilityName} (${booking.facilityCategory})`} />
            <Row label="Tanggal" value={formatDate(booking.bookingDate)} />
            <Row label="Jam" value={`${booking.startTime} – ${booking.endTime} (${booking.durationHours} jam)`} />
            <Row label="Grand Total" value={`Rp ${booking.totalPrice.toLocaleString("id-ID")}`} bold accent />
            {booking.notes && <Row label="Catatan" value={booking.notes} />}
          </CardContent>
        </Card>

        {/* Payment status */}
        {booking.payment && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Status Pembayaran</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <Row
                label="Status"
                value={
                  booking.payment.status === "confirmed" ? "✅ Dikonfirmasi" :
                  booking.payment.status === "rejected" ? "❌ Ditolak" :
                  "⏳ Menunggu verifikasi"
                }
              />
              {booking.payment.confirmedAt && (
                <Row label="Dikonfirmasi" value={formatDateTime(booking.payment.confirmedAt)} />
              )}
              {booking.payment.proofUrl && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Bukti Transfer</p>
                  {/\.(jpg|jpeg|png|webp)/i.test(booking.payment.proofUrl) ? (
                    <a href={booking.payment.proofUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={booking.payment.proofUrl}
                        alt="Bukti pembayaran"
                        className="w-full max-h-40 object-cover rounded-lg border cursor-pointer"
                      />
                    </a>
                  ) : (
                    <a
                      href={booking.payment.proofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-600 underline text-sm">
                      Lihat Bukti Pembayaran
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Action buttons */}
        <div className="space-y-3">
          {canUploadProof && (
            <a href={booking.uploadProofUrl!}
              className="flex items-center justify-center gap-2 w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 px-4 rounded-xl text-sm transition-colors">
              <Upload className="w-5 h-5" />
              Upload Bukti Pembayaran
            </a>
          )}

          <a
            href="https://wa.me/6281382702074"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full border border-green-500 text-green-700 font-semibold py-3 px-4 rounded-xl text-sm hover:bg-green-50 transition-colors">
            <MessageCircle className="w-5 h-5" />
            Hubungi Admin via WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-xs text-gray-500 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm text-right ${bold ? "font-bold" : "font-medium"} ${accent ? "text-orange-600" : "text-gray-800"}`}>
        {value}
      </span>
    </div>
  );
}
