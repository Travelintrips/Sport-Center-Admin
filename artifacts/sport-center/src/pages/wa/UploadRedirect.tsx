import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { MessageCircle } from "lucide-react";

export default function WaUploadRedirect() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderNumber) return;
    fetch(`/api/wa/get-proof-token/${orderNumber}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.token) {
          window.location.replace(`/wa/proof/${data.token}`);
        } else {
          setError(data.error || "Link upload tidak tersedia");
        }
      })
      .catch(() => setError("Terjadi kesalahan jaringan. Coba lagi."));
  }, [orderNumber]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl p-6 shadow-md text-center space-y-3 max-w-sm w-full">
          <div className="text-4xl">⚠️</div>
          <h2 className="font-bold text-slate-800">Link Tidak Valid</h2>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl p-6 shadow-md text-center space-y-4 max-w-sm w-full">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto animate-pulse">
          <MessageCircle className="text-green-600" size={26} />
        </div>
        <div>
          <h2 className="font-bold text-slate-800 text-lg">Mengalihkan...</h2>
          <p className="text-sm text-slate-500 mt-1">
            Membuka halaman upload bukti pembayaran untuk{" "}
            <strong className="text-slate-700">{orderNumber}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
