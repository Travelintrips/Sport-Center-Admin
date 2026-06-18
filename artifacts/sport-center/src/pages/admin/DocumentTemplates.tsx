import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, Eye, FileText, X, ExternalLink, Printer } from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

const DOCUMENT_TYPES = [
  { value: "invoice", label: "Invoice" },
  { value: "spp", label: "SPP (Surat Perintah Pembayaran)" },
  { value: "faktur", label: "Faktur Pembayaran" },
  { value: "kwitansi", label: "Kwitansi" },
  { value: "lampiran", label: "Lampiran Invoice" },
  { value: "berita_acara", label: "Berita Acara Pembayaran" },
];

const PAPER_STYLES = ["A4", "Letter", "Legal"];

const DOC_TYPE_COLORS: Record<string, string> = {
  invoice: "bg-blue-100 text-blue-700",
  spp: "bg-purple-100 text-purple-700",
  faktur: "bg-orange-100 text-orange-700",
  kwitansi: "bg-green-100 text-green-700",
  lampiran: "bg-gray-100 text-gray-700",
  berita_acara: "bg-red-100 text-red-700",
};

const EMPTY_FORM = {
  companyId: "",
  documentType: "",
  isDefault: false,
  headerLogoUrl: "",
  kopSuratHtml: "",
  footerHtml: "",
  companyDisplayName: "",
  financeName: "",
  financeTitle: "",
  financeSignature: "",
  address: "",
  phone: "",
  email: "",
  numberFormatPrefix: "",
  numberFormatPattern: "",
  paperStyle: "A4",
};

type FormState = typeof EMPTY_FORM;

async function fetchTemplates(companyId?: string, documentType?: string) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (documentType) params.set("documentType", documentType);
  const r = await fetch(`${API}/document-templates?${params}`, { headers: authHeaders() });
  if (!r.ok) throw new Error("Gagal memuat template");
  return r.json();
}

async function fetchCompanies() {
  const r = await fetch(`${API}/customers?accountType=company`, { headers: authHeaders() });
  if (!r.ok) return [];
  const data = await r.json();
  return (data || []).filter((c: any) => c.accountType === "company" || c.companyName);
}

