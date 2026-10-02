import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordResetFields, isValidNewPassword } from "@/components/PasswordResetFields";
import { removeToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/lib/i18n";

export default function ResetPassword() {
  const { t } = useLang();
  const search = useSearch();
  const queryClient = useQueryClient();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [invalidLink, setInvalidLink] = useState(!token);
  const [error, setError] = useState<string | null>(null);
  const loginPath = new URLSearchParams(search).get("source") === "admin" ? "/admin/login" : "/login";

  useEffect(() => {
    // Remove the credential from browser history once it is held in memory.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (password !== confirmation) { setError(t("Konfirmasi kata sandi belum sama.", "Passwords do not match.")); return; }
    if (!isValidNewPassword(password)) { setError(t("Kata sandi minimal 8 karakter dan maksimal 72 byte.", "Password must be at least 8 characters and no more than 72 bytes.")); return; }
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: password }) });
      const data = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (!response.ok || !data?.success) {
        if (response.status === 400) setInvalidLink(true);
        setError(data?.error || t("Kata sandi belum dapat diubah. Coba lagi nanti.", "Unable to update your password. Try again later."));
        return;
      }
      removeToken();
      queryClient.clear();
      setPassword(""); setConfirmation(""); setDone(true);
    } catch {
      setError(t("Koneksi ke server gagal. Coba lagi.", "Connection failed. Please try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl">
        <div className="h-2 bg-primary" />
        <CardHeader className="text-center">
          {done ? <CheckCircle2 className="mx-auto text-green-600" size={40} /> : <KeyRound className="mx-auto text-primary" size={36} />}
          <CardTitle>{done ? t("Kata sandi berhasil diubah", "Password changed") : t("Buat kata sandi baru", "Choose a new password")}</CardTitle>
          <CardDescription>{done ? t("Silakan masuk kembali dengan kata sandi baru.", "Sign in with your new password.") : t("Tautan reset berlaku 15 menit dan hanya dapat digunakan satu kali.", "Your reset link expires in 15 minutes and can only be used once.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {invalidLink && !error && <p role="alert" className="text-sm text-destructive">{t("Tautan reset tidak tersedia. Minta tautan baru melalui halaman login.", "Reset link is missing. Request a new one from the login page.")}</p>}
          {!done && !invalidLink && (
            <form className="space-y-4" onSubmit={submit}>
              <PasswordResetFields password={password} confirmation={confirmation} onPasswordChange={setPassword} onConfirmationChange={setConfirmation} disabled={pending} />
              <Button type="submit" className="w-full" disabled={pending || !isValidNewPassword(password) || !confirmation}>
                {pending ? t("Menyimpan...", "Saving...") : t("Simpan kata sandi baru", "Save new password")}
              </Button>
            </form>
          )}
          <Button variant={done || invalidLink ? "default" : "ghost"} className="w-full" asChild>
            <Link href={loginPath}>{t("Kembali ke login", "Back to login")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
