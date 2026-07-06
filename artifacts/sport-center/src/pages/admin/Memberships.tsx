import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListMemberships, useUpdateMembership, useDeleteMembership, getListMembershipsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Users, Search, Trash2, CheckCircle, Dumbbell, Clock, XCircle, ImageIcon, ExternalLink, LogIn, CalendarCheck } from "lucide-react";
import { getToken } from "@/lib/auth";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

function todayStr() {
  return new Date().toISOString().split("T")[0]!;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge className="bg-green-100 text-green-700 border-green-200">Aktif</Badge>;
  if (status === "expired") return <Badge className="bg-gray-100 text-gray-600 border-gray-200">Kadaluarsa</Badge>;
  if (status === "cancelled") return <Badge className="bg-red-100 text-red-700 border-red-200">Dibatalkan</Badge>;
  if (status === "waiting_confirmation") return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Menunggu Konfirmasi</Badge>;
  if (status === "pending_payment") return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Menunggu Bayar</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

interface Checkin {
  id: number;
  membershipId: number;
  checkinDate: string;
  checkedInAt: string;
  notes: string | null;
  memberName: string | null;
  memberPhone: string | null;
}

export default function AdminMemberships() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [viewMember, setViewMember] = useState<any>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const today = todayStr();

  const { data: memberships, isLoading } = useListMemberships({});

  // Check-in hari ini
  const { data: checkins = [] } = useQuery<Checkin[]>({
    queryKey: ["gym-checkins", today],
    queryFn: () =>
      fetch(`${API}/memberships/checkins?date=${today}`, { headers: authHeaders() }).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const checkedInIds = new Set(checkins.map((c) => c.membershipId));
  const checkinById = new Map(checkins.map((c) => [c.membershipId, c]));

  const checkInMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${API}/memberships/${id}/checkin`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ checkinDate: today }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Gagal check-in");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gym-checkins", today] });
      toast({ title: "Check-in berhasil ✅" });
    },
    onError: (err: any) => toast({ title: err.message || "Gagal check-in", variant: "destructive" }),
  });

  const undoCheckinMutation = useMutation({
    mutationFn: (checkinId: number) =>
      fetch(`${API}/memberships/checkins/${checkinId}`, { method: "DELETE", headers: authHeaders() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gym-checkins", today] });
      toast({ title: "Check-in dibatalkan" });
    },
    onError: () => toast({ title: "Gagal membatalkan check-in", variant: "destructive" }),
  });

  const updateMutation = useUpdateMembership({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembershipsQueryKey() });
        toast({ title: "Status berhasil diperbarui" });
        setViewMember(null);
      },
      onError: () => toast({ title: "Gagal memperbarui", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteMembership({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembershipsQueryKey() });
        toast({ title: "Member berhasil dihapus" });
        setDeleteId(null);
      },
      onError: () => toast({ title: "Gagal menghapus", variant: "destructive" }),
    },
  });

  const filtered = (memberships || []).filter((m) => {
    const matchSearch = !search ||
      (m.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (m.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (m.phone ?? "").includes(search);
    const matchSearch =
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()) ||
      m.phone.includes(search);
    const matchStatus = filterStatus === "all" || m.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const totalActive = (memberships || []).filter((m) => m.status === "active").length;
  const totalPending = (memberships || []).filter((m) => m.status === "waiting_confirmation" || m.status === "pending_payment").length;
  const totalRevenue = (memberships || [])
    .filter((m) => m.status === "active" || m.status === "expired")
    .reduce((s, m) => s + m.totalPrice, 0);

  function openMember(m: any) {
    setViewMember(m);
    setImgError(false);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <Dumbbell size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Member Gym Bulanan</h1>
          <p className="text-muted-foreground text-sm">Kelola data member gym per bulan</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
            <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center text-yellow-600">
              <Clock size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold">{totalPending}</div>
              <div className="text-sm text-muted-foreground">Menunggu</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Users size={20} />
            </div>
            <div>
              <div className="text-base font-bold leading-tight">{formatCurrency(totalRevenue)}</div>
              <div className="text-sm text-muted-foreground">Total Revenue</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
              <CalendarCheck size={20} />
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-700">{checkins.length}</div>
              <div className="text-sm text-muted-foreground">Check-in Hari Ini</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daftar check-in hari ini */}
      {checkins.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarCheck size={15} className="text-blue-600" />
              <span className="font-semibold text-sm">Hadir Hari Ini — {today}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {checkins.map((c) => (
                <Badge
                  key={c.id}
                  variant="outline"
                  className="bg-green-50 border-green-200 text-green-800 gap-1 py-1 px-3"
                >
                  <CheckCircle size={11} />
                  {c.memberName}
                  <span className="text-green-600 ml-1 text-xs opacity-70">
                    {new Date(c.checkedInAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter */}
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
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="waiting_confirmation">Menunggu Konfirmasi</SelectItem>
            <SelectItem value="pending_payment">Menunggu Bayar</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="expired">Kadaluarsa</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabel member */}
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
                <th className="text-center px-4 py-3 font-semibold">Check-in</th>
                <th className="text-right px-4 py-3 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((m) => {
                const isCheckedIn = checkedInIds.has(m.id);
                const checkin = checkinById.get(m.id);
                return (
                  <tr
                    key={m.id}
                    className={`hover:bg-muted/30 transition-colors ${isCheckedIn ? "bg-green-50/40" : ""}`}
                  >
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
                      {(m as any).paymentMethod && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {(m as any).paymentMethod === "qris" ? "QRIS" : "Transfer"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {m.status === "active" ? (
                        isCheckedIn ? (
                          <div className="flex flex-col items-center gap-1">
                            <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 text-xs">
                              <CheckCircle size={10} /> Hadir
                            </Badge>
                            <button
                              className="text-xs text-muted-foreground hover:text-destructive underline leading-none"
                              onClick={() => checkin && undoCheckinMutation.mutate(checkin.id)}
                              disabled={undoCheckinMutation.isPending}
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                            disabled={checkInMutation.isPending}
                            onClick={() => checkInMutation.mutate(m.id)}
                          >
                            <LogIn size={13} />
                            Check In
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openMember(m)}>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog detail member */}
      {viewMember && (
        <Dialog open={!!viewMember} onOpenChange={() => setViewMember(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Detail Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
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
                {viewMember.paymentMethod && (
                  <>
                    <div className="text-muted-foreground">Metode Bayar</div>
                    <div className="font-medium">
                      {viewMember.paymentMethod === "qris" ? "QRIS" : "Transfer Bank"}
                    </div>
                  </>
                )}
                {viewMember.notes && (
                  <>
                    <div className="text-muted-foreground">Catatan</div>
                    <div className="text-sm">{viewMember.notes}</div>
                  </>
                )}
                {checkedInIds.has(viewMember.id) && (
                  <>
                    <div className="text-muted-foreground">Check-in Hari Ini</div>
                    <div className="text-green-700 font-medium flex items-center gap-1">
                      <CheckCircle size={13} /> Sudah hadir
                    </div>
                  </>
                )}
              </div>

              {viewMember.paymentProofUrl && (
                <div className="space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <ImageIcon size={14} />
                    Bukti Pembayaran
                  </div>
                  {imgError ? (
                    <div className="w-full rounded-xl border border-border bg-muted/40 flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
                      <ImageIcon size={28} className="opacity-40" />
                      <span>Gambar tidak dapat dimuat</span>
                      <a
                        href={viewMember.paymentProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline text-xs"
                      >
                        Coba buka langsung
                      </a>
                    </div>
                  ) : (
                    <img
                      src={viewMember.paymentProofUrl}
                      alt="Bukti Pembayaran"
                      className="w-full max-h-64 object-contain rounded-xl border border-border cursor-zoom-in"
                      onError={() => setImgError(true)}
                      onClick={() => setLightboxUrl(viewMember.paymentProofUrl)}
                    />
                  )}
                  {!imgError && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setLightboxUrl(viewMember.paymentProofUrl)}
                    >
                      <ExternalLink size={14} />
                      Lihat Penuh
                    </Button>
                  )}
                </div>
              )}

              {!viewMember.paymentProofUrl && viewMember.status === "pending_payment" && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
                  Customer belum melakukan pembayaran.
                </div>
              )}

              <div className="border-t pt-4">
                <p className="text-sm text-muted-foreground mb-3">Ubah Status</p>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "active", label: "Aktif" },
                    { value: "waiting_confirmation", label: "Menunggu Konfirmasi" },
                    { value: "pending_payment", label: "Menunggu Bayar" },
                    { value: "expired", label: "Kadaluarsa" },
                    { value: "cancelled", label: "Dibatalkan" },
                  ].map((s) => (
                    <Button
                      key={s.value}
                      size="sm"
                      variant={viewMember.status === s.value ? "default" : "outline"}
                      disabled={viewMember.status === s.value || updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ id: viewMember.id, data: { status: s.value as any } })}
                    >
                      {s.label}
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

      {/* Konfirmasi hapus */}
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

      {/* Lightbox bukti bayar */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white bg-white/20 hover:bg-white/30 rounded-full p-2 transition-colors"
            onClick={() => setLightboxUrl(null)}
          >
            <XCircle size={24} />
          </button>
          <img
            src={lightboxUrl}
            alt="Bukti Pembayaran"
            className="max-w-full max-h-full object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
