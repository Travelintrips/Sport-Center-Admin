import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle, Clock, XCircle, ZoomIn } from "lucide-react";

interface ReviewData {
  booking: {
    id: number;
    orderNumber: string;
    customerName: string;
    customerPhone: string;
    facilityName: string;
    bookingDate: string;
    startTime: string;
    endTime: string;
    durationHours: number;
    totalPrice: number;
    status: string;
    notes: string | null;
    payment: {
      status: string;
      proofUrl: string | null;
      confirmedAt: string | null;
      amount: number;
    } | null;
  };
  expiresAt: string | null;
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

function formatIDR(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

export default function WaAdminReview() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alreadyUsed, setAlreadyUsed] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string; action: "approve" | "reject" } | null>(null);
  const [zoomedIn, setZoomedIn] = useState(false);

  useEffect(() => {
    fetch(`/api/wa/review/${params.token}`)
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

  async function handleAction(action: "approve" | "reject") {
    setSubmitting(action);
    setError("");
    try {
      const resp = await fetch(`/api/wa/review/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: rejectReason }),
      });
      const d = await resp.json();
      if (!resp.ok) { setError(d.error ?? "Gagal melakukan aksi"); setSubmitting(null); return; }
      setResult({ success: true, message: d.message, action });
    } catch {
      setError("Terjadi kesalahan. Coba lagi.");
    } finally {
      setSubmitting(null);
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
            <p className="text-gray-500 text-sm">Aksi konfirmasi/tolak sudah dilakukan sebelumnya.</p>
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
    const isApprove = result.action === "approve";
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${isApprove ? "bg-green-100" : "bg-red-100"}`}>
              {isApprove
                ? <CheckCircle className="w-9 h-9 text-green-600" />
                : <XCircle className="w-9 h-9 text-red-600" />}
            </div>
            <div>
              <h2 className={`font-black text-xl ${isApprove ? "text-green-700" : "text-red-700"}`}>
                {isApprove ? "Pembayaran Dikonfirmasi!" : "Pembayaran Ditolak"}
              </h2>
              <p className="text-gray-600 text-sm mt-1">{result.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const b = data.booking;
  const proofUrl = b.payment?.proofUrl ?? null;
  const isImage = proofUrl && /\.(jpg|jpeg|png|webp)/i.test(proofUrl);
  const hasProof = !!proofUrl;

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 pt-8 pb-6">
        <p className="text-white/80 text-sm font-medium uppercase tracking-wide mb-1">Review Pembayaran</p>
        <h1 className="font-black text-2xl">Konfirmasi Bukti Bayar</h1>
        {data.expiresAt && (
          <p className="text-white/70 text-xs mt-1">
            Link berlaku hingga: {formatDateTime(data.expiresAt)}
          </p>
        )}
      </div>

      <div className="px-4 pt-4 max-w-md mx-auto space-y-4">

        {/* Booking Details */}
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
            <Row label="Total" value={formatIDR(b.totalPrice)} accent />
            {b.notes && <Row label="Catatan" value={b.notes} />}
          </CardContent>
        </Card>

        {/* Payment Proof — highlighted section */}
        <Card className="shadow-sm border-2 border-orange-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-orange-700 uppercase tracking-wide">
              📎 Bukti Pembayaran
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasProof ? (
              isImage ? (
                <div className="space-y-2">
                  <div
                    className={`relative cursor-zoom-in rounded-xl overflow-hidden border bg-gray-50 transition-all duration-300 ${zoomedIn ? "max-h-[80vh]" : "max-h-72"}`}
                    onClick={() => setZoomedIn((v) => !v)}
                  >
                    <img
                      src={proofUrl!}
                      alt="Bukti pembayaran"
                      className="w-full object-contain"
                    />
                    {!zoomedIn && (
                      <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs rounded-full px-2 py-1 flex items-center gap-1">
                        <ZoomIn className="w-3 h-3" /> Tap untuk zoom
                      </div>
                    )}
                  </div>
                  <a
                    href={proofUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-blue-600 text-xs underline py-1"
                  >
                    Buka di tab baru ↗
                  </a>
                </div>
              ) : (
                <a
                  href={proofUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center bg-blue-50 border border-blue-200 rounded-xl py-4 text-blue-700 font-semibold text-sm hover:bg-blue-100"
                >
                  📄 Lihat Bukti Pembayaran ↗
                </a>
              )
            ) : (
              <div className="text-center py-6">
                <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
                <p className="text-sm text-red-500 font-medium">Bukti pembayaran belum diupload</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Reject reason form */}
        {showRejectForm && (
          <Card className="shadow-sm border border-red-200">
            <CardContent className="pt-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-red-700">Alasan Penolakan (opsional)</Label>
                <Textarea
                  placeholder="Contoh: Bukti tidak jelas, nominal tidak sesuai..."
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="border-red-200 focus:border-red-400"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          {!showRejectForm ? (
            <>
              {/* Approve */}
              <Button
                onClick={() => handleAction("approve")}
                disabled={!hasProof || submitting !== null}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-black text-base py-6 rounded-xl shadow-md"
              >
                {submitting === "approve" ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Mengkonfirmasi...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    ✅ Konfirmasi Pembayaran
                  </span>
                )}
              </Button>

              {/* Reject trigger */}
              <Button
                onClick={() => setShowRejectForm(true)}
                disabled={submitting !== null}
                variant="outline"
                className="w-full border-red-300 text-red-600 hover:bg-red-50 font-bold text-base py-6 rounded-xl"
              >
                <span className="flex items-center gap-2">
                  <XCircle className="w-5 h-5" />
                  ❌ Tolak Pembayaran
                </span>
              </Button>

              {!hasProof && (
                <p className="text-xs text-center text-red-500">
                  Tidak bisa approve — bukti pembayaran belum diupload
                </p>
              )}
            </>
          ) : (
            <>
              <Button
                onClick={() => handleAction("reject")}
                disabled={submitting !== null}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-black text-base py-6 rounded-xl shadow-md"
              >
                {submitting === "reject" ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Menolak...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <XCircle className="w-5 h-5" />
                    Konfirmasi Tolak
                  </span>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => { setShowRejectForm(false); setRejectReason(""); }}
                disabled={submitting !== null}
                className="w-full text-gray-500 text-sm"
              >
                Batal
              </Button>
            </>
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
