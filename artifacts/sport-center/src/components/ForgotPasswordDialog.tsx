import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PasswordResetFields, isValidNewPassword } from "./PasswordResetFields";
import { useLang } from "@/lib/i18n";

type Channel = "email" | "whatsapp";
type Step = "email" | "link" | "otp" | "done";

export function ForgotPasswordDialog({ open, onClose, initialEmail = "", source = "customer", defaultChannel = "email" }: {
  open: boolean;
  onClose: () => void;
  initialEmail?: string;
  source?: "admin" | "customer";
  defaultChannel?: Channel;
}) {
  const { t } = useLang();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(initialEmail);
  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setStep("email"); setEmail(initialEmail); setChannel(defaultChannel);
      setOtp(""); setPassword(""); setConfirmation(""); setCountdown(0); setError(null); setLoading(false);
    }
    return () => { controllerRef.current?.abort(); };
  }, [open, initialEmail, defaultChannel]);

  useEffect(() => {
    if (!open || countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [open, countdown]);

  async function submit(path: string, body: Record<string, string>, onSuccess: () => void) {
    if (loading) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true); setError(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !data?.success) {
        setError(data?.error || t("Permintaan belum dapat diproses. Coba lagi nanti.", "Unable to process your request. Try again later."));
        return;
      }
      onSuccess();
    } catch {
      if (!controller.signal.aborted) setError(t("Koneksi ke server gagal. Coba lagi.", "Connection failed. Please try again."));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function sendInstructions() {
    if (countdown > 0 || !email.trim()) return;
    await submit("/api/auth/forgot-password", { email: email.trim().toLowerCase(), channel, source }, () => {
      setStep(channel === "email" ? "link" : "otp"); setCountdown(60); setOtp("");
    });
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setError(t("Konfirmasi kata sandi belum sama.", "Passwords do not match.")); return; }
    if (!isValidNewPassword(password)) { setError(t("Kata sandi minimal 8 karakter dan maksimal 72 byte.", "Password must be at least 8 characters and no more than 72 bytes.")); return; }
    await submit("/api/auth/reset-password", { email: email.trim().toLowerCase(), otp, newPassword: password }, () => { setStep("done"); setPassword(""); setConfirmation(""); setOtp(""); });
  }

  const changeEmail = () => { setStep("email"); setCountdown(0); setError(null); setOtp(""); setPassword(""); setConfirmation(""); };
  const resend = (
    <Button type="button" variant="outline" className="w-full" onClick={() => void sendInstructions()} disabled={loading || countdown > 0}>
      {countdown > 0 ? `${t("Kirim ulang dalam", "Resend in")} ${countdown}s` : t("Kirim ulang", "Resend")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <KeyRound className="mx-auto mb-2 text-primary" size={28} />
          <DialogTitle className="text-center">{t("Reset kata sandi", "Reset password")}</DialogTitle>
          <DialogDescription className="text-center">
            {step === "email" && t("Gunakan email akun yang terdaftar. Pilih cara menerima instruksi reset.", "Use your registered account email and choose a recovery method.")}
            {step === "link" && t("Jika akun terdaftar, tautan reset akan dikirim ke email Anda. Tautan berlaku 15 menit.", "If the account exists, a reset link will be emailed to you. It expires in 15 minutes.")}
            {step === "otp" && t("Jika akun memiliki nomor WhatsApp terdaftar, kode akan dikirim ke nomor tersebut. Kode berlaku 5 menit.", "If your account has a registered WhatsApp number, a code will be sent there. It expires in 5 minutes.")}
            {step === "done" && t("Kata sandi berhasil diubah. Silakan masuk dengan kata sandi baru.", "Password changed. Sign in with your new password.")}
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {step === "email" && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void sendInstructions(); }}>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input id="reset-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" disabled={loading} />
            </div>
            <fieldset className="space-y-2" disabled={loading}>
              <legend className="text-sm font-medium mb-2">{t("Kirim melalui", "Send via")}</legend>
              {(["email", "whatsapp"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 rounded-md border p-3 text-sm cursor-pointer">
                  <input type="radio" name="reset-channel" value={value} checked={channel === value} onChange={() => setChannel(value)} />
                  {value === "email" ? t("Tautan email", "Email link") : t("Kode WhatsApp", "WhatsApp code")}
                </label>
              ))}
            </fieldset>
            <Button className="w-full" type="submit" disabled={loading || !email.trim()}>
              {loading ? t("Memproses...", "Processing...") : t("Kirim instruksi reset", "Send reset instructions")}
            </Button>
          </form>
        )}
        {step === "link" && (
          <div className="space-y-4 text-center">
            <Mail size={36} className="mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">{t("Periksa kotak masuk dan folder spam. Jika belum menerima email, pastikan alamat tersebut terdaftar atau hubungi pengelola.", "Check your inbox and spam folder. If no email arrives, verify the registered address or contact the administrator.")}</p>
            {resend}
            <Button className="w-full" variant="ghost" onClick={changeEmail} disabled={loading}>{t("Ganti email atau metode", "Change email or method")}</Button>
          </div>
        )}
        {step === "otp" && (
          <form className="space-y-4" onSubmit={resetPassword}>
            <Button type="button" variant="ghost" onClick={changeEmail} disabled={loading}><ArrowLeft size={14} className="mr-2" />{t("Ganti email atau metode", "Change email or method")}</Button>
            <div className="space-y-2">
              <Label htmlFor="reset-otp">{t("Kode WhatsApp", "WhatsApp code")}</Label>
              <Input id="reset-otp" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" disabled={loading} />
            </div>
            <PasswordResetFields password={password} confirmation={confirmation} onPasswordChange={setPassword} onConfirmationChange={setConfirmation} disabled={loading} />
            <Button type="submit" className="w-full" disabled={loading || otp.length !== 6 || !isValidNewPassword(password) || !confirmation}>
              {loading ? t("Menyimpan...", "Saving...") : t("Simpan kata sandi baru", "Save new password")}
            </Button>
            {resend}
          </form>
        )}
        {step === "done" && (
          <div className="space-y-4 text-center">
            <CheckCircle2 size={40} className="text-green-600 mx-auto" />
            <Button className="w-full" onClick={onClose}>{t("Kembali ke login", "Back to login")}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
