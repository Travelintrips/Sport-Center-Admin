import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle, Download, Upload, Image as ImageIcon, ZoomIn } from "lucide-react";

interface OcrPreview {
  paymentMethod: "QRIS" | "Transfer Bank" | "unknown";
  confidence: number;
  signals: string[];
  recipient: string | null;
  amount: number | null;
  date: string | null;
  engine: "tesseract" | "unsupported" | "failed";
  validation: {
    methodMatch: boolean;
    amountMatch: boolean;
    dateMatch: boolean;
    recipientMatch: boolean;
    complete: boolean;
    expectedAmount: number;
    expectedRecipients: string[];
  };
}

interface ActionInfo {
  action: string;
  booking: {
    orderNumber: string;
    customerName: string;
    facilityName: string;
    bookingDate: string;
    startTime: string;
    endTime: string;
    totalPrice: number;
    ppnRate?: number | null;
    ppnAmount?: number | null;
    grandTotal?: number | null;
    pphRate?: number | null;
    pphAmount?: number | null;
    netAmount?: number | null;
    status: string;
    createdAt?: string | null;
  };
  paymentOptions?: {
    transferBank: { bankName: string; bankAccount: string; bankAccountName: string } | null;
    qris: { imageUrl: string; recipientNames: string[] } | null;
  };
  supportWhatsapp?: string | null;
}

