import { useState } from "react";
import {
  useListCustomers, useGetCustomer, useListBookings,
  useCreateCustomer, useUpdateCustomer,
  useConnectCustomerSheet, usePushCustomersToSheet, usePullCustomersFromSheet,
} from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Eye, MessageCircle, Globe, Building2, Plus, Pencil, Users, Sheet, Upload, Download, CheckCircle2, AlertCircle, Link, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Search, Eye, MessageCircle, Globe, Building2, Plus, Pencil, Users, Copy, Check } from "lucide-react";
import { Search, Eye, MessageCircle, Globe, Building2, Plus, Pencil, Users, Sheet, Upload, Download, CheckCircle2, AlertCircle, Link, ChevronDown, ChevronUp } from "lucide-react";

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm" variant="outline"
      className="h-7 px-2 gap-1 text-xs"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
    >
      {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
      {copied ? "Tersalin" : "Salin"}
    </Button>
  );
}

function TempPasswordDialog({ password, email, onClose }: { password: string; email: string; onClose: () => void }) {
  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle className="text-green-700">✅ Akun Berhasil Dibuat</DialogTitle>
        <DialogDescription>Simpan password sementara ini — hanya tampil sekali.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 pt-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Email</Label>
          <div className="flex items-center gap-2 p-2 bg-muted rounded-md font-mono text-sm">
            <span className="flex-1 break-all">{email}</span>
            <CopyButton text={email} />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Password Sementara</Label>
          <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-md font-mono text-sm">
            <span className="flex-1 font-bold tracking-wider text-amber-800">{password}</span>
            <CopyButton text={password} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Berikan password ini ke customer agar bisa login. Customer dapat menggantinya setelah masuk.</p>
        <Button className="w-full" onClick={onClose}>Selesai</Button>
      </div>
    </DialogContent>
  );
}

