import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Save, Upload, Eye, FileText, Building2, CreditCard,
  User, Image as ImageIcon, Hash, Percent, AlignLeft, RefreshCw,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });
const jsonHeaders = () => ({ ...authHeaders(), "Content-Type": "application/json" });

interface InvoiceSettings {
  id: number;
  companyName: string;
  logoUrl: string | null;
  kopSuratHtml: string | null;
  address: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
  financeName: string;
  financeTitle: string;
  signatureUrl: string | null;
  invoicePrefix: string;
  taxRate: string;
  footerText: string | null;
}

const DEFAULTS: Omit<InvoiceSettings, "id"> = {
  companyName: "",
  logoUrl: null,
  kopSuratHtml: null,
  address: "",
  phone: "",
  email: "",
  bankName: "",
  bankAccount: "",
  bankAccountName: "",
  financeName: "",
  financeTitle: "Finance Manager",
  signatureUrl: null,
  invoicePrefix: "INV",
  taxRate: "11",
  footerText: null,
};

async function fetchSettings(): Promise<InvoiceSettings> {
  const r = await fetch(`${API}/admin/invoice-settings`, { headers: authHeaders() });
  if (!r.ok) throw new Error("Gagal memuat invoice settings");
  return r.json();
}

export default function AdminInvoiceSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<InvoiceSettings>({
    queryKey: ["invoice-settings"],
    queryFn: fetchSettings,
  });

  const [form, setForm] = useState<Omit<InvoiceSettings, "id">>(DEFAULTS);
  const [logoUploading, setLogoUploading] = useState(false);
  const [sigUploading, setSigUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "bank" | "finance" | "template" | "preview">("general");

  useEffect(() => {
    if (data) {
      setForm({
        companyName: data.companyName ?? "",
        logoUrl: data.logoUrl ?? null,
        kopSuratHtml: data.kopSuratHtml ?? null,
        address: data.address ?? "",
        phone: data.phone ?? "",
        email: data.email ?? "",
        bankName: data.bankName ?? "",
        bankAccount: data.bankAccount ?? "",
        bankAccountName: data.bankAccountName ?? "",
        financeName: data.financeName ?? "",
        financeTitle: data.financeTitle ?? "Finance Manager",
        signatureUrl: data.signatureUrl ?? null,
        invoicePrefix: data.invoicePrefix ?? "INV",
        taxRate: data.taxRate ?? "11",
        footerText: data.footerText ?? null,
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (body: Omit<InvoiceSettings, "id">) => {
      const r = await fetch(`${API}/admin/invoice-settings`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Gagal menyimpan"); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Invoice settings disimpan" });
      qc.invalidateQueries({ queryKey: ["invoice-settings"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function uploadFile(endpoint: string, file: File, field: "logoUrl" | "signatureUrl", setUploading: (v: boolean) => void) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API}${endpoint}`, { method: "POST", headers: authHeaders(), body: fd });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Upload gagal"); }
      const { url } = await r.json();
      setForm(prev => ({ ...prev, [field]: url }));
      qc.invalidateQueries({ queryKey: ["invoice-settings"] });
      toast({ title: "Upload berhasil" });
    } catch (e: any) {
      toast({ title: "Upload gagal", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const f = (field: keyof Omit<InvoiceSettings, "id">, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const tabs = [
    { id: "general", label: "Umum", icon: Building2 },
    { id: "bank", label: "Bank", icon: CreditCard },
    { id: "finance", label: "Finance & TTD", icon: User },
    { id: "template", label: "Template HTML", icon: FileText },
    { id: "preview", label: "Preview Invoice", icon: Eye },
  ] as const;

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Memuat pengaturan invoice...</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-foreground">Pengaturan Invoice & Dokumen</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Kustomisasi tampilan invoice — logo, kop surat, bank, tanda tangan, dan prefix nomor.
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="bg-primary hover:bg-primary/90 font-bold gap-2"
        >
          <Save size={15} />
          {saveMutation.isPending ? "Menyimpan..." : "Simpan Semua"}
        </Button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Umum ── */}
      {activeTab === "general" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Building2 size={16} /> Informasi Perusahaan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Logo */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Logo Perusahaan</Label>
              <div className="flex items-center gap-4">
                {form.logoUrl ? (
                  <div className="relative">
                    <img src={form.logoUrl} alt="Logo" className="h-16 w-auto object-contain border rounded-lg p-1 bg-white" />
                    <button
                      onClick={() => f("logoUrl", null)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                    >×</button>
                  </div>
                ) : (
                  <div className="h-16 w-32 border-2 border-dashed rounded-lg flex items-center justify-center bg-muted/30">
                    <ImageIcon size={20} className="text-muted-foreground" />
                  </div>
                )}
                <div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) uploadFile("/admin/invoice-settings/upload-logo", file, "logoUrl", setLogoUploading);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={logoUploading}
                    onClick={() => logoInputRef.current?.click()}
                    className="gap-2"
                  >
                    <Upload size={13} />
                    {logoUploading ? "Mengupload..." : "Upload Logo"}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">PNG/JPG, max 5MB</p>
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs font-semibold">Nama Perusahaan *</Label>
                <Input
                  value={form.companyName}
                  onChange={e => f("companyName", e.target.value)}
                  placeholder="Sport Center Soekarno-Hatta"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs font-semibold">Alamat Lengkap</Label>
                <Textarea
                  value={form.address}
                  onChange={e => f("address", e.target.value)}
                  placeholder="Jl. C3 No. 831, Pajang, Benda – Kota Tangerang 15126"
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Telepon</Label>
                <Input value={form.phone} onChange={e => f("phone", e.target.value)} placeholder="021-1234567" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Email</Label>
                <Input value={form.email} onChange={e => f("email", e.target.value)} placeholder="info@sportcenter.id" type="email" />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Hash size={12} /> Prefix Nomor Invoice
                </Label>
                <Input
                  value={form.invoicePrefix}
                  onChange={e => f("invoicePrefix", e.target.value.toUpperCase())}
                  placeholder="INV"
                  maxLength={10}
                />
                <p className="text-[11px] text-muted-foreground">Contoh: INV → INV/SC/20260619/000001</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Percent size={12} /> Tarif PPN (%)
                </Label>
                <Input
                  value={form.taxRate}
                  onChange={e => f("taxRate", e.target.value)}
                  placeholder="11"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                />
                <p className="text-[11px] text-muted-foreground">Default: 11% (PPN Indonesia)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tab: Bank ── */}
      {activeTab === "bank" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <CreditCard size={16} /> Informasi Pembayaran Bank
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
              Data bank ini tampil di bagian <strong>Informasi Pembayaran</strong> pada setiap invoice.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Nama Bank</Label>
                <Input value={form.bankName} onChange={e => f("bankName", e.target.value)} placeholder="Bank Mandiri" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Nomor Rekening</Label>
                <Input value={form.bankAccount} onChange={e => f("bankAccount", e.target.value)} placeholder="1640006707220" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs font-semibold">Atas Nama</Label>
                <Input value={form.bankAccountName} onChange={e => f("bankAccountName", e.target.value)} placeholder="PT Cahaya Sejati Teknologi" />
              </div>
            </div>

            {/* Preview box */}
            {(form.bankName || form.bankAccount || form.bankAccountName) && (
              <div className="rounded-lg border p-4 bg-white mt-2">
                <p className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wide">Preview di Invoice</p>
                <div className="text-sm space-y-0.5">
                  <p className="font-bold text-blue-700">{form.bankAccountName || "—"}</p>
                  <p>{form.bankName || "—"}</p>
                  <p className="font-mono font-bold">No. Rek: {form.bankAccount || "—"}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Tab: Finance & TTD ── */}
      {activeTab === "finance" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <User size={16} /> Finance & Tanda Tangan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Nama Finance</Label>
                <Input value={form.financeName} onChange={e => f("financeName", e.target.value)} placeholder="Ahmad Fauzi" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Jabatan</Label>
                <Input value={form.financeTitle} onChange={e => f("financeTitle", e.target.value)} placeholder="Finance Manager" />
              </div>
            </div>

            <Separator />

            {/* Signature upload */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Gambar Tanda Tangan</Label>
              <div className="flex items-center gap-4">
                {form.signatureUrl ? (
                  <div className="relative">
                    <img src={form.signatureUrl} alt="TTD" className="h-20 w-auto object-contain border rounded-lg p-2 bg-white" />
                    <button
                      onClick={() => f("signatureUrl", null)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                    >×</button>
                  </div>
                ) : (
                  <div className="h-20 w-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center bg-muted/30 gap-1">
                    <ImageIcon size={20} className="text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Belum ada TTD</span>
                  </div>
                )}
                <div>
                  <input
                    ref={sigInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) uploadFile("/admin/invoice-settings/upload-signature", file, "signatureUrl", setSigUploading);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sigUploading}
                    onClick={() => sigInputRef.current?.click()}
                    className="gap-2"
                  >
                    <Upload size={13} />
                    {sigUploading ? "Mengupload..." : "Upload TTD"}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">PNG transparan direkomendasikan</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Footer text */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <AlignLeft size={12} /> Teks Footer Invoice
              </Label>
              <Textarea
                value={form.footerText ?? ""}
                onChange={e => f("footerText", e.target.value || null)}
                placeholder="Dokumen ini dibuat secara otomatis oleh sistem Sport Center. Sah tanpa tanda tangan basah."
                rows={2}
              />
              <p className="text-[11px] text-muted-foreground">Kosong = pakai teks default sistem</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tab: Template HTML ── */}
      {activeTab === "template" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <FileText size={16} /> Kop Surat HTML (Opsional)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <strong>Opsional.</strong> Jika diisi, kop surat ini akan <em>menggantikan</em> tampilan header default.
                Kosongkan untuk menggunakan tampilan otomatis (logo + nama perusahaan).
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">HTML Kop Surat</Label>
                <Textarea
                  value={form.kopSuratHtml ?? ""}
                  onChange={e => f("kopSuratHtml", e.target.value || null)}
                  placeholder={`<div style="display:flex;align-items:center;gap:16px;border-bottom:2px solid #ea580c;padding-bottom:12px;">\n  <img src="{{logoUrl}}" style="height:60px;" />\n  <div>\n    <h2 style="margin:0;color:#ea580c;">{{companyName}}</h2>\n    <p style="margin:0;font-size:12px;">{{address}}</p>\n    <p style="margin:0;font-size:12px;">Telp: {{phone}}</p>\n  </div>\n</div>`}
                  className="font-mono text-xs min-h-[200px]"
                />
              </div>
              <div className="text-[11px] text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
                <p className="font-semibold">Variabel yang tersedia:</p>
                <p><code className="bg-white px-1 rounded">{"{{logoUrl}}"}</code> — URL logo perusahaan</p>
                <p><code className="bg-white px-1 rounded">{"{{companyName}}"}</code> — Nama perusahaan</p>
                <p><code className="bg-white px-1 rounded">{"{{address}}"}</code> — Alamat</p>
                <p><code className="bg-white px-1 rounded">{"{{phone}}"}</code> — Telepon</p>
                <p><code className="bg-white px-1 rounded">{"{{financeName}}"}</code> — Nama finance</p>
                <p><code className="bg-white px-1 rounded">{"{{financeTitle}}"}</code> — Jabatan finance</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Tab: Preview Invoice ── */}
      {activeTab === "preview" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Eye size={16} /> Preview Invoice
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Preview menggunakan booking nyata. Simpan settings terlebih dahulu, lalu buka invoice dari halaman Pemesanan.
            </p>

            {/* Live preview dari settings saat ini */}
            <div className="rounded-xl border bg-white p-6 shadow-sm">
              {/* Header preview */}
              <div className="flex items-start justify-between border-b-2 border-orange-500 pb-4 mb-4">
                <div className="flex items-center gap-3">
                  {form.logoUrl ? (
                    <img src={form.logoUrl} alt="Logo" className="h-14 w-auto object-contain" />
                  ) : (
                    <div className="h-14 w-14 bg-orange-100 rounded flex items-center justify-center">
                      <Building2 size={24} className="text-orange-500" />
                    </div>
                  )}
                  <div>
                    <p className="font-black text-lg text-gray-900">{form.companyName || "Nama Perusahaan"}</p>
                    {form.address && <p className="text-xs text-gray-500">{form.address}</p>}
                    {form.phone && <p className="text-xs text-gray-500">Telp: {form.phone}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-orange-500">INVOICE</p>
                  <Badge variant="outline" className="text-[10px]">
                    {form.invoicePrefix || "INV"}/SC/YYYYMMDD/000001
                  </Badge>
                </div>
              </div>

              {/* Info row */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="border rounded-lg p-3">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Informasi Invoice</p>
                  <div className="text-xs space-y-1">
                    <p><span className="text-muted-foreground">No Invoice</span> : <span className="font-mono text-orange-600">{form.invoicePrefix}/SC/20260619/000001</span></p>
                    <p><span className="text-muted-foreground">Tanggal</span> : 19 Juni 2026</p>
                  </div>
                </div>
                <div className="border rounded-lg p-3">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Informasi Pelanggan</p>
                  <div className="text-xs space-y-1">
                    <p><span className="text-muted-foreground">Nama</span> : Budi Santoso</p>
                    <p><span className="text-muted-foreground">No HP</span> : 0812-xxxx-xxxx</p>
                  </div>
                </div>
              </div>

              {/* Payment & Signature */}
              <div className="flex items-start justify-between border-t pt-4 mt-2">
                <div className="text-xs">
                  <p className="font-bold text-[10px] text-muted-foreground uppercase mb-1">Informasi Pembayaran</p>
                  <p className="font-bold text-blue-700">{form.bankAccountName || "—"}</p>
                  {form.bankName && <p>{form.bankName}</p>}
                  {form.bankAccount && <p className="font-mono font-bold">No. Rek: {form.bankAccount}</p>}
                </div>
                <div className="text-right text-xs">
                  <p className="text-muted-foreground mb-1">Hormat kami,</p>
                  {form.signatureUrl ? (
                    <img src={form.signatureUrl} alt="TTD" className="h-14 ml-auto object-contain" />
                  ) : (
                    <div className="h-14 w-28 border-dashed border rounded ml-auto flex items-center justify-center text-muted-foreground">
                      <ImageIcon size={14} />
                    </div>
                  )}
                  <div className="border-t border-gray-400 pt-1 mt-1">
                    <p className="font-bold">{form.financeName || form.companyName || "Sport Center"}</p>
                    {form.financeTitle && <p className="text-muted-foreground">{form.financeTitle}</p>}
                  </div>
                </div>
              </div>

              {form.footerText && (
                <p className="text-[10px] text-muted-foreground mt-3 border-t pt-2">{form.footerText}</p>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                className="bg-primary hover:bg-primary/90 font-bold gap-2"
              >
                <Save size={14} />
                {saveMutation.isPending ? "Menyimpan..." : "Simpan & Terapkan"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setActiveTab("general")}
                className="gap-2"
              >
                <RefreshCw size={14} />
                Edit Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bottom save bar */}
      {activeTab !== "preview" && (
        <div className="flex justify-end pt-2">
          <Button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
            className="bg-primary hover:bg-primary/90 font-bold gap-2"
          >
            <Save size={15} />
            {saveMutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </div>
      )}
    </div>
  );
}
