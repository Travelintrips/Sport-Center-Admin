import { useEffect, useRef, useState } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Camera, LockKeyhole, ShieldCheck, AlertTriangle } from "lucide-react";

/**
 * Safe compatibility stage ONLY. Camera frames never leave the handset,
 * and this page has no endpoint capable of mutating X904 accounts.
 */
export default function GymDoorEnrollment() {
  const { data: user, isLoading, isError } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const pinValid = /^[0-9]{4,8}$/.test(pin) && pin === confirmPin;
  const capture = () => {
    // The preview frame is deliberately not serialized or uploaded.
    // A successful capture here only verifies that a live video frame exists.
    if (!cameraReady || !video.current?.videoWidth || !video.current?.videoHeight) return;
    setCaptured(true);
  };
  const stop = () => {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCameraReady(false);
    setCaptured(false);
  };
  useEffect(() => () => {
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);
  async function startCamera() {
    stop();
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Browser atau koneksi HTTPS tidak mendukung kamera.");
      const live = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user" } });
      stream.current = live;
      // A camera permission revocation or background interruption must invalidate
      // any earlier successful frame preflight immediately.
      for (const track of live.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (stream.current === live) {
            setCameraReady(false);
            setCaptured(false);
            setCameraError("Kamera terputus. Ulangi pemeriksaan kamera sebelum melanjutkan.");
          }
        }, { once: true });
      }
      if (video.current) {
        video.current.srcObject = live;
        await video.current.play();
      }
      setCameraReady(true);
    } catch {
      stop();
      setCameraError("Kamera tidak dapat dibuka. Periksa izin kamera, HTTPS, dan browser HP.");
    }
  }
  if (isLoading) return <main className="mx-auto max-w-xl p-6">Memeriksa akun…</main>;
  if (isError || !user) return <main className="mx-auto max-w-xl p-6"><h1 className="text-xl font-bold">Login diperlukan</h1><p className="my-3">Masuk menggunakan akun Sport Center milik Anda.</p><Link href="/login" className="text-primary underline">Login</Link></main>;
  return (
    <main className="mx-auto max-w-xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-bold">Pendaftaran Akses Pintu Gym</h1>
      <p className="text-sm text-muted-foreground">Akun: {user.name}. Pendaftaran hanya untuk pemilik akun sendiri.</p>
      <section className="rounded-xl border p-4 space-y-3" aria-label="Uji kompatibilitas kamera">
        <div className="flex items-center gap-2 font-semibold"><Camera className="h-5 w-5" /> Kamera HP</div>
        <p className="text-sm">Tahap pemeriksaan kamera Android/iPhone. Belum melakukan pendaftaran wajah atau mengirim gambar ke server.</p>
        <video ref={video} autoPlay playsInline muted className="aspect-[3/4] max-h-80 w-full rounded-lg bg-black object-cover" aria-label="Pratinjau kamera depan" />
        {cameraError && <p role="alert" className="text-sm text-red-600">{cameraError}</p>}
        <button type="button" onClick={cameraReady ? stop : startCamera} className="w-full rounded-lg bg-primary px-4 py-3 text-primary-foreground">{cameraReady ? "Matikan kamera" : "Uji kamera depan HP"}</button>
        {cameraReady && <button type="button" onClick={capture} className="w-full rounded-lg border px-4 py-3">Periksa frame kamera (lokal)</button>}
        {captured && <p role="status" className="text-sm text-green-700">Frame tersedia untuk tahap integrasi berikutnya. Tidak ada foto dibuat atau dikirim.</p>}
        {cameraReady && <p className="text-sm text-green-700">Pratinjau kamera berhasil. Tidak ada foto atau video yang disimpan atau dikirim.</p>}
      </section>
      <section className="rounded-xl border p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-5 w-5" /> Password/PIN pintu</div>
        <p className="text-sm text-muted-foreground">Simulasi validasi PIN lokal (4–8 angka). Tidak tersimpan dan tidak dikirim. Ini bukan password login Sport Center.</p>
        <label className="block text-sm" htmlFor="door-pin">PIN pintu</label>
        <input id="door-pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={e => setPin(e.target.value)} className="w-full rounded border p-3" />
        <label className="block text-sm" htmlFor="door-pin-confirm">Ulangi PIN</label>
        <input id="door-pin-confirm" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={confirmPin} onChange={e => setConfirmPin(e.target.value)} className="w-full rounded border p-3" />
        <p role="status" className="text-sm">{pinValid ? "Format PIN cocok (uji lokal saja)." : "Masukkan PIN 4–8 angka yang sama pada kedua kolom."}</p>
        <button type="button" disabled className="rounded-lg border px-4 py-2 opacity-50">Daftarkan ke X904 — belum diaktifkan</button>
      </section>
      <section className="rounded-xl border p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5" /> Perlindungan pengguna lama</div>
        <p className="text-sm">Tidak ada perubahan pada akun X904, wajah, sidik jari, kartu, PIN, maupun hak akses pengguna yang sudah ada.</p>
        <div className="flex items-start gap-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" /><span>Pendaftaran wajah X904 belum tersedia hingga uji akun baru dan verifikasi pembukaan pintu dinyatakan PASS.</span></div>
      </section>
    </main>
  );
}