export default function AdminDocumentTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filterCompany, setFilterCompany] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewTab, setPreviewTab] = useState<"basic" | "html">("basic");

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["document-templates", filterCompany, filterType],
    queryFn: () => fetchTemplates(
      filterCompany !== "all" ? filterCompany : undefined,
      filterType !== "all" ? filterType : undefined,
    ),
  });

  const { data: companies = [] } = useQuery({ queryKey: ["companies-list"], queryFn: fetchCompanies });

  const saveMutation = useMutation({
    mutationFn: async (data: FormState) => {
      const body = {
        ...data,
        companyId: data.companyId ? parseInt(data.companyId) : null,
        isDefault: data.isDefault,
      };
      const url = editingId ? `${API}/document-templates/${editingId}` : `${API}/document-templates`;
      const method = editingId ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Gagal menyimpan"); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editingId ? "Template diperbarui" : "Template dibuat" });
      qc.invalidateQueries({ queryKey: ["document-templates"] });
      closeForm();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${API}/document-templates/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Gagal menghapus"); }
    },
    onSuccess: () => { toast({ title: "Template dihapus" }); qc.invalidateQueries({ queryKey: ["document-templates"] }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPreviewTab("basic");
    setShowForm(true);
  }

  function openEdit(tpl: any) {
    setEditingId(tpl.id);
    setPreviewTab("basic");
    setForm({
      companyId: tpl.companyId ? String(tpl.companyId) : "",
      documentType: tpl.documentType || "",
      isDefault: tpl.isDefault || false,
      headerLogoUrl: tpl.headerLogoUrl || "",
      kopSuratHtml: tpl.kopSuratHtml || "",
      footerHtml: tpl.footerHtml || "",
      companyDisplayName: tpl.companyDisplayName || "",
      financeName: tpl.financeName || "",
      financeTitle: tpl.financeTitle || "",
      financeSignature: tpl.financeSignature || "",
      address: tpl.address || "",
      phone: tpl.phone || "",
      email: tpl.email || "",
      numberFormatPrefix: tpl.numberFormatPrefix || "",
      numberFormatPattern: tpl.numberFormatPattern || "",
      paperStyle: tpl.paperStyle || "A4",
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.documentType) { toast({ title: "documentType wajib diisi", variant: "destructive" }); return; }
    saveMutation.mutate(form);
  }

  function openPreview(documentType: string, entityId: number, companyId?: number | null) {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", String(companyId));
    const token = getToken();
    if (token) params.set("_token", token);
    setPreviewUrl(`${API}/documents/${documentType}/${entityId}/preview?${params}`);
    window.open(`${API}/documents/${documentType}/${entityId}/preview?${params}`, "_blank");
  }

  function openPdf(documentType: string, entityId: number, companyId?: number | null) {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", String(companyId));
    const token = getToken();
    if (token) params.set("_token", token);
    window.open(`${API}/documents/${documentType}/${entityId}/pdf?${params}`, "_blank");
  }

  const f = (field: keyof FormState, value: any) => setForm((prev) => ({ ...prev, [field]: value }));

  const docTypeLabel = (type: string) => DOCUMENT_TYPES.find((d) => d.value === type)?.label || type;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-foreground">Template Dokumen</h1>
          <p className="text-muted-foreground text-sm mt-1">Kelola kop surat, footer, dan format dokumen per perusahaan</p>
        </div>
        <Button onClick={openCreate} className="bg-primary hover:bg-primary/90 font-bold">
          <Plus size={16} className="mr-2" /> Buat Template
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Perusahaan:</Label>
              <Select value={filterCompany} onValueChange={setFilterCompany}>
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="null">System Default</SelectItem>
                  {companies.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.companyName || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Tipe Dokumen:</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 w-52 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  {DOCUMENT_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Templates Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Memuat template...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <div>Belum ada template dokumen</div>
          <Button onClick={openCreate} variant="outline" className="mt-4">Buat Template Pertama</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map((tpl: any) => (
            <Card key={tpl.id} className="border hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm font-bold truncate">{tpl.companyDisplayName || tpl.companyName || "System Default"}</CardTitle>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      <Badge className={`text-[10px] px-2 py-0 ${DOC_TYPE_COLORS[tpl.documentType] || "bg-gray-100 text-gray-700"}`}>
                        {docTypeLabel(tpl.documentType)}
                      </Badge>
                      {tpl.isDefault && (
                        <Badge className="text-[10px] px-2 py-0 bg-yellow-100 text-yellow-700">Default</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] px-2 py-0">{tpl.paperStyle || "A4"}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(tpl)}>
                      <Edit2 size={13} />
                    </Button>
                    {!tpl.isDefault && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => { if (confirm("Hapus template ini?")) deleteMutation.mutate(tpl.id); }}>
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1 text-xs text-muted-foreground">
                  {tpl.financeName && <div>Finance: <span className="font-medium text-foreground">{tpl.financeName}</span> {tpl.financeTitle && `(${tpl.financeTitle})`}</div>}
                  {tpl.numberFormatPrefix && <div>Format: <span className="font-mono font-medium text-foreground">{tpl.numberFormatPrefix}-[COMPANY]-[YEAR]-[SEQ]</span></div>}
                  {tpl.address && <div className="truncate">Alamat: {tpl.address}</div>}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${tpl.kopSuratHtml ? "bg-green-500" : "bg-gray-300"}`} title="Kop Surat HTML" />
                    <div className={`w-2 h-2 rounded-full ${tpl.footerHtml ? "bg-green-500" : "bg-gray-300"}`} title="Footer HTML" />
                    <div className={`w-2 h-2 rounded-full ${tpl.headerLogoUrl ? "bg-green-500" : "bg-gray-300"}`} title="Logo" />
                    <div className={`w-2 h-2 rounded-full ${tpl.financeSignature ? "bg-green-500" : "bg-gray-300"}`} title="Tanda Tangan" />
                  </div>
                  <span className="text-[10px] text-muted-foreground">kop / footer / logo / ttd</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Info box: how to generate documents */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <Eye size={20} className="text-blue-500 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <div className="font-bold mb-1">Cara Generate Dokumen</div>
              <ul className="space-y-1 text-xs">
                <li>• Buka halaman <strong>Tagihan Perusahaan</strong> → pilih invoice → klik tombol <strong>Preview / PDF</strong></li>
                <li>• Buka halaman <strong>Pemesanan</strong> → pilih booking → klik <strong>Generate Dokumen</strong></li>
                <li>• Preview membuka dokumen di tab baru. Untuk PDF, gunakan <strong>Ctrl+P → Save as PDF</strong></li>
                <li>• Template perusahaan diprioritaskan; jika tidak ada, fallback ke <strong>System Default</strong></li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) closeForm(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black">{editingId ? "Edit Template Dokumen" : "Buat Template Dokumen"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Perusahaan <span className="text-muted-foreground">(kosong = System Default)</span></Label>
                <Select value={form.companyId || "none"} onValueChange={(v) => f("companyId", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="System Default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">System Default</SelectItem>
                    {companies.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.companyName || c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Tipe Dokumen *</Label>
                <Select value={form.documentType || "none"} onValueChange={(v) => f("documentType", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih tipe dokumen" /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((dt) => (
                      <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Nama Perusahaan (tampil di dokumen)</Label>
                <Input value={form.companyDisplayName} onChange={(e) => f("companyDisplayName", e.target.value)} placeholder="PT. Sport Center Jakarta" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Ukuran Kertas</Label>
                <Select value={form.paperStyle} onValueChange={(v) => f("paperStyle", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAPER_STYLES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Contact Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Alamat</Label>
                <Input value={form.address} onChange={(e) => f("address", e.target.value)} placeholder="Jl. Sport Center No. 1" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Telepon</Label>
                <Input value={form.phone} onChange={(e) => f("phone", e.target.value)} placeholder="021-1234567" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Email</Label>
                <Input value={form.email} onChange={(e) => f("email", e.target.value)} placeholder="info@sportcenter.id" />
              </div>
            </div>

            {/* Finance Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Nama Finance</Label>
                <Input value={form.financeName} onChange={(e) => f("financeName", e.target.value)} placeholder="Ahmad Fauzi" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Jabatan Finance</Label>
                <Input value={form.financeTitle} onChange={(e) => f("financeTitle", e.target.value)} placeholder="Finance Manager" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">URL Tanda Tangan (gambar)</Label>
                <Input value={form.financeSignature} onChange={(e) => f("financeSignature", e.target.value)} placeholder="https://..." />
              </div>
            </div>

            {/* Document Numbering */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Prefix Nomor Surat</Label>
                <Input value={form.numberFormatPrefix} onChange={(e) => f("numberFormatPrefix", e.target.value.toUpperCase())} placeholder="INV" />
                <p className="text-[10px] text-muted-foreground">Contoh: INV → INV-GMCGK-2026-0001</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">URL Logo Header</Label>
                <Input value={form.headerLogoUrl} onChange={(e) => f("headerLogoUrl", e.target.value)} placeholder="https://..." />
              </div>
            </div>

            {/* HTML Template Tabs */}
            <div className="space-y-3">
              <div className="flex gap-2 border-b">
                <button type="button" onClick={() => setPreviewTab("basic")} className={`pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ${previewTab === "basic" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
                  Kop Surat HTML
                </button>
                <button type="button" onClick={() => setPreviewTab("html")} className={`pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ${previewTab === "html" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
                  Footer HTML
                </button>
              </div>

              {previewTab === "basic" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Kop Surat HTML <span className="text-muted-foreground">(kosong = auto-generate dari field di atas)</span></Label>
                  <Textarea
                    value={form.kopSuratHtml}
                    onChange={(e) => f("kopSuratHtml", e.target.value)}
                    placeholder={'<div style="display:flex;...">\n  <img src="{{headerLogoUrl}}" />\n  <h1>{{companyDisplayName}}</h1>\n</div>'}
                    className="font-mono text-xs min-h-[180px]"
                  />
                  <p className="text-[10px] text-muted-foreground">Variabel: &#123;&#123;companyDisplayName&#125;&#125; &#123;&#123;headerLogoUrl&#125;&#125; &#123;&#123;address&#125;&#125; &#123;&#123;phone&#125;&#125; &#123;&#123;email&#125;&#125;</p>
                </div>
              )}

              {previewTab === "html" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Footer HTML <span className="text-muted-foreground">(kosong = auto-generate dari field finance)</span></Label>
                  <Textarea
                    value={form.footerHtml}
                    onChange={(e) => f("footerHtml", e.target.value)}
                    placeholder={'<div style="text-align:right;">\n  <p>{{financeTitle}}</p>\n  <img src="{{financeSignature}}" />\n  <p>{{financeName}}</p>\n</div>'}
                    className="font-mono text-xs min-h-[180px]"
                  />
                  <p className="text-[10px] text-muted-foreground">Variabel: &#123;&#123;financeName&#125;&#125; &#123;&#123;financeTitle&#125;&#125; &#123;&#123;financeSignature&#125;&#125; &#123;&#123;companyDisplayName&#125;&#125;</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={closeForm}>Batal</Button>
              <Button type="submit" disabled={saveMutation.isPending} className="bg-primary hover:bg-primary/90 font-bold">
                {saveMutation.isPending ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Buat Template"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Re-export document generation helpers for use in other pages
export function DocumentActions({ documentType, entityId, companyId, label }: { documentType: string; entityId: number; companyId?: number | null; label?: string }) {
  const API = import.meta.env.VITE_API_BASE_URL ?? "/api";

  function openPreview(printMode = false) {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", String(companyId));
    const token = getToken();
    if (token) params.set("_token", token);
    const path = printMode ? "pdf" : "preview";
    window.open(`${API}/documents/${documentType}/${entityId}/${path}?${params}`, "_blank");
  }

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" onClick={() => openPreview(false)} className="h-7 text-xs gap-1">
        <Eye size={12} /> {label || "Preview"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => openPreview(true)} className="h-7 text-xs gap-1">
        <Printer size={12} /> PDF
      </Button>
    </div>
  );
}
