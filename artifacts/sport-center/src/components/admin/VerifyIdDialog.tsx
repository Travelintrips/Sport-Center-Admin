import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useVerifyBooking, getListBookingsQueryKey } from "@workspace/api-client-react";
import type { VerifyResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ScanLine, CameraOff, CheckCircle2, XCircle, Plane } from "lucide-react";

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

type VerifyDialogBooking = {
  id: number;
  orderNumber: string;
  customerName: string;
  idCardNumber?: string | null;
  verificationStatus?: string | null;
};

const READER_ID = "ap-qr-reader";

export default function VerifyIdDialog({
  booking,
  onClose,
}: {
  booking: VerifyDialogBooking | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [idCardNumber, setIdCardNumber] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const open = !!booking;

  useEffect(() => {
    if (booking) {
      setIdCardNumber(booking.idCardNumber ?? "");
      setResult(null);
    }
  }, [booking]);

  const stopScan = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        /* noop */
      }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => {
      void stopScan();
    };
  }, []);

  const verifyMutation = useVerifyBooking({
    mutation: {
      onSuccess: (res) => {
        setResult(res);
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
      },
      onError: (e: any) => toast({ title: "Verifikasi gagal", description: e?.message, variant: "destructive" }),
    },
  });

  const startScan = async () => {
    setScanning(true);
    setResult(null);
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode(READER_ID);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            setIdCardNumber(decodedText.trim().toUpperCase());
            void stopScan();
          },
          () => { /* ignore per-frame errors */ },
        );
      } catch {
        toast({ title: "Tidak bisa mengakses kamera", description: "Gunakan input manual.", variant: "destructive" });
        setScanning(false);
      }
    }, 100);
  };

  const handleClose = async () => {
    await stopScan();
    onClose();
  };

  const handleVerify = () => {
    if (!booking || !idCardNumber.trim()) {
      toast({ title: "Masukkan nomor ID Card", variant: "destructive" });
      return;
    }
    verifyMutation.mutate({ id: booking.id, data: { idCardNumber: idCardNumber.trim() } });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) void handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plane size={18} /> Verifikasi ID Card Angkasa Pura
          </DialogTitle>
        </DialogHeader>

        {booking && (
          <div className="space-y-4">
            <div className="text-sm bg-muted/50 rounded-lg p-3">
              <div className="flex justify-between"><span className="text-muted-foreground">Order</span><span className="font-mono font-semibold">{booking.orderNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pemesan</span><span className="font-medium">{booking.customerName}</span></div>
            </div>

            {result ? (
              <div className={`rounded-lg border p-4 ${result.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                <div className={`flex items-center gap-2 font-semibold ${result.success ? "text-green-700" : "text-red-700"}`}>
                  {result.success ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                  {result.success ? "Verifikasi Berhasil" : "Verifikasi Gagal"}
                </div>
                <p className={`text-sm mt-1 ${result.success ? "text-green-600" : "text-red-600"}`}>{result.message}</p>
                {result.success && (
                  <div className="mt-3 space-y-1 text-sm">
                    {result.memberName && <div className="flex justify-between"><span className="text-muted-foreground">Nama Member</span><span className="font-medium">{result.memberName}</span></div>}
                    {result.discountPercentage != null && <div className="flex justify-between"><span className="text-muted-foreground">Diskon</span><span className="font-medium">{result.discountPercentage}%</span></div>}
                    {result.discountAmount != null && <div className="flex justify-between"><span className="text-muted-foreground">Potongan</span><span className="font-medium text-green-700">−{formatCurrency(result.discountAmount)}</span></div>}
                    {result.finalPrice != null && <div className="flex justify-between border-t pt-1 mt-1"><span className="text-muted-foreground">Total Akhir</span><span className="font-bold text-primary">{formatCurrency(result.finalPrice)}</span></div>}
                  </div>
                )}
              </div>
            ) : (
              <>
                {booking.verificationStatus === "rejected" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Verifikasi sebelumnya ditolak. Masukkan atau scan ID Card yang benar untuk mencoba lagi.
                  </div>
                )}
                {scanning ? (
                  <div className="space-y-2">
                    <div id={READER_ID} className="rounded-lg overflow-hidden border" />
                    <Button type="button" variant="outline" className="w-full" onClick={() => void stopScan()}>
                      <CameraOff size={15} className="mr-2" /> Hentikan Scan
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" className="w-full" onClick={startScan}>
                    <ScanLine size={15} className="mr-2" /> Scan QR ID Card
                  </Button>
                )}

                <div className="space-y-2">
                  <Label>Nomor ID Card</Label>
                  <Input
                    value={idCardNumber}
                    onChange={(e) => setIdCardNumber(e.target.value.toUpperCase())}
                    placeholder="AP-2024-001"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Scan QR atau masukkan nomor secara manual.</p>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => void handleClose()}>
            {result ? "Tutup" : "Batal"}
          </Button>
          {!result && (
            <Button onClick={handleVerify} disabled={verifyMutation.isPending}>
              {verifyMutation.isPending ? "Memverifikasi..." : "Verifikasi"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
