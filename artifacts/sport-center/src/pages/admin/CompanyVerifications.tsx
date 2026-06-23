import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Search, CheckCircle2, XCircle, ShieldOff, ExternalLink, Building2, User, Eye, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";

const API_BASE = "/api";

type VerifStatus = "pending" | "approved" | "rejected" | "revoked";

interface CompanyAccount {
  id: number;
  name: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  allowMonthlyBilling: boolean;
  requirePerBookingApproval: boolean;
  accountStatus: string | null;
}

interface VerificationRequest {
  id: number;
  companyId: number;
  customerId: number;
  companyUserId: number | null;
  employeeId: string;
  officeEmail: string | null;
  idCardUrl: string | null;
  status: VerifStatus;
  requestedAt: string;
  approvedAt: string | null;
  rejectionReason: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  companyName: string;
  approvedByName: string | null;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const STATUS_CONFIG: Record<VerifStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "Menunggu", color: "#f59e0b", bg: "#fef3c7" },
  approved: { label: "Disetujui", color: "#10b981", bg: "#d1fae5" },
  rejected: { label: "Ditolak", color: "#ef4444", bg: "#fee2e2" },
  revoked: { label: "Dicabut", color: "#6b7280", bg: "#f3f4f6" },
};

function CompanySettingsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [toggling, setToggling] = useState<string | null>(null);

  const { data: companies, isLoading } = useQuery<CompanyAccount[]>({
    queryKey: ["company-accounts-list"],
    queryFn: () => apiFetch("/companies?status=active"),
  });

  const updateSetting = async (id: number, field: "requirePerBookingApproval" | "allowMonthlyBilling", value: boolean) => {
    const key = `${id}-${field}`;
    setToggling(key);
    try {
      await apiFetch(`/companies/${id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      });
      qc.invalidateQueries({ queryKey: ["company-accounts-list"] });
      toast({ title: "Pengaturan perusahaan diperbarui" });
    } catch {
      toast({ title: "Gagal memperbarui pengaturan", variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  if (isLoading) return <Skeleton className="h-32" />;
  if (!companies?.length) return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings size={16} /> Pengaturan Perusahaan</CardTitle></CardHeader>
      <CardContent><p className="text-sm text-muted-foreground">Belum ada akun perusahaan terdaftar.</p></CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings size={16} /> Pengaturan Perusahaan</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {companies.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-6 py-3 gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{c.companyName ?? c.name}</div>
                <div className="text-xs text-muted-foreground">{c.email}</div>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                <div className="flex items-center gap-2 text-xs">
                  <Switch
                    id={`monthly-${c.id}`}
                    checked={c.allowMonthlyBilling}
                    disabled={toggling === `${c.id}-allowMonthlyBilling`}
                    onCheckedChange={(v) => updateSetting(c.id, "allowMonthlyBilling", v)}
                  />
                  <Label htmlFor={`monthly-${c.id}`} className="text-muted-foreground cursor-pointer">Tagihan Bulanan</Label>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Switch
                    id={`approval-${c.id}`}
                    checked={c.requirePerBookingApproval}
                    disabled={toggling === `${c.id}-requirePerBookingApproval`}
                    onCheckedChange={(v) => updateSetting(c.id, "requirePerBookingApproval", v)}
                  />
                  <Label htmlFor={`approval-${c.id}`} className="text-muted-foreground cursor-pointer">Approval per Booking</Label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: VerifStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <Badge style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }} variant="secondary">
      {cfg.label}
    </Badge>
  );
}

function VerificationDetail({
  v,
  onClose,
  onAction,
}: {
  v: VerificationRequest;
  onClose: () => void;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const approveMutation = useMutation({
    mutationFn: () => apiFetch(`/company-verifications/${v.id}/approve`, { method: "PATCH" }),
    onSuccess: () => {
      toast({ title: "Verifikasi disetujui" });
      qc.invalidateQueries({ queryKey: ["company-verifications"] });
      onAction();
      onClose();
    },
    onError: () => toast({ title: "Gagal menyetujui", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/company-verifications/${v.id}/reject`, {
        method: "PATCH",
        body: JSON.stringify({ rejectionReason: rejectReason }),
      }),
    onSuccess: () => {
      toast({ title: "Verifikasi ditolak" });
      qc.invalidateQueries({ queryKey: ["company-verifications"] });
      onAction();
      onClose();
    },
    onError: () => toast({ title: "Gagal menolak", variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: () => apiFetch(`/company-verifications/${v.id}/revoke`, { method: "PATCH" }),
    onSuccess: () => {
      toast({ title: "Akses dicabut" });
      qc.invalidateQueries({ queryKey: ["company-verifications"] });
      onAction();
      onClose();
    },
    onError: () => toast({ title: "Gagal mencabut akses", variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Detail Verifikasi Karyawan</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <StatusBadge status={v.status} />
          <span className="text-xs text-muted-foreground">
            {new Date(v.requestedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold text-primary mb-1"><User size={14} /> Customer</div>
          <div><span className="text-muted-foreground">Nama:</span> <span className="font-medium">{v.customerName}</span></div>
          <div><span className="text-muted-foreground">Email:</span> <span>{v.customerEmail}</span></div>
          {v.customerPhone && <div><span className="text-muted-foreground">WA:</span> <span>{v.customerPhone}</span></div>}
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold text-primary mb-1"><Building2 size={14} /> Perusahaan</div>
          <div><span className="text-muted-foreground">Nama:</span> <span className="font-medium">{v.companyName}</span></div>
          <div><span className="text-muted-foreground">ID Karyawan:</span> <span className="font-mono font-semibold">{v.employeeId}</span></div>
          {v.officeEmail && <div><span className="text-muted-foreground">Email Kantor:</span> <span>{v.officeEmail}</span></div>}
          {v.idCardUrl && (
            <div>
              <a href={v.idCardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                <ExternalLink size={12} /> Lihat ID Card
              </a>
            </div>
          )}
        </div>

        {v.rejectionReason && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm">
            <div className="font-semibold text-red-700 mb-1">Alasan Penolakan:</div>
            <div className="text-red-600">{v.rejectionReason}</div>
          </div>
        )}

        {v.approvedAt && v.approvedByName && (
          <div className="text-xs text-muted-foreground">
            Diproses oleh <strong>{v.approvedByName}</strong> pada{" "}
            {new Date(v.approvedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
        )}

        {v.status === "pending" && (
          <div className="space-y-2 pt-2">
            {!showRejectForm ? (
              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-1 bg-green-600 hover:bg-green-700"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending}
                >
                  <CheckCircle2 size={14} /> Setujui
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-1 border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => setShowRejectForm(true)}
                >
                  <XCircle size={14} /> Tolak
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Alasan Penolakan (opsional)</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Misal: ID karyawan tidak valid..."
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowRejectForm(false)}>Batal</Button>
                  <Button
                    className="flex-1 gap-1 bg-red-600 hover:bg-red-700"
                    onClick={() => rejectMutation.mutate()}
                    disabled={rejectMutation.isPending}
                  >
                    <XCircle size={14} /> Konfirmasi Tolak
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {v.status === "approved" && (
          <Button
            variant="outline"
            className="w-full gap-1 border-gray-300 text-gray-600 hover:bg-gray-50"
            onClick={() => revokeMutation.mutate()}
            disabled={revokeMutation.isPending}
          >
            <ShieldOff size={14} /> Cabut Akses
          </Button>
        )}
      </div>
    </DialogContent>
  );
}

export default function AdminCompanyVerifications() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<VerificationRequest | null>(null);

  const { data: verifications, isLoading } = useQuery<VerificationRequest[]>({
    queryKey: ["company-verifications", statusFilter],
    queryFn: () => apiFetch(`/company-verifications${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`),
  });

  const filtered = (verifications ?? []).filter((v) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      v.customerName.toLowerCase().includes(s) ||
      v.customerEmail.toLowerCase().includes(s) ||
      (v.customerPhone ?? "").includes(s) ||
      v.companyName.toLowerCase().includes(s) ||
      v.employeeId.toLowerCase().includes(s)
    );
  });

  const counts = {
    all: verifications?.length ?? 0,
    pending: verifications?.filter((v) => v.status === "pending").length ?? 0,
    approved: verifications?.filter((v) => v.status === "approved").length ?? 0,
    rejected: verifications?.filter((v) => v.status === "rejected").length ?? 0,
    revoked: verifications?.filter((v) => v.status === "revoked").length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Verifikasi Karyawan</h1>
        <p className="text-muted-foreground">Kelola permintaan verifikasi karyawan untuk tagihan perusahaan</p>
      </div>

      <CompanySettingsPanel />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: "pending", label: "Menunggu", color: "text-amber-600 bg-amber-50 border-amber-200" },
          { key: "approved", label: "Disetujui", color: "text-green-600 bg-green-50 border-green-200" },
          { key: "rejected", label: "Ditolak", color: "text-red-600 bg-red-50 border-red-200" },
          { key: "revoked", label: "Dicabut", color: "text-gray-600 bg-gray-50 border-gray-200" },
        ].map(({ key, label, color }) => (
          <Card
            key={key}
            className={`cursor-pointer border transition-all ${statusFilter === key ? "ring-2 ring-primary" : ""}`}
            onClick={() => setStatusFilter(statusFilter === key ? "all" : key)}
          >
            <CardContent className="p-4">
              <div className={`text-2xl font-black ${color.split(" ")[0]}`}>{counts[key as keyof typeof counts]}</div>
              <div className="text-xs text-muted-foreground mt-1">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Cari nama customer, perusahaan, ID karyawan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="pending">Menunggu</SelectItem>
                <SelectItem value="approved">Disetujui</SelectItem>
                <SelectItem value="rejected">Ditolak</SelectItem>
                <SelectItem value="revoked">Dicabut</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Customer</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Perusahaan</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">ID Karyawan</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Status</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Tanggal</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((v) => (
                    <tr key={v.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{v.customerName}</div>
                        <div className="text-xs text-muted-foreground">{v.customerEmail}</div>
                        {v.customerPhone && <div className="text-xs text-muted-foreground">{v.customerPhone}</div>}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-1.5">
                          <Building2 size={13} className="text-orange-500 shrink-0" />
                          <span className="font-medium">{v.companyName}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-mono text-xs bg-primary/5 text-primary px-2 py-1 rounded">{v.employeeId}</span>
                        {v.officeEmail && <div className="text-xs text-muted-foreground mt-0.5">{v.officeEmail}</div>}
                      </td>
                      <td className="py-3 pr-4"><StatusBadge status={v.status} /></td>
                      <td className="py-3 pr-4 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(v.requestedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="py-3">
                        <Button size="sm" variant="ghost" onClick={() => setSelected(v)}>
                          <Eye size={14} className="mr-1" /> Detail
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-muted-foreground">
                        Belum ada permintaan verifikasi
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(v) => !v && setSelected(null)}>
        {selected && (
          <VerificationDetail
            v={selected}
            onClose={() => setSelected(null)}
            onAction={() => qc.invalidateQueries({ queryKey: ["company-verifications"] })}
          />
        )}
      </Dialog>
    </div>
  );
}
