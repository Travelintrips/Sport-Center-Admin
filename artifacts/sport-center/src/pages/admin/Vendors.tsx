import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, UserCheck, UserX, Building2, Phone, Mail, MapPin } from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

interface Vendor {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_FORM = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  isActive: true,
};

export default function AdminVendors() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  const { data: vendors = [], isLoading } = useQuery<Vendor[]>({
    queryKey: ["vendors-admin"],
    queryFn: () =>
      fetch(`${API}/admin/vendors`, { headers: authHeaders() }).then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API}/admin/vendors`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal membuat vendor");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors-admin"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setFormOpen(false);
      setForm({ ...EMPTY_FORM });
      toast({ title: "Vendor berhasil ditambahkan" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      fetch(`${API}/admin/vendors/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body) }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal update vendor");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors-admin"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setFormOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      toast({ title: "Vendor berhasil diupdate" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/admin/vendors/${id}`, { method: "DELETE", headers: authHeaders() }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal hapus vendor");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors-admin"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setDeleteConfirmId(null);
      setDeleteConfirmName("");
      toast({ title: "Vendor berhasil dihapus" });
    },
    onError: (e: any) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      fetch(`${API}/admin/vendors/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ isActive }) }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal update status vendor");
        return d;
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["vendors-admin"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast({ title: vars.isActive ? "Vendor diaktifkan" : "Vendor dinonaktifkan" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormOpen(true);
  }

  function openEdit(vendor: Vendor) {
    setEditingId(vendor.id);
    setForm({
      name: vendor.name,
      contactPerson: vendor.contactPerson ?? "",
      phone: vendor.phone ?? "",
      email: vendor.email ?? "",
      address: vendor.address ?? "",
      notes: vendor.notes ?? "",
      isActive: vendor.isActive,
    });
    setFormOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Nama vendor wajib diisi", variant: "destructive" });
      return;
    }
    const body = {
      name: form.name.trim(),
      contactPerson: form.contactPerson || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      notes: form.notes || null,
      isActive: form.isActive,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const filtered = vendors.filter((v) => {
    const q = search.toLowerCase();
    const matchSearch = !search || v.name.toLowerCase().includes(q) || (v.contactPerson ?? "").toLowerCase().includes(q) || (v.phone ?? "").includes(q);
    const matchStatus = filterStatus === "all" || (filterStatus === "active" ? v.isActive : !v.isActive);
    return matchSearch && matchStatus;
  });

  const activeCount = vendors.filter((v) => v.isActive).length;
  const inactiveCount = vendors.filter((v) => !v.isActive).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Daftar Vendor</h1>
          <p className="text-gray-500 text-sm mt-0.5">Kelola master vendor / supplier pengeluaran</p>
        </div>
        <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white font-bold">
          <Plus className="w-4 h-4 mr-2" /> Tambah Vendor
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-gray-500 font-medium">Total Vendor</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{vendors.length}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <UserCheck className="w-4 h-4 text-green-500" />
              <span className="text-xs text-gray-500 font-medium">Aktif</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{activeCount}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-gray-400">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <UserX className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">Nonaktif</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{inactiveCount}</p>
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
                placeholder="Cari nama vendor, kontak..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              {(["all", "active", "inactive"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    filterStatus === s
                      ? "bg-orange-500 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {s === "all" ? "Semua" : s === "active" ? "Aktif" : "Nonaktif"}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">
            Vendor <span className="text-gray-400 font-normal">({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-gray-400">Memuat data...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              {vendors.length === 0 ? (
                <div className="space-y-2">
                  <Building2 className="w-10 h-10 mx-auto text-gray-200" />
                  <p className="font-medium">Belum ada vendor</p>
                  <p className="text-sm">Tambahkan vendor pertama untuk mulai mengelola pengeluaran</p>
                  <Button onClick={openCreate} className="mt-2 bg-orange-500 hover:bg-orange-600 text-white">
                    <Plus className="w-4 h-4 mr-2" /> Tambah Vendor
                  </Button>
                </div>
              ) : "Tidak ada vendor yang cocok dengan filter"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Nama Vendor</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Contact Person</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Telepon / Email</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Alamat</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600">Status</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((vendor) => (
                    <tr key={vendor.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                            <Building2 className="w-4 h-4 text-orange-500" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{vendor.name}</p>
                            {vendor.notes && <p className="text-xs text-gray-400 truncate max-w-[150px]">{vendor.notes}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{vendor.contactPerson ?? "-"}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {vendor.phone && (
                            <div className="flex items-center gap-1 text-gray-600">
                              <Phone className="w-3 h-3 text-gray-400" />
                              <span className="text-xs">{vendor.phone}</span>
                            </div>
                          )}
                          {vendor.email && (
                            <div className="flex items-center gap-1 text-gray-600">
                              <Mail className="w-3 h-3 text-gray-400" />
                              <span className="text-xs">{vendor.email}</span>
                            </div>
                          )}
                          {!vendor.phone && !vendor.email && <span className="text-gray-400">-</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {vendor.address ? (
                          <div className="flex items-start gap-1 text-gray-600 max-w-[180px]">
                            <MapPin className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
                            <span className="text-xs line-clamp-2">{vendor.address}</span>
                          </div>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={vendor.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}>
                          {vendor.isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-blue-400 hover:text-blue-600"
                            onClick={() => openEdit(vendor)}
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className={`h-7 w-7 p-0 ${vendor.isActive ? "text-gray-400 hover:text-yellow-600" : "text-gray-400 hover:text-green-600"}`}
                            onClick={() => toggleActiveMutation.mutate({ id: vendor.id, isActive: !vendor.isActive })}
                            title={vendor.isActive ? "Nonaktifkan" : "Aktifkan"}
                            disabled={toggleActiveMutation.isPending}
                          >
                            {vendor.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                            onClick={() => { setDeleteConfirmId(vendor.id); setDeleteConfirmName(vendor.name); }}
                            title="Hapus"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-black">{editingId ? "Edit Vendor" : "Tambah Vendor"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1">
              <Label>Nama Vendor <span className="text-red-500">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Contoh: PT. Maju Jaya"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Contact Person</Label>
                <Input
                  value={form.contactPerson}
                  onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                  placeholder="Nama kontak"
                />
              </div>
              <div className="space-y-1">
                <Label>Telepon</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="08xx-xxxx-xxxx"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="vendor@email.com"
              />
            </div>

            <div className="space-y-1">
              <Label>Alamat</Label>
              <Textarea
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Alamat lengkap vendor..."
                rows={2}
              />
            </div>

            <div className="space-y-1">
              <Label>Catatan</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Catatan tambahan..."
                rows={2}
              />
            </div>

            <div className="flex items-center gap-3">
              <Label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 accent-orange-500"
                />
                <span>Vendor Aktif</span>
              </Label>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => { setFormOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }}>
                Batal
              </Button>
              <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white font-bold" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingId ? "Simpan Perubahan" : "Tambah Vendor"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(o) => { if (!o) { setDeleteConfirmId(null); setDeleteConfirmName(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black text-red-600">Hapus Vendor</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            Yakin ingin menghapus vendor <span className="font-bold text-orange-600">"{deleteConfirmName}"</span>? Tindakan ini tidak bisa dibatalkan.
          </p>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
            Perhatian: Pengeluaran yang sudah memakai vendor ini akan tetap menyimpan nama vendor, tapi FK akan dihapus.
          </p>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => { setDeleteConfirmId(null); setDeleteConfirmName(""); }}>Batal</Button>
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
