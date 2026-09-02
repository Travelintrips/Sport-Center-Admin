import SEOHead from "@/components/SEOHead";
import { useState, useRef } from "react";
import { useSubmitMembershipPaymentProof, useGetSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import {
  CheckCircle2, Dumbbell, Calendar, Shield, Star, Users,
  ArrowRight, Building2, QrCode, Upload, X, ImageIcon, Loader2,
  RefreshCw, Search, AlertCircle,
} from "lucide-react";

const PRICE_PER_MONTH = 300000;

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function addMonths(dateStr: string, months: number): string {
  const date = new Date(dateStr);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split("T")[0]!;
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0]!;
}

const today = new Date().toISOString().split("T")[0]!;

const BENEFITS = [
  { icon: Dumbbell, label: "Akses Gym Penuh", labelEn: "Full Gym Access", desc: "Gunakan seluruh peralatan gym tanpa batasan waktu", descEn: "Use all gym equipment with no time limits" },
  { icon: Calendar, label: "Bebas Pilih Jadwal", labelEn: "Flexible Schedule", desc: "Datang kapan saja selama jam operasional", descEn: "Come anytime during operating hours" },
  { icon: Shield, label: "Locker Pribadi", labelEn: "Private Locker", desc: "Simpan barang Anda dengan aman di locker member", descEn: "Store your belongings safely in a member locker" },
  { icon: Star, label: "Diskon Fasilitas Lain", labelEn: "Discounts on Other Facilities", desc: "Dapatkan diskon khusus untuk booking lapangan", descEn: "Get special discounts for court bookings" },
  { icon: Users, label: "Komunitas Aktif", labelEn: "Active Community", desc: "Bergabung dengan komunitas olahraga kami", descEn: "Join our sports community" },
];

type Mode = "register" | "renew";
type Step = "form" | "payment" | "upload" | "success";

interface CreatedMembership {
  id: number;
  name: string;
  endDate: string;
  totalPrice: number;
  months: number;
  startDate: string;
}

interface LookupResult {
  id: number;
  name: string;
  phone: string;
  email: string;
  status: string;
  startDate: string;
  endDate: string;
  months: number;
  totalPrice: number;
}

async function uploadProofFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/storage/upload-proof", { method: "POST", body: formData });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Upload gagal"); }
  const { url } = await res.json();
  return url;
}

