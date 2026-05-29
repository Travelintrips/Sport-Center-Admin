import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useRegister } from "@workspace/api-client-react";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import { UserPlus, Eye, EyeOff } from "lucide-react";

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useLang();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirmPassword: "" });
  const [showPw, setShowPw] = useState(false);

  const registerMutation = useRegister({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        toast({ title: t("Akun berhasil dibuat!", "Account created successfully!"), description: `${t("Selamat datang", "Welcome")}, ${data.user.name}!` });
        setLocation("/my-bookings");
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? t("Gagal mendaftar. Coba lagi.", "Registration failed. Please try again.");
        toast({ title: t("Registrasi gagal", "Registration failed"), description: msg, variant: "destructive" });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast({ title: t("Password tidak cocok", "Passwords do not match"), description: t("Pastikan kedua password sama.", "Make sure both passwords are the same."), variant: "destructive" });
      return;
    }
    if (form.password.length < 6) {
      toast({ title: t("Password terlalu pendek", "Password too short"), description: t("Minimal 6 karakter.", "Minimum 6 characters."), variant: "destructive" });
      return;
    }
    registerMutation.mutate({ data: { name: form.name, email: form.email, password: form.password, phone: form.phone || undefined } });
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <UserPlus size={26} className="text-primary" />
          </div>
          <CardTitle className="text-2xl font-black">{t("Buat Akun Baru", "Create New Account")}</CardTitle>
          <CardDescription>{t("Daftar untuk melacak riwayat booking Anda", "Register to track your booking history")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("Nama Lengkap", "Full Name")}</Label>
              <Input
                id="name"
                placeholder={t("Nama lengkap Anda", "Your full name")}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="nama@email.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                {t("No. HP", "Phone No.")} <span className="text-muted-foreground font-normal">{t("(opsional)", "(optional)")}</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="08xxxxxxxxxx"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                autoComplete="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("Password", "Password")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  placeholder={t("Min. 6 karakter", "Min. 6 characters")}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">{t("Konfirmasi Password", "Confirm Password")}</Label>
              <Input
                id="confirmPassword"
                type={showPw ? "text" : "password"}
                placeholder={t("Ulangi password", "Repeat password")}
                value={form.confirmPassword}
                onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                required
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? t("Mendaftarkan...", "Registering...") : t("Daftar Sekarang", "Register Now")}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            {t("Sudah punya akun?", "Already have an account?")}{" "}
            <Link href="/login" className="text-primary font-semibold hover:underline">
              {t("Masuk di sini", "Sign in here")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
