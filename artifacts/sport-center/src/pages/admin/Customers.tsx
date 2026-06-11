import { useState } from "react";
import {
  useListCustomers, useGetCustomer, useListBookings,
  useCreateCustomer, useUpdateCustomer,
} from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Eye, MessageCircle, Globe, Building2, Plus, Pencil, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getListCustomersQueryKey } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "#f59e0b", paid: "#3b82f6", confirmed: "#10b981",
  cancelled: "#ef4444", completed: "#6366f1", expired: "#94a3b8",
  rejected: "#e11d48", refunded: "#8b5cf6", waiting_confirmation: "#f97316",
};
const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Menunggu Bayar", paid: "Terbayar", confirmed: "Dikonfirmasi",
  cancelled: "Dibatalkan", completed: "Selesai", expired: "Expired",
  rejected: "Ditolak", refunded: "Refund", waiting_confirmation: "Menunggu Konfirmasi",
};

function SourceBadge({ source }: { source?: string }) {
  if (source === "whatsapp")
    return <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700 border-green-200 text-xs"><MessageCircle size={10} /> WA</Badge>;
  return <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 border-blue-200 text-xs"><Globe size={10} /> Web</Badge>;
}

type CompanyUserRow = { id: number; customerId: number; companyId: number; employeeId: string; officeEmail: string | null; verificationStatus: string; corporateBillingEnabled: boolean; customerName: string; customerEmail: string; verificationId: number | null };

function CompanyMembersPanel({ companyId }: { companyId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: members, isLoading } = useQuery<CompanyUserRow[]>({
    queryKey: ["company-users", companyId],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/api/company-users/by-company/${companyId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const token = getToken();
      const res = await fetch(`/api/company-users/${id}/toggle-billing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Gagal mengubah status");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status billing diperbarui" });
      qc.invalidateQueries({ queryKey: ["company-users", companyId] });
    },
    onError: () => toast({ title: "Gagal mengubah status billing", variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ verificationId }: { verificationId: number }) => {
      const token = getToken();
      const res = await fetch(`/api/company-verifications/${verificationId}/revoke`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Gagal mencabut akses");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Akses karyawan dicabut" });
      qc.invalidateQueries({ queryKey: ["company-users", companyId] });
    },
    onError: () => toast({ title: "Gagal mencabut akses", variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-20" />;
  if (!members?.length) return <div className="text-sm text-muted-foreground text-center py-3 border rounded-lg">Belum ada karyawan terverifikasi</div>;

  return (
    <div className="space-y-2">
      {members.map((m) => (
        <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/20 text-sm gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{m.customerName}</div>
            <div className="text-xs text-muted-foreground">{m.customerEmail} · ID: <span className="font-mono">{m.employeeId}</span></div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">Billing</span>
            <Switch
              checked={m.corporateBillingEnabled}
              disabled={toggleMutation.isPending || revokeMutation.isPending}
              onCheckedChange={(v) => toggleMutation.mutate({ id: m.id, enabled: v })}
            />
            {m.verificationId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                disabled={revokeMutation.isPending}
                onClick={() => m.verificationId && revokeMutation.mutate({ verificationId: m.verificationId })}
              >
                Cabut
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

type MyVerifRow = { id: number; companyId: number; companyUserId: number | null; companyName: string; employeeId: string; status: string; requestedAt: string; rejectionReason: string | null; corporateBillingEnabled: boolean };

function PersonalCompanyPanel({ customerId }: { customerId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<MyVerifRow[]>({
    queryKey: ["customer-verifications", customerId],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/api/company-verifications?customerId=${customerId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ companyUserId, enabled }: { companyUserId: number; enabled: boolean }) => {
      const token = getToken();
      const res = await fetch(`/api/company-users/${companyUserId}/toggle-billing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Gagal mengubah status");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Status billing diperbarui" });
      qc.invalidateQueries({ queryKey: ["customer-verifications", customerId] });
    },
    onError: () => toast({ title: "Gagal", variant: "destructive" }),
  });

  const STATUS_COLORS_V: Record<string, string> = {
    pending: "text-amber-600 bg-amber-50 border-amber-200",
    approved: "text-green-600 bg-green-50 border-green-200",
    rejected: "text-red-600 bg-red-50 border-red-200",
    revoked: "text-gray-500 bg-gray-50 border-gray-200",
  };
  const STATUS_LABELS_V: Record<string, string> = { pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak", revoked: "Dicabut" };

  if (isLoading) return <Skeleton className="h-16" />;
  if (!data?.length) return <div className="text-xs text-muted-foreground text-center py-2 border rounded-lg">Belum terhubung ke perusahaan</div>;

  return (
    <div className="space-y-2">
      {data.map((v) => (
        <div key={v.id} className="p-2.5 rounded-lg border text-xs space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 size={12} className="text-primary shrink-0" />
              <span className="font-medium truncate">{v.companyName}</span>
              <span className="text-muted-foreground font-mono">{v.employeeId}</span>
            </div>
            <Badge variant="secondary" className={`text-xs shrink-0 ${STATUS_COLORS_V[v.status] ?? ""}`}>{STATUS_LABELS_V[v.status] ?? v.status}</Badge>
          </div>
          {v.status === "approved" && v.companyUserId && (
            <div className="flex items-center justify-between pt-0.5 border-t">
              <span className="text-muted-foreground">Tagihan Perusahaan</span>
              <div className="flex items-center gap-2">
                <span className={v.corporateBillingEnabled ? "text-green-600 font-medium" : "text-muted-foreground"}>
                  {v.corporateBillingEnabled ? "Aktif" : "Nonaktif"}
                </span>
                <Switch
                  checked={v.corporateBillingEnabled}
                  disabled={toggleMutation.isPending}
                  onCheckedChange={(enabled) => toggleMutation.mutate({ companyUserId: v.companyUserId!, enabled })}
                  className="scale-75"
                />
              </div>
            </div>
          )}
          {v.rejectionReason && <div className="text-red-600">Alasan: {v.rejectionReason}</div>}
        </div>
      ))}
    </div>
  );
}

