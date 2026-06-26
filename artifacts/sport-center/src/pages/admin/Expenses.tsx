import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronsUpDown, Check } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, TrendingDown, Clock, CheckCircle2,
  Eye, Edit2, ThumbsUp, ThumbsDown, Banknote, X, Receipt,
  Upload, Loader2, Trash2, BookOpen, Building2,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

const PAYMENT_METHODS = ["Transfer Bank", "Tunai", "Kartu Kredit", "Virtual Account", "E-Wallet"];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Disetujui",
  paid: "Sudah Dibayar",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_approval: "bg-yellow-100 text-yellow-700",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Aset",
  liability: "Kewajiban",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  expense: "Beban",
};

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  asset: "bg-blue-50 text-blue-700",
  liability: "bg-purple-50 text-purple-700",
  equity: "bg-indigo-50 text-indigo-700",
  revenue: "bg-green-50 text-green-700",
  expense: "bg-orange-50 text-orange-700",
};

const JOURNAL_TYPE_INFO: Record<string, { label: string; desc: string }> = {
  expense: { label: "Beban Operasional", desc: "Debit Beban → Kredit Kas/Bank" },
  asset: { label: "Aset / Kasbon", desc: "Debit Piutang/Aset → Kredit Kas/Bank" },
  liability: { label: "Bayar Hutang", desc: "Debit Hutang/Kewajiban → Kredit Kas/Bank" },
};

function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

const EMPTY_FORM = {
  expenseDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }),
  coaAccountId: "",
  description: "",
  vendorId: "",
  vendorName: "",
  facilityId: "",
  amount: "",
  ppnAmount: "",
  paymentMethod: "",
  paymentAccount: "",
  receiptUrls: [] as string[],
  notes: "",
};

interface Vendor {
  id: number;
  name: string;
}

interface CoaAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
  sortOrder: number;
}

