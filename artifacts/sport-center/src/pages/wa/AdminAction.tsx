import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle, Clock, UserCheck, Flag, XCircle } from "lucide-react";

interface ActionData {
  action: string;
  booking: {
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
    status: string;
    source: string;
    notes: string | null;
    checkedInAt: string | null;
    payment: {
      status: string;
      proofUrl: string | null;
      confirmedAt: string | null;
      amount: number;
    } | null;
  };
  expiresAt: string | null;
}

const ACTION_META: Record<string, { title: string; icon: React.ReactNode; color: string; buttonLabel: string; buttonColor: string }> = {
  approve_payment: {
    title: "Konfirmasi Pembayaran",
    icon: <CheckCircle className="w-8 h-8 text-green-500" />,
    color: "from-green-500 to-emerald-500",
    buttonLabel: "✅ Konfirmasi Pembayaran",
    buttonColor: "bg-green-600 hover:bg-green-700",
  },
  reject_payment: {
    title: "Tolak Pembayaran",
    icon: <XCircle className="w-8 h-8 text-red-500" />,
    color: "from-red-500 to-orange-500",
    buttonLabel: "❌ Tolak Pembayaran",
    buttonColor: "bg-red-600 hover:bg-red-700",
  },
  checkin: {
    title: "Check-In Customer",
    icon: <UserCheck className="w-8 h-8 text-blue-500" />,
    color: "from-blue-500 to-cyan-500",
    buttonLabel: "✅ Konfirmasi Check-In",
    buttonColor: "bg-blue-600 hover:bg-blue-700",
  },
  finish: {
    title: "Selesai Main",
    icon: <Flag className="w-8 h-8 text-purple-500" />,
    color: "from-purple-500 to-pink-500",
    buttonLabel: "🏁 Tandai Selesai",
    buttonColor: "bg-purple-600 hover:bg-purple-700",
  },
};

function formatDateTime(dtStr: string): string {
  try {
    return new Date(dtStr).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " WIB";
  } catch { return dtStr; }
}

export default function WaAdminAction() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<ActionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alreadyUsed, setAlreadyUsed] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch(`/api/wa/action/${params.token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error === "Aksi ini sudah dilakukan" || d.error?.includes("sudah digunakan")) {
          setAlreadyUsed(true);
          setError(d.error);
        } else if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
      })
      .catch(() => setError("Link tidak valid"))
      .finally(() => setLoading(false));
  }, [params.token]);

  async function handleAction() {
    setSubmitting(true);
    setError("");
    try {
      const resp = await fetch(`/api/wa/action/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const d = await resp.json();
      if (!resp.ok) { setError(d.error ?? "Gagal melakukan aksi"); return; }
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
            <p className="text-gray-500 text-sm">Aksi ini sudah dilakukan sebelumnya.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <p className="font-bold text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${result.success ? "bg-green-100" : "bg-red-100"}`}>
              {result.success ? (
                <CheckCircle className="w-9 h-9 text-green-600" />
              ) : (
                <AlertCircle className="w-9 h-9 text-red-600" />
              )}
            </div>
            <div>
              <h2 className={`font-black text-xl ${result.success ? "text-green-700" : "text-red-700"}`}>
                {result.success ? "Berhasil!" : "Gagal"}
              </h2>
              <p className="text-gray-600 text-sm mt-1">{result.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const meta = ACTION_META[data.action];
  const b = data.booking;

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className={`bg-gradient-to-r ${meta?.color ?? "from-orange-500 to-red-500"} text-white px-4 pt-8 pb-6`}>
        <p className="text-white/80 text-sm font-medium uppercase tracking-wide mb-2">Admin Action</p>
        <div className="flex items-center gap-3">
          {meta?.icon}
          <h1 className="font-black text-2xl">{meta?.title ?? data.action}</h1>
        </div>
        {data.expiresAt && (
          <p className="text-white/70 text-xs mt-2">
            Link berlaku hingga: {formatDateTime(data.expiresAt)}
          </p>
        )}
      </div>

      <div className="px-4 pt-4 max-w-md mx-auto space-y-4">
        {/* Booking details */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Detail Booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Row label="Order" value={b.orderNumber} bold />
            <Row label="Customer" value={b.customerName} />
            <Row label="Fasilitas" value={b.facilityName} />
            <Row label="Tanggal" value={b.bookingDate} />
            <Row label="Jam" value={`${b.startTime} – ${b.endTime}`} />
            <Row label="Total" value={`Rp ${b.totalPrice.toLocaleString("id-ID")}`} accent />
            {b.notes && <Row label="Catatan" value={b.notes} />}
            {b.checkedInAt && <Row label="Check-in" value={formatDateTime(b.checkedInAt)} />}
          </CardContent>
        </Card>

        {/* Payment proof (for approve/reject) */}
        {(data.action === "approve_payment" || data.action === "reject_payment") && b.payment && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Bukti Pembayaran</CardTitle>
            </CardHeader>
            <CardContent>
              {b.payment.proofUrl ? (
                <>
                  {/\.(jpg|jpeg|png|webp)/i.test(b.payment.proofUrl) ? (
                    <a href={b.payment.proofUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={b.payment.proofUrl}
                        alt="Bukti pembayaran"
                        className="w-full max-h-72 object-contain rounded-lg border bg-gray-50 cursor-pointer"
                      />
                    </a>
                  ) : (
                    <a
                      href={b.payment.proofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline text-sm">
                      Lihat Bukti Pembayaran
                    </a>
                  )}
                  <p className="text-xs text-gray-500 mt-2 text-center">Tap gambar untuk zoom</p>
                </>
              ) : (
                <p className="text-sm text-red-500 text-center py-4">Bukti pembayaran belum diupload</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Notes for reject */}
        {data.action === "reject_payment" && (
          <Card className="shadow-sm">
            <CardContent className="pt-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Alasan Penolakan (opsional)</Label>
                <Textarea
                  placeholder="Contoh: Bukti tidak jelas, nominal tidak sesuai..."
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Action button(s) */}
        <div className="space-y-3">
          <Button
            onClick={handleAction}
            disabled={submitting || (data.action === "approve_payment" && !b.payment?.proofUrl)}
            className={`w-full text-white font-black text-base py-6 rounded-xl ${meta?.buttonColor ?? "bg-orange-500 hover:bg-orange-600"}`}>
            {submitting ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Memproses...
              </span>
            ) : meta?.buttonLabel ?? "Lanjutkan"}
          </Button>

          {data.action === "approve_payment" && !b.payment?.proofUrl && (
            <p className="text-xs text-center text-red-500">
              Tidak bisa approve — bukti pembayaran belum ada
            </p>
          )}
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