function CustomerDetail({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const { data: customer, isLoading: custLoading } = useGetCustomer(customerId);
  const { data: bookings, isLoading: bookLoading } = useListBookings({ customerId });
  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Detail Customer</DialogTitle></DialogHeader>
      {custLoading ? <Skeleton className="h-32" /> : customer && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-black">
              {customer.accountType === "company" ? <Building2 size={24} /> : customer.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-lg">{customer.name}</h3>
                {customer.accountType === "company"
                  ? <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs gap-1"><Building2 size={10} /> Perusahaan</Badge>
                  : <SourceBadge source={customer.registrationSource ?? undefined} />}
              </div>
              <div className="text-sm text-muted-foreground">{customer.email}</div>
              {customer.phone && <div className="text-sm text-muted-foreground">{customer.phone}</div>}
              {customer.customerCode && (
                <div className="text-xs font-mono bg-primary/5 text-primary px-2 py-0.5 rounded mt-1 inline-block">
                  {customer.customerCode}
                </div>
              )}
            </div>
          </div>

          {customer.accountType === "company" && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
              <div className="font-semibold text-primary">Info Perusahaan</div>
              {customer.companyName && <div><span className="text-muted-foreground">Nama Perusahaan:</span> <span className="font-medium">{customer.companyName}</span></div>}
              {customer.picName && <div><span className="text-muted-foreground">PIC:</span> <span className="font-medium">{customer.picName}</span></div>}
              {customer.picPhone && <div><span className="text-muted-foreground">Telp PIC:</span> <span className="font-medium">{customer.picPhone}</span></div>}
              {customer.picEmail && <div><span className="text-muted-foreground">Email PIC:</span> <span className="font-medium">{customer.picEmail}</span></div>}
              {customer.billingAddress && <div><span className="text-muted-foreground">Alamat Tagihan:</span> <span className="font-medium">{customer.billingAddress}</span></div>}
              <div className="flex gap-4 pt-1">
                <div><span className="text-muted-foreground text-xs">Termin Bayar:</span> <span className="font-semibold">{customer.paymentTermsDays ?? 30} hari</span></div>
                {customer.monthlyCreditLimit && <div><span className="text-muted-foreground text-xs">Kredit Limit:</span> <span className="font-semibold">{formatCurrency(customer.monthlyCreditLimit)}</span></div>}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <span className={`w-2 h-2 rounded-full ${customer.allowMonthlyBilling ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="text-xs">{customer.allowMonthlyBilling ? "Tagihan bulanan AKTIF" : "Tagihan bulanan NONAKTIF"}</span>
              </div>
            </div>
          )}

          {customer.accountType === "company" && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users size={14} className="text-primary" />
                <span className="font-semibold text-sm">Karyawan Terverifikasi</span>
              </div>
              <CompanyMembersPanel companyId={customer.id} />
            </div>
          )}

          {customer.accountType !== "company" && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Building2 size={14} className="text-primary" />
                <span className="font-semibold text-sm">Verifikasi Perusahaan</span>
              </div>
              <PersonalCompanyPanel customerId={customer.id} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Card><CardContent className="p-4 text-center"><div className="text-2xl font-black">{customer.totalBookings}</div><div className="text-xs text-muted-foreground">Total Bookings</div></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><div className="text-lg font-black">{formatCurrency(customer.totalSpent ?? 0)}</div><div className="text-xs text-muted-foreground">Total Spent</div></CardContent></Card>
          </div>
          {bookLoading ? <Skeleton className="h-32" /> : (
            <div>
              <h4 className="font-semibold mb-2">Recent Bookings</h4>
              <div className="space-y-2">
                {bookings?.slice(0, 5).map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded-md">
                    <div>
                      <div className="font-medium">{b.facilityName}</div>
                      <div className="text-xs text-muted-foreground">{b.bookingDate} · {b.startTime}–{b.endTime}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatCurrency(b.totalPrice)}</div>
                      <Badge variant="secondary" className="text-xs" style={{ background: (STATUS_COLORS[b.status] ?? "#94a3b8") + "20", color: STATUS_COLORS[b.status] ?? "#94a3b8" }}>
                        {STATUS_LABELS[b.status] ?? b.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {!bookings?.length && <div className="text-sm text-muted-foreground text-center py-4">Belum ada booking</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  );
}

function CompanyForm({ initial, onClose }: { initial?: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    companyName: initial?.companyName ?? "",
    picName: initial?.picName ?? "",
    picPhone: initial?.picPhone ?? "",
    picEmail: initial?.picEmail ?? "",
    billingAddress: initial?.billingAddress ?? "",
    paymentTermsDays: initial?.paymentTermsDays ?? 30,
    monthlyCreditLimit: initial?.monthlyCreditLimit ?? "",
    allowMonthlyBilling: initial?.allowMonthlyBilling ?? false,
    accountStatus: initial?.accountStatus ?? "active",
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    const payload = {
      ...form,
      accountType: "company" as const,
      paymentTermsDays: Number(form.paymentTermsDays),
      monthlyCreditLimit: form.monthlyCreditLimit ? Number(form.monthlyCreditLimit) : undefined,
    };
    try {
      if (initial) {
        await updateMutation.mutateAsync({ id: initial.id, data: payload });
        toast({ title: "Customer diperbarui" });
      } else {
        const result = await createMutation.mutateAsync({ data: payload });
        const tempPwd = (result as any)?.tempPassword;
        toast({
          title: "Customer perusahaan dibuat",
          description: tempPwd
            ? `Password sementara: ${tempPwd} — simpan sebelum menutup dialog ini`
            : "Akun berhasil dibuat",
        });
      }
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      onClose();
    } catch {
      toast({ title: "Gagal menyimpan", variant: "destructive" });
    }
  };

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{initial ? "Edit Customer Perusahaan" : "Tambah Customer Perusahaan"}</DialogTitle></DialogHeader>
      <div className="space-y-4 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Nama Akun *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="PT. ABC" /></div>
          <div className="space-y-1"><Label>Email *</Label><Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="akun@perusahaan.com" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Nama Perusahaan</Label><Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="PT. Nama Lengkap" /></div>
          <div className="space-y-1"><Label>No. HP Akun</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="08xxx" /></div>
        </div>
        <div className="border-t pt-3">
          <p className="text-sm font-semibold mb-2 text-muted-foreground">Data PIC (Person In Charge)</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Nama PIC</Label><Input value={form.picName} onChange={(e) => set("picName", e.target.value)} /></div>
            <div className="space-y-1"><Label>Telp PIC</Label><Input value={form.picPhone} onChange={(e) => set("picPhone", e.target.value)} /></div>
          </div>
          <div className="space-y-1 mt-3"><Label>Email PIC</Label><Input value={form.picEmail} onChange={(e) => set("picEmail", e.target.value)} /></div>
        </div>
        <div className="border-t pt-3">
          <p className="text-sm font-semibold mb-2 text-muted-foreground">Pengaturan Tagihan</p>
          <div className="space-y-1 mb-3"><Label>Alamat Tagihan</Label><Input value={form.billingAddress} onChange={(e) => set("billingAddress", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Termin Bayar (hari)</Label><Input type="number" value={form.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} /></div>
            <div className="space-y-1"><Label>Kredit Limit (Rp)</Label><Input type="number" value={form.monthlyCreditLimit} onChange={(e) => set("monthlyCreditLimit", e.target.value)} /></div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Switch id="allowBilling" checked={form.allowMonthlyBilling} onCheckedChange={(v) => set("allowMonthlyBilling", v)} />
            <Label htmlFor="allowBilling">Aktifkan tagihan bulanan</Label>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
            {initial ? "Simpan Perubahan" : "Buat Akun"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

export default function AdminCustomers() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("personal");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState<any>(null);

  const { data: customers, isLoading } = useListCustomers({
    search: search || undefined,
    accountType: tab as "personal" | "company",
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Customers</h1>
          <p className="text-muted-foreground">Kelola daftar customer terdaftar</p>
        </div>
        {tab === "company" && (
          <Button onClick={() => { setEditCustomer(null); setShowForm(true); }} className="gap-2">
            <Plus size={16} /> Tambah Perusahaan
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <Tabs value={tab} onValueChange={setTab} className="shrink-0">
              <TabsList>
                <TabsTrigger value="personal">Personal</TabsTrigger>
                <TabsTrigger value="company" className="gap-1"><Building2 size={12} /> Perusahaan</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder={tab === "company" ? "Cari nama, email, atau perusahaan..." : "Cari nama, email, HP, kode customer..."} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : tab === "personal" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Customer</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Kode</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Sumber</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Phone</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Bookings</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Total Spent</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {customers?.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">{c.name.charAt(0)}</div>
                          <div><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.email}</div></div>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        {c.customerCode ? <span className="font-mono text-xs bg-primary/5 text-primary px-2 py-1 rounded">{c.customerCode}</span> : <span className="text-muted-foreground text-xs">–</span>}
                      </td>
                      <td className="py-3 pr-4"><SourceBadge source={c.registrationSource ?? undefined} /></td>
                      <td className="py-3 pr-4 text-muted-foreground">{c.phone ?? "–"}</td>
                      <td className="py-3 pr-4 font-semibold">{c.totalBookings}</td>
                      <td className="py-3 pr-4 font-semibold">{formatCurrency(c.totalSpent ?? 0)}</td>
                      <td className="py-3"><Button size="sm" variant="ghost" onClick={() => setSelectedId(c.id)}><Eye size={14} className="mr-1" /> Lihat</Button></td>
                    </tr>
                  ))}
                  {!customers?.length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada customer terdaftar</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Perusahaan</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">PIC</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Tagihan Bulanan</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Termin</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Bookings</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Total Spent</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {customers?.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm"><Building2 size={14} /></div>
                          <div>
                            <div className="font-medium">{c.companyName ?? c.name}</div>
                            <div className="text-xs text-muted-foreground">{c.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{c.picName ?? "–"}</div>
                        <div className="text-xs text-muted-foreground">{c.picPhone ?? ""}</div>
                      </td>
                      <td className="py-3 pr-4">
                        {c.allowMonthlyBilling
                          ? <Badge className="bg-green-100 text-green-700 border-green-200">Aktif</Badge>
                          : <Badge variant="secondary">Nonaktif</Badge>}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{c.paymentTermsDays ?? 30} hari</td>
                      <td className="py-3 pr-4 font-semibold">{c.totalBookings}</td>
                      <td className="py-3 pr-4 font-semibold">{formatCurrency(c.totalSpent ?? 0)}</td>
                      <td className="py-3 flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedId(c.id)}><Eye size={14} /></Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditCustomer(c); setShowForm(true); }}><Pencil size={14} /></Button>
                      </td>
                    </tr>
                  ))}
                  {!customers?.length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada customer perusahaan</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={selectedId !== null} onOpenChange={(v) => !v && setSelectedId(null)}>
        {selectedId && <CustomerDetail customerId={selectedId} onClose={() => setSelectedId(null)} />}
      </Dialog>

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setEditCustomer(null); } }}>
        {showForm && <CompanyForm initial={editCustomer} onClose={() => { setShowForm(false); setEditCustomer(null); }} />}
      </Dialog>
    </div>
  );
}
