import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { CheckCircle, AlertCircle, Loader2, Building2, Phone, MapPin, Printer } from "lucide-react";

interface KwitansiData {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: number;
  ppnRate: number | null;
  ppnAmount: number | null;
  grandTotal: number | null;
  status: string;
  confirmedAt: string;
  centerName: string;
  centerAddress: string;
  centerPhone: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
  financeName: string;
  financeTitle: string;
  financeSignature: string | null;
}

function formatIDR(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDate(s: string) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleDateString("id-ID", {
      day: "2-digit", month: "long", year: "numeric",
    });
  } catch { return s; }
}

function formatDateTime(s: string) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " WIB";
  } catch { return s; }
}

export default function WaKwitansi() {
  const params = useParams<{ orderNumber: string }>();
  const [data, setData] = useState<KwitansiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/public/kwitansi-data/${params.orderNumber}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Gagal memuat kwitansi. Coba lagi."))
      .finally(() => setLoading(false));
  }, [params.orderNumber]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-10 h-10 text-orange-500 animate-spin mx-auto" />
          <p className="text-gray-500 text-sm">Memuat kwitansi...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <h2 className="font-black text-lg text-gray-800">Kwitansi Tidak Ditemukan</h2>
          <p className="text-gray-500 text-sm">{error || "Link kwitansi tidak valid atau sudah kedaluwarsa."}</p>
        </div>
      </div>
    );
  }

  const subtotal = data.totalPrice;
  const ppn = data.ppnAmount ?? 0;
  const grand = data.grandTotal ?? subtotal;
  const hasPpn = ppn > 0 && data.ppnRate != null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-gray-50 pb-10 print:bg-white print:pb-0">
      {/* Header strip */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-5 pt-8 pb-10 print:pt-4 print:pb-6">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-5 h-5 text-white/90" />
            <span className="text-white/80 text-sm font-medium uppercase tracking-wider">Kwitansi Pembayaran</span>
          </div>
          <h1 className="font-black text-3xl leading-tight">{data.centerName}</h1>
          {data.centerAddress && (
            <p className="text-white/70 text-xs mt-1 flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" /> {data.centerAddress}
            </p>
          )}
          {data.centerPhone && (
            <p className="text-white/70 text-xs flex items-center gap-1">
              <Phone className="w-3 h-3 shrink-0" /> {data.centerPhone}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 -mt-5 space-y-4">
        {/* Confirmed badge */}
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center shrink-0">
            <CheckCircle className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="font-black text-green-800 text-base">Pembayaran Dikonfirmasi ✅</p>
            <p className="text-green-600 text-xs">{formatDateTime(data.confirmedAt)}</p>
          </div>
        </div>

        {/* Order info card */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Nomor Order</p>
            <p className="font-black text-xl text-orange-600 font-mono">{data.orderNumber}</p>
          </div>
          <div className="px-4 py-4 space-y-3">
            <Row label="Nama Customer" value={data.customerName} bold />
            <Row label="No. HP" value={data.customerPhone} />
            <div className="border-t pt-3 mt-1 space-y-3">
              <Row label="Fasilitas" value={data.facilityName} bold />
              <Row label="Tanggal" value={formatDate(data.bookingDate)} />
              <Row label="Waktu" value={`${data.startTime} – ${data.endTime}`} />
              <Row label="Durasi" value={`${data.durationHours} jam`} />
            </div>
          </div>
        </div>

        {/* Payment summary */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Rincian Pembayaran</p>
          </div>
          <div className="px-4 py-4 space-y-2.5">
            <Row label="Subtotal" value={formatIDR(subtotal)} />
            {hasPpn && (
              <Row label={`PPN ${data.ppnRate}%`} value={formatIDR(ppn)} />
            )}
            <div className="border-t pt-3 mt-1">
              <div className="flex justify-between items-center">
                <span className="font-black text-gray-800">Total Dibayar</span>
                <span className="font-black text-xl text-orange-600">{formatIDR(grand)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Signature & stamp area */}
        <div className="bg-white rounded-2xl shadow-sm border px-4 py-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-gray-500 mb-1">Diterbitkan oleh</p>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-orange-500 shrink-0" />
                <p className="font-bold text-sm text-gray-800">{data.centerName}</p>
              </div>
              {data.centerPhone && <p className="text-xs text-gray-500 mt-0.5 ml-6">{data.centerPhone}</p>}
            </div>
            <div className="text-right">
              <div className="w-20 h-20 border-2 border-dashed border-orange-300 rounded-full flex items-center justify-center bg-orange-50">
                <div className="text-center">
                  <p className="text-[9px] font-black text-orange-600 uppercase leading-tight">LUNAS</p>
                  <CheckCircle className="w-5 h-5 text-orange-500 mx-auto mt-0.5" />
                </div>
              </div>
            </div>
          </div>

          {/* Signature block — sama seperti admin portal */}
          <div className="mt-5 flex justify-end">
            <div className="text-right min-w-[160px]">
              <p className="text-xs text-gray-500 mb-2">Hormat kami,</p>
              <div className="flex flex-col items-center">
                {data.financeSignature ? (
                  <img
                    src={data.financeSignature}
                    alt="Tanda tangan"
                    className="h-14 w-auto object-contain mb-1"
                  />
                ) : (
                  <div className="h-14" />
                )}
                <div className="w-full border-b-2 border-gray-400 mb-1" />
                <p className="font-black text-sm text-gray-800">{data.financeName || data.centerName}</p>
                <p className="text-xs text-gray-500">{data.financeTitle || "Finance"}</p>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-gray-400 mt-3 text-center">
            Kwitansi ini merupakan bukti pembayaran yang sah. Diterbitkan secara digital oleh sistem Sport Center.
          </p>
        </div>

        {/* Print button (hidden on print) */}
        <button
          onClick={() => window.print()}
          className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-600 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors print:hidden shadow-sm"
        >
          <Printer className="w-4 h-4" />
          Cetak / Simpan PDF
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-xs text-gray-500 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm text-right ${bold ? "font-bold text-gray-900" : "font-medium text-gray-700"}`}>
        {value}
      </span>
    </div>
  );
}
