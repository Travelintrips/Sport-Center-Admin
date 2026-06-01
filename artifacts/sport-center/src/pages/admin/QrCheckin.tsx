import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useMutation } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { QrCode, CheckCircle, XCircle, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

export default function AdminQrCheckin() {
  const [orderNumber, setOrderNumber] = useState("");
  const [result, setResult] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const checkinMutation = useMutation({
    mutationFn: (orderNumber: string) =>
      fetch(`${API}/bookings/checkin`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ orderNumber }) }).then(r => r.json()),
    onSuccess: (data) => {
      setResult(data);
      setOrderNumber("");
      if (data.success) {
        toast({ title: data.alreadyCheckedIn ? "Sudah Check-In" : "✅ Check-In Berhasil!", description: data.message });
      } else {
        toast({ title: "Gagal", description: data.error, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Error", description: "Gagal melakukan check-in", variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderNumber.trim()) return;
    checkinMutation.mutate(orderNumber.trim().toUpperCase());
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div>
        <h1 className="text-3xl font-black flex items-center gap-2"><QrCode size={28} /> QR Check-In</h1>
        <p className="text-muted-foreground mt-1">Scan QR code customer atau masukkan nomor order</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Input Nomor Order</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value.toUpperCase())}
                placeholder="SC-0001"
                className="font-mono text-lg h-12"
                autoFocus
              />
              <Button type="submit" disabled={checkinMutation.isPending} className="h-12 px-6 gap-2">
                <Search size={18} />
                {checkinMutation.isPending ? "..." : "Check-In"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: Gunakan scanner barcode/QR yang otomatis menekan Enter setelah scan.
            </p>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card className={result.success ? "border-green-500 border-2" : "border-destructive border-2"}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-4">
              {result.success ? (
                <CheckCircle size={40} className={result.alreadyCheckedIn ? "text-orange-500" : "text-green-500"} />
              ) : (
                <XCircle size={40} className="text-destructive" />
              )}
              <div>
                <div className={`text-xl font-bold ${result.success ? (result.alreadyCheckedIn ? "text-orange-600" : "text-green-600") : "text-destructive"}`}>
                  {result.success ? (result.alreadyCheckedIn ? "Sudah Check-In Sebelumnya" : "Check-In Berhasil!") : "Gagal Check-In"}
                </div>
                <div className="text-sm text-muted-foreground">{result.message ?? result.error}</div>
              </div>
            </div>

            {result.booking && (
              <div className="bg-muted/30 rounded-lg p-4 space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">Order:</span> <span className="font-mono font-bold">{result.booking.orderNumber}</span></div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{result.booking.status}</Badge></div>
                  <div><span className="text-muted-foreground">Customer:</span> <span className="font-medium">{result.booking.customerName}</span></div>
                  <div><span className="text-muted-foreground">Telepon:</span> {result.booking.customerPhone}</div>
                  <div><span className="text-muted-foreground">Fasilitas:</span> {result.booking.facilityName}</div>
                  <div><span className="text-muted-foreground">Tanggal:</span> {result.booking.bookingDate}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Jam:</span> <span className="font-semibold">{result.booking.startTime} – {result.booking.endTime}</span></div>
                  {result.checkedInAt && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Check-in:</span>{" "}
                      <span className="font-medium">{new Date(result.checkedInAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button variant="outline" className="w-full mt-4" onClick={() => { setResult(null); inputRef.current?.focus(); }}>
              Scan Berikutnya
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader><CardTitle className="text-base">Cara Penggunaan</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Minta customer menunjukkan QR code dari halaman invoice booking mereka</p>
          <p>2. Arahkan scanner QR ke QR code tersebut (atau scan dari foto)</p>
          <p>3. Nomor order (SC-XXXX) akan terisi otomatis dan check-in dilakukan</p>
          <p>4. Atau ketik nomor order secara manual lalu tekan Enter / tombol Check-In</p>
          <p className="text-xs pt-1">⚠️ Hanya booking berstatus <strong>Confirmed</strong> yang bisa check-in</p>
        </CardContent>
      </Card>
    </div>
  );
}
