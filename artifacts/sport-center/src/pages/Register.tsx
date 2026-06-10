import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useRegister, useSendOtp, useVerifyOtp, useLoginWithGoogle } from "@workspace/api-client-react";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import { UserPlus, Eye, EyeOff, MessageCircle, CheckCircle, Copy, Phone, ArrowLeft, RefreshCw } from "lucide-react";
import { FcGoogle } from "react-icons/fc";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

type RegisterTab = "email" | "phone" | "wa_source";
type PhoneStep = "input" | "otp";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: any) => void;
          renderButton: (el: HTMLElement, cfg: any) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export default function Register() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { t } = useLang();

  const params = new URLSearchParams(search);
  const sourceWA = params.get("source") === "wa";
  const prefilledPhone = params.get("phone") ?? "";

  const [tab, setTab] = useState<RegisterTab>(sourceWA ? "wa_source" : "email");
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
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("input");
  const [countdown, setCountdown] = useState(0);

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

  const googleMutation = useLoginWithGoogle({
    mutation: {
      onSuccess: (data) => {
        setGoogleLoading(false);
        setToken(data.token);
        toast({ title: t("Akun berhasil dibuat!", "Account created!"), description: `${t("Selamat datang", "Welcome")}, ${data.user.name}!` });
        setLocation("/my-bookings");
      },
      onError: () => {
        setGoogleLoading(false);
        toast({ title: t("Google gagal", "Google failed"), description: t("Coba lagi.", "Please try again."), variant: "destructive" });
      },
    },
  });

  const sendOtpMutation = useSendOtp({
    mutation: {
      onSuccess: () => {
        setPhoneStep("otp");
        setCountdown(60);
        toast({ title: t("OTP Terkirim", "OTP Sent"), description: t("Cek WhatsApp Anda untuk kode OTP", "Check your WhatsApp for the OTP code") });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? t("Gagal mengirim OTP.", "Failed to send OTP.");
        toast({ title: t("Gagal", "Failed"), description: msg, variant: "destructive" });
      },
    },
  });

  const verifyOtpMutation = useVerifyOtp({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        toast({ title: t("Berhasil masuk!", "Signed in!"), description: `${t("Selamat datang", "Welcome")}, ${data.user.name}!` });
        setLocation("/my-bookings");
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? t("OTP salah atau kadaluarsa.", "Incorrect or expired OTP.");
        toast({ title: t("Verifikasi gagal", "Verification failed"), description: msg, variant: "destructive" });
      },
    },
  });

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleGoogleCallback = useCallback((response: { credential: string }) => {
    setGoogleLoading(true);
    googleMutation.mutate({ data: { idToken: response.credential } });
  }, [googleMutation]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleBtnRef.current) return;

    function initGoogle() {
      if (!googleBtnRef.current) return;
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCallback,
        auto_select: false,
      });
      window.google?.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        shape: "rectangular",
        theme: "outline",
        text: "signup_with",
        size: "large",
        width: googleBtnRef.current.offsetWidth || 380,
        locale: "id",
      });
    }

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", initGoogle);
      return () => existing.removeEventListener("load", initGoogle);
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);
    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, [handleGoogleCallback]);

  async function handleWaSourceSubmit(e: React.FormEvent) {
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

  function handleEmailSubmit(e: React.FormEvent) {
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

  function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    sendOtpMutation.mutate({ data: { phone } });
  }

  function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    verifyOtpMutation.mutate({ data: { phone, otp } });
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
            {t("Buat Akun Baru", "Create New Account")}
          </CardTitle>
          <CardDescription>
            {t("Daftar untuk melacak riwayat booking Anda", "Register to track your booking history")}
          </CardDescription>
          {sourceWA && (
            <Badge variant="secondary" className="mx-auto mt-2 gap-1 bg-green-100 text-green-700 border-green-200">
              <MessageCircle size={12} /> Diakses dari WhatsApp
            </Badge>
          )}
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          {!sourceWA && (
            <div className="flex rounded-lg border p-1 gap-1">
              <button
                type="button"
                onClick={() => setTab("email")}
                className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors ${tab === "email" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Email
              </button>
              <button
                type="button"
                onClick={() => { setTab("phone"); setPhoneStep("input"); }}
                className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors flex items-center justify-center gap-1 ${tab === "phone" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Phone size={12} />
                WhatsApp OTP
              </button>
            </div>
          )}

          {/* Email registration */}
          {(tab === "email") && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
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
                  {t("No. WhatsApp", "WhatsApp No.")} <span className="text-muted-foreground font-normal text-xs">(opsional)</span>
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
          )}

          {/* WA OTP registration */}
          {tab === "phone" && phoneStep === "input" && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="wa-phone">{t("Nomor WhatsApp", "WhatsApp Number")}</Label>
                <Input
                  id="wa-phone"
                  type="tel"
                  placeholder="08xxxxxxxxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoComplete="tel"
                />
                <p className="text-xs text-muted-foreground">{t("Kode OTP akan dikirim via WhatsApp", "OTP code will be sent via WhatsApp")}</p>
              </div>
              <Button type="submit" className="w-full" disabled={sendOtpMutation.isPending}>
                {sendOtpMutation.isPending ? t("Mengirim...", "Sending...") : t("Kirim Kode OTP", "Send OTP Code")}
              </Button>
            </form>
          )}

          {tab === "phone" && phoneStep === "otp" && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <button type="button" onClick={() => setPhoneStep("input")} className="text-muted-foreground hover:text-foreground">
                  <ArrowLeft size={16} />
                </button>
                <p className="text-sm text-muted-foreground">
                  {t("Kode dikirim ke", "Code sent to")} <span className="font-semibold text-foreground">{phone}</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="otp">{t("Kode OTP", "OTP Code")}</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  required
                  autoComplete="one-time-code"
                  className="text-center text-xl tracking-[0.4em] font-bold"
                />
              </div>
              <Button type="submit" className="w-full" disabled={verifyOtpMutation.isPending || otp.length !== 6}>
                {verifyOtpMutation.isPending ? t("Memverifikasi...", "Verifying...") : t("Verifikasi & Daftar", "Verify & Register")}
              </Button>
              <div className="text-center">
                {countdown > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("Kirim ulang dalam", "Resend in")} <span className="font-semibold text-primary">{countdown}s</span>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => sendOtpMutation.mutate({ data: { phone } })}
                    disabled={sendOtpMutation.isPending}
                    className="text-sm text-primary font-semibold hover:underline flex items-center gap-1 mx-auto"
                  >
                    <RefreshCw size={13} />
                    {t("Kirim ulang OTP", "Resend OTP")}
                  </button>
                )}
              </div>
            </form>
          )}

          {/* WA source (from WhatsApp bot) */}
          {tab === "wa_source" && (
            <form onSubmit={handleWaSourceSubmit} className="space-y-4">
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
                <Label htmlFor="wa-src-phone">
                  Nomor WhatsApp<span className="text-destructive ml-0.5">*</span>
                </Label>
                <Input
                  id="wa-src-phone"
                  type="tel"
                  placeholder="628xxxxxxxxxx"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  required
                  readOnly={!!prefilledPhone}
                  className={prefilledPhone ? "bg-muted" : ""}
                  autoComplete="tel"
                />
                {prefilledPhone && (
                  <p className="text-xs text-muted-foreground">Nomor diisi otomatis dari WhatsApp</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-email">
                  Email <span className="text-muted-foreground font-normal text-xs">(opsional)</span>
                </Label>
                <Input
                  id="wa-email"
                  type="email"
                  placeholder="nama@email.com (bisa dikosongkan)"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  autoComplete="email"
                />
                <p className="text-xs text-muted-foreground">Jika dikosongkan, email akan dibuat otomatis</p>
              </div>
              <Button type="submit" className="w-full" disabled={waLoading}>
                {waLoading ? "Mendaftarkan..." : "Daftar Sekarang 🚀"}
              </Button>
            </form>
          )}

          {/* Divider + Google */}
          {!sourceWA && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">{t("atau", "or")}</span>
                </div>
              </div>

              {googleLoading || googleMutation.isPending ? (
                <Button type="button" variant="outline" className="w-full gap-2" disabled>
                  <FcGoogle size={18} /> {t("Memproses...", "Processing...")}
                </Button>
              ) : (
                <div ref={googleBtnRef} className="w-full flex justify-center min-h-[44px]" />
              )}
            </>
          )}

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
