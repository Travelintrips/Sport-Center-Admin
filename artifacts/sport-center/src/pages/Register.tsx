import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useRegister } from "@workspace/api-client-react";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import { UserPlus, Eye, EyeOff, MessageCircle, CheckCircle, Copy } from "lucide-react";

export default function Register() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { t } = useLang();

  const params = new URLSearchParams(search);
  const sourceWA = params.get("source") === "wa";
  const prefilledPhone = params.get("phone") ?? "";

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: prefilledPhone,
    password: "",
    confirmPassword: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [waLoading, setWaLoading] = useState(false);
  const [waSuccess, setWaSuccess] = useState<{ customerCode: string; name: string } | null>(null);

  const registerMutation = useRegister({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        toast({ title: t("Akun berhasil dibuat!", "Account created!"), description: `${t("Selamat datang", "Welcome")}, ${data.user.name}!` });
        setLocation("/my-bookings");
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? t("Gagal mendaftar. Coba lagi.", "Registration failed. Please try again.");
        toast({ title: t("Registrasi gagal", "Registration failed"), description: msg, variant: "destructive" });
      },
    },
  });

  async function handleWaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Nama wajib diisi", variant: "destructive" });
      return;
    }
    if (!form.phone.trim()) {
      toast({ title: "Nomor WhatsApp wajib diisi", variant: "destructive" });
      return;
    }
    setWaLoading(true);
    try {
      const res = await fetch("/api/wa/customer/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.alreadyRegistered) {
          toast({ title: "Nomor WA sudah terdaftar", description: `Kode customer kamu: ${data.customerCode}`, variant: "destructive" });
        } else {
          toast({ title: "Gagal mendaftar", description: data.error, variant: "destructive" });
        }
        return;
      }
      setWaSuccess({ customerCode: data.customerCode, name: data.name });
    } catch {
      toast({ title: "Gagal mendaftar", description: "Terjadi kesalahan. Coba lagi.", variant: "destructive" });
    } finally {
      setWaLoading(false);
    }
  }

  function handleWebSubmit(e: React.FormEvent) {
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

  if (waSuccess) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md shadow-lg text-center">
          <CardContent className="pt-10 pb-8 space-y-5">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle size={32} className="text-green-600" />
            </div>
            <div>
              <h2 className="text-2xl font-black mb-1">Registrasi Berhasil! 🎉</h2>
              <p className="text-muted-foreground text-sm">Akun WhatsApp kamu sudah aktif, <strong>{waSuccess.name}</strong>.</p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">Kode Customer Kamu</div>
              <div className="text-2xl font-black text-primary tracking-wider flex items-center justify-center gap-2">
                {waSuccess.customerCode}
                <button
                  onClick={() => { navigator.clipboard.writeText(waSuccess.customerCode); toast({ title: "Kode disalin!" }); }}
                  className="text-muted-foreground hover:text-primary"
                >
                  <Copy size={16} />
                </button>
              </div>
              <div className="text-xs text-muted-foreground mt-1">Simpan kode ini untuk referensi</div>
            </div>
            <p className="text-sm text-muted-foreground">
              Cek WhatsApp kamu — kami sudah kirim pesan selamat datang + link untuk mulai booking! 📲
            </p>
            <div className="flex flex-col gap-2">
              <Button className="w-full" onClick={() => setLocation("/facilities")}>
                Lihat Fasilitas & Booking
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setLocation("/")}>
                Ke Beranda
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            {sourceWA ? <MessageCircle size={26} className="text-primary" /> : <UserPlus size={26} className="text-primary" />}
          </div>
          <CardTitle className="text-2xl font-black">
            {sourceWA ? "Daftar via WhatsApp" : t("Buat Akun Baru", "Create New Account")}
          </CardTitle>
          <CardDescription>
            {sourceWA
              ? "Isi data di bawah untuk mengaktifkan akun booking kamu"
              : t("Daftar untuk melacak riwayat booking Anda", "Register to track your booking history")}
          </CardDescription>
          {sourceWA && (
            <Badge variant="secondary" className="mx-auto mt-2 gap-1 bg-green-100 text-green-700 border-green-200">
              <MessageCircle size={12} /> Diakses dari WhatsApp
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-5 pt-4">
          <form onSubmit={sourceWA ? handleWaSubmit : handleWebSubmit} className="space-y-4">
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
              <Label htmlFor="phone">
                Nomor WhatsApp{sourceWA && <span className="text-destructive ml-0.5">*</span>}
                {!sourceWA && <span className="text-muted-foreground font-normal"> (opsional)</span>}
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="628xxxxxxxxxx"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                required={sourceWA}
                readOnly={sourceWA && !!prefilledPhone}
                className={sourceWA && prefilledPhone ? "bg-muted" : ""}
                autoComplete="tel"
              />
              {sourceWA && prefilledPhone && (
                <p className="text-xs text-muted-foreground">Nomor diisi otomatis dari WhatsApp</p>
              )}
            </div>

            {!sourceWA && (
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
            )}

            {sourceWA && (
              <div className="space-y-1.5">
                <Label htmlFor="email">
                  Email <span className="text-muted-foreground font-normal">(opsional)</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="nama@email.com (bisa dikosongkan)"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  autoComplete="email"
                />
                <p className="text-xs text-muted-foreground">Jika dikosongkan, email akan dibuat otomatis untuk akun kamu</p>
              </div>
            )}

            {!sourceWA && (
              <>
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
              </>
            )}

            <Button type="submit" className="w-full" disabled={registerMutation.isPending || waLoading}>
              {(registerMutation.isPending || waLoading)
                ? "Mendaftarkan..."
                : sourceWA ? "Daftar Sekarang 🚀" : t("Daftar Sekarang", "Register Now")}
            </Button>
          </form>

          {!sourceWA && (
            <div className="text-center text-sm text-muted-foreground">
              {t("Sudah punya akun?", "Already have an account?")}{" "}
              <Link href="/login" className="text-primary font-semibold hover:underline">
                {t("Masuk di sini", "Sign in here")}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
