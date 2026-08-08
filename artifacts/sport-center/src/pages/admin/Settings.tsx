import { useState, useEffect, useRef } from "react";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey, useListDiscountSettings, useUpdateDiscountSetting, getListDiscountSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Save, Upload, Trash2, QrCode, ImageIcon, Plane, MessageCircle, Eye, EyeOff, CheckCircle2, AlertCircle, Receipt, FlaskConical, RefreshCw, Link2, Send, CalendarDays } from "lucide-react";
import { getToken } from "@/lib/auth";

function ApDiscountCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: discountSettings, isLoading } = useListDiscountSettings();
  const [percentage, setPercentage] = useState("");
  const [isActive, setIsActive] = useState(true);

  const ap = (discountSettings || []).find((d) => d.customerType === "angkasa_pura");

  useEffect(() => {
    if (ap) {
      setPercentage(String(ap.discountPercentage));
      setIsActive(ap.isActive);
    }
  }, [ap]);

  const updateMutation = useUpdateDiscountSetting({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDiscountSettingsQueryKey() });
        toast({ title: "Diskon Angkasa Pura disimpan" });
      },
      onError: () => toast({ title: "Gagal menyimpan diskon", variant: "destructive" }),
    },
  });

  const handleSave = () => {
    const pct = Number(percentage);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast({ title: "Persentase harus 0–100", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ customerType: "angkasa_pura", data: { discountPercentage: pct, isActive } });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Plane size={18} />
          Diskon Karyawan Angkasa Pura
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Persentase diskon yang diterapkan setelah ID Card karyawan Angkasa Pura terverifikasi oleh admin.
        </p>
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
            <div className="space-y-2 flex-1">
              <Label>Persentase Diskon (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
                placeholder="20"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:w-48">
              <Label htmlFor="ap-discount-active" className="cursor-pointer">Aktif</Label>
              <Switch id="ap-discount-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
            <Button type="button" onClick={handleSave} disabled={updateMutation.isPending}>
              <Save size={16} className="mr-2" />
              {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface PpnConfig {
  enabled: boolean;
  taxRate: number;
  taxCode: string;
  taxName: string;
  effectiveDate: string | null;
}

const PPN_CONFIG_KEY = ["admin", "tax-config", "ppn"];

async function fetchPpnConfig(token: string | null): Promise<PpnConfig> {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${BASE}/api/admin/tax-config/ppn`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Gagal memuat konfigurasi PPN");
  return res.json();
}

async function patchPpnConfig(
  token: string | null,
  patch: Partial<{ enabled: boolean; taxRate: number; effectiveDate: string | null }>
): Promise<PpnConfig> {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${BASE}/api/admin/tax-config/ppn`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Gagal menyimpan konfigurasi PPN");
  }
  return res.json();
}

function PpnSettingsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const token = getToken();

  const { data: cfg, isLoading } = useQuery<PpnConfig>({
    queryKey: PPN_CONFIG_KEY,
    queryFn: () => fetchPpnConfig(token),
  });

  const [enabled, setEnabled] = useState(true);
  const [taxRate, setTaxRate] = useState("11");
  const [effectiveDate, setEffectiveDate] = useState("");

  useEffect(() => {
    if (cfg) {
      setEnabled(cfg.enabled);
      setTaxRate(String(cfg.taxRate));
      setEffectiveDate(cfg.effectiveDate ?? "");
    }
  }, [cfg]);

  const mutation = useMutation<PpnConfig, Error, Partial<{ enabled: boolean; taxRate: number; effectiveDate: string | null }>>({
    mutationFn: (patch) => patchPpnConfig(token, patch),
    onSuccess: (data) => {
      queryClient.setQueryData(PPN_CONFIG_KEY, data);
      toast({ title: "Konfigurasi PPN disimpan" });
    },
    onError: (e) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleSave = () => {
    const rate = Number(taxRate);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      toast({ title: "Tarif PPN harus 0–100", variant: "destructive" });
      return;
    }
    const dateVal = effectiveDate.trim() || null;
    if (dateVal && !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      toast({ title: "Format tanggal harus YYYY-MM-DD", variant: "destructive" });
      return;
    }
    mutation.mutate({ enabled, taxRate: rate, effectiveDate: dateVal });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Receipt size={18} className="text-orange-500" />
          Pengaturan PPN (Pajak Pertambahan Nilai)
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Harga lapangan bersifat <strong>inklusif PPN</strong> — artinya PPN sudah termasuk dalam harga yang tertera.
          Grand Total = harga yang diinput. DPP diekstrak otomatis dari harga.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">PPN Aktif</p>
                <p className="text-xs text-muted-foreground">
                  Jika dinonaktifkan, tidak ada PPN pada booking baru.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tarif PPN (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  placeholder="11"
                />
                <p className="text-xs text-muted-foreground">
                  Saat ini: <span className="font-semibold">{cfg?.taxRate ?? 11}%</span>
                </p>
              </div>

              <div className="space-y-2">
                <Label>Tanggal Berlaku (Effective Date)</Label>
                <Input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {effectiveDate
                    ? <>Booking sebelum <span className="font-semibold">{effectiveDate}</span> tidak kena PPN.</>
                    : "Kosongkan = PPN berlaku untuk semua booking baru."}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-xs text-orange-800 space-y-1">
              <p className="font-semibold">⚠️ Backward Compatibility</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Data booking lama <strong>tidak diubah</strong> — nilai historis tetap terjaga.</li>
                <li>Booking baru pada/setelah tanggal berlaku wajib PPN {cfg?.taxRate ?? 11}%.</li>
                <li>Booking berulang (recurring) dihitung per-tanggal secara individual.</li>
                <li>Refund membalik jurnal PPN secara otomatis.</li>
              </ul>
            </div>

            <div className="flex justify-between items-center">
              <div className="text-xs text-muted-foreground">
                Kode pajak: <span className="font-mono font-semibold">{cfg?.taxCode ?? "PPN_OUT_11"}</span>
                {cfg?.effectiveDate && (
                  <span className="ml-3 inline-flex items-center gap-1 text-orange-700">
                    Berlaku mulai: <strong>{cfg.effectiveDate}</strong>
                  </span>
                )}
              </div>
              <Button onClick={handleSave} disabled={mutation.isPending}>
                <Save size={16} className="mr-2" />
                {mutation.isPending ? "Menyimpan..." : "Simpan PPN"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function SeedDemoCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ bookings: number; payments: number; reviews: number; promoRegistrations: number } | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const token = getToken();
      const res = await fetch("/api/admin/seed-demo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Gagal" }));
        throw new Error(err.error ?? "Terjadi kesalahan");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data.summary);
      queryClient.invalidateQueries();
      toast({ title: "✅ Data demo berhasil di-seed!", description: `${data.summary.bookings} booking, ${data.summary.payments} pembayaran, ${data.summary.reviews} ulasan` });
    },
    onError: (err: Error) => {
      toast({ title: "Gagal seed data demo", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card className="border-dashed border-2 border-amber-300 bg-amber-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-700">
          <FlaskConical size={18} />
          Data Demo (Development Only)
        </CardTitle>
        <p className="text-xs text-amber-600 mt-1">
          Hapus semua transaksi lama dan isi ulang dengan data demo realistis — booking, pembayaran, ulasan, dll.
          <strong className="block mt-0.5">⚠ Tidak tersedia di production. Data lama akan dihapus permanen.</strong>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {result && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Booking", value: result.bookings },
              { label: "Pembayaran", value: result.payments },
              { label: "Ulasan", value: result.reviews },
              { label: "Registrasi Promo", value: result.promoRegistrations },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-lg border border-amber-200 p-3 text-center">
                <p className="text-2xl font-black text-amber-700">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
        >
          {mutation.isPending ? (
            <><RefreshCw size={16} className="animate-spin" /> Memproses...</>
          ) : (
            <><FlaskConical size={16} /> Reset & Seed Data Demo</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function RekapPemakaianCard() {
  const { toast } = useToast();
  const token = getToken();
  const [sending, setSending] = useState(false);
  const [date, setDate] = useState(() => {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return wib.toISOString().split("T")[0];
  });

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/admin/rekap-pemakaian/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mengirim rekap");
      toast({ title: "✅ Rekap terkirim!", description: data.message });
    } catch (err: any) {
      toast({ title: "Gagal kirim rekap", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Send size={18} className="text-green-600" />
          Rekap Pemakaian Harian — Grup WA Admin
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Laporan pemakaian fasilitas per kategori dikirim otomatis ke grup WA admin setiap hari jam <strong>08:00 WIB</strong>. Bisa juga dikirim manual di bawah.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">📋 Format pesan rekap:</p>
          <pre className="whitespace-pre text-xs font-mono leading-relaxed">
{`PEMAKAIAN SPORT CENTER
Senin 7 Juli 2026

Ket: ✅ Lunas  ⏳ Verifikasi  ❌ Belum Bayar

*GYM*
1. Oce (m) ✅
2. Cahyo (m) ⏳
3. Budi (m) ❌

*BASKET/VOLI/FUTSAL*
1. Tim A 08:00-10:00 (m) ✅

*TENIS*
1.

*BADMINTON*
1. Rudi 09:00-10:00 (m) ❌

*BILIARD*
1.

SELAMAT BEROLAHRAGA 🏆`}
          </pre>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <CalendarDays size={12} /> Tanggal rekap
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="bg-green-600 hover:bg-green-700 gap-2"
          >
            {sending ? (
              <><RefreshCw size={14} className="animate-spin" /> Mengirim...</>
            ) : (
              <><Send size={14} /> Kirim Rekap Sekarang</>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Pastikan <strong>FONNTE_TOKEN</strong> dan <strong>ADMIN_WA_GROUP</strong> sudah dikonfigurasi di Secrets agar rekap terkirim ke grup WA.
        </p>
      </CardContent>
    </Card>
  );
}

export default function AdminSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useGetSettings();
  const qrisInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    centerName: "", address: "", phone: "", whatsapp: "", email: "",
    openHour: "", closeHour: "", logoUrl: "", bankName: "", bankAccount: "", bankAccountName: "",
    paymentDeadlineHours: "24",
  });
  const [waForm, setWaForm] = useState({
    fonnteToken: "", fonnteCustomerToken: "", fonnteAdminWa: "", adminWaPhones: "", appUrl: "",
  });
  const [paymentDomain, setPaymentDomain] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showCustomerToken, setShowCustomerToken] = useState(false);
  const [qrisPreview, setQrisPreview] = useState<string | null>(null);
  const [qrisUploading, setQrisUploading] = useState(false);
  const [qrisDeleting, setQrisDeleting] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        centerName: settings.centerName ?? "",
        address: settings.address ?? "",
        phone: settings.phone ?? "",
        whatsapp: settings.whatsapp ?? "",
        email: settings.email ?? "",
        openHour: settings.openHour ?? "",
        closeHour: settings.closeHour ?? "",
        logoUrl: settings.logoUrl ?? "",
        bankName: settings.bankName ?? "",
        bankAccount: settings.bankAccount ?? "",
        bankAccountName: settings.bankAccountName ?? "",
        paymentDeadlineHours: (settings as any).paymentDeadlineHours ?? "24",
      });
      setWaForm({
        fonnteToken: (settings as any).fonnteToken ?? "",
        fonnteCustomerToken: (settings as any).fonnteCustomerToken ?? "",
        fonnteAdminWa: (settings as any).fonnteAdminWa ?? "",
        adminWaPhones: (settings as any).adminWaPhones ?? "",
        appUrl: (settings as any).appUrl ?? "",
      });
      setPaymentDomain((settings as any).paymentDomain ?? "");
      setQrisPreview((settings as any).qrisImageUrl ?? null);
    }
  }, [settings]);

  const updateMutation = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Pengaturan disimpan" });
      },
      onError: () => toast({ title: "Gagal menyimpan", variant: "destructive" }),
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form };
    Object.keys(payload).forEach(k => { if (!payload[k]) delete payload[k]; });
    updateMutation.mutate({ data: payload });
  };

  const handleWaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...waForm };
    Object.keys(payload).forEach(k => { if (!payload[k]) delete payload[k]; });
    updateMutation.mutate({ data: payload });
  };

  const handlePaymentDomainSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({ data: { paymentDomain: paymentDomain.trim() || null } as any });
  };

  const handleQrisUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setQrisUploading(true);
    try {
      const fd = new FormData();
      fd.append("qris", file);
      const token = getToken();
      if (!token) throw new Error("Tidak terautentikasi");
      const res = await fetch(`${BASE}/api/settings/qris`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload gagal: ${res.status}`);
      const data = await res.json();
      setQrisPreview(data.qrisImageUrl);
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Foto QRIS berhasil diupload" });
    } catch {
      toast({ title: "Gagal upload foto QRIS", variant: "destructive" });
    } finally {
      setQrisUploading(false);
      if (qrisInputRef.current) qrisInputRef.current.value = "";
    }
  };

  const handleQrisDelete = async () => {
    setQrisDeleting(true);
    try {
      const token = getToken();
      if (!token) throw new Error("Tidak terautentikasi");
      const res = await fetch(`${BASE}/api/settings/qris`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      setQrisPreview(null);
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Foto QRIS dihapus" });
    } catch {
      toast({ title: "Gagal menghapus QRIS", variant: "destructive" });
    } finally {
      setQrisDeleting(false);
    }
  };

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Pengaturan</h1>
        <p className="text-muted-foreground">Konfigurasi informasi sport center</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Informasi Sport Center</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nama Sport Center</Label>
                <Input value={form.centerName} onChange={(e) => setForm(f => ({ ...f, centerName: e.target.value }))} placeholder="Sport Center" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="info@sportcenter.com" />
              </div>
              <div className="space-y-2">
                <Label>Nomor Telepon</Label>
                <Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+62 21 1234567" />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp (dengan kode negara, tanpa +)</Label>
                <Input value={form.whatsapp} onChange={(e) => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="6281234567890" />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>Alamat</Label>
                <Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Alamat lengkap..." />
              </div>
              <div className="space-y-2">
                <Label>Jam Buka</Label>
                <Input type="time" value={form.openHour} onChange={(e) => setForm(f => ({ ...f, openHour: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Jam Tutup</Label>
                <Input type="time" value={form.closeHour} onChange={(e) => setForm(f => ({ ...f, closeHour: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Batas Waktu Pembayaran Personal (jam)</Label>
                <Input
                  type="number"
                  min="1"
                  max="72"
                  value={form.paymentDeadlineHours}
                  onChange={(e) => setForm(f => ({ ...f, paymentDeadlineHours: e.target.value }))}
                  placeholder="24"
                />
                <p className="text-xs text-muted-foreground">Waktu yang diberikan customer personal untuk upload bukti bayar (default: 24 jam)</p>
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>URL Logo</Label>
                <Input value={form.logoUrl} onChange={(e) => setForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://..." />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Informasi Rekening Bank (Transfer Manual)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Nama Bank</Label>
                <Input value={form.bankName} onChange={(e) => setForm(f => ({ ...f, bankName: e.target.value }))} placeholder="BCA, BNI, Mandiri..." />
              </div>
              <div className="space-y-2">
                <Label>Nomor Rekening</Label>
                <Input value={form.bankAccount} onChange={(e) => setForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="1234567890" />
              </div>
              <div className="space-y-2">
                <Label>Atas Nama</Label>
                <Input value={form.bankAccountName} onChange={(e) => setForm(f => ({ ...f, bankAccountName: e.target.value }))} placeholder="PT Sport Center" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateMutation.isPending} className="px-8">
            <Save size={16} className="mr-2" />
            {updateMutation.isPending ? "Menyimpan..." : "Simpan Pengaturan"}
          </Button>
        </div>
      </form>

      <ApDiscountCard />

      <PpnSettingsCard />

      <SeedDemoCard />

      {/* ─── WhatsApp Notification Settings ─────────────────────── */}
      <form onSubmit={handleWaSubmit}>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <MessageCircle size={18} className="text-green-600" />
                  Pengaturan Notifikasi WhatsApp (Fonnte)
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Konfigurasi token Fonnte dan nomor admin penerima notifikasi otomatis.
                  Jika kosong, sistem pakai nilai dari environment variable.
                </p>
              </div>
              {(settings as any)?.fonnteToken ? (
                <Badge className="bg-green-100 text-green-700 border-green-200 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Token Terkonfigurasi
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-700 border-yellow-300 bg-yellow-50 flex items-center gap-1">
                  <AlertCircle size={12} /> Pakai Env Variable
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-2">
                <Label>Token Fonnte — Nomor Admin (085121073537)</Label>
                <div className="relative">
                  <Input
                    type={showToken ? "text" : "password"}
                    value={waForm.fonnteToken}
                    onChange={(e) => setWaForm(f => ({ ...f, fonnteToken: e.target.value }))}
                    placeholder="Token dari dashboard.fonnte.com"
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Token nomor WhatsApp admin (<strong>085121073537</strong>). Digunakan untuk mengirim notifikasi ke admin.
                  Dapatkan token di{" "}
                  <a href="https://fonnte.com" target="_blank" rel="noreferrer" className="text-primary underline">
                    fonnte.com
                  </a>.
                </p>
              </div>

              <div className="md:col-span-2 space-y-2">
                <Label>Token Fonnte — Nomor Customer (081216104734)</Label>
                <div className="relative">
                  <Input
                    type={showCustomerToken ? "text" : "password"}
                    value={waForm.fonnteCustomerToken}
                    onChange={(e) => setWaForm(f => ({ ...f, fonnteCustomerToken: e.target.value }))}
                    placeholder="Token dari dashboard.fonnte.com untuk nomor customer"
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCustomerToken(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCustomerToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Token nomor WhatsApp customer (<strong>081216104734</strong>). Digunakan untuk mengirim notifikasi ke customer (booking, konfirmasi, reminder, dll).
                  Jika kosong, sistem pakai token admin di atas.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Nomor WA Admin Utama</Label>
                <Input
                  value={waForm.fonnteAdminWa}
                  onChange={(e) => setWaForm(f => ({ ...f, fonnteAdminWa: e.target.value }))}
                  placeholder="628123456789 (tanpa + atau spasi)"
                />
                <p className="text-xs text-muted-foreground">
                  Nomor admin utama penerima notifikasi (jika kolom bawah kosong).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Nomor Admin &amp; Grup WA</Label>
                <Input
                  value={waForm.adminWaPhones}
                  onChange={(e) => setWaForm(f => ({ ...f, adminWaPhones: e.target.value }))}
                  placeholder="6281234,6289876,1203456789-1234567890@g.us"
                />
                <p className="text-xs text-muted-foreground">
                  Pisahkan dengan koma. Bisa nomor individu (<strong>628xxx</strong>) atau ID grup WA (<strong>1234567890-123456@g.us</strong>).
                  Semua penerima ini akan mendapat notifikasi booking baru, bukti bayar, dll.
                </p>
              </div>

              <div className="md:col-span-2 space-y-2">
                <Label>URL Aplikasi (untuk link di notifikasi)</Label>
                <Input
                  value={waForm.appUrl}
                  onChange={(e) => setWaForm(f => ({ ...f, appUrl: e.target.value }))}
                  placeholder="https://sportcenter.travelintrips.co.id"
                />
                <p className="text-xs text-muted-foreground">
                  URL ini digunakan sebagai base link di pesan WA (status booking, upload bukti, dll).
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">📋 Notifikasi yang dikirim otomatis:</p>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Booking baru dibuat → customer + admin</li>
                <li>Bukti pembayaran diupload → admin</li>
                <li>Pembayaran dikonfirmasi → customer</li>
                <li>Booking dibatalkan / expired → customer + admin</li>
                <li>Reminder H-1 bermain → customer</li>
              </ul>
              <p className="mt-2">
                Edit isi pesan di halaman{" "}
                <a href="/admin/notifications" className="text-primary underline font-medium">
                  Template Notifikasi
                </a>.
              </p>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateMutation.isPending}>
                <Save size={16} className="mr-2" />
                {updateMutation.isPending ? "Menyimpan..." : "Simpan Pengaturan WA"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* ─── Domain Link Pembayaran ─────────────────────────────── */}
      <form onSubmit={handlePaymentDomainSubmit}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Link2 size={18} className="text-blue-600" />
              Domain Link Pembayaran Tenant
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Domain yang digunakan pada link bayar yang dikirim via WhatsApp ke customer.
              Jika diisi, akan menimpa konfigurasi server secara otomatis.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="payment-domain">URL Domain</Label>
              <Input
                id="payment-domain"
                type="url"
                value={paymentDomain}
                onChange={(e) => setPaymentDomain(e.target.value)}
                placeholder="https://sportcenter.domain.co.id"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Format: <code className="bg-muted px-1 rounded">https://domain.anda.com</code> — tanpa garis miring di akhir.
                {paymentDomain ? (
                  <span className="block mt-1 text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                    Link bukti bayar akan menjadi: <strong>{paymentDomain.replace(/\/$/, "")}/bukti/&#123;token&#125;</strong>
                  </span>
                ) : (
                  <span className="block mt-1">
                    Jika kosong, sistem menggunakan URL dari environment variable server.
                  </span>
                )}
              </p>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={updateMutation.isPending}>
                <Save size={16} className="mr-2" />
                {updateMutation.isPending ? "Menyimpan..." : "Simpan Domain"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* ─── Kirim Rekap Pemakaian ke Grup WA Admin ─────────────────────────── */}
      <RekapPemakaianCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <QrCode size={18} />
            Foto QRIS (Pembayaran QRIS)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload foto QR Code QRIS yang akan ditampilkan kepada pelanggan saat melakukan pembayaran.
          </p>

          {qrisPreview ? (
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="border rounded-xl overflow-hidden w-48 h-48 flex items-center justify-center bg-gray-50 flex-shrink-0">
                <img
                  src={qrisPreview}
                  alt="QRIS"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
                  ✓ Foto QRIS sudah diupload dan aktif
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => qrisInputRef.current?.click()}
                    disabled={qrisUploading}
                  >
                    <Upload size={14} className="mr-1.5" />
                    Ganti Foto
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={handleQrisDelete}
                    disabled={qrisDeleting}
                  >
                    <Trash2 size={14} className="mr-1.5" />
                    {qrisDeleting ? "Menghapus..." : "Hapus"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => qrisInputRef.current?.click()}
              disabled={qrisUploading}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-orange-50/40 transition-colors cursor-pointer disabled:opacity-50"
            >
              <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
                <ImageIcon size={28} className="text-orange-500" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-700">
                  {qrisUploading ? "Mengupload..." : "Upload Foto QRIS"}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Klik untuk pilih gambar (JPG, PNG, maks 5MB)
                </p>
              </div>
            </button>
          )}

          <input
            ref={qrisInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleQrisUpload}
          />
        </CardContent>
      </Card>
    </div>
  );
}