function getRenewalStartDate(result: LookupResult): string {
  if (result.status === "active") {
    return addDays(result.endDate, 1);
  }
  return today;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    active: { label: "Aktif", className: "bg-green-100 text-green-700 border-green-200" },
    expired: { label: "Kedaluwarsa", className: "bg-red-100 text-red-700 border-red-200" },
    pending_payment: { label: "Menunggu Pembayaran", className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    waiting_confirmation: { label: "Menunggu Konfirmasi", className: "bg-blue-100 text-blue-700 border-blue-200" },
    cancelled: { label: "Dibatalkan", className: "bg-muted text-muted-foreground border-border" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}

export default function Membership() {
  const { toast } = useToast();
  const { t } = useLang();

  // ─── Shared state ─────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    return requestedMode === "renew" ? "renew" : "register";
  });
  const [step, setStep] = useState<Step>("form");
  const [paymentMethod, setPaymentMethod] = useState<"transfer" | "qris" | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [created, setCreated] = useState<CreatedMembership | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Register mode state ───────────────────────────────────────────────────
  const [months, setMonths] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", phone: "", startDate: today, notes: "" });

  // ─── Renew mode state ──────────────────────────────────────────────────────
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [renewMonths, setRenewMonths] = useState(1);

  const { data: settings } = useGetSettings();

  const [registerLoading, setRegisterLoading] = useState(false);

  const proofMutation = useSubmitMembershipPaymentProof({
    mutation: {
      onSuccess: () => setStep("success"),
      onError: () => {
        toast({ title: t("Gagal mengirim bukti", "Failed to submit proof"), description: t("Terjadi kesalahan. Silakan coba lagi.", "An error occurred. Please try again."), variant: "destructive" });
      },
    },
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────
  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone || !form.startDate) {
      toast({ title: t("Form tidak lengkap", "Incomplete form"), description: t("Harap isi semua field yang wajib.", "Please fill in all required fields."), variant: "destructive" });
      return;
    }
    setRegisterLoading(true);
    try {
      const res = await fetch("/api/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, months }),
      });
      const data = await res.json();
      if (res.status === 409) {
        toast({
          title: t("Sudah terdaftar", "Already registered"),
          description: t(
            "Nomor HP ini sudah memiliki membership aktif atau sedang menunggu konfirmasi. Gunakan tab Perpanjang Membership.",
            "This phone number already has an active membership. Please use the Renew Membership tab."
          ),
          variant: "destructive",
        });
        return;
      }
      if (!res.ok) {
        toast({ title: t("Gagal mendaftar", "Registration failed"), description: data.error || t("Terjadi kesalahan.", "An error occurred."), variant: "destructive" });
        return;
      }
      setCreated({ id: data.id, name: data.name, endDate: data.endDate, totalPrice: data.totalPrice, months: data.months, startDate: data.startDate });
      setStep("payment");
    } catch {
      toast({ title: t("Gagal terhubung", "Connection failed"), description: t("Coba lagi.", "Please try again."), variant: "destructive" });
    } finally {
      setRegisterLoading(false);
    }
  }

  async function handleLookup() {
    if (!lookupPhone.trim()) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const res = await fetch("/api/memberships/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: lookupPhone.trim() }),
      });
      if (res.status === 404) { setLookupError(t("Membership dengan nomor ini tidak ditemukan.", "No membership found for this phone number.")); return; }
      if (!res.ok) { setLookupError(t("Terjadi kesalahan. Silakan coba lagi.", "An error occurred. Please try again.")); return; }
      const data = await res.json();
      setLookupResult(data);
      setRenewMonths(1);
    } catch {
      setLookupError(t("Gagal terhubung ke server.", "Failed to connect to server."));
    } finally {
      setLookupLoading(false);
    }
  }

  const [renewLoading, setRenewLoading] = useState(false);

  async function handleRenew() {
    if (!lookupResult) return;
    setRenewLoading(true);
    try {
      const res = await fetch(`/api/memberships/${lookupResult.id}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: renewMonths }),
      });
      if (!res.ok) {
        const e = await res.json();
        toast({ title: t("Gagal memperpanjang", "Renewal failed"), description: e.error || t("Terjadi kesalahan.", "An error occurred."), variant: "destructive" });
        return;
      }
      const data = await res.json();
      setCreated({ id: data.id, name: data.name, endDate: data.endDate, totalPrice: data.totalPrice, months: data.months, startDate: data.startDate });
      setStep("payment");
    } catch {
      toast({ title: t("Gagal terhubung", "Connection failed"), description: t("Coba lagi.", "Please try again."), variant: "destructive" });
    } finally {
      setRenewLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setProofPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleRemoveFile() {
    setProofFile(null);
    setProofPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmitProof() {
    if (!proofFile) {
      toast({ title: t("Wajib isi", "Required"), description: t("Pilih foto bukti pembayaran.", "Please select a payment proof photo."), variant: "destructive" });
      return;
    }
    if (!paymentMethod || !created) return;
    try {
      setIsUploading(true);
      const proofUrl = await uploadProofFile(proofFile);
      proofMutation.mutate({ id: created.id, data: { paymentMethod, paymentProofUrl: proofUrl } });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }

  function handleReset() {
    setStep("form");
    setCreated(null);
    setPaymentMethod(null);
    setProofFile(null);
    setProofPreview(null);
    setMonths(1);
    setForm({ name: "", email: "", phone: "", startDate: today, notes: "" });
    setLookupPhone("");
    setLookupResult(null);
    setLookupError(null);
    setRenewMonths(1);
  }

  // ─── Shared steps: success ─────────────────────────────────────────────────
  if (step === "success" && created) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="text-green-600 w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold mb-2">
          {mode === "renew" ? t("Perpanjangan Dikirim!", "Renewal Submitted!") : t("Bukti Diterima!", "Proof Submitted!")}
        </h1>
        <p className="text-muted-foreground mb-6">
          {t("Selamat", "Hello")}, <span className="font-semibold text-foreground">{created.name}</span>!<br />
          {mode === "renew"
            ? t("Perpanjangan membership sedang diverifikasi oleh admin. Membership akan diperpanjang setelah konfirmasi.", "Your membership renewal is being verified by admin. It will be extended after confirmation.")
            : t("Pembayaran Anda sedang diverifikasi oleh admin. Membership gym akan aktif setelah konfirmasi.", "Your payment is being verified by admin. Gym membership will be activated after confirmation.")}
        </p>
        <Card className="mb-6 text-left">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{t("Total Pembayaran", "Total Payment")}</div>
              <div className="text-xl font-black text-primary">{formatCurrency(created.totalPrice)}</div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("Durasi", "Duration")}</span>
              <span>{created.months} {t("bulan", "months")}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("Berlaku mulai", "Valid from")}</span>
              <span>{created.startDate}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("Berlaku hingga", "Valid until")}</span>
              <span className="font-medium">{created.endDate}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("Metode", "Method")}</span>
              <Badge variant="outline">{paymentMethod === "qris" ? "QRIS" : "Transfer Bank"}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">{t("Menunggu Konfirmasi", "Awaiting Confirmation")}</Badge>
            </div>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground mb-6">
          {t("Admin akan mengkonfirmasi pembayaran Anda dalam 1x24 jam.", "Admin will confirm your payment within 24 hours.")}
        </p>
        <Button onClick={handleReset} variant="outline" className="mr-3">
          {mode === "renew" ? t("Perpanjang Lagi", "Renew Again") : t("Daftar Lagi", "Register Again")}
        </Button>
        <Button asChild>
          <a href="/">{t("Kembali ke Home", "Back to Home")}</a>
        </Button>
      </div>
    );
  }

  // ─── Shared steps: upload proof ────────────────────────────────────────────
  if (step === "upload" && created && paymentMethod) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-16">
        <StepIndicator step={3} />
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-xl">{t("Upload Bukti Pembayaran", "Upload Payment Proof")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("Upload foto/screenshot bukti transfer atau QRIS Anda", "Upload your transfer or QRIS payment proof photo")}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Nama", "Name")}</span>
                <span className="font-medium">{created.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Total Pembayaran", "Total Payment")}</span>
                <span className="font-bold text-primary">{formatCurrency(created.totalPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Metode", "Method")}</span>
                <Badge variant="outline">{paymentMethod === "qris" ? "QRIS" : "Transfer Bank"}</Badge>
              </div>
            </div>

            <div>
              <Label className="mb-2 block">{t("Foto Bukti Pembayaran", "Payment Proof Photo")} <span className="text-destructive">*</span></Label>
              {proofPreview ? (
                <div className="relative">
                  <img src={proofPreview} alt="Bukti" className="w-full max-h-64 object-contain rounded-xl border border-border" />
                  <button
                    onClick={handleRemoveFile}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-40 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                >
                  <ImageIcon size={32} className="opacity-50" />
                  <span className="text-sm">{t("Klik untuk pilih foto", "Click to select photo")}</span>
                  <span className="text-xs opacity-60">{t("JPG, PNG, WEBP — maks 10MB", "JPG, PNG, WEBP — max 10MB")}</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setStep("payment")}
                disabled={isUploading || proofMutation.isPending}
              >
                {t("Kembali", "Back")}
              </Button>
              <Button
                className="flex-1"
                onClick={handleSubmitProof}
                disabled={!proofFile || isUploading || proofMutation.isPending}
              >
                {isUploading || proofMutation.isPending ? (
                  <><Loader2 size={16} className="mr-2 animate-spin" />{t("Mengirim...", "Sending...")}</>
                ) : (
                  <><Upload size={16} className="mr-2" />{t("Kirim Bukti", "Submit Proof")}</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Shared steps: payment method ─────────────────────────────────────────
  if (step === "payment" && created) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-16">
        <StepIndicator step={2} />
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-xl">{t("Pilih Metode Pembayaran", "Choose Payment Method")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("Pilih cara pembayaran dan ikuti instruksi di bawah ini", "Choose your payment method and follow the instructions below")}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Nama", "Name")}</span>
                <span className="font-medium">{created.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Durasi", "Duration")}</span>
                <span>{created.months} {t("bulan", "months")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Berlaku mulai", "Valid from")}</span>
                <span>{created.startDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Berlaku hingga", "Valid until")}</span>
                <span>{created.endDate}</span>
              </div>
              <div className="border-t border-primary/20 pt-2 flex justify-between font-bold">
                <span>{t("Total Pembayaran", "Total Payment")}</span>
                <span className="text-primary text-base">{formatCurrency(created.totalPrice)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label>{t("Metode Pembayaran", "Payment Method")}</Label>
              <button
                type="button"
                onClick={() => setPaymentMethod("transfer")}
                className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-colors text-left ${paymentMethod === "transfer" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
              >
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 shrink-0 mt-0.5">
                  <Building2 size={20} />
                </div>
                <div className="flex-1">
                  <div className="font-semibold">{t("Transfer Bank", "Bank Transfer")}</div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {settings?.bankName ? (
                      <span>{settings.bankName} · {settings.bankAccount} · a.n. {settings.bankAccountName}</span>
                    ) : (
                      t("Transfer ke rekening kami", "Transfer to our bank account")
                    )}
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${paymentMethod === "transfer" ? "border-primary bg-primary" : "border-border"}`}>
                  {paymentMethod === "transfer" && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("qris")}
                className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-colors text-left ${paymentMethod === "qris" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
              >
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center text-primary shrink-0 mt-0.5">
                  <QrCode size={20} />
                </div>
                <div className="flex-1">
                  <div className="font-semibold">QRIS</div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {t("Scan QRIS dengan aplikasi mobile banking atau e-wallet", "Scan QRIS with your mobile banking or e-wallet app")}
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${paymentMethod === "qris" ? "border-primary bg-primary" : "border-border"}`}>
                  {paymentMethod === "qris" && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </button>
            </div>

            {paymentMethod === "transfer" && settings && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 space-y-2">
                <div className="text-sm font-semibold text-blue-800">{t("Instruksi Transfer", "Transfer Instructions")}</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-blue-600">{t("Bank", "Bank")}</span>
                    <span className="font-semibold">{settings.bankName || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-600">{t("No. Rekening", "Account No.")}</span>
                    <span className="font-semibold font-mono">{settings.bankAccount || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-600">{t("Atas Nama", "Account Name")}</span>
                    <span className="font-semibold">{settings.bankAccountName || "-"}</span>
                  </div>
                  <div className="flex justify-between border-t border-blue-200 pt-2">
                    <span className="text-blue-600">{t("Jumlah Transfer", "Transfer Amount")}</span>
                    <span className="font-bold text-primary">{formatCurrency(created.totalPrice)}</span>
                  </div>
                </div>
              </div>
            )}

            {paymentMethod === "qris" && settings?.qrisImageUrl && (
              <div className="rounded-xl bg-orange-50 border border-orange-200 p-4 flex flex-col items-center gap-3">
                <div className="text-sm font-semibold text-orange-800">{t("Scan QRIS di bawah ini", "Scan the QRIS below")}</div>
                <img src={settings.qrisImageUrl} alt="QRIS" className="w-48 h-48 object-contain rounded-lg border border-orange-200" />
                <div className="text-sm text-orange-700 font-bold">{formatCurrency(created.totalPrice)}</div>
              </div>
            )}

            {paymentMethod === "qris" && !settings?.qrisImageUrl && (
              <div className="rounded-xl bg-orange-50 border border-orange-200 p-4 text-center text-sm text-orange-700">
                {t("QRIS belum tersedia. Gunakan transfer bank atau hubungi kami.", "QRIS not available. Please use bank transfer or contact us.")}
              </div>
            )}

            <Button
              className="w-full h-12"
              disabled={!paymentMethod}
              onClick={() => setStep("upload")}
            >
              {t("Lanjut Upload Bukti", "Continue to Upload Proof")} <ArrowRight size={16} className="ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Main page (form step) ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen">
      <SEOHead
        title="Keanggotaan Member Gym | Sport Center Soekarno-Hatta"
        description="Bergabunglah sebagai member Sport Center Soekarno-Hatta dan nikmati berbagai keuntungan eksklusif, diskon booking, dan akses prioritas ke fasilitas gym premium."
        path="/membership"
      />
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary/20 via-background to-background py-16 md:py-24">
        <div className="container px-4 md:px-8 text-center max-w-2xl mx-auto">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">{t("Member Gym Bulanan", "Monthly Gym Membership")}</Badge>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            {t("Jadilah", "Become")} <span className="text-primary">{t("Member Gym", "Gym Member")}</span> {t("Kami", "of Ours")}
          </h1>
          <p className="text-xl text-muted-foreground mb-6">
            {t("Akses penuh ke fasilitas gym premium hanya dengan", "Full access to premium gym facilities for only")} <span className="font-bold text-foreground">{formatCurrency(PRICE_PER_MONTH)}</span> {t("per bulan.", "per month.")}
          </p>
          <div className="text-3xl font-black text-primary">{formatCurrency(PRICE_PER_MONTH)} <span className="text-lg font-normal text-muted-foreground">{t("/ bulan", "/ month")}</span></div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-16 bg-muted/30">
        <div className="container px-4 md:px-8">
          <h2 className="text-2xl font-bold text-center mb-10">{t("Keuntungan Menjadi Member", "Benefits of Becoming a Member")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {BENEFITS.map((b) => (
              <div key={b.label} className="flex gap-4 p-5 rounded-xl bg-background border border-border">
                <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <b.icon size={22} />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{t(b.label, b.labelEn)}</h3>
                  <p className="text-sm text-muted-foreground">{t(b.desc, b.descEn)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form section */}
      <section className="py-16">
        <div className="container px-4 md:px-8">
          <div className="max-w-xl mx-auto">

            {/* Mode tab switcher */}
            <div className="flex rounded-xl border border-border bg-muted/40 p-1 mb-6 gap-1">
              <button
                type="button"
                onClick={() => { setMode("register"); setLookupResult(null); setLookupError(null); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${mode === "register" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Dumbbell size={15} />
                {t("Daftar Member Baru", "Register New Member")}
              </button>
              <button
                type="button"
                onClick={() => { setMode("renew"); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${mode === "renew" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <RefreshCw size={15} />
                {t("Perpanjang Membership", "Renew Membership")}
              </button>
            </div>

            {/* Register mode */}
            {mode === "register" && (
              <>
                <StepIndicator step={1} />
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="text-xl">{t("Formulir Pendaftaran Member", "Member Registration Form")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSubmitForm} className="space-y-5">
                      <div>
                        <Label htmlFor="name">{t("Nama Lengkap", "Full Name")} <span className="text-destructive">*</span></Label>
                        <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("Nama lengkap Anda", "Your full name")} required className="mt-1.5" />
                      </div>
                      <div>
                        <Label htmlFor="email">{t("Email", "Email")} <span className="text-destructive">*</span></Label>
                        <Input id="email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="email@contoh.com" required className="mt-1.5" />
                      </div>
                      <div>
                        <Label htmlFor="phone">{t("No. Telepon", "Phone No.")} <span className="text-destructive">*</span></Label>
                        <Input id="phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="08xxxxxxxxxx" required className="mt-1.5" />
                      </div>
                      <div>
                        <Label htmlFor="startDate">{t("Tanggal Mulai", "Start Date")} <span className="text-destructive">*</span></Label>
                        <Input id="startDate" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required className="mt-1.5" />
                      </div>
                      <div>
                        <Label>{t("Durasi Membership", "Membership Duration")}</Label>
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          {[1, 2, 3, 6, 12].map((m) => (
                            <button key={m} type="button" onClick={() => setMonths(m)}
                              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${months === m ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground hover:border-primary/50"}`}
                            >
                              {m} {t("Bulan", "Months")}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="notes">{t("Catatan (opsional)", "Notes (optional)")}</Label>
                        <Textarea id="notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("Catatan atau pertanyaan tambahan...", "Additional notes or questions...")} className="mt-1.5" rows={3} />
                      </div>

                      <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("Harga per bulan", "Price per month")}</span>
                          <span>{formatCurrency(PRICE_PER_MONTH)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{t("Durasi", "Duration")}</span>
                          <span>{months} {t("bulan", "months")}</span>
                        </div>
                        {form.startDate && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t("Berlaku hingga", "Valid until")}</span>
                            <span>{addMonths(form.startDate, months)}</span>
                          </div>
                        )}
                        <div className="border-t border-primary/20 pt-2 flex justify-between font-bold">
                          <span>{t("Total", "Total")}</span>
                          <span className="text-primary">{formatCurrency(PRICE_PER_MONTH * months)}</span>
                        </div>
                      </div>

                      <Button type="submit" className="w-full h-12 text-base" disabled={registerLoading}>
                        {registerLoading ? (
                          <><Loader2 size={16} className="mr-2 animate-spin" />{t("Mendaftarkan...", "Registering...")}</>
                        ) : (
                          <>{t("Lanjut ke Pembayaran", "Continue to Payment")} <ArrowRight size={16} className="ml-2" /></>
                        )}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Renew mode */}
            {mode === "renew" && (
              <div className="space-y-5">
                {/* Lookup form */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">{t("Cek Membership Anda", "Check Your Membership")}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {t("Masukkan nomor telepon yang terdaftar untuk melihat status membership.", "Enter your registered phone number to check membership status.")}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <Input
                        type="tel"
                        value={lookupPhone}
                        onChange={(e) => setLookupPhone(e.target.value)}
                        placeholder="08xxxxxxxxxx"
                        onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                        className="flex-1"
                      />
                      <Button
                        onClick={handleLookup}
                        disabled={lookupLoading || !lookupPhone.trim()}
                        className="shrink-0"
                      >
                        {lookupLoading ? <Loader2 size={16} className="animate-spin" /> : <><Search size={16} className="mr-1.5" />{t("Cari", "Search")}</>}
                      </Button>
                    </div>

                    {lookupError && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        <span>{lookupError}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Lookup result */}
                {lookupResult && (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{t("Data Membership", "Membership Data")}</CardTitle>
                        <StatusBadge status={lookupResult.status} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("Nama", "Name")}</span>
                          <span className="font-semibold">{lookupResult.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("Periode Aktif", "Active Period")}</span>
                          <span>{lookupResult.startDate} → {lookupResult.endDate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t("Durasi Lama", "Previous Duration")}</span>
                          <span>{lookupResult.months} {t("bulan", "months")}</span>
                        </div>
                      </div>

                      {/* Renewable statuses */}
                      {(lookupResult.status === "active" || lookupResult.status === "expired" || lookupResult.status === "waiting_confirmation") && (
                        <>
                          <div className="border-t border-border pt-4">
                            {lookupResult.status === "active" && (
                              <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 mb-4">
                                ✓ {t("Membership masih aktif. Perpanjangan akan mulai otomatis setelah", "Membership is still active. Renewal will start automatically after")} <span className="font-semibold">{lookupResult.endDate}</span>.
                              </div>
                            )}
                            {lookupResult.status === "expired" && (
                              <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800 mb-4">
                                ⚠ {t("Membership sudah kedaluwarsa. Perpanjangan akan mulai dari hari ini.", "Membership has expired. Renewal will start from today.")}
                              </div>
                            )}
                            {lookupResult.status === "waiting_confirmation" && (
                              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 mb-4">
                                ⏳ {t("Pembayaran sebelumnya sedang dikonfirmasi. Anda tetap bisa perpanjang sekarang.", "Previous payment is being confirmed. You can still renew now.")}
                              </div>
                            )}

                            <Label className="mb-2 block">{t("Tambah Durasi", "Add Duration")}</Label>
                            <div className="flex gap-2 flex-wrap mb-4">
                              {[1, 2, 3, 6, 12].map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setRenewMonths(m)}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${renewMonths === m ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground hover:border-primary/50"}`}
                                >
                                  {m} {t("Bulan", "Months")}
                                </button>
                              ))}
                            </div>

                            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-2 text-sm mb-4">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("Mulai Periode Baru", "New Period Start")}</span>
                                <span className="font-medium">{getRenewalStartDate(lookupResult)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("Berakhir", "Ends")}</span>
                                <span className="font-medium">{addMonths(getRenewalStartDate(lookupResult), renewMonths)}</span>
                              </div>
                              <div className="border-t border-primary/20 pt-2 flex justify-between font-bold">
                                <span>{t("Total Pembayaran", "Total Payment")}</span>
                                <span className="text-primary text-base">{formatCurrency(PRICE_PER_MONTH * renewMonths)}</span>
                              </div>
                            </div>

                            <Button
                              className="w-full h-12 text-base"
                              onClick={handleRenew}
                              disabled={renewLoading}
                            >
                              {renewLoading ? (
                                <><Loader2 size={16} className="mr-2 animate-spin" />{t("Memproses...", "Processing...")}</>
                              ) : (
                                <><RefreshCw size={16} className="mr-2" />{t("Perpanjang Membership", "Renew Membership")} <ArrowRight size={16} className="ml-2" /></>
                              )}
                            </Button>
                          </div>
                        </>
                      )}

                      {/* Pending payment — can't renew yet */}
                      {lookupResult.status === "pending_payment" && (
                        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
                          {t("Membership Anda sedang menunggu pembayaran. Selesaikan pembayaran yang ada sebelum memperpanjang.", "Your membership is awaiting payment. Please complete the existing payment before renewing.")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

          </div>
        </div>
      </section>
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "Isi Formulir" },
    { n: 2, label: "Metode Bayar" },
    { n: 3, label: "Upload Bukti" },
  ];
  return (
    <div className="flex items-center gap-0 max-w-sm mx-auto">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${step >= s.n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {step > s.n ? <CheckCircle2 size={16} /> : s.n}
            </div>
            <span className={`text-xs mt-1 text-center ${step >= s.n ? "text-primary font-medium" : "text-muted-foreground"}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mb-5 mx-1 ${step > s.n ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
