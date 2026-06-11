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
import { Save, Upload, Trash2, QrCode, ImageIcon, Plane, MessageCircle, Eye, EyeOff, CheckCircle2, AlertCircle, Receipt } from "lucide-react";
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
          PPN 11% wajib dikenakan pada booking Sport Center. Data lama tidak diubah otomatis — hanya booking
          pada/setelah tanggal berlaku yang dikenai PPN.
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

export default function AdminSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useGetSettings();
  const qrisInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    centerName: "", address: "", phone: "", whatsapp: "", email: "",
    openHour: "", closeHour: "", logoUrl: "", bankName: "", bankAccount: "", bankAccountName: "",
  });
  const [waForm, setWaForm] = useState({
    fonnteToken: "", fonnteAdminWa: "", adminWaPhones: "", appUrl: "",
  });
  const [showToken, setShowToken] = useState(false);
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
      });
      setWaForm({
        fonnteToken: (settings as any).fonnteToken ?? "",
        fonnteAdminWa: (settings as any).fonnteAdminWa ?? "",
        adminWaPhones: (settings as any).adminWaPhones ?? "",
        appUrl: (settings as any).appUrl ?? "",
      });
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
                <Label>Fonnte API Token</Label>
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
                  Dapatkan token di{" "}
                  <a href="https://fonnte.com" target="_blank" rel="noreferrer" className="text-primary underline">
                    fonnte.com
                  </a>
                  . Token digunakan untuk mengirim pesan WA ke customer dan admin.
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
                <Label>Nomor Admin Tambahan</Label>
                <Input
                  value={waForm.adminWaPhones}
                  onChange={(e) => setWaForm(f => ({ ...f, adminWaPhones: e.target.value }))}
                  placeholder="6281234,6289876 (pisahkan dengan koma)"
                />
                <p className="text-xs text-muted-foreground">
                  Semua nomor ini akan menerima notifikasi admin (booking baru, bukti bayar, dll).
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
