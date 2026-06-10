import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useLogin, useSendOtp, useVerifyOtp, useLoginWithGoogle } from "@workspace/api-client-react";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import { LogIn, Eye, EyeOff, Phone, ArrowLeft, RefreshCw } from "lucide-react";
import { FcGoogle } from "react-icons/fc";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

type LoginTab = "email" | "phone";
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

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { t } = useLang();

  const [tab, setTab] = useState<LoginTab>("email");
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPw, setShowPw] = useState(false);

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("input");
  const [countdown, setCountdown] = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  const redirectTo = new URLSearchParams(search).get("redirect");

  function handleSuccess(data: { token: string; user: { name: string } }) {
    setToken(data.token);
    toast({ title: t("Selamat datang!", "Welcome!"), description: `${t("Halo", "Hello")}, ${data.user.name}` });
    setLocation(redirectTo ?? "/my-bookings");
  }

  const loginMutation = useLogin({
    mutation: {
      onSuccess: handleSuccess,
      onError: () => {
        toast({ title: t("Login gagal", "Login failed"), description: t("Email atau password salah.", "Incorrect email or password."), variant: "destructive" });
      },
    },
  });

  const googleMutation = useLoginWithGoogle({
    mutation: {
      onSuccess: handleSuccess,
      onError: () => {
        setGoogleLoading(false);
        toast({ title: t("Login Google gagal", "Google login failed"), description: t("Coba lagi.", "Please try again."), variant: "destructive" });
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
      onSuccess: handleSuccess,
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
        text: "signin_with",
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

  function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    loginMutation.mutate({ data: form });
  }

  function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    sendOtpMutation.mutate({ data: { phone } });
  }

  function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    verifyOtpMutation.mutate({ data: { phone, otp } });
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <LogIn size={26} className="text-primary" />
          </div>
          <CardTitle className="text-2xl font-black">{t("Masuk ke Akun", "Sign in to Account")}</CardTitle>
          <CardDescription>{t("Login untuk melihat riwayat booking Anda", "Log in to view your booking history")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          {/* Tab selector */}
          <div className="flex rounded-lg border p-1 gap-1">
            <button
              type="button"
              onClick={() => setTab("email")}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${tab === "email" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => { setTab("phone"); setPhoneStep("input"); }}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${tab === "phone" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Phone size={14} />
              {t("No. HP", "Phone")}
            </button>
          </div>

          {/* Email/password login */}
          {tab === "email" && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
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
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    autoComplete="current-password"
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
              <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? t("Memproses...", "Processing...") : t("Masuk", "Sign in")}
              </Button>
            </form>
          )}

          {/* Phone OTP login */}
          {tab === "phone" && phoneStep === "input" && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("Nomor WhatsApp", "WhatsApp Number")}</Label>
                <Input
                  id="phone"
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
                {verifyOtpMutation.isPending ? t("Memverifikasi...", "Verifying...") : t("Verifikasi & Masuk", "Verify & Sign in")}
              </Button>
              <div className="text-center">
                {countdown > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("Kirim ulang OTP dalam", "Resend OTP in")} <span className="font-semibold text-primary">{countdown}s</span>
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

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">{t("atau", "or")}</span>
            </div>
          </div>

          {/* Google Sign-In */}
          {googleLoading || googleMutation.isPending ? (
            <Button type="button" variant="outline" className="w-full gap-2" disabled>
              <FcGoogle size={18} /> {t("Memproses...", "Processing...")}
            </Button>
          ) : (
            <div ref={googleBtnRef} className="w-full flex justify-center min-h-[44px]" />
          )}

          <div className="text-center text-sm text-muted-foreground">
            {t("Belum punya akun?", "Don't have an account?")}{" "}
            <Link href="/register" className="text-primary font-semibold hover:underline">
              {t("Daftar sekarang", "Register now")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
