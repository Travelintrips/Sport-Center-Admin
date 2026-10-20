import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { setToken } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

// Only allow returning to a known in-app calendar booking after admin login.
// Never trust an arbitrary "next" URL from the query string.
function adminLoginDestination(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && /^\/\?booking=booking-\d+&date=\d{4}-\d{2}-\d{2}$/.test(next) ? next : "/admin/dashboard";
}

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const googleContainerRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleContainerRef.current) return;
    let active = true;
    const initialize = () => {
      if (!active || !googleContainerRef.current || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: false,
        callback: async (response: { credential: string }) => {
          setGooglePending(true);
          try {
            const res = await fetch("/api/auth/admin-google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken: response.credential }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.token) throw new Error(data.error || "Login Google gagal");
            setToken(data.token);
            queryClient.setQueryData(getGetMeQueryKey(), data.user);
            setLocation(adminLoginDestination());
          } catch (error) {
            toast({ title: "Login Google gagal", description: error instanceof Error ? error.message : "Silakan coba lagi.", variant: "destructive" });
          } finally {
            if (active) setGooglePending(false);
          }
        },
      });
      window.google.accounts.id.renderButton(googleContainerRef.current, {
        type: "standard", theme: "outline", size: "large", shape: "rectangular",
        text: "signin_with", width: 350, locale: "id",
      });
    };
    if (window.google?.accounts?.id) initialize();
    else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = initialize;
      document.head.appendChild(script);
      return () => { active = false; script.remove(); };
    }
    return () => { active = false; };
  }, [queryClient, setLocation, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    try {
      const res = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        const description =
          res.status === 401
            ? data.error || "Email atau password salah"
            : res.status >= 500
              ? "Server API tidak tersedia. Pastikan workflow API Server sedang berjalan, lalu coba lagi."
              : data.error || "Login tidak dapat diproses";
        toast({
          title: "Login Gagal",
          description,
          variant: "destructive",
        });
        return;
      }
      if (!data.token) {
        toast({
          title: "Login Gagal",
          description: "Respons tidak valid dari server",
          variant: "destructive",
        });
        return;
      }
      setToken(data.token);
      queryClient.setQueryData(getGetMeQueryKey(), data.user);
      toast({ title: "Login berhasil", description: "Selamat datang, Admin." });
      setLocation(adminLoginDestination());
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.";
      console.error("[AdminLogin] error:", err);
      toast({ title: "Login Gagal", description: msg, variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-border">
        <div className="h-2 w-full bg-primary" />
        <CardHeader className="space-y-1 text-center pt-8 pb-4">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
            <Lock size={32} />
          </div>
          <CardTitle className="text-2xl font-black tracking-tight">
            Admin Portal
          </CardTitle>
          <CardDescription>
            Masukkan kredensial admin untuk mengakses dashboard
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@sportcenter.com"
                className="h-12"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Kata Sandi</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12"
              />
            </div>
            <Button type="button" variant="link" className="px-0" disabled={isPending} onClick={() => setForgotOpen(true)}>
              Lupa kata sandi?
            </Button>
          </CardContent>
          <CardFooter className="pb-8">
            <Button
              type="submit"
              className="w-full h-12 text-base font-bold"
              disabled={isPending}
            >
              {isPending ? "Memverifikasi..." : "Masuk"}
            </Button>
          </CardFooter>
        </form>
        {GOOGLE_CLIENT_ID && (
          <div className="px-6 pb-7 text-center">
            <div className="mb-4 text-sm text-muted-foreground">atau</div>
            <div ref={googleContainerRef} className="flex min-h-11 justify-center" />
            {googlePending && <p className="mt-2 text-sm">Memverifikasi akun Google...</p>}
            <p className="mt-3 text-xs text-muted-foreground">Hanya akun Google admin yang sudah terhubung dan disetujui.</p>
          </div>
        )}
      </Card>
      <ForgotPasswordDialog open={forgotOpen} initialEmail={email} source="admin" onClose={() => setForgotOpen(false)} />
    </div>
  );
}
