import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Save, Upload, Eye, FileText,
  Image as ImageIcon, Hash, Percent, AlignLeft,
  Building2, Receipt, FileCheck, ClipboardList, FileSignature, ScrollText,
  ChevronRight, LayoutTemplate, CheckCircle2, FileIcon, Trash2,
  Layers, FileImage, AlertCircle,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });
const jsonHeaders = () => ({ ...authHeaders(), "Content-Type": "application/json" });

// ─── Types ────────────────────────────────────────────────────────────────────

type DocumentType = "general" | "invoice" | "spp" | "kwitansi" | "lampiran" | "berita_acara" | "surat_pengantar";

interface DocSettings {
  id: number;
  documentType: DocumentType;
  logoUrl: string | null;
  kopSuratHtml: string | null;
  footerHtml: string | null;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  financeName: string;
  financeTitle: string;
  signatureUrl: string | null;
  prefixNumber: string;
  taxRate: string;
  bgTemplateUrl: string | null;
  bgTemplateType: string | null;
  bgTemplateActive: boolean;
}

type DocForm = Omit<DocSettings, "id" | "documentType">;

const DEFAULT_FORM: DocForm = {
  logoUrl: null,
  kopSuratHtml: null,
  footerHtml: null,
  bankName: "",
  bankAccount: "",
  bankHolder: "",
  financeName: "",
  financeTitle: "Finance Manager",
  signatureUrl: null,
  prefixNumber: "INV",
  taxRate: "11",
  bgTemplateUrl: null,
  bgTemplateType: null,
  bgTemplateActive: false,
};

// ─── Document type metadata ───────────────────────────────────────────────────