export default function AdminExpenses() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [coaOpen, setCoaOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteConfirmNo, setDeleteConfirmNo] = useState("");

  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  async function handleReceiptUpload(files: FileList | File[]) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      if (!allowed.includes(file.type)) {
        toast({ title: "Format tidak didukung", description: `${file.name}: Gunakan JPG, PNG, WebP, atau GIF`, variant: "destructive" });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "File terlalu besar", description: `${file.name}: Maksimal 10 MB`, variant: "destructive" });
        return;
      }
    }
    setUploadingReceipt(true);
    try {
      const uploaded: string[] = [];
      for (const file of fileArr) {
        const fd = new FormData();
        fd.append("file", file);
        const resp = await fetch(`${API}/storage/upload-proof`, {
          method: "POST",
          headers: { Authorization: `Bearer ${getToken()}` },
          body: fd,
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error ?? "Upload gagal");
        uploaded.push(data.url);
      }
      setForm((prev) => ({ ...prev, receiptUrls: [...prev.receiptUrls, ...uploaded] }));
      toast({ title: `${uploaded.length} foto nota berhasil diupload` });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally {
      setUploadingReceipt(false);
    }
  }

  function removeReceiptUrl(idx: number) {
    setForm((prev) => ({ ...prev, receiptUrls: prev.receiptUrls.filter((_, i) => i !== idx) }));
  }

  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (filterStatus !== "all") params.set("status", filterStatus);
  if (filterCategory !== "all") params.set("category", filterCategory);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", startDate, endDate, filterStatus, filterCategory],
    queryFn: () =>
      fetch(`${API}/admin/expenses?${params}`, { headers: authHeaders() }).then((r) => r.json()),
  });

  const { data: facilities = [] } = useQuery({
    queryKey: ["facilities"],
    queryFn: () => fetch(`${API}/facilities`).then((r) => r.json()),
  });

  const { data: coaAccounts = [] } = useQuery<CoaAccount[]>({
    queryKey: ["coa-accounts"],
    queryFn: () =>
      fetch(`${API}/admin/expenses/coa-accounts`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : [])),
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["vendors"],
    queryFn: () =>
      fetch(`${API}/admin/vendors`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d.filter((v: any) => v.isActive) : [])),
  });

  const { data: detail } = useQuery({
    queryKey: ["expense-detail", detailId],
    queryFn: () =>
      fetch(`${API}/admin/expenses/${detailId}`, { headers: authHeaders() }).then((r) => r.json()),
    enabled: !!detailId && detailOpen,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API}/admin/expenses`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal membuat pengeluaran");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setFormOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      toast({ title: "Pengeluaran dibuat" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      fetch(`${API}/admin/expenses/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal update");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-detail", editingId] });
      setFormOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      toast({ title: "Pengeluaran diupdate" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action, rejectedReason }: { id: number; action: string; rejectedReason?: string }) =>
      fetch(`${API}/admin/expenses/${id}/status`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ action, rejectedReason }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal update status");
        return d;
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-detail", vars.id] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setRejectOpen(false);
      setRejectReason("");
      const labels: Record<string, string> = {
        submit: "Pengeluaran diajukan untuk approval",
        approve: "Pengeluaran disetujui",
        reject: "Pengeluaran ditolak",
        pay: "Pengeluaran ditandai sudah dibayar",
        cancel: "Pengeluaran dibatalkan",
      };
      toast({ title: labels[vars.action] ?? "Status diupdate" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/admin/expenses/${id}`, { method: "DELETE", headers: authHeaders() }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal menghapus");
        return d;
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setDeleteConfirmId(null);
      setDeleteConfirmNo("");
      setDetailOpen(false);
      toast({ title: `${data.expenseNo} berhasil dihapus` });
    },
    onError: (e: any) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const summary = data?.summary ?? { totalThisMonth: 0, pendingApproval: 0, paid: 0, unpaid: 0 };
  const allExpenses: any[] = data?.expenses ?? [];

  // Group COA accounts by type for display
  const coaByType = (coaAccounts as CoaAccount[]).reduce((acc, a) => {
    if (!acc[a.accountType]) acc[a.accountType] = [];
    acc[a.accountType]!.push(a);
    return acc;
  }, {} as Record<string, CoaAccount[]>);

  // Get selected COA account info
  const selectedCoa = form.coaAccountId
    ? (coaAccounts as CoaAccount[]).find((a) => a.id === Number(form.coaAccountId)) ?? null
    : null;

  const filtered = allExpenses.filter((e: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.expenseNo?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.vendorName?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q) ||
      e.coaAccount?.name?.toLowerCase().includes(q) ||
      e.coaAccount?.code?.toLowerCase().includes(q)
    );
  });

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormOpen(true);
  }

  function openEdit(expense: any) {
    setEditingId(expense.id);
    setForm({
      expenseDate: expense.expenseDate ?? "",
      coaAccountId: expense.coaAccountId ? String(expense.coaAccountId) : "",
      description: expense.description ?? "",
      vendorId: expense.vendorId ? String(expense.vendorId) : "",


      vendorName: expense.vendorName ?? "",
      facilityId: expense.facilityId ? String(expense.facilityId) : "",
      amount: String(expense.amount ?? ""),
      ppnAmount: String(expense.ppnAmount ?? "0"),
      paymentMethod: expense.paymentMethod ?? "",
      paymentAccount: expense.paymentAccount ?? "",
      receiptUrls: Array.isArray(expense.receiptUrls) ? expense.receiptUrls : (expense.receiptUrl ? [expense.receiptUrl] : []),
      notes: expense.notes ?? "",
    });
    setFormOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.coaAccountId) {
      toast({ title: "Akun COA wajib dipilih", variant: "destructive" });
      return;
    }
    if (!form.vendorId) {
      toast({ title: "Vendor wajib dipilih", description: "Pilih vendor dari daftar yang tersedia", variant: "destructive" });
      return;
    }
    const selectedV = vendors.find((v) => v.id === Number(form.vendorId));
    const body = {
      expenseDate: form.expenseDate,
      coaAccountId: Number(form.coaAccountId),
      description: form.description,
      vendorId: form.vendorId ? Number(form.vendorId) : null,
      vendorId: Number(form.vendorId),
      vendorName: selectedV?.name ?? form.vendorName ?? null,
      facilityId: form.facilityId ? Number(form.facilityId) : null,
      amount: Number(form.amount),
      ppnAmount: Number(form.ppnAmount || 0),
      paymentMethod: form.paymentMethod || null,
      paymentAccount: form.paymentAccount || null,
      receiptUrls: form.receiptUrls,
      notes: form.notes || null,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const totalNum = Number(form.amount || 0) + Number(form.ppnAmount || 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Pengeluaran</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manajemen pengeluaran operasional Sport Center</p>
        </div>
        <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white font-bold">
          <Plus className="w-4 h-4 mr-2" /> Tambah Pengeluaran
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-gray-500 font-medium">Total Bulan Ini</span>
            </div>
            <p className="text-xl font-black text-gray-900">{formatIDR(summary.totalThisMonth)}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-yellow-500" />
              <span className="text-xs text-gray-500 font-medium">Pending Approval</span>
            </div>
            <p className="text-xl font-black text-gray-900">{summary.pendingApproval} item</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-xs text-gray-500 font-medium">Sudah Dibayar</span>
            </div>
            <p className="text-xl font-black text-gray-900">{formatIDR(summary.paid)}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Banknote className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-gray-500 font-medium">Belum Dibayar</span>
            </div>
            <p className="text-xl font-black text-gray-900">{formatIDR(summary.unpaid)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Cari nomor, deskripsi, vendor, akun COA..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[150px]" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[150px]" />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">
            Daftar Pengeluaran <span className="text-gray-400 font-normal">({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-gray-400">Memuat data...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400">Belum ada pengeluaran</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">No. Pengeluaran</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Tanggal</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Akun COA</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Deskripsi</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Vendor</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Total</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600">Status</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((expense: any) => (
                    <tr key={expense.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-orange-600">{expense.expenseNo}</td>
                      <td className="px-4 py-3 text-gray-700">{expense.expenseDate}</td>
                      <td className="px-4 py-3">
                        {expense.coaAccount ? (
                          <div>
                            <p className="font-semibold text-xs text-gray-900">
                              {expense.coaAccount.code} — {expense.coaAccount.name}
                            </p>
                            <Badge className={`text-[10px] mt-0.5 ${ACCOUNT_TYPE_COLORS[expense.coaAccount.accountType] ?? "bg-gray-100 text-gray-600"}`}>
                              {ACCOUNT_TYPE_LABELS[expense.coaAccount.accountType] ?? expense.coaAccount.accountType}
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs">{expense.category}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[200px] truncate text-gray-700">{expense.description}</td>
                      <td className="px-4 py-3 text-gray-500">{expense.vendorName ?? "-"}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{formatIDR(expense.totalAmount)}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`text-xs ${STATUS_COLORS[expense.paymentStatus]}`}>
                          {STATUS_LABELS[expense.paymentStatus]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600"
                            onClick={() => { setDetailId(expense.id); setDetailOpen(true); }}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-blue-400 hover:text-blue-600"
                            onClick={() => openEdit(expense)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          {expense.paymentStatus === "draft" && (
                            <>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-2 text-xs text-yellow-600 hover:text-yellow-700"
                                onClick={() => statusMutation.mutate({ id: expense.id, action: "submit" })}
                              >
                                Ajukan
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                                title="Hapus"
                                onClick={() => { setDeleteConfirmId(expense.id); setDeleteConfirmNo(expense.expenseNo); }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {expense.paymentStatus === "pending_approval" && (
                            <>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-green-500 hover:text-green-700"
                                onClick={() => statusMutation.mutate({ id: expense.id, action: "approve" })}
                                title="Approve"
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                                onClick={() => { setRejectTargetId(expense.id); setRejectOpen(true); }}
                                title="Reject"
                              >
                                <ThumbsDown className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {expense.paymentStatus === "approved" && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-xs text-green-600 hover:text-green-800"
                              onClick={() => statusMutation.mutate({ id: expense.id, action: "pay" })}
                            >
                              <Banknote className="w-3 h-3 mr-1" />
                              Bayar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black">{editingId ? "Edit Pengeluaran" : "Tambah Pengeluaran"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Tanggal <span className="text-red-500">*</span></Label>
                <Input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5 text-orange-500" />
                  Akun COA <span className="text-red-500">*</span>
                </Label>
                <Popover open={coaOpen} onOpenChange={setCoaOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {selectedCoa
                        ? <span><span className="font-mono text-xs text-gray-500 mr-1">{selectedCoa.code}</span>{selectedCoa.name}</span>
                        : <span className="text-muted-foreground">Pilih akun COA...</span>
                      }
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Cari akun COA..." />
                      <CommandList className="max-h-64">
                        <CommandEmpty>Akun tidak ditemukan.</CommandEmpty>
                        {Object.entries(coaByType).map(([type, accounts]) => (
                          <CommandGroup key={type} heading={ACCOUNT_TYPE_LABELS[type] ?? type}>
                            {accounts.map((acc) => (
                              <CommandItem
                                key={acc.id}
                                value={`${acc.code} ${acc.name}`}
                                onSelect={() => {
                                  setForm({ ...form, coaAccountId: String(acc.id) });
                                  setCoaOpen(false);
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${form.coaAccountId === String(acc.id) ? "opacity-100" : "opacity-0"}`} />
                                <span className="font-mono text-xs text-gray-500 mr-1">{acc.code}</span>
                                {acc.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedCoa && (
                  <div className="text-xs mt-1 p-2 rounded-md bg-orange-50 border border-orange-100 flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ACCOUNT_TYPE_COLORS[selectedCoa.accountType] ?? "bg-gray-100"}`}>
                      {ACCOUNT_TYPE_LABELS[selectedCoa.accountType] ?? selectedCoa.accountType}
                    </span>
                    <span className="text-gray-600">
                      {JOURNAL_TYPE_INFO[selectedCoa.accountType]?.desc ?? ""}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Deskripsi <span className="text-red-500">*</span></Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Deskripsi pengeluaran..."
                rows={2}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-orange-500" />
                  Vendor / Supplier
                </Label>
                <Select value={form.vendorId || "none"} onValueChange={(v) => setForm({ ...form, vendorId: v === "none" ? "" : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih vendor…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="none">— Tanpa vendor —</SelectItem>
                    {vendors.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-400 italic">
                        Belum ada vendor aktif. Tambahkan di menu Daftar Vendor.
                      </div>
                    ) : (
                      vendors.map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Label>Vendor / Supplier <span className="text-red-500">*</span></Label>
                <Popover open={vendorOpen} onOpenChange={setVendorOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {form.vendorId
                        ? <span className="font-medium">{vendors.find((v) => v.id === Number(form.vendorId))?.name ?? "Pilih vendor..."}</span>
                        : <span className="text-muted-foreground">Pilih vendor...</span>
                      }
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Cari vendor..." />
                      <CommandList className="max-h-56">
                        <CommandEmpty>
                          <div className="text-center py-2">
                            <p className="text-sm text-gray-500">Vendor tidak ditemukan.</p>
                            <a href="/admin/vendors" className="text-xs text-orange-500 underline" target="_blank">
                              Tambah vendor baru →
                            </a>
                          </div>
                        </CommandEmpty>
                        <CommandGroup>
                          {vendors.map((v) => (
                            <CommandItem
                              key={v.id}
                              value={v.name}
                              onSelect={() => {
                                setForm({ ...form, vendorId: String(v.id), vendorName: v.name });
                                setVendorOpen(false);
                              }}
                            >
                              <Check className={`mr-2 h-4 w-4 ${form.vendorId === String(v.id) ? "opacity-100" : "opacity-0"}`} />
                              {v.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {vendors.length === 0 && (
                  <p className="text-xs text-amber-600">Belum ada vendor aktif. <a href="/admin/vendors" className="underline" target="_blank">Tambah vendor</a></p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Fasilitas Terkait</Label>
                <Select value={form.facilityId || "none"} onValueChange={(v) => setForm({ ...form, facilityId: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih fasilitas (opsional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tidak terkait fasilitas</SelectItem>
                    {(facilities as any[]).map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Nominal (Rp) <span className="text-red-500">*</span></Label>
                <Input
                  type="number" min="0" step="1000"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>PPN Masukan (Rp)</Label>
                <Input
                  type="number" min="0" step="1000"
                  value={form.ppnAmount}
                  onChange={(e) => setForm({ ...form, ppnAmount: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label>Total</Label>
                <Input value={formatIDR(totalNum)} disabled className="bg-gray-50 font-bold" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Metode Pembayaran</Label>
                <Select value={form.paymentMethod || "none"} onValueChange={(v) => setForm({ ...form, paymentMethod: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih metode" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tidak ditentukan</SelectItem>
                    {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Rekening / Akun Pembayaran</Label>
                <Input value={form.paymentAccount} onChange={(e) => setForm({ ...form, paymentAccount: e.target.value })} placeholder="Nama bank / no. rekening" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Foto Nota / Struk <span className="text-gray-400 font-normal text-xs">(bisa lebih dari 1)</span></Label>
              <input
                ref={receiptInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files?.length) handleReceiptUpload(e.target.files); e.target.value = ""; }}
              />
              {form.receiptUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {form.receiptUrls.map((url, idx) => (
                    <div key={idx} className="relative border rounded-lg overflow-hidden bg-gray-50 aspect-square">
                      <img
                        src={url}
                        alt={`Nota ${idx + 1}`}
                        className="w-full h-full object-cover bg-white"
                        onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"
                        onClick={() => removeReceiptUrl(idx)}
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[10px] px-1 py-0.5 text-center truncate">
                        Foto {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={uploadingReceipt}
                className="w-full border-2 border-dashed border-gray-200 rounded-lg p-4 flex flex-col items-center gap-2 text-gray-400 hover:border-orange-300 hover:text-orange-500 transition-colors disabled:opacity-60 cursor-pointer"
              >
                {uploadingReceipt ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                    <span className="text-sm font-medium text-orange-500">Mengupload...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    <span className="text-sm font-medium">{form.receiptUrls.length > 0 ? "Tambah foto lagi" : "Klik untuk upload foto nota"}</span>
                    <span className="text-xs">JPG, PNG, WebP — maks 10 MB per foto</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-1">
              <Label>Catatan</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Catatan tambahan..." rows={2} />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => { setFormOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }}>
                Batal
              </Button>
              <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white font-bold" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingId ? "Simpan Perubahan" : "Buat Pengeluaran"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black flex items-center gap-2">
              <Receipt className="w-5 h-5 text-orange-500" />
              Detail Pengeluaran
            </DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-orange-600">{detail.expenseNo}</span>
                <Badge className={`${STATUS_COLORS[detail.paymentStatus]}`}>{STATUS_LABELS[detail.paymentStatus]}</Badge>
              </div>

              {detail.coaAccount && (
                <div className="p-3 rounded-lg bg-orange-50 border border-orange-100">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Akun COA</p>
                  <p className="font-bold text-gray-900 text-sm">
                    {detail.coaAccount.code} — {detail.coaAccount.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={`text-[10px] ${ACCOUNT_TYPE_COLORS[detail.coaAccount.accountType] ?? "bg-gray-100"}`}>
                      {ACCOUNT_TYPE_LABELS[detail.coaAccount.accountType] ?? detail.coaAccount.accountType}
                    </Badge>
                    {JOURNAL_TYPE_INFO[detail.coaAccount.accountType] && (
                      <span className="text-xs text-gray-500">{JOURNAL_TYPE_INFO[detail.coaAccount.accountType]?.desc}</span>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Tanggal</span><p className="font-semibold">{detail.expenseDate}</p></div>
                <div><span className="text-gray-500">Kategori</span><p className="font-semibold">{detail.category}</p></div>
                <div className="col-span-2"><span className="text-gray-500">Deskripsi</span><p className="font-semibold">{detail.description}</p></div>
                {detail.vendorName && <div><span className="text-gray-500">Vendor</span><p className="font-semibold">{detail.vendorName}</p></div>}
                {detail.facilityName && <div><span className="text-gray-500">Fasilitas</span><p className="font-semibold">{detail.facilityName}</p></div>}
                <div><span className="text-gray-500">Nominal</span><p className="font-semibold">{formatIDR(detail.amount)}</p></div>
                {detail.ppnAmount > 0 && <div><span className="text-gray-500">PPN Masukan</span><p className="font-semibold">{formatIDR(detail.ppnAmount)}</p></div>}
                <div><span className="text-gray-500">Total</span><p className="font-black text-orange-600 text-base">{formatIDR(detail.totalAmount)}</p></div>
                {detail.paymentMethod && <div><span className="text-gray-500">Metode</span><p className="font-semibold">{detail.paymentMethod}</p></div>}
                {detail.paymentAccount && <div><span className="text-gray-500">Rekening</span><p className="font-semibold">{detail.paymentAccount}</p></div>}
                {detail.journalId && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Jurnal</span>
                    <p className="font-mono text-xs font-bold text-green-700">{detail.journalId}</p>
                  </div>
                )}
                {detail.createdByName && <div><span className="text-gray-500">Dibuat oleh</span><p className="font-semibold">{detail.createdByName}</p></div>}
                {detail.approvedByName && <div><span className="text-gray-500">Disetujui oleh</span><p className="font-semibold">{detail.approvedByName}</p></div>}
                {detail.approvedAt && <div><span className="text-gray-500">Disetujui pada</span><p className="font-semibold">{new Date(detail.approvedAt).toLocaleDateString("id-ID")}</p></div>}
                {detail.paidAt && <div><span className="text-gray-500">Dibayar pada</span><p className="font-semibold">{new Date(detail.paidAt).toLocaleDateString("id-ID")}</p></div>}
                {detail.rejectedReason && <div className="col-span-2"><span className="text-gray-500">Alasan ditolak</span><p className="font-semibold text-red-600">{detail.rejectedReason}</p></div>}
                {detail.notes && <div className="col-span-2"><span className="text-gray-500">Catatan</span><p className="font-semibold">{detail.notes}</p></div>}
                {(() => {
                  const photos: string[] = Array.isArray(detail.receiptUrls) && detail.receiptUrls.length > 0
                    ? detail.receiptUrls
                    : detail.receiptUrl ? [detail.receiptUrl] : [];
                  return photos.length > 0 ? (
                    <div className="col-span-2">
                      <span className="text-gray-500">Nota / Struk ({photos.length} foto)</span>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        {photos.map((url: string, idx: number) => (
                          <div key={idx} className="border rounded-lg overflow-hidden bg-gray-50">
                            <img
                              src={url}
                              alt={`Nota ${idx + 1}`}
                              className="w-full max-h-40 object-contain bg-white"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>

              <div className="flex gap-2 pt-2 flex-wrap">
                {detail.paymentStatus === "draft" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setDetailOpen(false); openEdit(detail); }}>
                      <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      className="bg-yellow-500 hover:bg-yellow-600 text-white"
                      onClick={() => statusMutation.mutate({ id: detail.id, action: "submit" })}
                    >
                      Ajukan Approval
                    </Button>
                    <Button
                      size="sm" variant="destructive"
                      onClick={() => { setDeleteConfirmId(detail.id); setDeleteConfirmNo(detail.expenseNo); }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Hapus
                    </Button>
                  </>
                )}
                {detail.paymentStatus === "pending_approval" && (
                  <>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => statusMutation.mutate({ id: detail.id, action: "approve" })}
                    >
                      <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Setujui
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => { setRejectTargetId(detail.id); setRejectOpen(true); }}>
                      <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Tolak
                    </Button>
                  </>
                )}
                {detail.paymentStatus === "approved" && (
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => statusMutation.mutate({ id: detail.id, action: "pay" })}
                  >
                    <Banknote className="w-3.5 h-3.5 mr-1" /> Tandai Dibayar
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-gray-400">Memuat detail...</div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black text-red-600">Tolak Pengeluaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Alasan Penolakan <span className="text-red-500">*</span></Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Jelaskan alasan penolakan..."
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejectOpen(false)}>Batal</Button>
              <Button
                variant="destructive"
                disabled={!rejectReason.trim() || statusMutation.isPending}
                onClick={() => {
                  if (rejectTargetId) {
                    statusMutation.mutate({ id: rejectTargetId, action: "reject", rejectedReason: rejectReason });
                  }
                }}
              >
                Tolak
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(o) => { if (!o) { setDeleteConfirmId(null); setDeleteConfirmNo(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black text-red-600">Hapus Pengeluaran</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Yakin ingin menghapus <span className="font-bold text-orange-600">{deleteConfirmNo}</span>? Tindakan ini tidak bisa dibatalkan.
          </p>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => { setDeleteConfirmId(null); setDeleteConfirmNo(""); }}>Batal</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId); }}
            >
              Hapus
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
