import { useState } from "react";
import {
  useListApMembers,
  useCreateApMember,
  useUpdateApMember,
  useDeleteApMember,
  getListApMembersQueryKey,
} from "@workspace/api-client-react";
import type { ApMember } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plane, Search, Trash2, Plus, Pencil, IdCard } from "lucide-react";

type FormState = { name: string; idCardNumber: string; phone: string; email: string; isActive: boolean };
const emptyForm: FormState = { name: "", idCardNumber: "", phone: "", email: "", isActive: true };

export default function AdminApMembers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ApMember | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const { data: members, isLoading } = useListApMembers(search ? { search } : undefined);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListApMembersQueryKey() });

  const createMutation = useCreateApMember({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Member ditambahkan" }); setDialogOpen(false); },
      onError: (e: any) => toast({ title: "Gagal menambah", description: e?.message, variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateApMember({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Member diperbarui" }); setDialogOpen(false); },
      onError: (e: any) => toast({ title: "Gagal memperbarui", description: e?.message, variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteApMember({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Member dihapus" }); setDeleteId(null); },
      onError: () => toast({ title: "Gagal menghapus", variant: "destructive" }),
    },
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (m: ApMember) => {
    setEditing(m);
    setForm({ name: m.name, idCardNumber: m.idCardNumber, phone: m.phone ?? "", email: m.email ?? "", isActive: m.isActive });
    setDialogOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.idCardNumber.trim()) {
      toast({ title: "Nama & Nomor ID Card wajib diisi", variant: "destructive" });
      return;
    }
    const data = {
      name: form.name.trim(),
      idCardNumber: form.idCardNumber.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      isActive: form.isActive,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate({ data });
  };

  const list = members || [];
  const totalActive = list.filter((m) => m.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Plane size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Member Angkasa Pura</h1>
            <p className="text-muted-foreground text-sm">Kelola data karyawan Angkasa Pura untuk verifikasi ID Card</p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} className="mr-1.5" /> Tambah Member
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <IdCard size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold">{list.length}</div>
              <div className="text-sm text-muted-foreground">Total Member</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-green-600">
              <Plane size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold">{totalActive}</div>
              <div className="text-sm text-muted-foreground">Member Aktif</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari nama atau nomor ID Card..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Plane size={40} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium">Belum ada member</p>
          <p className="text-sm mt-1">Tambah member Angkasa Pura untuk mulai verifikasi</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-3 font-semibold">Nama</th>
                <th className="text-left px-4 py-3 font-semibold">No. ID Card</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Kontak</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-4 font-medium">{m.name}</td>
                  <td className="px-4 py-4 font-mono">{m.idCardNumber}</td>
                  <td className="px-4 py-4 hidden md:table-cell">
                    <div>{m.email || "-"}</div>
                    <div className="text-xs text-muted-foreground">{m.phone || "-"}</div>
                  </td>
                  <td className="px-4 py-4">
                    {m.isActive
                      ? <Badge className="bg-green-100 text-green-700 border-green-200">Aktif</Badge>
                      : <Badge className="bg-gray-100 text-gray-600 border-gray-200">Nonaktif</Badge>}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(m)}>
                        <Pencil size={15} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteId(m.id)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Member" : "Tambah Member"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Nama Lengkap <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nama karyawan" />
            </div>
            <div className="space-y-2">
              <Label>Nomor ID Card <span className="text-destructive">*</span></Label>
              <Input value={form.idCardNumber} onChange={(e) => setForm(f => ({ ...f, idCardNumber: e.target.value.toUpperCase() }))} placeholder="AP-2024-001" className="font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Telepon</Label>
                <Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08..." />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@..." />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="ap-active" className="cursor-pointer">Status Aktif</Label>
              <Switch id="ap-active" checked={form.isActive} onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Member</AlertDialogTitle>
            <AlertDialogDescription>
              Yakin ingin menghapus member ini? Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
