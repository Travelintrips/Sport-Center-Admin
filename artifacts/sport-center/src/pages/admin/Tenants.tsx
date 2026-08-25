import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Search, Plus, Building2, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API = "/api";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` });

async function fetchTenants() {
  const res = await fetch(`${API}/admin/tenants`, { headers: headers() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function createTenant(data: any) {
  const res = await fetch(`${API}/admin/tenants`, { method: "POST", headers: headers(), body: JSON.stringify(data) });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
  return res.json();
}

async function updateTenantStatus(id: number, status: string) {
  const res = await fetch(`${API}/admin/tenants/${id}/status`, { method: "PUT", headers: headers(), body: JSON.stringify({ status }) });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

const STATUS_BADGE: Record<string, string> = {
  pending:  "bg-yellow-100 text-yellow-700 border-yellow-200",
  active:   "bg-green-100 text-green-700 border-green-200",
  inactive: "bg-gray-100 text-gray-600 border-gray-200",
};
const STATUS_LABEL: Record<string, string> = { pending: "Pending", active: "Aktif", inactive: "Non-aktif" };

export default function AdminTenants() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [viewTenant, setViewTenant] = useState<any>(null);

  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", businessName: "", ownerName: "", businessCategory: "", address: "" });

  const { data: tenants = [], isLoading } = useQuery({ queryKey: ["admin-tenants"], queryFn: fetchTenants });

  const createMutation = useMutation({
    mutationFn: createTenant,
    onSuccess: () => {
      toast({ title: "Berhasil!", description: "Akun tenan berhasil dibuat." });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
      setShowCreate(false);
      setForm({ name: "", email: "", password: "", phone: "", businessName: "", ownerName: "", businessCategory: "", address: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateTenantStatus(id, status),
    onSuccess: () => { toast({ title: "Status diperbarui" }); qc.invalidateQueries({ queryKey: ["admin-tenants"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = (tenants as any[]).filter((t) =>
    t.businessName.toLowerCase().includes(search.toLowerCase()) ||
    t.ownerName.toLowerCase().includes(search.toLowerCase()) ||
    (t.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    if (!form.name || !form.email || !form.password || !form.businessName || !form.ownerName) {
      toast({ title: "Wajib isi", description: "Semua field dengan * wajib diisi.", variant: "destructive" }); return;
    }
    createMutation.mutate(form);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">Penyewa Tenan</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Kelola akun dan status tenan</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="rounded-full px-5 font-bold shadow-md shadow-primary/20">
          <Plus size={15} className="mr-2" /> Tambah Tenan
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari bisnis, pemilik, email..." className="pl-9" />
      </div>

      {/* Table */}
      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Building2 size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{search ? "Tidak ada hasil pencarian." : "Belum ada tenan terdaftar."}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {filtered.map((tenant: any) => (
                <div key={tenant.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 size={18} className="text-primary" />
                    </div>
                    <div>
                      <div className="font-black text-sm">{tenant.businessName}</div>
                      <div className="text-xs text-muted-foreground">{tenant.ownerName} · {tenant.email || "-"}</div>
                      {tenant.businessCategory && <div className="text-[10px] text-muted-foreground mt-0.5">{tenant.businessCategory}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-13 sm:ml-0">
                    <Badge variant="outline" className={`text-xs font-bold ${STATUS_BADGE[tenant.status] || ""}`}>
                      {STATUS_LABEL[tenant.status] || tenant.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{tenant.bookingCount} pemesanan</span>
                    <Select
                      value={tenant.status}
                      onValueChange={(val) => statusMutation.mutate({ id: tenant.id, status: val })}
                    >
                      <SelectTrigger className="h-8 text-xs w-28 rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="active">Aktif</SelectItem>
                        <SelectItem value="inactive">Non-aktif</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl" onClick={() => setViewTenant(tenant)}>
                      <Eye size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black">Tambah Tenan Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Akun Login</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Nama Lengkap *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="John Doe" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Email *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="john@email.com" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Password *</Label>
                <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">No. HP</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08xx" className="mt-1" />
              </div>
            </div>
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-2">Profil Bisnis</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Nama Bisnis *</Label>
                <Input value={form.businessName} onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} placeholder="Toko Sport Jaya" className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Nama Pemilik *</Label>
                <Input value={form.ownerName} onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))} placeholder="Budi Santoso" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Kategori Bisnis</Label>
                <Input value={form.businessCategory} onChange={e => setForm(f => ({ ...f, businessCategory: e.target.value }))} placeholder="F&B, Retail, Jasa..." className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Alamat</Label>
                <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Jl. ..." className="mt-1" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleCreate} disabled={createMutation.isPending} className="rounded-full px-6 font-bold">
                {createMutation.isPending ? "Menyimpan..." : "Buat Akun Tenan"}
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)} className="rounded-full px-6">Batal</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Detail Dialog */}
      <Dialog open={!!viewTenant} onOpenChange={() => setViewTenant(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black">{viewTenant?.businessName}</DialogTitle>
          </DialogHeader>
          {viewTenant && (
            <div className="space-y-3 text-sm mt-2">
              {[
                ["Nama Tenan", viewTenant.businessName],
                ["Pengguna Tenan", viewTenant.ownerName],
                ["Email", viewTenant.email || "-"],
                ["Nama Usaha", viewTenant.businessName],
                ["No. HP", viewTenant.phone || "-"],
                ["Kategori", viewTenant.businessCategory || "-"],
                ["Alamat", viewTenant.address || "-"],
                ["Status Tenan", STATUS_LABEL[viewTenant.status] || viewTenant.status],
                ["Terdaftar", new Date(viewTenant.createdAt).toLocaleDateString("id-ID")],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">{k}</span>
                  <span className="font-semibold text-right">{v}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
