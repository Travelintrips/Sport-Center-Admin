import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Filter, TrendingDown, Clock, CheckCircle2, XCircle,
  Eye, Edit2, ThumbsUp, ThumbsDown, Banknote, X, Receipt,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

const CATEGORIES = [
  "Alat Gym",
  "Bola & Peralatan Olahraga",
  "Perbaikan Lapangan",
  "Maintenance Fasilitas",
  "Listrik & Air",
  "Kebersihan",
  "Gaji / Fee Staff",
  "Sewa / Vendor",
  "Lain-lain",
];

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

function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

const EMPTY_FORM = {
  expenseDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }),
  category: "",
  description: "",
  vendorName: "",
  facilityId: "",
  amount: "",
  ppnAmount: "",
  paymentMethod: "",
  paymentAccount: "",
  receiptUrl: "",
  notes: "",
};

export default function AdminExpenses() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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

  const summary = data?.summary ?? { totalThisMonth: 0, pendingApproval: 0, paid: 0, unpaid: 0 };
  const allExpenses: any[] = data?.expenses ?? [];

  const filtered = allExpenses.filter((e: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.expenseNo?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.vendorName?.toLowerCase().includes(q) ||
      e.category?.toLowerCase().includes(q)
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
      category: expense.category ?? "",
      description: expense.description ?? "",
      vendorName: expense.vendorName ?? "",
      facilityId: expense.facilityId ? String(expense.facilityId) : "",
      amount: String(expense.amount ?? ""),
      ppnAmount: String(expense.ppnAmount ?? "0"),
      paymentMethod: expense.paymentMethod ?? "",
      paymentAccount: expense.paymentAccount ?? "",
      receiptUrl: expense.receiptUrl ?? "",
      notes: expense.notes ?? "",
    });
    setFormOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      expenseDate: form.expenseDate,
      category: form.category,
      description: form.description,
      vendorName: form.vendorName || null,
      facilityId: form.facilityId ? Number(form.facilityId) : null,
      amount: Number(form.amount),
      ppnAmount: Number(form.ppnAmount || 0),
      paymentMethod: form.paymentMethod || null,
      paymentAccount: form.paymentAccount || null,
      receiptUrl: form.receiptUrl || null,
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
                placeholder="Cari nomor, deskripsi, vendor..."
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
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kategori</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[150px]" placeholder="Dari" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[150px]" placeholder="Sampai" />
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
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Kategori</th>
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
                        <Badge variant="outline" className="text-xs">{expense.category}</Badge>
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
                          {["draft", "rejected"].includes(expense.paymentStatus) && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-blue-400 hover:text-blue-600"
                              onClick={() => openEdit(expense)}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {expense.paymentStatus === "draft" && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-xs text-yellow-600 hover:text-yellow-700"
                              onClick={() => statusMutation.mutate({ id: expense.id, action: "submit" })}
                            >
                              Ajukan
                            </Button>
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
                <Label>Kategori <span className="text-red-500">*</span></Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
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
                <Label>Vendor / Supplier</Label>
                <Input value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} placeholder="Nama vendor" />
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

            <div className="space-y-1">
              <Label>URL Nota / Struk</Label>
              <Input value={form.receiptUrl} onChange={(e) => setForm({ ...form, receiptUrl: e.target.value })} placeholder="https://..." />
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
                {detail.createdByName && <div><span className="text-gray-500">Dibuat oleh</span><p className="font-semibold">{detail.createdByName}</p></div>}
                {detail.approvedByName && <div><span className="text-gray-500">Disetujui oleh</span><p className="font-semibold">{detail.approvedByName}</p></div>}
                {detail.approvedAt && <div><span className="text-gray-500">Disetujui pada</span><p className="font-semibold">{new Date(detail.approvedAt).toLocaleDateString("id-ID")}</p></div>}
                {detail.paidAt && <div><span className="text-gray-500">Dibayar pada</span><p className="font-semibold">{new Date(detail.paidAt).toLocaleDateString("id-ID")}</p></div>}
                {detail.rejectedReason && <div className="col-span-2"><span className="text-gray-500">Alasan ditolak</span><p className="font-semibold text-red-600">{detail.rejectedReason}</p></div>}
                {detail.notes && <div className="col-span-2"><span className="text-gray-500">Catatan</span><p className="font-semibold">{detail.notes}</p></div>}
                {detail.receiptUrl && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Nota / Struk</span>
                    <a href={detail.receiptUrl} target="_blank" rel="noopener noreferrer" className="block text-blue-600 underline font-semibold text-sm mt-0.5 truncate">
                      Lihat Nota
                    </a>
                  </div>
                )}
                {detail.journalId && <div className="col-span-2"><span className="text-gray-500">Journal ID</span><p className="font-mono text-xs text-gray-700">{detail.journalId}</p></div>}
              </div>

              {/* Action buttons in detail */}
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {["draft", "rejected"].includes(detail.paymentStatus) && (
                  <Button size="sm" variant="outline" onClick={() => { openEdit(detail); setDetailOpen(false); }}>
                    <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                )}
                {detail.paymentStatus === "draft" && (
                  <Button size="sm" className="bg-yellow-500 hover:bg-yellow-600 text-white"
                    onClick={() => statusMutation.mutate({ id: detail.id, action: "submit" })}>
                    Ajukan Approval
                  </Button>
                )}
                {detail.paymentStatus === "pending_approval" && (
                  <>
                    <Button size="sm" className="bg-green-500 hover:bg-green-600 text-white"
                      onClick={() => statusMutation.mutate({ id: detail.id, action: "approve" })}>
                      <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Setujui
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-500 border-red-300"
                      onClick={() => { setRejectTargetId(detail.id); setDetailOpen(false); setRejectOpen(true); }}>
                      <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Tolak
                    </Button>
                  </>
                )}
                {detail.paymentStatus === "approved" && (
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => statusMutation.mutate({ id: detail.id, action: "pay" })}>
                    <Banknote className="w-3.5 h-3.5 mr-1" /> Tandai Sudah Dibayar
                  </Button>
                )}
                {["draft", "pending_approval", "approved"].includes(detail.paymentStatus) && (
                  <Button size="sm" variant="ghost" className="text-gray-400"
                    onClick={() => statusMutation.mutate({ id: detail.id, action: "cancel" })}>
                    <X className="w-3.5 h-3.5 mr-1" /> Batalkan
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-gray-400">Memuat detail...</div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black text-red-600">Tolak Pengeluaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Alasan Penolakan</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Tuliskan alasan penolakan..."
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setRejectOpen(false); setRejectReason(""); }} className="flex-1">Batal</Button>
              <Button
                className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                onClick={() => {
                  if (rejectTargetId) {
                    statusMutation.mutate({ id: rejectTargetId, action: "reject", rejectedReason: rejectReason });
                  }
                }}
                disabled={statusMutation.isPending}
              >
                Tolak
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