function PersonalForm({ onClose, onCreated }: { onClose: () => void; onCreated: (pwd: string, email: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMutation = useCreateCustomer();
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [loading, setLoading] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast({ title: "Nama dan email wajib diisi", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      const result = await createMutation.mutateAsync({
        data: { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, accountType: "personal" as const },
      });
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      onCreated((result as any).tempPassword ?? "", form.email.trim());
    } catch (err: any) {
      toast({ title: "Gagal membuat akun", description: err?.message ?? "Error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Buat Akun Customer</DialogTitle>
        <DialogDescription>Password sementara akan dibuat otomatis. Berikan ke customer agar bisa login.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <Label>Nama Lengkap <span className="text-destructive">*</span></Label>
          <Input placeholder="Budi Santoso" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email <span className="text-destructive">*</span></Label>
          <Input type="email" placeholder="customer@email.com" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>No. WhatsApp</Label>
          <Input placeholder="08xxxxxxxxxx" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={loading}>Batal</Button>
          <Button onClick={handleSubmit} disabled={loading || !form.name.trim() || !form.email.trim()}>
            {loading ? "Membuat..." : "Buat Akun"}
          </Button>
        </div>
      </div>
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

function GuestDetailDialog({ guest, onClose }: { guest: any; onClose: () => void }) {
  const token = getToken();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showConvert, setShowConvert] = useState(false);
  const [convertEmail, setConvertEmail] = useState(guest.email ?? "");
  const [convertName, setConvertName] = useState(guest.name ?? "");
  const [converting, setConverting] = useState(false);

  const { data: bookings, isLoading } = useQuery<any[]>({
    queryKey: ["guest-bookings", guest.phone],
    queryFn: async () => {
      const r = await fetch(`/api/bookings?customerPhone=${encodeURIComponent(guest.phone)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!guest.phone,
  });

  const handleConvert = async () => {
    if (!convertEmail.trim()) {
      toast({ title: "Email wajib diisi", variant: "destructive" });
      return;
    }
    setConverting(true);
    try {
      const r = await fetch("/api/customers/from-guest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: guest.phone, name: convertName, email: convertEmail }),
      });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error ?? "Gagal membuat akun", variant: "destructive" }); return; }
      toast({
        title: "Akun customer berhasil dibuat!",
        description: `Kode: ${data.customerCode} · Password sementara: ${data.tempPassword} — simpan sebelum menutup!`,
        duration: 15000,
      });
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      onClose();
    } catch {
      toast({ title: "Gagal membuat akun", variant: "destructive" });
    } finally {
      setConverting(false);
    }
  };

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Detail Guest Booker</DialogTitle></DialogHeader>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 text-2xl font-black">
            {guest.name?.charAt(0) ?? "?"}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-lg">{guest.name}</h3>
              <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200 text-xs">Guest</Badge>
            </div>
            <div className="text-sm text-muted-foreground">{guest.email || "–"}</div>
            <div className="text-sm text-muted-foreground">{guest.phone}</div>
          </div>
        </div>

        {/* Panel konversi */}
        {!showConvert ? (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 flex items-center justify-between gap-3">
            <div className="text-sm text-amber-800">Belum punya akun terdaftar. Semua booking akan terhubung otomatis.</div>
            <Button size="sm" variant="default" className="shrink-0" onClick={() => setShowConvert(true)}>
              <Users size={14} className="mr-1.5" /> Buat Akun
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="font-semibold text-sm">Buat Akun Customer</div>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Nama</Label>
                <Input value={convertName} onChange={e => setConvertName(e.target.value)} placeholder="Nama lengkap" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email <span className="text-destructive">*</span></Label>
                <Input type="email" value={convertEmail} onChange={e => setConvertEmail(e.target.value)} placeholder="email@customer.com" />
              </div>
              <div className="text-xs text-muted-foreground">
                Semua {bookings?.length ?? 0} booking dengan nomor <span className="font-mono font-semibold">{guest.phone}</span> akan otomatis terhubung ke akun ini.
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setShowConvert(false)} disabled={converting}>Batal</Button>
              <Button size="sm" onClick={handleConvert} disabled={converting || !convertEmail.trim()}>
                {converting ? "Membuat..." : "Konfirmasi Buat Akun"}
              </Button>
            </div>
          </div>
        )}

        <div>
          <div className="font-semibold mb-3">Riwayat Booking ({bookings?.length ?? 0})</div>
          {isLoading ? (
            <Skeleton className="h-20" />
          ) : !bookings?.length ? (
            <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg">Tidak ada booking</div>
          ) : (
            <div className="space-y-2">
              {bookings.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between p-3 border rounded-lg text-sm gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.facilityName}</div>
                    <div className="text-xs text-muted-foreground">{b.bookingDate} · {b.startTime ?? "Walk-in"}</div>
                    <div className="font-mono text-xs text-muted-foreground">{b.orderNumber}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(b.grandTotal ?? b.totalPrice)}</div>
                    <Badge style={{ backgroundColor: STATUS_COLORS[b.status] + "20", color: STATUS_COLORS[b.status], borderColor: STATUS_COLORS[b.status] + "40" }} variant="outline" className="text-xs mt-1">
                      {STATUS_LABELS[b.status] ?? b.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DialogContent>
  );
}

function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([\w-]+)/);
  return m ? m[1] : input.trim();
}

function SheetSyncPanel() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [rawInput, setRawInput] = useState("");
  const [connectedSheet, setConnectedSheet] = useState<{ id: string; title: string } | null>(null);
  const [lastSync, setLastSync] = useState<{ direction: "push" | "pull"; result: string; at: Date } | null>(null);

  const connectMutation = useConnectCustomerSheet({
    mutation: {
      onSuccess: (data) => {
        const id = extractSheetId(rawInput);
        setConnectedSheet({ id, title: data.title });
        toast({ title: `Terhubung ke "${data.title}"` });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal terhubung ke sheet", variant: "destructive" });
      },
    },
  });

  const pushMutation = usePushCustomersToSheet({
    mutation: {
      onSuccess: (data) => {
        setLastSync({ direction: "push", result: `${data.updatedRows} customer diekspor`, at: new Date() });
        toast({ title: `✅ ${data.updatedRows} customer berhasil dikirim ke Google Sheet` });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal export ke sheet", variant: "destructive" });
      },
    },
  });

  const pullMutation = usePullCustomersFromSheet({
    mutation: {
      onSuccess: (data) => {
        setLastSync({ direction: "pull", result: `${data.updatedCount} diperbarui, ${data.skippedCount} dilewati`, at: new Date() });
        toast({ title: `✅ ${data.updatedCount} customer diperbarui dari Google Sheet` });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal import dari sheet", variant: "destructive" });
      },
    },
  });

  const isBusy = connectMutation.isPending || pushMutation.isPending || pullMutation.isPending;

  return (
    <Card className="border-green-200 bg-green-50/30">
      <CardContent className="p-4">
        <button
          className="w-full flex items-center justify-between gap-3 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
              <Sheet size={16} className="text-green-700" />
            </div>
            <div>
              <div className="font-semibold text-sm">Sinkronisasi Google Sheets</div>
              <div className="text-xs text-muted-foreground">
                {connectedSheet
                  ? <span className="text-green-700 flex items-center gap-1"><CheckCircle2 size={10} /> {connectedSheet.title}</span>
                  : "Hubungkan spreadsheet untuk sync dua arah"}
              </div>
            </div>
          </div>
          {expanded ? <ChevronUp size={16} className="text-muted-foreground shrink-0" /> : <ChevronDown size={16} className="text-muted-foreground shrink-0" />}
        </button>

        {expanded && (
          <div className="mt-4 space-y-4 border-t pt-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Google Sheet ID atau URL</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://docs.google.com/spreadsheets/d/... atau Sheet ID"
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  className="flex-1 text-sm"
                  disabled={isBusy}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  disabled={!rawInput.trim() || isBusy}
                  onClick={() => connectMutation.mutate({ data: { sheetId: extractSheetId(rawInput) } })}
                >
                  <Link size={14} />
                  {connectMutation.isPending ? "Mengecek..." : "Hubungkan"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Pastikan <strong>Service Account</strong> sudah diberi akses <em>Editor</em> di spreadsheet tersebut.
              </p>
            </div>

            {connectedSheet && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-100/60 border border-green-200 text-sm">
                  <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                  <span className="font-medium text-green-800">Terhubung ke: {connectedSheet.title}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isBusy}
                    onClick={() => pushMutation.mutate({ data: { sheetId: connectedSheet.id } })}
                  >
                    <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center">
                      <Upload size={16} className="text-white" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-sm text-orange-800">Export ke Sheet</div>
                      <div className="text-xs text-orange-600 mt-0.5">App → Google Sheet</div>
                    </div>
                    {pushMutation.isPending && <div className="text-xs text-orange-600 animate-pulse">Mengekspor...</div>}
                  </button>

                  <button
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isBusy}
                    onClick={() => pullMutation.mutate({ data: { sheetId: connectedSheet.id } })}
                  >
                    <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center">
                      <Download size={16} className="text-white" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-sm text-blue-800">Import dari Sheet</div>
                      <div className="text-xs text-blue-600 mt-0.5">Google Sheet → App</div>
                    </div>
                    {pullMutation.isPending && <div className="text-xs text-blue-600 animate-pulse">Mengimpor...</div>}
                  </button>
                </div>

                {lastSync && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                    <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                    <span>
                      Terakhir {lastSync.direction === "push" ? "export" : "import"}: <strong>{lastSync.result}</strong>
                      {" · "}{lastSync.at.toLocaleTimeString("id-ID")}
                    </span>
                  </div>
                )}

                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 space-y-1">
                  <div className="font-semibold flex items-center gap-1"><AlertCircle size={11} /> Catatan</div>
                  <div>• <strong>Export</strong>: Menimpa seluruh isi sheet dengan data terbaru dari app.</div>
                  <div>• <strong>Import</strong>: Memperbarui data customer berdasarkan kolom <strong>ID</strong>. Kolom Kode Customer, Total Booking, dan Total Belanja diabaikan.</div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminCustomers() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("personal");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedGuest, setSelectedGuest] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState<any>(null);
  const [showPersonalForm, setShowPersonalForm] = useState(false);
  const [tempResult, setTempResult] = useState<{ password: string; email: string } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = getToken();
      const r = await fetch(`/api/customers/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error ?? "Gagal menghapus", variant: "destructive" }); return; }
      toast({ title: data.message ?? "Customer berhasil dihapus" });
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      setDeleteTarget(null);
    } catch {
      toast({ title: "Gagal menghapus akun", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const { data: customers, isLoading } = useListCustomers({
    search: search || undefined,
    accountType: tab as "personal" | "company",
  });

  const handleMigrateAll = async () => {
    setMigrating(true);
    try {
      const token = getToken();
      const r = await fetch("/api/customers/migrate-all-guests", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error ?? "Gagal migrasi", variant: "destructive" }); return; }
      toast({
        title: `Sinkronisasi selesai`,
        description: `${data.created} akun baru dibuat · ${data.linked} booking dihubungkan · ${data.skipped} dilewati`,
      });
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
    } catch {
      toast({ title: "Gagal melakukan sinkronisasi", variant: "destructive" });
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black">Customers</h1>
          <p className="text-muted-foreground">Kelola daftar customer terdaftar</p>
        </div>
        {tab === "personal" && (
          <Button onClick={() => setShowPersonalForm(true)} className="gap-2">
            <Plus size={16} /> Buat Akun Customer
          </Button>
        )}
        {tab === "company" && (
          <Button onClick={() => { setEditCustomer(null); setShowForm(true); }} className="gap-2">
            <Plus size={16} /> Tambah Perusahaan
          </Button>
        )}
      </div>

      <Dialog open={showPersonalForm} onOpenChange={setShowPersonalForm}>
        {showPersonalForm && (
          <PersonalForm
            onClose={() => setShowPersonalForm(false)}
            onCreated={(pwd, email) => { setShowPersonalForm(false); setTempResult({ password: pwd, email }); }}
          />
        )}
      </Dialog>

      <Dialog open={!!tempResult} onOpenChange={(o) => { if (!o) setTempResult(null); }}>
        {tempResult && (
          <TempPasswordDialog
            password={tempResult.password}
            email={tempResult.email}
            onClose={() => setTempResult(null)}
          />
        )}
      </Dialog>
        <div className="flex gap-2">
          {tab === "personal" && (
            <Button variant="outline" onClick={handleMigrateAll} disabled={migrating} className="gap-2">
              <Users size={16} /> {migrating ? "Memproses..." : "Sinkronisasi Guest → Akun"}
            </Button>
          )}
          {tab === "company" && (
            <Button onClick={() => { setEditCustomer(null); setShowForm(true); }} className="gap-2">
              <Plus size={16} /> Tambah Perusahaan
            </Button>
          )}
        </div>
      </div>

      <SheetSyncPanel />

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
                  {customers?.map((c) => {
                    const isGuest = c.id < 0;
                    return (
                      <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${isGuest ? "bg-amber-100 text-amber-600" : "bg-primary/10 text-primary"}`}>{c.name.charAt(0)}</div>
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium">{c.name}</span>
                                {isGuest && <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200 text-xs py-0 h-4">Guest</Badge>}
                              </div>
                              <div className="text-xs text-muted-foreground">{c.email ?? "–"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          {c.customerCode ? <span className="font-mono text-xs bg-primary/5 text-primary px-2 py-1 rounded">{c.customerCode}</span> : <span className="text-muted-foreground text-xs">–</span>}
                        </td>
                        <td className="py-3 pr-4">
                          {isGuest
                            ? <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-xs gap-1">Booking Langsung</Badge>
                            : <SourceBadge source={c.registrationSource ?? undefined} />}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{c.phone ?? "–"}</td>
                        <td className="py-3 pr-4 font-semibold">{c.totalBookings}</td>
                        <td className="py-3 pr-4 font-semibold">{formatCurrency(c.totalSpent ?? 0)}</td>
                        <td className="py-3">
                          <Button size="sm" variant="ghost" onClick={() => isGuest ? setSelectedGuest(c) : setSelectedId(c.id)}>
                            <Eye size={14} className="mr-1" /> Lihat
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
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
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setDeleteTarget({ id: c.id, name: c.companyName ?? c.name })}><Trash2 size={14} /></Button>
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

      <Dialog open={selectedGuest !== null} onOpenChange={(v) => !v && setSelectedGuest(null)}>
        {selectedGuest && <GuestDetailDialog guest={selectedGuest} onClose={() => setSelectedGuest(null)} />}
      </Dialog>

      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setEditCustomer(null); } }}>
        {showForm && <CompanyForm initial={editCustomer} onClose={() => { setShowForm(false); setEditCustomer(null); }} />}
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Akun Perusahaan?</AlertDialogTitle>
            <AlertDialogDescription>
              Akun <strong>{deleteTarget?.name}</strong> akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
