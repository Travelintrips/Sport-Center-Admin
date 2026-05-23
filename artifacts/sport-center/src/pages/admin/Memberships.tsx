import { useState } from "react";
import { useListMemberships, useUpdateMembership, useDeleteMembership, getListMembershipsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Users, Search, Trash2, CheckCircle, XCircle, Clock, Dumbbell } from "lucide-react";

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge className="bg-green-100 text-green-700 border-green-200">Aktif</Badge>;
  if (status === "expired") return <Badge className="bg-gray-100 text-gray-600 border-gray-200">Kadaluarsa</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200">Dibatalkan</Badge>;
}

export default function AdminMemberships() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [viewMember, setViewMember] = useState<any>(null);

  const { data: memberships, isLoading } = useListMemberships({});

  const updateMutation = useUpdateMembership({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembershipsQueryKey() });
        toast({ title: "Status berhasil diperbarui" });
        setViewMember(null);
      },
      onError: () => { toast({ title: "Gagal memperbarui", variant: "destructive" }); },
    },
  });

  const deleteMutation = useDeleteMembership({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembershipsQueryKey() });
        toast({ title: "Member berhasil dihapus" });
        setDeleteId(null);
      },
      onError: () => { toast({ title: "Gagal menghapus", variant: "destructive" }); },
    },
  });

  const filtered = (memberships || []).filter((m) => {
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase()) || m.phone.includes(search);
    const matchStatus = filterStatus === "all" || m.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const totalActive = (memberships || []).filter((m) => m.status === "active").length;
  const totalRevenue = (memberships || []).reduce((s, m) => s + m.totalPrice, 0);

  function handleUpdateStatus(id: number, status: string) {
    updateMutation.mutate({ id, data: { status: status as any } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Dumbbell size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Member Gym Bulanan</h1>
          <p className="text-muted-foreground text-sm">Kelola data member gym per bulan</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-green-600">
              <CheckCircle size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold">{totalActive}</div>
              <div className="text-sm text-muted-foreground">Member Aktif</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Users size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold">{(memberships || []).length}</div>
              <div className="text-sm text-muted-foreground">Total Member</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
              <Dumbbell size={20} />
            </div>
            <div>
              <div className="text-lg font-bold">{formatCurrency(totalRevenue)}</div>
              <div className="text-sm text-muted-foreground">Total Revenue</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nama, email, atau telepon..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="expired">Kadaluarsa</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Dumbbell size={40} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium">Tidak ada data member</p>
          <p className="text-sm mt-1">Member yang mendaftar akan muncul di sini</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-3 font-semibold">Member</th>
                <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Kontak</th>
                <th className="text-left px-4 py-3 font-semibold hidden sm:table-cell">Periode</th>
                <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Bayar</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-4">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground md:hidden">{m.email}</div>
                  </td>
                  <td className="px-4 py-4 hidden md:table-cell">
                    <div>{m.email}</div>
                    <div className="text-xs text-muted-foreground">{m.phone}</div>
                  </td>
                  <td className="px-4 py-4 hidden sm:table-cell">
                    <div>{m.startDate}</div>
                    <div className="text-xs text-muted-foreground">s/d {m.endDate}</div>
                  </td>
                  <td className="px-4 py-4 hidden lg:table-cell font-semibold text-primary">
                    {formatCurrency(m.totalPrice)}
                    <div className="text-xs font-normal text-muted-foreground">{m.months} bulan</div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setViewMember(m)}>
                        Detail
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

      {viewMember && (
        <Dialog open={!!viewMember} onOpenChange={() => setViewMember(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Detail Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-muted-foreground">Nama</div>
                <div className="font-medium">{viewMember.name}</div>
                <div className="text-muted-foreground">Email</div>
                <div className="font-medium break-all">{viewMember.email}</div>
                <div className="text-muted-foreground">Telepon</div>
                <div className="font-medium">{viewMember.phone}</div>
                <div className="text-muted-foreground">Mulai</div>
                <div className="font-medium">{viewMember.startDate}</div>
                <div className="text-muted-foreground">Berakhir</div>
                <div className="font-medium">{viewMember.endDate}</div>
                <div className="text-muted-foreground">Durasi</div>
                <div className="font-medium">{viewMember.months} bulan</div>
                <div className="text-muted-foreground">Total Bayar</div>
                <div className="font-bold text-primary">{formatCurrency(viewMember.totalPrice)}</div>
                <div className="text-muted-foreground">Status</div>
                <div><StatusBadge status={viewMember.status} /></div>
                {viewMember.notes && (
                  <>
                    <div className="text-muted-foreground">Catatan</div>
                    <div className="text-sm">{viewMember.notes}</div>
                  </>
                )}
              </div>
              <div className="border-t pt-4">
                <p className="text-sm text-muted-foreground mb-3">Ubah Status</p>
                <div className="flex gap-2 flex-wrap">
                  {["active", "expired", "cancelled"].map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={viewMember.status === s ? "default" : "outline"}
                      disabled={viewMember.status === s || updateMutation.isPending}
                      onClick={() => handleUpdateStatus(viewMember.id, s)}
                    >
                      {s === "active" ? "Aktif" : s === "expired" ? "Kadaluarsa" : "Dibatalkan"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewMember(null)}>Tutup</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Data Member</AlertDialogTitle>
            <AlertDialogDescription>
              Yakin ingin menghapus data member ini? Tindakan ini tidak dapat dibatalkan.
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
