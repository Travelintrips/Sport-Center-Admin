import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Upload, Image as ImageIcon } from "lucide-react";

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
    status: string;
  };
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
  const [orderNumber, setOrderNumber] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/wa/action/${params.token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else if (data.action !== "upload_proof") setError("Link ini bukan untuk upload bukti");
        else setInfo(data);
      })
      .catch(() => setError("Link tidak valid atau sudah kedaluwarsa"))
      .finally(() => setLoading(false));
  }, [params.token]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("proof", file);
      const resp = await fetch(`/api/wa/proof/${params.token}`, {
        method: "POST",
        body: fd,
      });
      const data = await resp.json();
      if (!resp.ok) { setError(data.error ?? "Upload gagal"); return; }
      setOrderNumber(data.orderNumber);
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
              <h2 className="font-black text-xl text-green-700">Bukti Terkirim!</h2>
              <p className="text-gray-600 text-sm mt-1">
                Bukti pembayaran berhasil diupload. Admin akan memverifikasi dalam waktu singkat.
              </p>
            </div>
            <a
              href={`/wa/status/${orderNumber}`}
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
              <Row label="Grand Total (incl. PPN)" value={`Rp ${(b.grandTotal != null ? Number(b.grandTotal) : b.totalPrice).toLocaleString("id-ID")}`} accent />
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
              <CardTitle className="text-sm font-bold text-gray-700 uppercase tracking-wide">Pilih Foto Bukti Transfer</CardTitle>
            </CardHeader>
            <CardContent>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
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
                    onClick={() => fileRef.current?.click()}>
                    <ImageIcon className="w-4 h-4 mr-2" />
                    Ganti Foto
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
            </CardContent>
          </Card>

          <Button
            type="submit"
            disabled={!file || uploading}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-base py-6 rounded-xl">
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