const DOC_TYPES: {
  type: DocumentType;
  label: string;
  icon: React.ElementType;
  description: string;
  defaultPrefix: string;
  color: string;
}[] = [
  { type: "general",       label: "Umum",              icon: Building2,     description: "Default fallback untuk semua dokumen. Digunakan jika document-specific tidak diatur.", defaultPrefix: "INV", color: "bg-slate-100 text-slate-700 border-slate-300" },
  { type: "invoice",       label: "Invoice",           icon: Receipt,       description: "Invoice pembayaran booking fasilitas. Terisi otomatis saat booking dikonfirmasi.", defaultPrefix: "INV", color: "bg-orange-100 text-orange-700 border-orange-300" },
  { type: "spp",           label: "SPP",               icon: FileCheck,     description: "Surat Permintaan Pembayaran untuk tagihan perusahaan / korporat.", defaultPrefix: "SPP", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { type: "kwitansi",      label: "Kwitansi",          icon: FileText,      description: "Bukti pembayaran lunas (paid). Hanya diterbitkan saat status booking = paid/confirmed.", defaultPrefix: "KWT", color: "bg-green-100 text-green-700 border-green-300" },
  { type: "lampiran",      label: "Lampiran Pemakaian",icon: ClipboardList, description: "Detail pemakaian fasilitas — waktu, durasi, fasilitas yang digunakan.", defaultPrefix: "LMP", color: "bg-purple-100 text-purple-700 border-purple-300" },
  { type: "berita_acara",  label: "Berita Acara",      icon: FileSignature, description: "Berita acara serah terima / pelaksanaan event di fasilitas.", defaultPrefix: "BA",  color: "bg-amber-100 text-amber-700 border-amber-300" },
  { type: "surat_pengantar",label: "Surat Pengantar",  icon: ScrollText,    description: "Surat pengantar resmi dari Sport Center untuk keperluan administrasi.", defaultPrefix: "SP",  color: "bg-cyan-100 text-cyan-700 border-cyan-300" },
];

// ─── Helper: fetch one doc type ───────────────────────────────────────────────

async function fetchDocSettings(type: DocumentType): Promise<DocSettings> {
  const r = await fetch(`${API}/admin/document-settings/${type}`, { headers: authHeaders() });
  if (!r.ok) throw new Error("Gagal memuat settings");
  return r.json();
}

async function fetchAllDocSettings(): Promise<DocSettings[]> {
  const r = await fetch(`${API}/admin/document-settings`, { headers: authHeaders() });
  if (!r.ok) throw new Error("Gagal memuat settings");
  return r.json();
}

// ─── DocTypePanel ─────────────────────────────────────────────────────────────

function DocTypePanel({ docType, meta }: {
  docType: DocumentType;
  meta: typeof DOC_TYPES[number];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const logoRef = useRef<HTMLInputElement>(null);
  const sigRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [sigUploading, setSigUploading] = useState(false);

  const [innerTab, setInnerTab] = useState<"kop" | "bank" | "finance" | "template" | "background">("kop");

  // ── Background file template state ──────────────────────────────────────
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const [bgTogglingId, setBgTogglingId] = useState<number | null>(null);
  const [bgDeletingId, setBgDeletingId] = useState<number | null>(null);

  const supportsFileTemplate = docType !== "general" && docType !== "surat_pengantar";

  const { data: bgTemplates = [] } = useQuery<any[]>({
    queryKey: ["document-file-templates", docType],
    queryFn: async () => {
      const r = await fetch(`${API}/api/admin/document-file-templates?documentType=${docType}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: supportsFileTemplate,
  });

  const { data, isLoading } = useQuery<DocSettings>({
    queryKey: ["doc-settings", docType],
    queryFn: () => fetchDocSettings(docType),
  });

  const [form, setForm] = useState<DocForm>(DEFAULT_FORM);

  useEffect(() => {
    if (data) {
      setForm({
        logoUrl: data.logoUrl,
        kopSuratHtml: data.kopSuratHtml,
        footerHtml: data.footerHtml,
        bankName: data.bankName ?? "",
        bankAccount: data.bankAccount ?? "",
        bankHolder: data.bankHolder ?? "",
        financeName: data.financeName ?? "",
        financeTitle: data.financeTitle ?? "Finance Manager",
        signatureUrl: data.signatureUrl,
        prefixNumber: data.prefixNumber ?? meta.defaultPrefix,
        taxRate: data.taxRate ?? "11",
        bgTemplateUrl: data.bgTemplateUrl ?? null,
        bgTemplateType: data.bgTemplateType ?? null,
        bgTemplateActive: data.bgTemplateActive ?? false,
      });
    }
  }, [data]);

  const f = (field: keyof DocForm, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const saveMutation = useMutation({
    mutationFn: async (body: DocForm) => {
      const r = await fetch(`${API}/admin/document-settings/${docType}`, {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Gagal menyimpan"); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: `${meta.label} settings disimpan` });
      qc.invalidateQueries({ queryKey: ["doc-settings", docType] });
      qc.invalidateQueries({ queryKey: ["doc-settings-all"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function uploadFile(
    endpoint: string,
    file: File,
    field: "logoUrl" | "signatureUrl",
    setUploading: (v: boolean) => void,
  ) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API}${endpoint}`, { method: "POST", headers: authHeaders(), body: fd });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Upload gagal"); }
      const { url } = await r.json();
      setForm(prev => ({ ...prev, [field]: url }));
      qc.invalidateQueries({ queryKey: ["doc-settings", docType] });
      toast({ title: "Upload berhasil" });
    } catch (e: any) {
      toast({ title: "Upload gagal", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }


  // ── Background template handlers ─────────────────────────────────────────
  async function handleBgUpload(file: File) {
    if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type)) {
      toast({ title: "Format tidak didukung", description: "Gunakan PNG, JPG, atau PDF", variant: "destructive" }); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File terlalu besar", description: "Maksimum 10MB", variant: "destructive" }); return;
    }
    await uploadBgTemplate(file);
  }

  async function uploadBgTemplate(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File terlalu besar", description: "Maksimal 10MB", variant: "destructive" });
      return;

    }
    setBgUploading(true);
    try {
      const fd = new FormData();

      fd.append("documentType", docType);
      fd.append("file", file);
      const r = await fetch(`${API}/api/admin/document-file-templates/upload`, {
        method: "POST", headers: authHeaders(), body: fd,
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Upload gagal"); }
      toast({ title: "Template diupload", description: "Klik Aktifkan untuk mulai digunakan" });
      qc.invalidateQueries({ queryKey: ["document-file-templates", docType] });

    } catch (e: any) {
      toast({ title: "Upload gagal", description: e.message, variant: "destructive" });
    } finally {
      setBgUploading(false);

      if (bgFileInputRef.current) bgFileInputRef.current.value = "";
    }
  }

  async function handleBgActivate(id: number) {
    setBgTogglingId(id);
    try {
      const r = await fetch(`${API}/api/admin/document-file-templates/${id}/activate`, { method: "PATCH", headers: jsonHeaders() });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      toast({ title: "Template diaktifkan" });
      qc.invalidateQueries({ queryKey: ["document-file-templates", docType] });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally { setBgTogglingId(null); }
  }

  async function handleBgDeactivate(id: number) {
    setBgTogglingId(id);
    try {
      const r = await fetch(`${API}/api/admin/document-file-templates/${id}/deactivate`, { method: "PATCH", headers: jsonHeaders() });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      toast({ title: "Template dinonaktifkan" });
      qc.invalidateQueries({ queryKey: ["document-file-templates", docType] });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally { setBgTogglingId(null); }
  }

  async function handleBgDelete(id: number) {
    if (!confirm("Hapus file template ini?")) return;
    setBgDeletingId(id);
    try {
      const r = await fetch(`${API}/api/admin/document-file-templates/${id}`, { method: "DELETE", headers: jsonHeaders() });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      toast({ title: "Template dihapus" });
      qc.invalidateQueries({ queryKey: ["document-file-templates", docType] });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally { setBgDeletingId(null); }
  }

  async function toggleBgTemplate() {
    setBgToggling(true);
    try {
      const r = await fetch(`${API}/admin/document-settings/${docType}/bg-template/toggle`, {
        method: "PATCH", headers: authHeaders(),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Gagal toggle"); }
      const { bgTemplateActive: newActive } = await r.json();
      setForm(prev => ({ ...prev, bgTemplateActive: newActive }));
      qc.invalidateQueries({ queryKey: ["doc-settings", docType] });
      qc.invalidateQueries({ queryKey: ["doc-settings-all"] });
      toast({ title: newActive ? "Background template diaktifkan" : "Background template dinonaktifkan" });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setBgToggling(false);
    }
  }

  async function deleteBgTemplate() {
    if (!confirm("Hapus background template ini?")) return;
    try {
      const r = await fetch(`${API}/admin/document-settings/${docType}/bg-template`, {
        method: "DELETE", headers: authHeaders(),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Gagal menghapus"); }
      setForm(prev => ({ ...prev, bgTemplateUrl: null, bgTemplateType: null, bgTemplateActive: false }));
      qc.invalidateQueries({ queryKey: ["doc-settings", docType] });
      qc.invalidateQueries({ queryKey: ["doc-settings-all"] });
      toast({ title: "Background template dihapus" });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    }

  }

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Memuat...</div>;
  }

  const bgActive = bgTemplates.find((t) => t.isActive);
  const bgInactive = bgTemplates.filter((t) => !t.isActive);

  const innerTabs = [

    { id: "kop",        label: "Logo & Kop Surat" },
    { id: "bank",       label: "Bank" },
    { id: "finance",    label: "Finance & TTD" },
    { id: "template",   label: "Template HTML" },
    ...(supportsFileTemplate ? [{ id: "background", label: "Background Template" }] : []),
  ] as const;

  return (
    <div className="space-y-4">
      {/* Description */}
      <div className={`rounded-lg border px-4 py-2.5 text-sm ${meta.color}`}>
        {meta.description}
        {docType === "general" && (
          <span className="ml-2 font-bold">Isi minimal logo dan bank — semua dokumen lain mewarisi nilai ini.</span>
        )}
      </div>

      {/* Inner tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {innerTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setInnerTab(t.id as any)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              innerTab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Logo & Kop ── */}
      {innerTab === "kop" && (
        <div className="space-y-5">
          {/* Logo upload */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Logo</Label>
            <div className="flex items-center gap-4">
              {form.logoUrl ? (
                <div className="relative">
                  <img src={form.logoUrl} alt="Logo" className="h-14 w-auto object-contain border rounded-lg p-1 bg-white" />
                  <button onClick={() => f("logoUrl", null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">×</button>
                </div>
              ) : (
                <div className="h-14 w-28 border-2 border-dashed rounded-lg flex items-center justify-center bg-muted/30">
                  <ImageIcon size={18} className="text-muted-foreground" />
                </div>
              )}
              <div>
                <input ref={logoRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const file = e.target.files?.[0]; if (file) uploadFile(`/admin/document-settings/${docType}/upload-logo`, file, "logoUrl", setLogoUploading); }} />
                <Button type="button" variant="outline" size="sm" disabled={logoUploading} onClick={() => logoRef.current?.click()} className="gap-2">
                  <Upload size={12} />{logoUploading ? "Mengupload..." : "Upload Logo"}
                </Button>
                <p className="text-[10px] text-muted-foreground mt-1">PNG/JPG, max 5MB</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Prefix & Tax */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1"><Hash size={11} /> Prefix Nomor</Label>
              <Input value={form.prefixNumber} onChange={e => f("prefixNumber", e.target.value.toUpperCase())} maxLength={10} placeholder={meta.defaultPrefix} />
              <p className="text-[10px] text-muted-foreground">{form.prefixNumber || meta.defaultPrefix}/SC/YYYYMMDD/000001</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1"><Percent size={11} /> Tarif Pajak (%)</Label>
              <Input value={form.taxRate} onChange={e => f("taxRate", e.target.value)} type="number" min="0" max="100" step="0.01" placeholder="11" />
              <p className="text-[10px] text-muted-foreground">Default: 11% (PPN)</p>
            </div>
          </div>

          {/* Footer text */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1"><AlignLeft size={11} /> Footer Dokumen (HTML)</Label>
            <Textarea
              value={form.footerHtml ?? ""}
              onChange={e => f("footerHtml", e.target.value || null)}
              placeholder="<p>Dokumen ini dibuat secara otomatis. Sah tanpa tanda tangan basah.</p>"
              rows={2}
              className="text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">Mendukung HTML. Kosong = teks default sistem.</p>
          </div>
        </div>
      )}

      {/* ── Bank ── */}
      {innerTab === "bank" && (
        <div className="space-y-4">
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
              <Input value={form.bankHolder} onChange={e => f("bankHolder", e.target.value)} placeholder="PT Cahaya Sejati Teknologi" />
            </div>
          </div>
          {(form.bankName || form.bankAccount || form.bankHolder) && (
            <div className="rounded-lg border p-4 bg-white">
              <p className="text-[10px] text-muted-foreground mb-2 font-bold uppercase tracking-wide">Preview di Dokumen</p>
              <div className="text-sm space-y-0.5">
                <p className="font-bold text-blue-700">{form.bankHolder || "—"}</p>
                <p>{form.bankName || "—"}</p>
                <p className="font-mono font-bold">No. Rek: {form.bankAccount || "—"}</p>
              </div>
            </div>
          )}
          {docType !== "general" && (
            <p className="text-[11px] text-muted-foreground">Kosong = inherit dari dokumen <strong>Umum</strong>.</p>
          )}
        </div>
      )}

      {/* ── Finance & TTD ── */}
      {innerTab === "finance" && (
        <div className="space-y-5">
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
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Tanda Tangan</Label>
            <div className="flex items-center gap-4">
              {form.signatureUrl ? (
                <div className="relative">
                  <img src={form.signatureUrl} alt="TTD" className="h-16 w-auto object-contain border rounded-lg p-1 bg-white" />
                  <button onClick={() => f("signatureUrl", null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">×</button>
                </div>
              ) : (
                <div className="h-16 w-36 border-2 border-dashed rounded-lg flex flex-col items-center justify-center bg-muted/30 gap-1">
                  <ImageIcon size={16} className="text-muted-foreground" />
                  <span className="text-[9px] text-muted-foreground">Belum ada TTD</span>
                </div>
              )}
              <div>
                <input ref={sigRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const file = e.target.files?.[0]; if (file) uploadFile(`/admin/document-settings/${docType}/upload-signature`, file, "signatureUrl", setSigUploading); }} />
                <Button type="button" variant="outline" size="sm" disabled={sigUploading} onClick={() => sigRef.current?.click()} className="gap-2">
                  <Upload size={12} />{sigUploading ? "Mengupload..." : "Upload TTD"}
                </Button>
                <p className="text-[10px] text-muted-foreground mt-1">PNG transparan direkomendasikan</p>
              </div>
            </div>
          </div>
          {docType !== "general" && (
            <p className="text-[11px] text-muted-foreground">Kosong = inherit dari dokumen <strong>Umum</strong>.</p>
          )}
        </div>
      )}

      {/* ── Template HTML ── */}
      {innerTab === "template" && (
        <div className="space-y-3">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <strong>Opsional.</strong> Jika diisi, HTML ini menggantikan kop surat default (logo + nama perusahaan).
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">HTML Kop Surat</Label>
            <Textarea
              value={form.kopSuratHtml ?? ""}
              onChange={e => f("kopSuratHtml", e.target.value || null)}
              placeholder={`<div style="display:flex;align-items:center;gap:16px;border-bottom:2px solid #ea580c;padding-bottom:12px;">\n  <img src="{{logoUrl}}" style="height:60px;" />\n  <div>\n    <h2 style="margin:0;color:#ea580c;">{{companyName}}</h2>\n    <p style="margin:0;font-size:12px;">{{address}}</p>\n  </div>\n</div>`}
              className="font-mono text-xs min-h-[180px]"
            />
          </div>
          <div className="text-[11px] text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
            <p className="font-semibold">Variabel:</p>
            {[
              ["{{logoUrl}}", "URL logo"],
              ["{{companyName}}", "Nama perusahaan"],
              ["{{address}}", "Alamat"],
              ["{{phone}}", "Telepon"],
              ["{{financeName}}", "Nama finance"],
              ["{{financeTitle}}", "Jabatan finance"],
            ].map(([v, d]) => (
              <p key={v}><code className="bg-white px-1 rounded">{v}</code> — {d}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── Background Template ── */}

      {innerTab === "background" && supportsFileTemplate && (
        <div className="space-y-4">
          {/* Info */}
          <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-xs text-orange-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><LayoutTemplate size={13} /> Background File Template</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>File ini digunakan sebagai <strong>background visual</strong> dokumen — data sistem dirender sebagai overlay di atasnya</li>
              <li>Hanya <strong>1 template aktif</strong> — mengaktifkan yang baru otomatis menonaktifkan yang lain</li>
              <li>Jika error → otomatis <strong>fallback ke HTML default</strong></li>
              <li>Rekomendasi: <strong>PNG A4 @300dpi</strong> (2480×3508px), background transparan</li>
            </ul>
          </div>

          {/* Active template */}
          {bgActive && (
            <div className="rounded-lg border-2 border-green-300 bg-green-50 p-3">
              <div className="flex items-start gap-3">
                <div className="w-14 h-14 rounded-lg border bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
                  {bgActive.templateType === "pdf"
                    ? <FileIcon size={22} className="text-red-500" />
                    : <img src={bgActive.fileUrl} alt="" className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <CheckCircle2 size={14} className="text-green-600" />
                    <span className="text-sm font-bold text-green-800">Template Aktif</span>
                  </div>
                  <p className="text-xs text-gray-600 truncate">{bgActive.fileName || "template"}</p>
                  <p className="text-[10px] text-muted-foreground">{bgActive.templateType === "image" ? "Image background" : "PDF"}</p>
                  <div className="flex gap-3 mt-2">
                    <a href={bgActive.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Lihat file ↗</a>
                    <button type="button" onClick={() => handleBgDeactivate(bgActive.id)} disabled={bgTogglingId === bgActive.id}
                      className="text-xs text-amber-600 hover:text-amber-700 underline disabled:opacity-50">
                      {bgTogglingId === bgActive.id ? "..." : "Nonaktifkan"}
                    </button>
                    <button type="button" onClick={() => handleBgDelete(bgActive.id)} disabled={bgDeletingId === bgActive.id}
                      className="text-xs text-red-500 hover:text-red-600 underline disabled:opacity-50">
                      {bgDeletingId === bgActive.id ? "..." : "Hapus"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Inactive templates */}
          {bgInactive.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Template tersimpan (tidak aktif):</p>
              {bgInactive.map((ft: any) => (
                <div key={ft.id} className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded bg-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {ft.templateType === "pdf"
                      ? <FileIcon size={15} className="text-red-400" />
                      : <img src={ft.fileUrl} alt="" className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{ft.fileName || "template"}</p>
                    <p className="text-[10px] text-muted-foreground">{ft.templateType}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button" onClick={() => handleBgActivate(ft.id)} disabled={bgTogglingId === ft.id}
                      className="text-[11px] font-semibold text-green-700 bg-green-100 hover:bg-green-200 px-2 py-1 rounded transition-colors disabled:opacity-50">
                      {bgTogglingId === ft.id ? "..." : "Aktifkan"}
                    </button>
                    <button type="button" onClick={() => handleBgDelete(ft.id)} disabled={bgDeletingId === ft.id}
                      className="text-[11px] text-red-500 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition-colors disabled:opacity-50">
                      {bgDeletingId === ft.id ? "..." : <Trash2 size={11} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Upload zone */}
          <button type="button" onClick={() => bgFileInputRef.current?.click()} disabled={bgUploading}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl p-5 flex items-center gap-3 hover:border-primary hover:bg-orange-50/40 transition-colors disabled:opacity-50 text-left">
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
              <Upload size={18} className="text-orange-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">{bgUploading ? "Mengupload..." : bgTemplates.length > 0 ? "Upload Template Baru" : "Upload Background Template"}</p>
              <p className="text-xs text-muted-foreground">PNG/JPG (disarankan) atau PDF · maks 10MB</p>
            </div>
          </button>
          <input ref={bgFileInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) handleBgUpload(file); }} />
        </div>
      )}

      {/* Save button — only for non-background tabs */}
      {innerTab !== "background" && (
        <div className="flex justify-end pt-2 border-t">
          <Button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
            className="bg-primary hover:bg-primary/90 font-bold gap-2"
          >
            <Save size={14} />
            {saveMutation.isPending ? "Menyimpan..." : `Simpan ${meta.label}`}
          </Button>
        </div>
      )}

      {innerTab === "bg" && (
        <div className="space-y-5">
          {/* Info box */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 space-y-1">
            <div className="font-bold flex items-center gap-1.5"><Layers size={14} /> Background Template Override</div>
            <p>Upload gambar atau PDF sebagai layout background dokumen. Data sistem (nomor, tabel, total) akan di-render sebagai overlay di atas template.</p>
            <p className="text-[11px] text-blue-600">Format: PNG, JPG, WebP, PDF · Maks. 10MB · Template tidak mengubah perhitungan pajak atau data booking.</p>
          </div>

          {/* Current template */}
          {form.bgTemplateUrl ? (
            <div className="rounded-lg border p-4 space-y-4 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${form.bgTemplateActive ? "bg-green-100" : "bg-gray-100"}`}>
                    <FileImage size={18} className={form.bgTemplateActive ? "text-green-600" : "text-gray-400"} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      {form.bgTemplateType === "pdf" ? "Template PDF" : "Template Gambar"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {form.bgTemplateActive ? (
                        <span className="flex items-center gap-1 text-[11px] text-green-600 font-semibold">
                          <CheckCircle2 size={11} /> Aktif — digunakan sebagai background
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <AlertCircle size={11} /> Tidak aktif — fallback ke HTML default
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => window.open(form.bgTemplateUrl!, "_blank")}
                  >
                    <Eye size={12} /> Preview
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 gap-1"
                    onClick={deleteBgTemplate}
                  >
                    <Trash2 size={12} /> Hapus
                  </Button>
                </div>
              </div>

              {/* Toggle aktif */}
              <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/30">
                <div>
                  <p className="text-sm font-semibold">Gunakan sebagai background dokumen</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Jika aktif, template digunakan saat generate preview/PDF. Jika tidak aktif, sistem menggunakan HTML default.
                  </p>
                </div>
                <Switch
                  checked={form.bgTemplateActive}
                  onCheckedChange={toggleBgTemplate}
                  disabled={bgToggling}
                />
              </div>

              {/* Image preview */}
              {form.bgTemplateType === "image" && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Preview Template</p>
                  <div className="rounded-lg overflow-hidden border bg-gray-50 max-h-64">
                    <img
                      src={form.bgTemplateUrl}
                      alt="Background template"
                      className="w-full object-contain"
                    />
                  </div>
                </div>
              )}

              {/* Replace button */}
              <div>
                <input
                  ref={bgRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
                  className="hidden"
                  onChange={e => { const file = e.target.files?.[0]; if (file) uploadBgTemplate(file); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={bgUploading}
                  onClick={() => bgRef.current?.click()}
                  className="gap-2"
                >
                  <Upload size={12} />
                  {bgUploading ? "Mengupload..." : "Ganti Template"}
                </Button>
              </div>
            </div>
          ) : (
            /* Upload area — no template yet */
            <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center space-y-4 bg-muted/10">
              <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                <Layers size={24} className="text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-sm">Belum ada background template</p>
                <p className="text-xs text-muted-foreground mt-1">Sistem menggunakan HTML default. Upload file untuk mengaktifkan background template.</p>
              </div>
              <input
                ref={bgRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
                className="hidden"
                onChange={e => { const file = e.target.files?.[0]; if (file) uploadBgTemplate(file); }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={bgUploading}
                onClick={() => bgRef.current?.click()}
                className="gap-2 font-semibold"
              >
                <Upload size={14} />
                {bgUploading ? "Mengupload..." : "Upload Template (PNG/JPG/PDF)"}
              </Button>
              <p className="text-[10px] text-muted-foreground">Maks. 10MB · PNG/JPG/WebP/PDF · Auto-diaktifkan setelah upload</p>
            </div>
          )}

          {/* Isolation notice */}
          <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-xs text-orange-800 space-y-1">
            <p className="font-bold">Isolasi per jenis dokumen</p>
            <p>Template <strong>{meta.label}</strong> hanya berlaku untuk dokumen jenis ini. Tidak mempengaruhi jenis dokumen lain.</p>
            {docType !== "general" && (
              <p className="text-orange-600">Jika jenis ini tidak punya template aktif, sistem otomatis fallback ke template <strong>Umum</strong> (jika ada).</p>
            )}
          </div>
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end pt-2 border-t">
        <Button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="bg-primary hover:bg-primary/90 font-bold gap-2"
        >
          <Save size={14} />
          {saveMutation.isPending ? "Menyimpan..." : `Simpan ${meta.label}`}
        </Button>
      </div>
    </div>
  );
}

// ─── Preview Panel ────────────────────────────────────────────────────────────

function PreviewPanel() {
  const { data: allSettings } = useQuery<DocSettings[]>({
    queryKey: ["doc-settings-all"],
    queryFn: fetchAllDocSettings,
  });

  const general = allSettings?.find(r => r.documentType === "general");
  const invoice = allSettings?.find(r => r.documentType === "invoice");

  const logo = invoice?.logoUrl ?? general?.logoUrl;
  const bankHolder = (invoice?.bankHolder || general?.bankHolder) ?? "—";
  const bankName = (invoice?.bankName || general?.bankName) ?? "—";
  const bankAccount = (invoice?.bankAccount || general?.bankAccount) ?? "—";
  const financeName = (invoice?.financeName || general?.financeName) ?? "";
  const financeTitle = (invoice?.financeTitle || general?.financeTitle) ?? "Finance Manager";
  const signatureUrl = invoice?.signatureUrl ?? general?.signatureUrl;
  const prefix = invoice?.prefixNumber ?? general?.prefixNumber ?? "INV";

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
        Preview menampilkan hasil merge <strong>Invoice</strong> → <strong>Umum</strong>.
        Invoice-specific menimpa nilai Umum jika diisi.
      </div>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        {/* Header preview */}
        <div className="flex items-start justify-between border-b-2 border-orange-500 pb-4 mb-4">
          <div className="flex items-center gap-3">
            {logo ? (
              <img src={logo} alt="Logo" className="h-14 w-auto object-contain" />
            ) : (
              <div className="h-14 w-14 bg-orange-100 rounded flex items-center justify-center">
                <Building2 size={24} className="text-orange-500" />
              </div>
            )}
            <div>
              <p className="font-black text-lg text-gray-900">Sport Center Soekarno-Hatta</p>
              <p className="text-xs text-gray-500">Kawasan Bandara Soekarno-Hatta, Tangerang</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-orange-500">INVOICE</p>
            <Badge variant="outline" className="text-[10px]">
              {prefix}/SC/20260619/000001
            </Badge>
          </div>
        </div>

        {/* Body placeholder */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="border rounded-lg p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Informasi Invoice</p>
            <div className="text-xs space-y-1">
              <p><span className="text-muted-foreground">No Invoice</span> : <span className="font-mono text-orange-600">{prefix}/SC/20260619/000001</span></p>
              <p><span className="text-muted-foreground">Tanggal</span> : 19 Juni 2026</p>
            </div>
          </div>
          <div className="border rounded-lg p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Pelanggan</p>
            <div className="text-xs space-y-1">
              <p><span className="text-muted-foreground">Nama</span> : Budi Santoso</p>
              <p><span className="text-muted-foreground">HP</span> : 0812-xxxx-xxxx</p>
            </div>
          </div>
        </div>

        {/* Table placeholder */}
        <div className="border rounded overflow-hidden mb-4">
          <div className="bg-gray-800 text-white grid grid-cols-6 text-[10px] font-bold">
            {["No","Fasilitas","Tanggal","Waktu","Durasi","Harga"].map(h => (
              <div key={h} className="px-2 py-1.5">{h}</div>
            ))}
          </div>
          <div className="grid grid-cols-6 text-xs border-t">
            {["1","Lapangan Futsal A","19 Jun 2026","08:00–10:00","2 jam","Rp 300.000"].map(c => (
              <div key={c} className="px-2 py-2">{c}</div>
            ))}
          </div>
        </div>

        {/* Payment & Signature */}
        <div className="flex items-start justify-between border-t pt-4">
          <div className="text-xs">
            <p className="font-bold text-[10px] text-muted-foreground uppercase mb-1">Informasi Pembayaran</p>
            <p className="font-bold text-blue-700">{bankHolder}</p>
            <p>{bankName}</p>
            <p className="font-mono font-bold">No. Rek: {bankAccount}</p>
          </div>
          <div className="text-right text-xs">
            <p className="text-muted-foreground mb-1">Hormat kami,</p>
            {signatureUrl ? (
              <img src={signatureUrl} alt="TTD" className="h-12 ml-auto object-contain" />
            ) : (
              <div className="h-12 w-24 border-dashed border rounded ml-auto flex items-center justify-center">
                <ImageIcon size={12} className="text-muted-foreground" />
              </div>
            )}
            <div className="border-t border-gray-400 pt-1 mt-1">
              <p className="font-bold">{financeName || "Sport Center"}</p>
              <p className="text-muted-foreground">{financeTitle}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="bg-muted px-4 py-2 text-xs font-bold uppercase tracking-wide">Status Konfigurasi Per Dokumen</div>
        <div className="divide-y">
          {DOC_TYPES.map(meta => {
            const row = allSettings?.find(r => r.documentType === meta.type);
            const hasLogo = !!(row?.logoUrl);
            const hasBank = !!(row?.bankName || row?.bankAccount);
            const hasTtd = !!(row?.signatureUrl);
            const hasKop = !!(row?.kopSuratHtml);
            const hasBg = !!(row?.bgTemplateUrl);
            const bgActive = !!(row?.bgTemplateActive);
            return (
              <div key={meta.type} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <meta.icon size={14} className="text-muted-foreground shrink-0" />
                <span className="font-semibold w-36 shrink-0">{meta.label}</span>
                <span className="font-mono text-orange-600 w-16 shrink-0">{row?.prefixNumber ?? meta.defaultPrefix}</span>
                <div className="flex gap-1.5 flex-wrap">
                  {hasLogo && <Badge variant="secondary" className="text-[10px] py-0">Logo ✓</Badge>}
                  {hasBank && <Badge variant="secondary" className="text-[10px] py-0">Bank ✓</Badge>}
                  {hasTtd && <Badge variant="secondary" className="text-[10px] py-0">TTD ✓</Badge>}
                  {hasKop && <Badge variant="secondary" className="text-[10px] py-0">Kop HTML ✓</Badge>}
                  {hasBg && (
                    <Badge className={`text-[10px] py-0 ${bgActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      BG {bgActive ? "✓ Aktif" : "(Nonaktif)"}
                    </Badge>
                  )}
                  {!hasLogo && !hasBank && !hasTtd && !hasKop && !hasBg && (
                    <span className="text-muted-foreground italic">Belum dikonfigurasi — inherit dari Umum</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminDocumentSettings() {
  const [activeType, setActiveType] = useState<DocumentType | "preview">("general");

  const activeMeta = DOC_TYPES.find(d => d.type === activeType);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-foreground">Template Dokumen</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Konfigurasi tampilan per jenis dokumen — logo, kop surat, bank, tanda tangan, prefix nomor.
          Setiap dokumen bisa punya setting berbeda, atau inherit dari <strong>Umum</strong>.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Left sidebar nav */}
        <div className="w-52 shrink-0 space-y-1">
          {DOC_TYPES.map(meta => (
            <button
              key={meta.type}
              onClick={() => setActiveType(meta.type)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-left transition-colors ${
                activeType === meta.type
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <meta.icon size={15} className="shrink-0" />
              <span className="flex-1">{meta.label}</span>
              {activeType === meta.type && <ChevronRight size={14} />}
            </button>
          ))}
          <Separator className="my-2" />
          <button
            onClick={() => setActiveType("preview")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-left transition-colors ${
              activeType === "preview"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Eye size={15} className="shrink-0" />
            <span className="flex-1">Preview Invoice</span>
            {activeType === "preview" && <ChevronRight size={14} />}
          </button>
        </div>

        {/* Right content */}
        <div className="flex-1 min-w-0">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                {activeType === "preview"
                  ? <><Eye size={16} /> Preview Invoice</>
                  : activeMeta
                    ? <><activeMeta.icon size={16} /> {activeMeta.label}</>
                    : null
                }
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeType === "preview"
                ? <PreviewPanel />
                : activeMeta
                  ? <DocTypePanel key={activeType} docType={activeType} meta={activeMeta} />
                  : null
              }
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
