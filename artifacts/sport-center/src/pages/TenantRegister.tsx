import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { setToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Building2, User, Mail, Lock, Phone, MapPin, ChevronLeft, CheckCircle2, Loader2 } from "lucide-react";

const CATEGORIES = [
  "Makanan & Minuman",
  "Perlengkapan Olahraga",
  "Kesehatan & Kebugaran",
  "Fashion & Aksesoris",
  "Jasa & Layanan",
  "Retail & Merchandise",
  "Lainnya",
];

async function registerTenant(data: Record<string, string>) {
  const res = await fetch("/api/tenant/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error || "Pendaftaran gagal");
  }
  return res.json();
}

export default function TenantRegister() {
  const { t } = useLang();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    businessName: "",
    ownerName: "",
    businessCategory: "",
    address: "",
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password || !form.businessName || !form.ownerName) {
      toast({ title: t("Wajib diisi", "Required fields"), description: t("Semua kolom bertanda * harus diisi.", "All starred fields are required."), variant: "destructive" });
      return;
    }
    if (form.password.length < 6) {
      toast({ title: t("Password terlalu pendek", "Password too short"), description: t("Minimal 6 karakter.", "Minimum 6 characters."), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const data = await registerTenant(form);
      setToken(data.token);
      await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setDone(true);
      setTimeout(() => setLocation("/tenant/booking"), 1800);
    } catch (err: any) {
      toast({ title: t("Pendaftaran gagal", "Registration failed"), description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-black mb-2">{t("Pendaftaran Berhasil!", "Registration Successful!")}</h2>
          <p className="text-muted-foreground text-sm mb-1">{t("Akun tenant Anda telah dibuat.", "Your tenant account has been created.")}</p>
          <p className="text-muted-foreground text-sm">{t("Mengarahkan ke form pengajuan sewa...", "Redirecting to booking form...")}</p>
          <div className="mt-6 flex justify-center">
            <Loader2 className="animate-spin text-primary" size={24} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-12 px-4">
      <div className="max-w-2xl mx-auto">

        <div className="mb-6">
          <Button asChild variant="ghost" size="sm" className="rounded-full -ml-2">
            <Link href="/tenant"><ChevronLeft size={14} /> {t("Kembali", "Back")}</Link>
          </Button>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-4">
            <Building2 size={12} /> {t("Program Sewa Tenan", "Tenant Program")}
          </div>
          <h1 className="text-3xl md:text-4xl font-black mb-2">{t("Daftar Sebagai Tenant", "Register as Tenant")}</h1>
          <p className="text-muted-foreground">
            {t("Isi data berikut untuk mendaftarkan bisnis Anda. Setelah daftar, Anda langsung bisa mengajukan booking sewa.", "Fill in the details below to register your business. After registration, you can immediately submit a rental booking.")}
          </p>
        </div>

        {/* Pricing reminder */}
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 mb-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 size={18} className="text-primary" />
          </div>
          <div>
            <p className="font-black text-sm">{t("Harga Sewa", "Rental Price")}: <span className="text-primary">Rp 3.000.000 / bulan</span></p>
            <p className="text-xs text-muted-foreground">{t("Sudah termasuk PPN 11%", "Inclusive of 11% VAT")}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-5">

            {/* Akun Login */}
            <Card className="border-border/60">
              <CardContent className="pt-5 space-y-4">
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
                  <User size={11} /> {t("Data Akun Login", "Login Account")}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-semibold">{t("Nama Lengkap", "Full Name")} *</Label>
                    <div className="relative mt-1.5">
                      <User size={14} className="absolute left-3 top-3 text-muted-foreground" />
                      <Input value={form.name} onChange={set("name")} placeholder={t("Nama Anda", "Your name")} className="pl-9" required />
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-semibold">{t("Nomor Telepon", "Phone Number")}</Label>
                    <div className="relative mt-1.5">
                      <Phone size={14} className="absolute left-3 top-3 text-muted-foreground" />
                      <Input value={form.phone} onChange={set("phone")} placeholder="08123456789" className="pl-9" />
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-semibold">{t("Alamat Email", "Email Address")} *</Label>
                  <div className="relative mt-1.5">
                    <Mail size={14} className="absolute left-3 top-3 text-muted-foreground" />
                    <Input type="email" value={form.email} onChange={set("email")} placeholder="email@bisnis.com" className="pl-9" required />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-semibold">{t("Password", "Password")} *</Label>
                  <div className="relative mt-1.5">
                    <Lock size={14} className="absolute left-3 top-3 text-muted-foreground" />
                    <Input type="password" value={form.password} onChange={set("password")} placeholder={t("Min. 6 karakter", "Min. 6 characters")} className="pl-9" required minLength={6} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Data Bisnis */}
            <Card className="border-border/60">
              <CardContent className="pt-5 space-y-4">
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Building2 size={11} /> {t("Data Bisnis", "Business Details")}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-semibold">{t("Nama Bisnis / Usaha", "Business Name")} *</Label>
                    <Input value={form.businessName} onChange={set("businessName")} placeholder={t("misal: Toko Olahraga ABC", "e.g. ABC Sports Shop")} className="mt-1.5" required />
                  </div>
                  <div>
                    <Label className="text-sm font-semibold">{t("Nama Pemilik", "Owner Name")} *</Label>
                    <Input value={form.ownerName} onChange={set("ownerName")} placeholder={t("Nama pemilik usaha", "Business owner name")} className="mt-1.5" required />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-semibold">{t("Kategori Bisnis", "Business Category")}</Label>
                  <Select value={form.businessCategory} onValueChange={(v) => setForm((f) => ({ ...f, businessCategory: v }))}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder={t("Pilih kategori...", "Select category...")} />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-semibold">{t("Alamat Bisnis", "Business Address")}</Label>
                  <div className="relative mt-1.5">
                    <MapPin size={14} className="absolute left-3 top-3 text-muted-foreground" />
                    <Input value={form.address} onChange={set("address")} placeholder={t("Alamat lengkap bisnis Anda", "Your business full address")} className="pl-9" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button type="submit" disabled={loading} size="lg" className="w-full rounded-full font-black text-base py-6 shadow-lg shadow-primary/25">
              {loading ? (
                <><Loader2 size={18} className="animate-spin mr-2" /> {t("Mendaftarkan...", "Registering...")}</>
              ) : (
                t("Daftar & Lanjut ke Pengajuan Sewa →", "Register & Continue to Booking →")
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              {t("Sudah punya akun tenant?", "Already have a tenant account?")}{" "}
              <Link href="/login" className="text-primary font-semibold hover:underline">{t("Login di sini", "Login here")}</Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
