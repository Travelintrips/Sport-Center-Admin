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
import { Plus, Search, Edit2, Power, Trash2, Store, Phone, Mail, MapPin } from "lucide-react";

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
    queryKey: ["admin-vendors"],
    queryFn: () =>
      fetch(`${API}/admin/vendors`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : [])),
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) =>
      fetch(`${API}/admin/vendors`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify(body),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal membuat vendor");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-vendors"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setFormOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      toast({ title: "Vendor berhasil ditambahkan" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<typeof EMPTY_FORM> }) =>
      fetch(`${API}/admin/vendors/${id}`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify(body),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal update vendor");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-vendors"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setFormOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      toast({ title: "Vendor berhasil diupdate" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      fetch(`${API}/admin/vendors/${id}`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ isActive }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal update status");
        return d;
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-vendors"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast({ title: vars.isActive ? "Vendor diaktifkan" : "Vendor dinonaktifkan" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/admin/vendors/${id}`, { method: "DELETE", headers: authHeaders() }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Gagal menghapus vendor");
        return d;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-vendors"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      setDeleteConfirmId(null);
      setDeleteConfirmName("");
      toast({ title: "Vendor berhasil dihapus" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = vendors.filter((v) => {
    const matchSearch = !search || v.name.toLowerCase().includes(search.toLowerCase()) ||
      (v.contactPerson ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (v.phone ?? "").includes(search) ||
      (v.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || (filterStatus === "active" ? v.isActive : !v.isActive);
    return matchSearch && matchStatus;
  });

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormOpen(true);
  }

  function openEdit(v: Vendor) {
    setEditingId(v.id);
    setForm({
      name: v.name,
      contactPerson: v.contactPerson ?? "",
      phone: v.phone ?? "",
      email: v.email ?? "",
      address: v.address ?? "",
      notes: v.notes ?? "",
      isActive: v.isActive,
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
      createMutation.mutate(body as any);
    }
  }

  const activeCount = vendors.filter((v) => v.isActive).length;
  const inactiveCount = vendors.filter((v) => !v.isActive).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Daftar Vendor</h1>
          <p className="text-gray-500 text-sm mt-0.5">Kelola master vendor untuk pengeluaran Sport Center</p>
        </div>
        <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white font-bold">
          <Plus className="w-4 h-4 mr-2" /> Tambah Vendor
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Store className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-gray-500 font-medium">Total Vendor</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{vendors.length}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Power className="w-4 h-4 text-green-500" />
              <span className="text-xs text-gray-500 font-medium">Aktif</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{activeCount}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-gray-400">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Power className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">Nonaktif</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{inactiveCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Cari nama, contact, telepon, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {(["all", "active", "inactive"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${filterStatus === s ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                >
                  {s === "all" ? "Semua" : s === "active" ? "Aktif" : "Nonaktif"}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

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
              {vendors.length === 0 ? "Belum ada vendor. Tambahkan vendor pertama Anda!" : "Tidak ada vendor yang sesuai filter."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Nama Vendor</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Contact Info</th>
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
                          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                            <Store className="w-4 h-4 text-orange-500" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{vendor.name}</p>
                            {vendor.contactPerson && (
                              <p className="text-xs text-gray-500">{vendor.contactPerson}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {vendor.phone && (
                            <div className="flex items-center gap-1 text-xs text-gray-600">
                              <Phone className="w-3 h-3 text-gray-400" />
                              {vendor.phone}
                            </div>
                          )}
                          {vendor.email && (
                            <div className="flex items-center gap-1 text-xs text-gray-600">
                              <Mail className="w-3 h-3 text-gray-400" />
                              {vendor.email}
                            </div>
                          )}
                          {!vendor.phone && !vendor.email && <span className="text-xs text-gray-400">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {vendor.address ? (
                          <div className="flex items-start gap-1 text-xs text-gray-600 max-w-[180px]">
                            <MapPin className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{vendor.address}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
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
                            title="Edit"
                            onClick={() => openEdit(vendor)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className={`h-7 w-7 p-0 ${vendor.isActive ? "text-amber-400 hover:text-amber-600" : "text-green-400 hover:text-green-600"}`}
                            title={vendor.isActive ? "Nonaktifkan" : "Aktifkan"}
                            onClick={() => toggleActiveMutation.mutate({ id: vendor.id, isActive: !vendor.isActive })}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                            title="Hapus"
                            onClick={() => { setDeleteConfirmId(vendor.id); setDeleteConfirmName(vendor.name); }}
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
                placeholder="Contoh: CV Maju Jaya Mandiri"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Contact Person</Label>
                <Input
                  value={form.contactPerson}
                  onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                  placeholder="Nama PIC"
                />
              </div>
              <div className="space-y-1">
                <Label>Telepon</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="08xxxxxxxxxx"
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
            {editingId && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border">
                <span className="text-sm font-medium text-gray-700">Status:</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, isActive: !form.isActive })}
                  className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${form.isActive ? "bg-green-500" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                <span className={`text-sm font-semibold ${form.isActive ? "text-green-600" : "text-gray-500"}`}>
                  {form.isActive ? "Aktif" : "Nonaktif"}
                </span>
              </div>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => { setFormOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }}>
                Batal
              </Button>
              <Button
                type="submit"
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editingId ? "Simpan Perubahan" : "Tambah Vendor"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={(o) => { if (!o) { setDeleteConfirmId(null); setDeleteConfirmName(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black text-red-600">Hapus Vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Apakah Anda yakin ingin menghapus vendor <strong>"{deleteConfirmName}"</strong>?
              Tindakan ini tidak bisa dibatalkan.
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
              Pengeluaran yang sudah menggunakan vendor ini akan tetap menyimpan nama vendor sebagai snapshot.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setDeleteConfirmId(null); setDeleteConfirmName(""); }}>Batal</Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => { if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId); }}
              >
                Hapus
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
