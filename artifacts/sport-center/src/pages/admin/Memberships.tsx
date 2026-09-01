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
import { Users, Search, Trash2, CheckCircle, Dumbbell, Clock, XCircle, ImageIcon, ExternalLink, LogIn, CalendarCheck, BadgeCheck, Download, Pencil, Save, X, ReceiptText } from "lucide-react";
import { Label } from "@/components/ui/label";
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

interface MembershipPayment {
  id: number;
  membershipId: number;
  periodStart: string;
  periodEnd: string;
  months: number;
  amount: number;
  status: "pending_payment" | "waiting_confirmation" | "confirmed" | "cancelled";
  paymentMethod: string | null;
  paymentProofUrl: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  mutationKey: string | null;
  accountingRef: string | null;
}

function PaymentStatusBadge({ status }: { status: MembershipPayment["status"] }) {
  if (status === "confirmed") return <Badge className="bg-green-100 text-green-700 border-green-200">Terkonfirmasi</Badge>;
  if (status === "waiting_confirmation") return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Verifikasi</Badge>;
  if (status === "pending_payment") return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Menunggu Bayar</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200">Dibatalkan</Badge>;
}

export default function AdminMemberships() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [viewMember, setViewMember] = useState<any>(null);
  const [editingDates, setEditingDates] = useState(false);
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [dateError, setDateError] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  // Export CSV
  const now = new Date();
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMonth, setExportMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [exportYear, setExportYear] = useState(String(now.getFullYear()));
  const [exportAllData, setExportAllData] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const MONTHS = [
    { value: "01", label: "Januari" }, { value: "02", label: "Februari" },
    { value: "03", label: "Maret" }, { value: "04", label: "April" },
    { value: "05", label: "Mei" }, { value: "06", label: "Juni" },
    { value: "07", label: "Juli" }, { value: "08", label: "Agustus" },
    { value: "09", label: "September" }, { value: "10", label: "Oktober" },
    { value: "11", label: "November" }, { value: "12", label: "Desember" },
  ];
  const YEARS = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - 2 + i));

  const handleExportCsv = async () => {
    const token = getToken();
    setIsExporting(true);
    try {
      let url = `${API}/memberships/export`;
      let filename = "members-gym.csv";
      if (!exportAllData) {
        const lastDay = new Date(Number(exportYear), Number(exportMonth), 0).getDate();
        const startDate = `${exportYear}-${exportMonth}-01`;
        const endDate = `${exportYear}-${exportMonth}-${String(lastDay).padStart(2, "0")}`;
        const monthName = MONTHS.find((m) => m.value === exportMonth)?.label ?? exportMonth;
        filename = `members-gym-${monthName}-${exportYear}.csv`;
        url += `?startDate=${startDate}&endDate=${endDate}`;
      }
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setShowExportModal(false);
    } finally {
      setIsExporting(false);
    }
  };

  const today = todayStr();

  const { data: memberships, isLoading } = useListMemberships({});

  // Check-in hari ini
  const { data: rawCheckins } = useQuery<Checkin[]>({
    queryKey: ["gym-checkins", today],
    queryFn: () =>
      fetch(`${API}/memberships/checkins?date=${today}`, { headers: authHeaders() }).then((r) => r.json()),
    refetchInterval: 30000,
  });
  const checkins: Checkin[] = Array.isArray(rawCheckins) ? rawCheckins : [];

  const { data: rawPaymentHistory, isLoading: isPaymentHistoryLoading } = useQuery<MembershipPayment[]>({
    queryKey: ["membership-payments", viewMember?.id],
    enabled: Boolean(viewMember?.id),
    queryFn: async () => {
      const response = await fetch(`${API}/memberships/${viewMember.id}/payments`, { headers: authHeaders() });
      if (!response.ok) throw new Error("Gagal memuat histori pembayaran");
      return response.json();
    },
  });
  const paymentHistory = Array.isArray(rawPaymentHistory) ? rawPaymentHistory : [];

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
        toast({ title: "Data member berhasil diperbarui" });
        setViewMember(null);
        setEditingDates(false);
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
    setEditingDates(false);
    setEditStartDate(m.startDate ?? "");
    setEditEndDate(m.endDate ?? "");
    setDateError("");
    setImgError(false);
  }

  function saveDates() {
    if (!editStartDate || !editEndDate) {
      setDateError("Tanggal mulai dan berakhir wajib diisi.");
      return;
    }
    if (editStartDate > editEndDate) {
      setDateError("Tanggal mulai tidak boleh setelah tanggal berakhir.");
      return;
    }
    setDateError("");
    updateMutation.mutate({
      id: viewMember.id,
      data: { startDate: editStartDate, endDate: editEndDate },
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Dumbbell size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Member Gym Bulanan</h1>
            <p className="text-muted-foreground text-sm">Kelola data member gym per bulan</p>
          </div>
        </div>
        <button
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <Download size={13} />
          Ekspor CSV
        </button>
      </div>

      {/* Modal Export CSV */}
      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Download size={16} className="text-slate-500" />
              Ekspor CSV Member Gym
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <input
                type="checkbox"
                id="export-all-gym"
                checked={exportAllData}
                onChange={(e) => setExportAllData(e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-500"
              />
              <Label htmlFor="export-all-gym" className="text-sm cursor-pointer">
                Ekspor semua data (tanpa filter bulan)
              </Label>
            </div>

            {!exportAllData && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Bulan</Label>
                    <Select value={exportMonth} onValueChange={setExportMonth}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Tahun</Label>
                    <Select value={exportYear} onValueChange={setExportYear}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={y}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Mengekspor member dengan tanggal mulai di bulan{" "}
                  {MONTHS.find((m) => m.value === exportMonth)?.label} {exportYear}.
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 h-9 text-sm" onClick={() => setShowExportModal(false)}>
                Batal
              </Button>
              <Button
                className="flex-1 h-9 text-sm gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                onClick={handleExportCsv}
                disabled={isExporting}
              >
                <Download size={14} />
                {isExporting ? "Mengunduh..." : "Unduh CSV"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

              <div className="rounded-xl border border-border p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Periode Membership</p>
                  {!editingDates && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        setEditStartDate(viewMember.startDate ?? "");
                        setEditEndDate(viewMember.endDate ?? "");
                        setDateError("");
                        setEditingDates(true);
                      }}
                    >
                      <Pencil size={13} />
                      Edit Tanggal
                    </Button>
                  )}
                </div>

                {editingDates ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="membership-start-date">Mulai</Label>
                        <Input
                          id="membership-start-date"
                          type="date"
                          value={editStartDate}
                          onChange={(e) => setEditStartDate(e.target.value)}
                          disabled={updateMutation.isPending}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="membership-end-date">Berakhir</Label>
                        <Input
                          id="membership-end-date"
                          type="date"
                          value={editEndDate}
                          onChange={(e) => setEditEndDate(e.target.value)}
                          disabled={updateMutation.isPending}
                        />
                      </div>
                    </div>
                    {dateError && <p className="text-xs text-destructive">{dateError}</p>}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        onClick={() => {
                          setEditingDates(false);
                          setDateError("");
                        }}
                        disabled={updateMutation.isPending}
                      >
                        <X size={13} />
                        Batal
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        onClick={saveDates}
                        disabled={updateMutation.isPending}
                      >
                        <Save size={13} />
                        Simpan Tanggal
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-muted-foreground">Mulai</div>
                      <div className="font-medium">{viewMember.startDate}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Berakhir</div>
                      <div className="font-medium">{viewMember.endDate}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <ReceiptText size={15} className="text-primary" />
                  <p className="text-sm font-semibold">Histori Pembayaran Bulanan</p>
                </div>
                {isPaymentHistoryLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full rounded-lg" />
                    <Skeleton className="h-16 w-full rounded-lg" />
                  </div>
                ) : paymentHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Belum ada histori pembayaran per periode. Data lama akan mulai tercatat saat pembayaran berikutnya.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {paymentHistory.map((payment) => (
                      <div key={payment.id} className="rounded-lg bg-muted/40 border border-border/70 p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">
                              {payment.periodStart} s/d {payment.periodEnd}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {payment.months} bulan · #{payment.id}
                            </p>
                          </div>
                          <PaymentStatusBadge status={payment.status} />
                        </div>
                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-primary">{formatCurrency(payment.amount)}</p>
                            <p className="text-xs text-muted-foreground">
                              {payment.paymentMethod === "qris"
                                ? "QRIS"
                                : payment.paymentMethod
                                  ? "Transfer Bank"
                                  : "Metode belum dipilih"}
                            </p>
                          </div>
                          {payment.paymentProofUrl && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5"
                              onClick={() => setLightboxUrl(payment.paymentProofUrl)}
                            >
                              <ImageIcon size={13} />
                              Bukti
                            </Button>
                          )}
                        </div>
                        {payment.confirmedAt && (
                          <p className="text-[11px] text-muted-foreground">
                            Dikonfirmasi {new Date(payment.confirmedAt).toLocaleString("id-ID")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
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
                  Customer belum melakukan pembayaran / upload bukti.
                </div>
              )}

              {/* Tombol konfirmasi menonjol untuk status yang butuh tindakan */}
              {(viewMember.status === "pending_payment" || viewMember.status === "waiting_confirmation") && (
                <div className="rounded-xl bg-green-50 border border-green-200 p-4 space-y-2">
                  <p className="text-sm font-semibold text-green-800">
                    {viewMember.status === "waiting_confirmation"
                      ? "Bukti pembayaran sudah diupload — siap dikonfirmasi"
                      : "Aktifkan membership secara manual (pembayaran diterima di luar sistem)"}
                  </p>
                  <Button
                    className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                    disabled={updateMutation.isPending}
                    onClick={() => updateMutation.mutate({ id: viewMember.id, data: { status: "active" as any } })}
                  >
                    <BadgeCheck size={16} />
                    Aktifkan Membership
                  </Button>
                </div>
              )}

              <div className="border-t pt-4">
                <p className="text-sm text-muted-foreground mb-3">Ubah Status Manual</p>
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
