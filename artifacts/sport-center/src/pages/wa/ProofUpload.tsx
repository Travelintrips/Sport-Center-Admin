import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Upload, Image as ImageIcon } from "lucide-react";

interface OcrPreview {
  paymentMethod: "QRIS" | "Transfer Bank" | "unknown";
  confidence: number;
  signals: string[];
  amount: number | null;
  date: string | null;
  engine: "tesseract" | "unsupported" | "failed";
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
    qris: { imageUrl: string } | null;
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
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (file) setReplacementAttempts((count) => count + 1);
    setFile(f);
    setOcrPreview(null);
    setOcrError("");
    setScanningOcr(true);
    const url = URL.createObjectURL(f);
    setPreview(url);

    try {
      const fd = new FormData();
      fd.append("proof", f);
      const resp = await fetch("/api/wa/proof/scan", { method: "POST", body: fd });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Pengecekan bukti gagal");
      setOcrPreview(data.ocrScan);
    } catch {
      // The final submit still performs a server-side scan. A preview outage
      // must not prevent a customer from submitting an otherwise valid proof.
      setOcrError("Pengecekan awal belum tersedia. Bukti akan diperiksa saat dikirim.");
    } finally {
      setScanningOcr(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
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
      if (!resp.ok) { setError(data.error ?? "Upload gagal"); return; }
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
  const expectedPaymentAmount = Number(
    hasWithholding ? (b?.netAmount ?? 0) : grossAmount,
  );
  const ocrAmountMatches =
    ocrPreview?.amount != null &&
    expectedPaymentAmount > 0 &&
    Number(ocrPreview.amount) === expectedPaymentAmount;
  const ocrMethodMatches =
    ocrPreview?.paymentMethod !== "unknown" &&
    ocrPreview?.paymentMethod === paymentMethod;
  const bookingCreatedDate = b?.createdAt
    ? new Date(b.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
    : null;
  const todayWib = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const ocrDateMatches =
    Boolean(
      ocrPreview?.date &&
      bookingCreatedDate &&
      ocrPreview.date >= bookingCreatedDate &&
      ocrPreview.date <= todayWib,
    );
  const methodMismatch =
    Boolean(ocrPreview) &&
    ocrPreview.paymentMethod !== "unknown" &&
    !ocrMethodMatches;
  const amountMismatch =
    Boolean(ocrPreview) &&
    ocrPreview.amount != null &&
    expectedPaymentAmount > 0 &&
    !ocrAmountMatches;
  const dateMismatch =
    Boolean(ocrPreview?.date) &&
    Boolean(bookingCreatedDate) &&
    !ocrDateMatches;
  const hasConfidentMismatch = methodMismatch || amountMismatch || dateMismatch;
  const escalationRequired = hasConfidentMismatch && replacementAttempts >= 3;
  const ocrPreviewVerified =
    Boolean(ocrPreview) &&
    ocrAmountMatches &&
    ocrMethodMatches &&
    ocrDateMatches;
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
                    onClick={() => setPaymentMethod("Transfer Bank")}
                    className={`rounded-lg border p-3 text-left text-sm ${paymentMethod === "Transfer Bank" ? "border-orange-500 bg-orange-50" : "border-gray-200"}`}>
                    <div className="font-bold">Transfer Bank</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {info.paymentOptions.transferBank.bankName} · {info.paymentOptions.transferBank.bankAccount}
                    </div>
                  </button>
                )}
                {info?.paymentOptions?.qris && (
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("QRIS")}
                    className={`rounded-lg border p-3 text-left text-sm ${paymentMethod === "QRIS" ? "border-orange-500 bg-orange-50" : "border-gray-200"}`}>
                    <div className="font-bold">QRIS</div>
                    <img src={info.paymentOptions.qris.imageUrl} alt="QRIS Sport Center" className="mt-2 h-24 w-24 object-contain" />
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                 accept="image/*,.pdf,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
               {preview ? (
                <div className="space-y-3">
                   {file?.type === "application/pdf" ? (
                     <div className="rounded-lg border bg-gray-50 px-4 py-8 text-center text-sm text-gray-700">
                       <p className="font-semibold">File PDF siap diperiksa</p>
                       <p className="mt-1 text-xs text-gray-500">{file.name}</p>
                     </div>
                   ) : (
                     <img
                       src={preview}
                       alt="Preview bukti"
                       className="w-full max-h-64 object-contain rounded-lg border bg-gray-50"
                     />
                   )}
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
                   <p className="text-xs text-gray-500 mt-1">JPG, PNG, atau PDF (maks 10MB)</p>
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
                   <p className="mt-1">
                     Metode: <strong>{ocrPreview.paymentMethod === "unknown" ? "Belum terbaca" : ocrPreview.paymentMethod}</strong>
                     {ocrPreview.paymentMethod !== "unknown" && !ocrMethodMatches && (
                       <span> — tidak sesuai pilihan {paymentMethod}</span>
                     )}
                   </p>
                   <p>
                     Nominal: <strong>{ocrPreview.amount == null ? "Belum terbaca" : `Rp ${Number(ocrPreview.amount).toLocaleString("id-ID")}`}</strong>
                     {ocrPreview.amount != null && expectedPaymentAmount > 0 && !ocrAmountMatches && (
                       <span> — tagihan Rp {expectedPaymentAmount.toLocaleString("id-ID")}</span>
                     )}
                   </p>
                   <p>
                     Tanggal transaksi: <strong>{ocrPreview.date ?? "Belum terbaca"}</strong>
                     {ocrPreview.date && !ocrDateMatches && bookingCreatedDate && (
                       <span> — tidak valid untuk booking yang dibuat {bookingCreatedDate}</span>
                     )}
                   </p>
                   <p className="mt-1">
                     {ocrPreviewVerified
                       ? "Metode, nominal, dan tanggal transaksi sesuai. Server akan memeriksa ulang bukti saat dikirim."
                       : escalationRequired
                         ? "Bukti masih tidak cocok setelah 3 kali ganti foto. Silakan hubungi admin untuk pemeriksaan manual."
                         : hasConfidentMismatch
                           ? `Bukti belum cocok. Silakan Ganti Foto${remainingReplacements > 0 ? ` (tersisa ${remainingReplacements} kali)` : ""}.`
                           : "Sebagian data OCR belum terbaca. Bukti tetap dapat dikirim dan akan menunggu verifikasi admin."}
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
            disabled={!file || uploading || scanningOcr || hasConfidentMismatch}
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
