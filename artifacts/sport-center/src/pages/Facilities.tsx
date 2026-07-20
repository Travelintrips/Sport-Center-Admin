import { useState, useMemo, useRef } from "react";
import { Link } from "wouter";
import { useListFacilities, useCreateMembership, useSubmitMembershipPaymentProof, useGetSettings } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, MapPin, Dumbbell, CheckCircle2, Star, Users, ArrowRight, Building2, QrCode, Upload, X, ImageIcon, Loader2, RefreshCw, UserPlus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getFacilityImage } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

async function uploadProofFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/storage/upload-proof", { method: "POST", body: formData });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Upload gagal"); }
  const { url } = await res.json();
  return url;
}

const PRICE_PER_MONTH = 300000;
const today = new Date().toISOString().split("T")[0];

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function addMonths(dateStr: string, months: number): string {
  const date = new Date(dateStr);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split("T")[0];
}

type DialogMode = "register" | "renew";
type DialogStep = "form" | "lookup" | "payment" | "upload" | "success";

interface CreatedMem { id: number; name: string; endDate: string; totalPrice: number; months: number; startDate?: string; }
interface LookupResult { id: number; name: string; phone: string; email: string; status: string; endDate: string; }

function MembershipDialog({ open, onClose, initialMode = "register" }: { open: boolean; onClose: () => void; initialMode?: DialogMode }) {
  const { toast } = useToast();
  const { t } = useLang();
  const [mode] = useState<DialogMode>(initialMode);
  const [step, setStep] = useState<DialogStep>(initialMode === "renew" ? "lookup" : "form");
  const [months, setMonths] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", phone: "", startDate: today, notes: "" });
  const [created, setCreated] = useState<CreatedMem | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"transfer" | "qris" | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: settings } = useGetSettings();

  // Renew-mode state
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [renewMonths, setRenewMonths] = useState(1);
  const [renewLoading, setRenewLoading] = useState(false);

  const createMutation = useCreateMembership({
    mutation: {
      onSuccess: (data) => {
        setCreated({ id: data.id, name: data.name, endDate: data.endDate, totalPrice: data.totalPrice, months: data.months });
        setStep("payment");
      },
      onError: () => {
        toast({ title: t("Gagal mendaftar", "Registration failed"), description: t("Terjadi kesalahan. Silakan coba lagi.", "An error occurred. Please try again."), variant: "destructive" });
      },
    },
  });

  const proofMutation = useSubmitMembershipPaymentProof({
    mutation: {
      onSuccess: () => setStep("success"),
      onError: () => {
        toast({ title: t("Gagal mengirim bukti", "Failed to submit proof"), variant: "destructive" });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone || !form.startDate) {
      toast({ title: t("Form tidak lengkap", "Incomplete form"), description: t("Harap isi semua field yang wajib.", "Please fill in all required fields."), variant: "destructive" });
      return;
    }
    createMutation.mutate({ data: { ...form, months } });
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
      if (!res.ok) {
        const e = await res.json();
        setLookupError(e.error || t("Member tidak ditemukan.", "Member not found."));
        return;
      }
      const data = await res.json();
      setLookupResult(data);
    } catch {
      setLookupError(t("Gagal terhubung. Coba lagi.", "Connection failed. Try again."));
    } finally {
      setLookupLoading(false);
    }
  }

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

  async function handleSubmitProof() {
    if (!proofFile || !paymentMethod || !created) return;
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

  function handleClose() {
    setStep(initialMode === "renew" ? "lookup" : "form");
    setCreated(null);
    setPaymentMethod(null);
    setProofFile(null);
    setProofPreview(null);
    setForm({ name: "", email: "", phone: "", startDate: today, notes: "" });
    setMonths(1);
    setLookupPhone("");
    setLookupResult(null);
    setLookupError(null);
    setRenewMonths(1);
    onClose();
  }

  const stepLabels = mode === "renew"
    ? [t("Cari Member", "Find Member"), t("Metode Bayar", "Payment"), t("Upload Bukti", "Upload Proof")]
    : [t("Formulir", "Form"), t("Metode Bayar", "Payment"), t("Upload Bukti", "Upload Proof")];
  const stepIndex = (step === "form" || step === "lookup") ? 0 : step === "payment" ? 1 : step === "upload" ? 2 : 3;

  const statusColor = (s: string) => s === "active" ? "bg-green-100 text-green-700" : s === "expired" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700";
  const statusLabel = (s: string) => s === "active" ? t("Aktif", "Active") : s === "expired" ? t("Kedaluwarsa", "Expired") : t("Menunggu", "Pending");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto rounded-3xl p-0 border-0">
        <DialogHeader className="p-6 pb-3 border-b bg-muted/30 sticky top-0 z-10">
          <DialogTitle className="flex items-center gap-2 text-lg font-black text-secondary dark:text-white">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              {mode === "renew" ? <RefreshCw size={18} /> : <UserPlus size={18} />}
            </div>
            {mode === "renew" ? t("Perpanjang Membership Gym", "Renew Gym Membership") : t("Daftar Member Gym Bulanan", "Monthly Gym Membership")}
          </DialogTitle>
          {step !== "success" && (
            <div className="flex items-center gap-1 mt-3">
              {stepLabels.map((label, i) => (
                <div key={i} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${stepIndex >= i ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                      {stepIndex > i ? <CheckCircle2 size={12} /> : i + 1}
                    </div>
                    <span className={`text-[10px] mt-0.5 text-center leading-tight ${stepIndex >= i ? "text-primary font-semibold" : "text-muted-foreground"}`}>{label}</span>
                  </div>
                  {i < stepLabels.length - 1 && <div className={`h-px flex-1 mb-4 mx-0.5 ${stepIndex > i ? "bg-primary" : "bg-border"}`} />}
                </div>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="p-6">
          {/* STEP: LOOKUP (renew mode) */}
          {step === "lookup" && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground font-medium">
                {t("Masukkan nomor WhatsApp yang terdaftar untuk mencari data membership Anda.", "Enter your registered WhatsApp number to find your membership.")}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="lookup-phone" className="font-bold text-foreground/80">{t("No. WhatsApp / Telepon", "WhatsApp / Phone No.")} <span className="text-destructive">*</span></Label>
                <div className="flex gap-2">
                  <Input
                    id="lookup-phone"
                    type="tel"
                    value={lookupPhone}
                    onChange={(e) => { setLookupPhone(e.target.value); setLookupError(null); setLookupResult(null); }}
                    onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                    placeholder="08xxxxxxxxxx"
                    className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium"
                  />
                  <Button type="button" onClick={handleLookup} disabled={lookupLoading || !lookupPhone.trim()} className="h-12 px-5 rounded-xl shrink-0">
                    {lookupLoading ? <Loader2 size={16} className="animate-spin" /> : t("Cari", "Search")}
                  </Button>
                </div>
                {lookupError && <p className="text-sm text-destructive font-medium">{lookupError}</p>}
              </div>

              {lookupResult && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-4">
                  <div className="rounded-2xl bg-[#F8FAFC] dark:bg-slate-900 border border-border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-black text-secondary dark:text-white text-base">{lookupResult.name}</div>
                        <div className="text-xs text-muted-foreground font-medium">{lookupResult.phone}</div>
                      </div>
                      <Badge className={`text-xs font-bold border-none ${statusColor(lookupResult.status)}`}>{statusLabel(lookupResult.status)}</Badge>
                    </div>
                    <div className="h-px bg-border" />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("Aktif hingga", "Active until")}</span>
                      <span className="font-semibold">{lookupResult.endDate}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-bold text-foreground/80">{t("Durasi Perpanjangan", "Renewal Duration")}</Label>
                    <div className="grid grid-cols-5 gap-2">
                      {[1, 2, 3, 6, 12].map((m) => (
                        <button key={m} type="button" onClick={() => setRenewMonths(m)}
                          className={`h-12 rounded-xl text-sm font-bold border-2 transition-all ${renewMonths === m ? "bg-primary/10 text-primary border-primary shadow-sm" : "bg-[#F8FAFC] dark:bg-slate-900 border-border text-foreground/70 hover:border-primary/40"}`}>
                          {m}<span className="block text-[10px] uppercase font-semibold opacity-70">{t("Bulan", "Mo")}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-primary/5 border border-primary/20 p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("Perpanjang", "Extend by")}</span>
                      <span className="font-semibold">{renewMonths} {t("bulan", "months")}</span>
                    </div>
                    <div className="flex justify-between border-t border-primary/20 pt-2">
                      <span className="font-bold">{t("Total Bayar", "Total Payment")}</span>
                      <span className="font-black text-primary">{formatCurrency(PRICE_PER_MONTH * renewMonths)}</span>
                    </div>
                  </div>

                  <Button className="w-full h-12 rounded-full font-bold shadow-md" onClick={handleRenew} disabled={renewLoading}>
                    {renewLoading
                      ? <><Loader2 size={16} className="mr-2 animate-spin" />{t("Memproses...", "Processing...")}</>
                      : <><RefreshCw size={16} className="mr-2" />{t("Perpanjang Sekarang", "Renew Now")} <ArrowRight size={15} className="ml-2" /></>}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* STEP: SUCCESS */}
          {step === "success" && created && (
            <div className="text-center py-4 animate-in fade-in zoom-in duration-500">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5 shadow-inner">
                <CheckCircle2 className="text-green-600 w-10 h-10" />
              </div>
              <h3 className="text-2xl font-black mb-2 text-secondary dark:text-white">{t("Bukti Diterima!", "Proof Submitted!")}</h3>
              <p className="text-muted-foreground font-medium mb-5">
                {t("Selamat", "Hello")}, <span className="font-bold text-foreground">{created.name}</span>!<br />
                {t("Pembayaran sedang diverifikasi admin. Membership aktif setelah konfirmasi.", "Your payment is being verified. Membership activates after confirmation.")}
              </p>
              <div className="bg-[#F8FAFC] dark:bg-slate-900 border border-border rounded-2xl p-5 mb-5 space-y-2 text-sm text-left">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Total Pembayaran", "Total Payment")}</span>
                  <span className="font-black text-primary text-base">{formatCurrency(created.totalPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Durasi", "Duration")}</span>
                  <span className="font-medium">{created.months} {t("bulan", "months")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Berlaku hingga", "Valid until")}</span>
                  <span className="font-medium">{created.endDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Metode", "Method")}</span>
                  <span className="font-medium">{paymentMethod === "qris" ? "QRIS" : "Transfer Bank"}</span>
                </div>
                <div className="flex justify-between pt-1 border-t">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-xs">{t("Menunggu Konfirmasi", "Awaiting Confirmation")}</Badge>
                </div>
              </div>
              <Button onClick={handleClose} size="lg" className="w-full rounded-full font-bold h-12 shadow-lg shadow-primary/20">
                {t("Tutup & Kembali", "Close & Back")}
              </Button>
            </div>
          )}

          {/* STEP: UPLOAD PROOF */}
          {step === "upload" && created && paymentMethod && (
            <div className="space-y-5">
              <div className="bg-[#F8FAFC] dark:bg-slate-900 border border-border rounded-2xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Total Pembayaran", "Total")}</span>
                  <span className="font-black text-primary">{formatCurrency(created.totalPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Metode", "Method")}</span>
                  <span className="font-medium">{paymentMethod === "qris" ? "QRIS" : "Transfer Bank"}</span>
                </div>
              </div>

              <div>
                <Label className="mb-2 block font-bold">{t("Foto Bukti Pembayaran", "Payment Proof Photo")} <span className="text-destructive">*</span></Label>
                {proofPreview ? (
                  <div className="relative">
                    <img src={proofPreview} alt="Bukti" className="w-full max-h-56 object-contain rounded-2xl border border-border" />
                    <button onClick={() => { setProofFile(null); setProofPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-destructive text-white flex items-center justify-center">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="w-full h-36 rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
                    <ImageIcon size={28} className="opacity-50" />
                    <span className="text-sm font-medium">{t("Klik untuk pilih foto", "Click to select photo")}</span>
                    <span className="text-xs opacity-60">JPG, PNG, WEBP — maks 10MB</span>
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 rounded-full" onClick={() => setStep("payment")} disabled={isUploading || proofMutation.isPending}>
                  {t("Kembali", "Back")}
                </Button>
                <Button className="flex-1 rounded-full font-bold" onClick={handleSubmitProof} disabled={!proofFile || isUploading || proofMutation.isPending}>
                  {isUploading || proofMutation.isPending
                    ? <><Loader2 size={15} className="mr-2 animate-spin" />{t("Mengirim...", "Sending...")}</>
                    : <><Upload size={15} className="mr-2" />{t("Kirim Bukti", "Submit Proof")}</>}
                </Button>
              </div>
            </div>
          )}

          {/* STEP: PAYMENT METHOD */}
          {step === "payment" && created && (
            <div className="space-y-5">
              <div className="rounded-2xl bg-primary/5 border border-primary/20 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Nama", "Name")}</span>
                  <span className="font-semibold">{created.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Durasi", "Duration")}</span>
                  <span>{created.months} {t("bulan", "months")}</span>
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
                <Label className="font-bold">{t("Pilih Metode Pembayaran", "Choose Payment Method")}</Label>
                <button type="button" onClick={() => setPaymentMethod("transfer")}
                  className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 transition-colors text-left ${paymentMethod === "transfer" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    <Building2 size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-sm">{t("Transfer Bank", "Bank Transfer")}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {settings?.bankName ? `${settings.bankName} · ${settings.bankAccount} · a.n. ${settings.bankAccountName}` : t("Transfer ke rekening kami", "Transfer to our bank account")}
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${paymentMethod === "transfer" ? "border-primary bg-primary" : "border-border"}`}>
                    {paymentMethod === "transfer" && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </button>

                <button type="button" onClick={() => setPaymentMethod("qris")}
                  className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 transition-colors text-left ${paymentMethod === "qris" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-primary shrink-0">
                    <QrCode size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-sm">QRIS</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{t("Scan QRIS dengan aplikasi mobile banking atau e-wallet", "Scan QRIS with your mobile banking or e-wallet")}</div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${paymentMethod === "qris" ? "border-primary bg-primary" : "border-border"}`}>
                    {paymentMethod === "qris" && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </button>
              </div>

              {paymentMethod === "transfer" && settings && (
                <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4 space-y-2 text-sm">
                  <div className="font-semibold text-blue-800 mb-2">{t("Instruksi Transfer", "Transfer Instructions")}</div>
                  <div className="flex justify-between"><span className="text-blue-600">{t("Bank", "Bank")}</span><span className="font-bold">{settings.bankName || "-"}</span></div>
                  <div className="flex justify-between"><span className="text-blue-600">{t("No. Rekening", "Account No.")}</span><span className="font-bold font-mono">{settings.bankAccount || "-"}</span></div>
                  <div className="flex justify-between"><span className="text-blue-600">{t("Atas Nama", "Name")}</span><span className="font-bold">{settings.bankAccountName || "-"}</span></div>
                  <div className="flex justify-between border-t border-blue-200 pt-2"><span className="text-blue-600">{t("Jumlah", "Amount")}</span><span className="font-black text-primary">{formatCurrency(created.totalPrice)}</span></div>
                </div>
              )}

              {paymentMethod === "qris" && settings?.qrisImageUrl && (
                <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4 flex flex-col items-center gap-3">
                  <div className="text-sm font-semibold text-orange-800">{t("Scan QRIS di bawah ini", "Scan the QRIS below")}</div>
                  <img src={settings.qrisImageUrl} alt="QRIS" className="w-44 h-44 object-contain rounded-xl border border-orange-200" />
                  <div className="text-sm font-black text-primary">{formatCurrency(created.totalPrice)}</div>
                </div>
              )}

              {paymentMethod === "qris" && !settings?.qrisImageUrl && (
                <div className="rounded-2xl bg-orange-50 border border-orange-200 p-3 text-center text-sm text-orange-700">
                  {t("QRIS belum tersedia. Gunakan transfer bank.", "QRIS not available. Please use bank transfer.")}
                </div>
              )}

              <Button className="w-full h-12 rounded-full font-bold shadow-lg shadow-primary/20" disabled={!paymentMethod} onClick={() => setStep("upload")}>
                {t("Lanjut Upload Bukti", "Continue to Upload Proof")} <ArrowRight size={15} className="ml-2" />
              </Button>
            </div>
          )}

          {/* STEP: FORM */}
          {step === "form" && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="m-name" className="font-bold text-foreground/80">{t("Nama Lengkap", "Full Name")} <span className="text-destructive">*</span></Label>
                <Input id="m-name" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t("Ketik nama lengkap Anda", "Enter your full name")} required className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-email" className="font-bold text-foreground/80">Email <span className="text-destructive">*</span></Label>
                <Input id="m-email" type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="nama@email.com" required className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="m-phone" className="font-bold text-foreground/80">{t("No. WhatsApp", "WhatsApp No.")} <span className="text-destructive">*</span></Label>
                  <Input id="m-phone" type="tel" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08xxxxxxxxxx" required className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m-start" className="font-bold text-foreground/80">{t("Mulai Tanggal", "Start Date")} <span className="text-destructive">*</span></Label>
                  <Input id="m-start" type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} required className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium" />
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <Label className="font-bold text-foreground/80">{t("Pilih Durasi Membership", "Choose Membership Duration")}</Label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 6, 12].map((m) => (
                    <button key={m} type="button" onClick={() => setMonths(m)}
                      className={`h-12 rounded-xl text-sm font-bold border-2 transition-all ${months === m ? "bg-primary/10 text-primary border-primary shadow-sm" : "bg-[#F8FAFC] dark:bg-slate-900 border-border text-foreground/70 hover:border-primary/40"}`}>
                      {m}<span className="block text-[10px] uppercase font-semibold opacity-70">{t("Bulan", "Month")}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl bg-[#F8FAFC] dark:bg-slate-900 border border-border p-5 space-y-3">
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">{t("Harga Per Bulan", "Price Per Month")}</span>
                  <span>{formatCurrency(PRICE_PER_MONTH)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">{t("Durasi Pilihan", "Selected Duration")}</span>
                  <span>{months} {t("Bulan", "Months")}</span>
                </div>
                <div className="h-px bg-border my-1" />
                <div className="flex justify-between items-end">
                  <span className="font-bold text-foreground/80">{t("Total Bayar", "Total Payment")}</span>
                  <span className="text-2xl font-black text-primary">{formatCurrency(PRICE_PER_MONTH * months)}</span>
                </div>
              </div>
              <Button type="submit" size="lg" className="w-full h-14 rounded-full font-bold shadow-lg shadow-primary/20 text-base" disabled={createMutation.isPending}>
                {createMutation.isPending
                  ? <><Loader2 size={16} className="mr-2 animate-spin" />{t("Memproses...", "Processing...")}</>
                  : <>{t("Lanjut ke Pembayaran", "Continue to Payment")} <ArrowRight size={16} className="ml-2" /></>}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Facilities() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [membershipMode, setMembershipMode] = useState<"register" | "renew">("register");

  function openMembership(mode: "register" | "renew") {
    setMembershipMode(mode);
    setMembershipOpen(true);
  }

  const { data: facilities, isLoading } = useListFacilities({ activeOnly: true });

  const categories = useMemo(() => {
    if (!facilities) return ["all"];
    const cats = new Set(facilities.map(f => f.category));
    return ["all", ...Array.from(cats)].sort();
  }, [facilities]);

  const filteredFacilities = useMemo(() => {
    if (!facilities) return [];
    return facilities.filter(f => {
      const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase()) ||
                            f.category.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = selectedCategory === "all" || f.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [facilities, search, selectedCategory]);

  const showMembershipCard = selectedCategory === "all" || selectedCategory.toLowerCase() === "gym";

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 pb-20">
      {/* Header section */}
      <div className="bg-white dark:bg-slate-900 border-b border-border/50 pt-12 pb-16">
        <div className="container mx-auto px-4 md:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4 leading-tight">
              {t("Pilih Fasilitas", "Choose Your")} <span className="text-primary">{t("Olahraga Anda", "Sports Facility")}</span>
            </h1>
            <p className="text-lg font-medium text-muted-foreground leading-relaxed">
              {t("Dari lapangan berstandar internasional hingga pusat kebugaran modern. Temukan ketersediaan dan pesan jadwal Anda hari ini.", "From internationally-standard courts to modern fitness centers. Find availability and book your schedule today.")}
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 -mt-8 relative z-10">
        {/* Filters */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 md:p-6 shadow-xl shadow-primary/5 border border-border/50 flex flex-col md:flex-row gap-4 md:gap-6 mb-12">
          <div className="relative w-full md:w-96 shrink-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
            <Input
              placeholder={t("Cari nama fasilitas...", "Search facility name...")}
              className="pl-12 h-14 rounded-2xl bg-[#F8FAFC] dark:bg-slate-950 border-transparent focus-visible:ring-primary focus-visible:bg-white focus-visible:border-primary/20 text-base font-medium shadow-inner transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex-1 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:pb-0 hide-scrollbar flex items-center">
            <div className="flex gap-2 min-w-max">
              {categories.map((cat) => (
                <button 
                  key={cat} 
                  onClick={() => setSelectedCategory(cat)} 
                  className={`px-5 py-3 rounded-2xl font-bold text-sm transition-all duration-300 capitalize whitespace-nowrap ${
                    selectedCategory === cat 
                      ? "bg-primary text-white shadow-md shadow-primary/20" 
                      : "bg-[#F8FAFC] dark:bg-slate-950 text-foreground/70 hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {cat === "all" ? t("Semua Kategori", "All Categories") : cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-border/50">
                <Skeleton className="h-[240px] w-full rounded-2xl mb-6" />
                <div className="space-y-3 px-2">
                  <Skeleton className="h-6 w-1/4 rounded-full" />
                  <Skeleton className="h-8 w-3/4 rounded-lg" />
                  <Skeleton className="h-4 w-1/2 rounded-md" />
                  <div className="h-px bg-border/50 my-4" />
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-10 w-1/3 rounded-lg" />
                    <Skeleton className="h-12 w-32 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredFacilities.map((facility) => (
              <Card key={facility.id} className="group border-none shadow-md hover:shadow-xl transition-all duration-500 rounded-3xl overflow-hidden bg-white dark:bg-slate-900 h-full flex flex-col">
                <div className="relative aspect-[4/3] overflow-hidden bg-muted p-2 pb-0">
                  <div className="w-full h-full rounded-t-2xl rounded-b-lg overflow-hidden relative">
                    <img 
                      src={getFacilityImage(facility.category, facility.images)} 
                      alt={facility.name} 
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-in-out" 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-80" />
                    
                    <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                      <div className="bg-white/90 backdrop-blur-md text-primary px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider shadow-sm">
                        {facility.category}
                      </div>
                      <div className="flex gap-1 text-yellow-400">
                        <Star className="w-4 h-4 fill-yellow-400" />
                        <span className="text-white font-bold text-xs ml-1">4.9</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <CardContent className="p-6 md:p-8 flex-1 flex flex-col">
                  <h3 className="text-2xl font-black text-secondary dark:text-white mb-2 line-clamp-1 group-hover:text-primary transition-colors">{facility.name}</h3>
                  <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground mb-4">
                    <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {t("Maks", "Max")} {facility.capacity || 10} {t("Org", "People")}</span>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-500"><CheckCircle2 className="w-4 h-4" /> {t("Tersedia", "Available")}</span>
                  </div>
                  
                  {facility.description && (
                    <p className="text-muted-foreground text-sm font-medium mb-6 line-clamp-2 leading-relaxed">
                      {facility.description}
                    </p>
                  )}
                  
                  <div className="mt-auto pt-6 border-t border-border/70 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-0.5">{t("Sewa Per Jam", "Rental Per Hour")}</div>
                      <div className="font-black text-xl text-primary">Rp {facility.pricePerHour.toLocaleString('id-ID')}</div>
                    </div>
                    <Button asChild className="rounded-full font-bold shadow-md shadow-primary/20 h-12 px-6">
                      <Link href={`/facilities/${facility.id}`}>{t("Cek Jadwal", "Check Schedule")}</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Special Gym Membership Card */}
            {showMembershipCard && !search && (
              <Card className="group relative border-2 border-primary/20 shadow-lg hover:shadow-primary/30 transition-all duration-500 rounded-3xl overflow-hidden h-full flex flex-col transform hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 pointer-events-none" />
                
                <div className="p-8 pb-4 relative z-10 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-6">
                    <div className="w-16 h-16 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/30">
                      <Dumbbell size={32} />
                    </div>
                    <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-none font-black tracking-wider px-3 py-1">
                      {t("PENAWARAN SPESIAL", "SPECIAL OFFER")}
                    </Badge>
                  </div>
                  
                  <h3 className="text-2xl font-black text-secondary dark:text-white mb-3 group-hover:text-primary transition-colors">{t("Membership Gym Eksklusif", "Exclusive Gym Membership")}</h3>
                  <p className="text-muted-foreground font-medium mb-6 leading-relaxed flex-1">
                    {t("Akses tak terbatas ke seluruh alat fitness premium kami. Berlaku untuk 1 bulan penuh tanpa batasan jam kunjungan.", "Unlimited access to all our premium fitness equipment. Valid for a full month with no visit-hour restrictions.")}
                  </p>
                  
                  <div className="space-y-3 mb-8">
                    {[t('Akses gym sepuasnya', 'Unlimited gym access'), t('Gratis loker & shower', 'Free locker & shower'), t('Konsultasi trainer (1x)', 'Trainer consultation (1x)')].map((b, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-sm font-semibold text-secondary dark:text-gray-300">
                        <CheckCircle2 className="w-5 h-5 text-primary shrink-0" /> {b}
                      </div>
                    ))}
                  </div>
                  
                  <div className="mt-auto pt-6 border-t border-primary/20 space-y-3">
                    <div>
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-0.5">{t("Biaya Langganan", "Subscription Fee")}</div>
                      <div className="font-black text-xl text-primary">Rp 300.000<span className="text-sm font-bold text-muted-foreground ml-1">{t("/bln", "/mo")}</span></div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 rounded-full font-bold h-12 shadow-md"
                        onClick={() => openMembership("register")}
                      >
                        <UserPlus size={16} className="mr-2" />
                        {t("Daftar", "Register")}
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 rounded-full font-bold h-12 border-primary/40 text-primary hover:bg-primary/5"
                        onClick={() => openMembership("renew")}
                      >
                        <RefreshCw size={16} className="mr-2" />
                        {t("Perpanjang", "Renew")}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {filteredFacilities.length === 0 && !showMembershipCard && (
              <div className="col-span-full text-center py-28 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-border/80 shadow-sm">
                <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
                  <MapPin className="w-8 h-8 text-muted-foreground opacity-50" />
                </div>
                <h3 className="text-2xl font-black text-secondary dark:text-white mb-2">{t("Fasilitas Tidak Ditemukan", "No Facilities Found")}</h3>
                <p className="text-muted-foreground font-medium mb-8 max-w-sm mx-auto">{t("Maaf, kami tidak menemukan fasilitas yang cocok dengan pencarian Anda.", "Sorry, we couldn't find any facilities matching your search.")}</p>
                <Button onClick={() => { setSearch(""); setSelectedCategory("all"); }} variant="outline" className="rounded-full font-bold h-12 px-8">
                  {t("Hapus Filter Pencarian", "Clear Search Filters")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <MembershipDialog open={membershipOpen} onClose={() => setMembershipOpen(false)} initialMode={membershipMode} />
    </div>
  );
}