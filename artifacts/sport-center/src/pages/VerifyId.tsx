import { useState, useRef, useCallback, useEffect } from "react";
import jsQR from "jsqr";
import { useVerifyBookingByOrder } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import {
  Camera, CameraOff, CheckCircle2, XCircle, Loader2,
  CreditCard, Hash, RotateCcw, ShieldCheck, ShieldX, AlertTriangle,
} from "lucide-react";

type VerifyState =
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: "done"; success: boolean; result: string; message: string; memberName?: string | null; discountApplied?: boolean; discountPercentage?: number; finalPrice?: number }
  | { phase: "error"; message: string };

export default function VerifyId() {
  const { t } = useLang();
  const { toast } = useToast();

  const prefilledOrder = new URLSearchParams(window.location.search).get("order") || "";
  const [orderNumber, setOrderNumber] = useState(prefilledOrder);
  const [idCardNumber, setIdCardNumber] = useState("");
  const [state, setState] = useState<VerifyState>({ phase: "idle" });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFor, setCameraFor] = useState<"order" | "id" | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const mutation = useVerifyBookingByOrder({
    mutation: {
      onSuccess: (data) => {
        setState({
          phase: "done",
          success: data.success,
          result: data.result,
          message: data.message ?? "",
          memberName: data.memberName,
          discountApplied: data.discountApplied,
          discountPercentage: data.discountPercentage,
          finalPrice: data.finalPrice,
        });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? t("Terjadi kesalahan", "An error occurred");
        setState({ phase: "error", message: msg });
      },
    },
  });

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setCameraFor(null);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = useCallback(async (target: "order" | "id") => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraFor(target);
      setCameraOpen(true);
    } catch (e) {
      toast({ title: t("Kamera tidak tersedia", "Camera not available"), description: String(e), variant: "destructive" });
    }
  }, [stopCamera, toast, t]);

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
    if (code?.data) {
      const value = code.data.trim().toUpperCase();
      if (cameraFor === "order") setOrderNumber(value);
      else if (cameraFor === "id") setIdCardNumber(value);
      stopCamera();
      toast({ title: t("QR berhasil dibaca!", "QR code scanned!"), description: value });
      return;
    }
    rafRef.current = requestAnimationFrame(scanFrame);
  }, [cameraFor, stopCamera, toast, t]);

  useEffect(() => {
    if (cameraOpen && videoRef.current) {
      rafRef.current = requestAnimationFrame(scanFrame);
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [cameraOpen, scanFrame]);

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const on = orderNumber.trim().toUpperCase();
    const ic = idCardNumber.trim().toUpperCase();
    if (!on || !ic) {
      toast({ title: t("Isi semua field", "Fill all fields"), variant: "destructive" }); return;
    }
    setState({ phase: "idle" });
    mutation.mutate({ data: { orderNumber: on, idCardNumber: ic } });
  }

  function handleReset() {
    setState({ phase: "idle" });
    setOrderNumber("");
    setIdCardNumber("");
    stopCamera();
  }

  const isLoading = mutation.isPending;

  return (
    <div className="container mx-auto px-4 py-10 max-w-xl">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck size={32} className="text-primary" />
        </div>
        <h1 className="text-3xl font-black tracking-tight">{t("Verifikasi ID Card", "ID Card Verification")}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {t("Khusus karyawan Angkasa Pura II — verifikasi diskon booking fasilitas olahraga.", "For Angkasa Pura II employees — verify your sports facility booking discount.")}
        </p>
      </div>

      {/* Camera viewfinder */}
      {cameraOpen && (
        <Card className="mb-6 border-primary/40 shadow-lg overflow-hidden">
          <CardContent className="p-0 relative">
            <video ref={videoRef} playsInline muted className="w-full aspect-video object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            {/* Scan overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-56 h-40 border-4 border-primary rounded-xl opacity-70 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4 flex items-center justify-between">
              <p className="text-white text-sm font-semibold">
                {cameraFor === "order"
                  ? t("Arahkan ke QR nomor order", "Point at order number QR")
                  : t("Arahkan ke QR ID Card", "Point at ID card QR")}
              </p>
              <Button size="sm" variant="secondary" onClick={stopCamera}>
                <CameraOff size={14} className="mr-1" /> {t("Tutup", "Close")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result card — success */}
      {state.phase === "done" && state.success && (
        <Card className="mb-6 border-green-200 bg-green-50/60 shadow-md">
          <CardContent className="p-6 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle2 size={36} className="text-green-600" />
            </div>
            <h2 className="text-xl font-black text-green-900">{t("Berhasil Terverifikasi", "Successfully Verified")}</h2>
            {state.memberName && (
              <p className="text-green-800 font-semibold text-sm">{t("Nama", "Name")}: {state.memberName}</p>
            )}
            <p className="text-green-700 text-sm">{state.message}</p>
            {state.discountApplied && (
              <div className="inline-flex items-center gap-2 bg-green-200/60 border border-green-300 rounded-xl px-4 py-2 text-green-800 font-bold text-sm">
                <CreditCard size={15} />
                Diskon {state.discountPercentage}% · Harga akhir Rp {state.finalPrice?.toLocaleString("id-ID")}
              </div>
            )}
            <Button onClick={handleReset} variant="outline" className="mt-2">
              <RotateCcw size={14} className="mr-1.5" /> {t("Verifikasi Lainnya", "Verify Another")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Result card — failed */}
      {state.phase === "done" && !state.success && (
        <Card className="mb-6 border-red-200 bg-red-50/60 shadow-md">
          <CardContent className="p-6 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              {state.result === "mismatch"
                ? <AlertTriangle size={36} className="text-orange-500" />
                : <ShieldX size={36} className="text-red-600" />}
            </div>
            <h2 className="text-xl font-black text-red-900">
              {state.result === "mismatch"
                ? t("ID Tidak Cocok", "ID Mismatch")
                : t("Nomor ID Tidak Valid", "Invalid ID Number")}
            </h2>
            <p className="text-red-700 text-sm">{state.message}</p>
            <Button onClick={handleReset} variant="outline" className="mt-2">
              <RotateCcw size={14} className="mr-1.5" /> {t("Coba Lagi", "Try Again")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Error card */}
      {state.phase === "error" && (
        <Card className="mb-6 border-red-200 bg-red-50/60">
          <CardContent className="p-5 flex items-start gap-3">
            <XCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-red-900 text-sm">{t("Error", "Error")}</div>
              <div className="text-red-700 text-sm">{state.message}</div>
              <Button size="sm" variant="link" className="text-red-600 p-0 h-auto mt-1" onClick={handleReset}>
                {t("Coba lagi", "Try again")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Input form */}
      {(state.phase === "idle" || state.phase === "error") && (
        <Card className="shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">{t("Data Verifikasi", "Verification Data")}</CardTitle>
            <CardDescription className="text-xs">
              {t("Scan QR code atau ketik manual nomor order dan nomor ID Card.", "Scan QR code or type the order number and ID card number manually.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerify} className="space-y-5">
              {/* Order number */}
              <div className="space-y-1.5">
                <Label htmlFor="order-number" className="flex items-center gap-1.5">
                  <Hash size={13} className="text-muted-foreground" />
                  {t("Nomor Order", "Order Number")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="order-number"
                    placeholder="SC-001"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
                    className="font-mono tracking-wide"
                    disabled={isLoading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => startCamera("order")}
                    disabled={isLoading || cameraOpen}
                    title={t("Scan QR", "Scan QR")}
                    className="shrink-0"
                  >
                    <Camera size={16} />
                  </Button>
                </div>
              </div>

              {/* ID Card number */}
              <div className="space-y-1.5">
                <Label htmlFor="id-card" className="flex items-center gap-1.5">
                  <CreditCard size={13} className="text-muted-foreground" />
                  {t("Nomor ID Card", "ID Card Number")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="id-card"
                    placeholder={t("Nomor ID Card karyawan AP2", "AP2 employee ID card number")}
                    value={idCardNumber}
                    onChange={(e) => setIdCardNumber(e.target.value.toUpperCase())}
                    className="font-mono tracking-wide"
                    disabled={isLoading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => startCamera("id")}
                    disabled={isLoading || cameraOpen}
                    title={t("Scan QR", "Scan QR")}
                    className="shrink-0"
                  >
                    <Camera size={16} />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("Nomor akan dicocokkan ke database karyawan Angkasa Pura II yang aktif.", "Number will be matched against the active AP2 employee database.")}
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-bold text-base"
                disabled={isLoading || !orderNumber.trim() || !idCardNumber.trim()}
              >
                {isLoading
                  ? <><Loader2 size={16} className="mr-2 animate-spin" />{t("Memverifikasi...", "Verifying...")}</>
                  : <><ShieldCheck size={16} className="mr-2" />{t("Verifikasi ID Card", "Verify ID Card")}</>}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Info box */}
      <div className="mt-6 p-4 rounded-xl bg-muted/40 border border-border/60 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground/70">{t("Catatan:", "Notes:")}</p>
        <p>• {t("Fitur ini hanya untuk karyawan Angkasa Pura II yang melakukan booking sebagai \"Angkasa Pura\".", "This feature is only for AP2 employees who booked as \"Angkasa Pura\".")}</p>
        <p>• {t("Nomor ID Card harus terdaftar di database karyawan aktif.", "The ID card number must be registered in the active employee database.")}</p>
        <p>• {t("Verifikasi berhasil akan menerapkan diskon karyawan sesuai kebijakan.", "Successful verification will apply the employee discount per policy.")}</p>
        <p>• {t("Setiap percobaan verifikasi dicatat dalam log aktivitas.", "Every verification attempt is recorded in the activity log.")}</p>
      </div>
    </div>
  );
}
