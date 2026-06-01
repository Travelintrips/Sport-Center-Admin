import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import { LogIn, Eye, EyeOff } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useLang();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPw, setShowPw] = useState(false);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        toast({ title: t("Selamat datang kembali!", "Welcome back!"), description: `${t("Halo", "Hello")}, ${data.user.name}` });
        if (data.user.role === "tenant") {
          setLocation("/tenant/dashboard");
        } else {
          setLocation("/my-bookings");
        }
      },
      onError: () => {
        toast({ title: t("Login gagal", "Login failed"), description: t("Email atau password salah.", "Incorrect email or password."), variant: "destructive" });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loginMutation.mutate({ data: form });
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
          <form onSubmit={handleSubmit} className="space-y-4">
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