export default function WaProofUpload() {
  const params = useParams<{ token: string }>();
  const [info, setInfo] = useState<ActionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"QRIS" | "Transfer Bank">("Transfer Bank");
  const [orderNumber, setOrderNumber] = useState("");
  const [ocrPreview, setOcrPreview] = useState<OcrPreview | null>(null);
  const [scanningOcr, setScanningOcr] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [replacementAttempts, setReplacementAttempts] = useState(0);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ocrRequestIdRef = useRef(0);

  useEffect(() => {
    fetch(`/api/wa/action/${params.token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else if (data.action !== "upload_proof") setError("Link ini bukan untuk upload bukti");
        else {
          setInfo(data);
          if (!data.paymentOptions?.transferBank && data.paymentOptions?.qris) setPaymentMethod("QRIS");
        }
      })
      .catch(() => setError("Link tidak valid atau sudah kedaluwarsa"))
      .finally(() => setLoading(false));
  }, [params.token]);

  async function runOcrScan(f: File, method: "QRIS" | "Transfer Bank") {
    const requestId = ++ocrRequestIdRef.current;
    setOcrPreview(null);
    setOcrError("");
    setError("");
    setScanningOcr(true);
    try {
      const fd = new FormData();
      fd.append("proof", f);
      fd.append("paymentMethod", method);
      fd.append("token", params.token);
      const resp = await fetch("/api/wa/proof/scan", { method: "POST", body: fd });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Pengecekan bukti gagal");
      if (requestId === ocrRequestIdRef.current) setOcrPreview(data.ocrScan);
    } catch {
      if (requestId === ocrRequestIdRef.current) {
        setOcrError("Pengecekan bukti belum berhasil. Coba pilih foto yang lebih jelas.");
      }
    } finally {
      if (requestId === ocrRequestIdRef.current) setScanningOcr(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Pilih foto atau tangkapan layar bukti pembayaran dalam format gambar.");
      e.target.value = "";
      return;
    }
    if (file) setReplacementAttempts((count) => count + 1);
    setError("");
    setFile(f);
    setOcrPreview(null);
    setOcrError("");
    setPreview(URL.createObjectURL(f));
    await runOcrScan(f, paymentMethod);
  }

  async function handleDownloadQris() {
    const imageUrl = info?.paymentOptions?.qris?.imageUrl;
    if (!imageUrl) return;

    const fileName = `QRIS-${info?.booking?.orderNumber ?? "Sport-Center"}.png`;

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
      // Cross-origin storage may block fetch(). Fall back to the browser's
      // native download/open behavior so the customer can still save the QRIS.
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (!ocrPreviewVerified) {
      setError("Bukti belum lolos pemeriksaan nominal.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("proof", file);
      fd.append("paymentMethod", paymentMethod);
      const resp = await fetch(`/api/wa/proof/${params.token}`, {
        method: "POST",
        body: fd,
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (data.ocrScan) setOcrPreview(data.ocrScan);
        setError(data.error ?? "Upload gagal");
        return;
      }
      setOrderNumber(data.orderNumber);
      setConfirmed(data.status === "confirmed");
      setSuccess(true);
    } catch {
      setError("Gagal mengupload. Coba lagi.");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full shadow-lg">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-9 h-9 text-green-600" />
            </div>
            <div>
              <h2 className="font-black text-xl text-green-700">
                {confirmed ? "Booking Dikonfirmasi!" : "Bukti Terkirim!"}
              </h2>
              <p className="text-gray-600 text-sm mt-1">
                {confirmed
                  ? "Bukti pembayaran cocok dan booking kamu otomatis dikonfirmasi."
                  : "Bukti pembayaran diterima. Status menunggu verifikasi admin sebelum booking menjadi final."}
              </p>
            </div>
            <a
              href={`/status/${orderNumber}`}
              className="block w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-lg text-sm transition-colors">
              🔍 Cek Status Booking
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <p className="font-bold text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const b = info?.booking;
  const grossAmount = b ? (b.grandTotal ?? b.totalPrice) : 0;
  const hasWithholding = !!b && Number(b.pphAmount ?? 0) > 0 && b.netAmount != null;
  const ocrValidation = ocrPreview?.validation;
  const expectedPaymentAmount = Number(
    ocrValidation?.expectedAmount ??
      (hasWithholding ? (b?.netAmount ?? 0) : grossAmount),
  );
  const ocrAmountMatches = ocrValidation?.amountMatch === true;
  const configuredRecipients = paymentMethod === "QRIS"
    ? info?.paymentOptions?.qris?.recipientNames ?? []
    : info?.paymentOptions?.transferBank?.bankAccountName
      ? [info.paymentOptions.transferBank.bankAccountName]
      : [];
  const expectedRecipientLabel =
    ocrValidation?.expectedRecipients.join(" / ") ||
    configuredRecipients.join(" / ") ||
    "Belum dikonfigurasi";
  const amountMismatch = Boolean(ocrPreview) && !ocrAmountMatches;
  const hasConfidentMismatch = amountMismatch;
  const escalationRequired = hasConfidentMismatch && replacementAttempts >= 3;
  const ocrPreviewVerified = ocrAmountMatches;
  const remainingReplacements = Math.max(0, 3 - replacementAttempts);
  const supportWhatsapp = String(info?.supportWhatsapp ?? "").replace(/\D/g, "");
  const supportMessage = encodeURIComponent(
    `Halo Admin Sport Center, saya perlu bantuan verifikasi bukti pembayaran untuk ${b?.orderNumber ?? "booking saya"}. OCR masih tidak cocok setelah 3 kali ganti foto.`,
  );
  const supportUrl = supportWhatsapp
    ? `https://wa.me/${supportWhatsapp}?text=${supportMessage}`
    : null;

  return (
    <div className="min-h-screen bg-orange-50 pb-8">
      <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 pt-8 pb-6">
        <p className="text-orange-100 text-sm font-medium uppercase tracking-wide mb-1">Upload Bukti Pembayaran</p>
        <h1 className="font-black text-2xl">{b?.facilityName}</h1>
        <p className="text-orange-100 text-sm mt-1">{b?.orderNumber}</p>
      </div>

      <div className="px-4 pt-4 max-w-md mx-auto space-y-4">
        {b && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Detail Booking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Row label="Pemesan" value={b.customerName} />
              <Row label="Fasilitas" value={b.facilityName} />
              <Row label="Tanggal" value={b.bookingDate} />
              <Row label="Jam" value={`${b.startTime} – ${b.endTime}`} />
              {hasWithholding && <Row label="Bruto" value={`Rp ${grossAmount.toLocaleString("id-ID")}`} />}
              {hasWithholding && <Row label={`PPh ${b.pphRate ?? 10}%`} value={`−Rp ${Number(b.pphAmount).toLocaleString("id-ID")}`} />}
              <Row
                label={hasWithholding ? "Net Dibayar" : "Grand Total"}
                value={`Rp ${Number(hasWithholding ? b.netAmount : grossAmount).toLocaleString("id-ID")}`}
                accent
              />
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Pembayaran</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {info?.paymentOptions?.transferBank && (
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod("Transfer Bank");
                      if (file) void runOcrScan(file, "Transfer Bank");
                    }}
                    className={`rounded-lg border p-3 text-left text-sm ${paymentMethod === "Transfer Bank" ? "border-orange-500 bg-orange-50" : "border-gray-200"}`}>
                    <div className="font-bold">Transfer Bank</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {info.paymentOptions.transferBank.bankName} · {info.paymentOptions.transferBank.bankAccount}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      a.n. {info.paymentOptions.transferBank.bankAccountName || "Nama pemilik rekening"}
                    </div>
                  </button>
                )}
                {info?.paymentOptions?.qris && (
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMethod("QRIS");
                      if (file) void runOcrScan(file, "QRIS");
                    }}
                    className={`rounded-lg border p-3 text-left text-sm ${paymentMethod === "QRIS" ? "border-orange-500 bg-orange-50" : "border-gray-200"}`}>
                    <div className="font-bold">QRIS</div>
                    <img src={info.paymentOptions.qris.imageUrl} alt="QRIS Sport Center" className="mt-2 h-24 w-24 object-contain" />
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              {paymentMethod === "QRIS" && info?.paymentOptions?.qris && (
                <div className="mb-4 rounded-lg border border-orange-200 bg-white p-3 text-center">
                  <p className="mb-2 text-xs font-semibold text-gray-600">
                    Pindai kode QRIS ini untuk membayar
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowQrDialog(true)}
                    aria-label="Perbesar kode QRIS"
                    className="group mx-auto block rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                  >
                    <img
                      src={info.paymentOptions.qris.imageUrl}
                      alt="Kode QRIS Sport Center"
                      className="mx-auto h-48 w-48 rounded-md object-contain sm:h-56 sm:w-56"
                    />
                    <span className="mt-1 flex items-center justify-center gap-1 text-xs font-semibold text-orange-700">
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
                  <p className="mt-2 text-xs text-gray-600">
                    Penerima QRIS: <strong>{expectedRecipientLabel}</strong>
                  </p>
                </div>
              )}
              <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
                <DialogContent className="max-h-[92vh] max-w-[min(92vw,560px)] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Kode QRIS Sport Center</DialogTitle>
                    <DialogDescription>
                      Perbesar kode ini agar mudah dipindai dari aplikasi pembayaran.
                    </DialogDescription>
                  </DialogHeader>
                  {info?.paymentOptions?.qris && (
                    <img
                      src={info.paymentOptions.qris.imageUrl}
                      alt="Kode QRIS Sport Center ukuran besar"
                      className="mx-auto max-h-[70vh] w-full object-contain"
                    />
                  )}
                  <p className="text-center text-sm text-gray-700">
                    Penerima: <strong>{expectedRecipientLabel}</strong>
                  </p>
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
               {preview ? (
                <div className="space-y-3">
                  <img
                    src={preview}
                    alt="Preview bukti"
                    className="w-full max-h-64 object-contain rounded-lg border bg-gray-50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={escalationRequired}
                    onClick={() => fileRef.current?.click()}>
                    <ImageIcon className="w-4 h-4 mr-2" />
                    {escalationRequired ? "Batas Ganti Foto Tercapai" : "Ganti Foto"}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-orange-300 rounded-xl p-8 text-center hover:border-orange-500 hover:bg-orange-50 transition-colors">
                  <Upload className="w-10 h-10 text-orange-400 mx-auto mb-2" />
                  <p className="font-semibold text-gray-700">Tap untuk pilih foto</p>
                  <p className="text-xs text-gray-500 mt-1">Pilih foto atau tangkapan layar (maks 10MB)</p>
                </button>
              )}
               {scanningOcr && (
                 <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                   Memeriksa bukti pembayaran...
                 </div>
               )}
               {ocrError && (
                 <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                   {ocrError}
                 </div>
               )}
               {ocrPreview && !scanningOcr && (
                 <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                   ocrPreviewVerified
                     ? "border-green-200 bg-green-50 text-green-800"
                     : "border-yellow-200 bg-yellow-50 text-yellow-800"
                 }`}>
                   <p className="font-bold">Hasil pengecekan awal</p>
                    <p className="mt-1">Mode uji coba: hanya nominal yang diperiksa.</p>
                   <div className="mt-2 space-y-1.5">
                     {[
                       {
                         label: "Nominal",
                         value: `${ocrPreview.amount == null ? "Belum terbaca" : `Rp ${Number(ocrPreview.amount).toLocaleString("id-ID")}`} · tagihan Rp ${expectedPaymentAmount.toLocaleString("id-ID")}`,
                         passed: ocrAmountMatches,
                       },
                     ].map((check) => (
                       <p key={check.label} className="flex items-start gap-1.5">
                         {check.passed
                           ? <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                           : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                         <span><strong>{check.label}:</strong> {check.value}</span>
                       </p>
                     ))}
                   </div>
                   <p className="mt-1">
                     {ocrPreviewVerified
                        ? "Nominal cocok. Server akan memeriksa ulang nominal saat bukti dikirim."
                       : escalationRequired
                          ? "Nominal masih tidak cocok setelah 3 kali ganti foto. Silakan hubungi admin untuk pemeriksaan manual."
                         : hasConfidentMismatch
                            ? `Nominal bukti belum cocok atau belum terbaca. Ganti foto${remainingReplacements > 0 ? ` (tersisa ${remainingReplacements} kali)` : ""}. Bukti hanya dapat dikirim jika nominal cocok.`
                            : "Pengecekan nominal belum selesai. Silakan coba foto yang lebih jelas."}
                   </p>
                 </div>
               )}
            </CardContent>
          </Card>

          {escalationRequired && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
              <div className="flex items-start gap-2 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">Perlu bantuan admin</p>
                  <p className="mt-1">
                    Bukti pembayaran masih tidak cocok setelah 3 kali ganti foto. Jangan kirim bukti ini lagi.
                  </p>
                </div>
              </div>
              {supportUrl ? (
                <a
                  href={supportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full rounded-lg bg-green-600 hover:bg-green-700 text-white text-center font-bold py-3 px-4">
                  Hubungi Admin via WhatsApp
                </a>
              ) : (
                <p className="text-xs text-red-700">
                  Nomor admin belum tersedia di sistem. Silakan hubungi petugas Sport Center.
                </p>
              )}
            </div>
          )}

          <Button
            type="submit"
            disabled={!file || uploading || scanningOcr || !ocrPreviewVerified}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-base py-6 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed">
            {uploading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Mengirim...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Kirim Bukti Pembayaran
              </span>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-xs text-gray-500 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm font-semibold text-right ${accent ? "text-orange-600" : "text-gray-800"}`}>{value}</span>
    </div>
  );
}
