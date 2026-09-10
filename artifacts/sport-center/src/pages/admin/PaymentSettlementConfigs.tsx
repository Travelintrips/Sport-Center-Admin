import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building2, Landmark, Lock, Plus, PowerOff, RefreshCw } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const headers = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

type ConfigData = {
  companies: Array<{ id: number; code: string | null; name: string }>;
  bankAccounts: Array<{ id: number; company_id: number; bank_name: string; name: string; account_number: string; coa_id: number | null; is_active: boolean }>;
  configs: Array<{ id: number; companyId: number; providerCode: string; bankAccountId: string; effectiveFrom: string; effectiveUntil: string | null; settlementDelayBusinessDays: number; source: string; isActive: boolean; status?: "active" | "scheduled" | "ended" | "inactive" }>;
};

type OverlapRule = {
  id: number;
  bankAccountId: string;
  settlementDelayBusinessDays: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: Record<string, any>) {
    super(message);
  }
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiRequestError(body.error ?? `HTTP ${response.status}`, response.status, body);
  return body;
}

export default function PaymentSettlementConfigs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [accountForm, setAccountForm] = useState({ bankName: "Bank Mandiri", name: "Bank Mandiri CST", accountNumber: "", coaId: "" });
  const [ruleForm, setRuleForm] = useState({ bankAccountId: "", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveUntil: "", delay: "1" });
  const [overlapRules, setOverlapRules] = useState<OverlapRule[] | null>(null);
  const [closingRule, setClosingRule] = useState<ConfigData["configs"][number] | null>(null);
  const [closeDate, setCloseDate] = useState("");
  const [deactivatingRule, setDeactivatingRule] = useState<ConfigData["configs"][number] | null>(null);
  const query = useQuery<ConfigData>({
    queryKey: ["payment-settlement-configs", companyId],
    queryFn: () => request(`/admin/payment-settlement-configs${companyId ? `?companyId=${companyId}` : ""}`),
    staleTime: 30_000,
    retry: 1,
  });
  const selectedAccounts = useMemo(
    () => (query.data?.bankAccounts ?? []).filter((account) => !companyId || String(account.company_id) === companyId),
    [query.data, companyId],
  );
  const selectableAccounts = useMemo(
    () => selectedAccounts.filter((account) => account.is_active && String(account.account_number ?? "").trim().length > 0),
    [selectedAccounts],
  );
  const createAccount = useMutation({
    mutationFn: () => request("/admin/payment-settlement-configs/bank-accounts", { method: "POST", body: JSON.stringify({ companyId: Number(companyId), ...accountForm }) }),
    onSuccess: () => { toast({ title: "Rekening perusahaan dibuat" }); queryClient.invalidateQueries({ queryKey: ["payment-settlement-configs"] }); setAccountForm({ bankName: "Bank Mandiri", name: "Bank Mandiri CST", accountNumber: "", coaId: "" }); },
    onError: (error: Error) => toast({ title: "Gagal membuat rekening", description: error.message, variant: "destructive" }),
  });
  const createRule = useMutation({
    mutationFn: ({ closeRuleIds = [] }: { closeRuleIds?: number[] } = {}) => request("/admin/payment-settlement-configs/rules", { method: "POST", body: JSON.stringify({ companyId: Number(companyId), bankAccountId: ruleForm.bankAccountId, effectiveFrom: ruleForm.effectiveFrom, effectiveUntil: ruleForm.effectiveUntil || null, settlementDelayBusinessDays: Number(ruleForm.delay), closeRuleIds }) }),
    onSuccess: () => { toast({ title: "Rule QRIS Mandiri CST dibuat" }); setOverlapRules(null); queryClient.invalidateQueries({ queryKey: ["payment-settlement-configs"] }); },
    onError: (error: Error) => {
      if (error instanceof ApiRequestError && error.status === 409 && error.body.code === "SETTLEMENT_RULE_OVERLAP") {
        setOverlapRules((error.body.overlaps ?? []) as OverlapRule[]);
      }
      toast({ title: "Gagal membuat rule", description: error.message, variant: "destructive" });
    },
  });
  const updateRule = useMutation({
    mutationFn: ({ id, action, effectiveUntil }: { id: number; action: "close" | "deactivate"; effectiveUntil?: string }) => request(`/admin/payment-settlement-configs/rules/${id}`, { method: "PATCH", body: JSON.stringify({ action, ...(effectiveUntil ? { effectiveUntil } : {}) }) }),
    onSuccess: (_data, variables) => {
      toast({ title: variables.action === "close" ? "Periode rule ditutup" : "Rule dinonaktifkan", description: "Perubahan telah dicatat di audit log." });
      setClosingRule(null);
      setDeactivatingRule(null);
      queryClient.invalidateQueries({ queryKey: ["payment-settlement-configs"] });
    },
    onError: (error: Error) => toast({ title: "Gagal mengubah rule", description: error.message, variant: "destructive" }),
  });

  const today = new Date().toISOString().slice(0, 10);
  const statusLabel: Record<NonNullable<ConfigData["configs"][number]["status"]>, string> = {
    active: "Aktif",
    scheduled: "Akan berlaku",
    ended: "Berakhir",
    inactive: "Nonaktif",
  };
  const statusVariant: Record<NonNullable<ConfigData["configs"][number]["status"]>, "default" | "secondary" | "outline"> = {
    active: "default",
    scheduled: "outline",
    ended: "secondary",
    inactive: "secondary",
  };

  const openCloseDialog = (config: ConfigData["configs"][number]) => {
    setClosingRule(config);
    setCloseDate(config.effectiveUntil ?? (config.effectiveFrom > today ? config.effectiveFrom : today));
  };

  const accountName = (accountNumber: string) =>
    selectedAccounts.find((account) => String(account.account_number).trim() === accountNumber)?.name ?? accountNumber;

  const formatRange = (config: ConfigData["configs"][number]) =>
    `${config.effectiveFrom} — ${config.effectiveUntil ?? "tanpa batas"}`;

  const ruleStatus = (config: ConfigData["configs"][number]) =>
    config.status ?? (config.isActive ? (config.effectiveFrom > today ? "scheduled" : config.effectiveUntil && config.effectiveUntil < today ? "ended" : "active") : "inactive");

  const closeRuleIds = overlapRules?.map((rule) => rule.id) ?? [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Rekening & Settlement Perusahaan</h1>
        <p className="text-sm text-muted-foreground mt-1">Konfigurasi rekening aktif dan settlement QRIS ke Bank Mandiri CST.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 size={18} /> Company</CardTitle></CardHeader>
        <CardContent>
          <Select
            value={companyId}
            onValueChange={(value) => { setCompanyId(value); setRuleForm((current) => ({ ...current, bankAccountId: "" })); }}
            disabled={query.isLoading || query.isError || !(query.data?.companies?.length)}
          >
            <SelectTrigger><SelectValue placeholder="Pilih company" /></SelectTrigger>
            <SelectContent>
              {query.isLoading && <SelectItem value="_loading" disabled>Memuat company...</SelectItem>}
              {query.isError && <SelectItem value="_error" disabled>Gagal memuat company</SelectItem>}
              {!query.isLoading && !query.isError && !(query.data?.companies?.length) && (
                <SelectItem value="_empty" disabled>Tidak ada company aktif</SelectItem>
              )}
              {(query.data?.companies ?? []).map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {query.isError && (
            <div className="mt-2 flex items-center justify-between gap-3 text-sm text-destructive">
              <span>{(query.error as Error)?.message ?? "Daftar company tidak dapat dimuat."}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>Coba lagi</Button>
            </div>
          )}
          {!query.isError && (
            <p className="mt-2 text-xs text-muted-foreground">
              Pilihan diambil dari company aktif pada Supabase environment yang sedang digunakan.
            </p>
          )}
        </CardContent>
      </Card>
      {companyId && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Landmark size={18} /> Rekening aktif</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {selectedAccounts.map((account) => <div key={account.id} className="flex items-center justify-between rounded-lg border p-3"><div><div className="font-medium">{account.name}</div><div className="text-sm text-muted-foreground">{account.bank_name} · {account.account_number}</div></div><Badge variant={account.is_active ? "default" : "secondary"}>{account.is_active ? "Aktif" : "Nonaktif"}</Badge></div>)}
                {!selectedAccounts.length && <p className="text-sm text-muted-foreground">Belum ada rekening. Buat rekening baru di bawah.</p>}
                <div className="border-t pt-4 space-y-3">
                  <Label>Bank</Label><Input value={accountForm.bankName} onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })} />
                  <Label>Nama rekening</Label><Input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} />
                  <Label>Nomor rekening / account number</Label><Input value={accountForm.accountNumber} onChange={(e) => setAccountForm({ ...accountForm, accountNumber: e.target.value })} placeholder="Nomor rekening Mandiri CST" />
                  <Label>COA ID (opsional, harus sudah disetujui Finance)</Label><Input value={accountForm.coaId} onChange={(e) => setAccountForm({ ...accountForm, coaId: e.target.value })} placeholder="Contoh: 49098" />
                  <Button disabled={!accountForm.accountNumber || createAccount.isPending} onClick={() => createAccount.mutate()}><Plus size={16} className="mr-2" /> Buat rekening</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Settlement QRIS Mandiri CST</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Label>Rekening settlement</Label>
                <Select value={ruleForm.bankAccountId} onValueChange={(value) => setRuleForm({ ...ruleForm, bankAccountId: value })}>
                  <SelectTrigger><SelectValue placeholder="Pilih rekening aktif" /></SelectTrigger>
                  <SelectContent>
                    {selectableAccounts.map((account) => {
                      const accountNumber = String(account.account_number).trim();
                      return <SelectItem key={account.id} value={accountNumber}>{account.name} · {accountNumber}</SelectItem>;
                    })}
                    {!selectableAccounts.length && <SelectItem value="_no-valid-account" disabled>Tidak ada rekening aktif yang valid</SelectItem>}
                  </SelectContent>
                </Select>
                <Label>Efektif mulai</Label>
                <Input
                  type="date"
                  value={ruleForm.effectiveFrom}
                  onChange={(e) => setRuleForm({ ...ruleForm, effectiveFrom: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Tanggal historis diperbolehkan untuk memperbaiki konfigurasi settlement pembayaran lama.
                </p>
                <Label>Efektif sampai (opsional)</Label><Input type="date" value={ruleForm.effectiveUntil} onChange={(e) => setRuleForm({ ...ruleForm, effectiveUntil: e.target.value })} />
                <Label>Delay settlement (hari kerja)</Label><Input type="number" min="0" value={ruleForm.delay} onChange={(e) => setRuleForm({ ...ruleForm, delay: e.target.value })} />
                <Button disabled={!ruleForm.bankAccountId || createRule.isPending} onClick={() => createRule.mutate({})}><Plus size={16} className="mr-2" /> Buat rule `mandiri_direct`</Button>
                <div className="border-t pt-4 space-y-3">
                  <div>
                    <h3 className="font-medium">Rule tersimpan</h3>
                    <p className="text-xs text-muted-foreground mt-1">Satu tanggal hanya boleh memiliki satu rule aktif. Untuk mengganti rekening atau delay, tutup periode lama secara eksplisit.</p>
                  </div>
                  {(query.data?.configs ?? []).filter((config) => config.companyId === Number(companyId)).map((config) => {
                    const status = ruleStatus(config);
                    return (
                      <div key={config.id} className="rounded border p-3 space-y-2" data-testid={`settlement-rule-${config.id}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{config.providerCode} · {accountName(config.bankAccountId)}</div>
                            <div className="text-sm text-muted-foreground">{config.bankAccountId} · delay {config.settlementDelayBusinessDays} hari kerja</div>
                          </div>
                          <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">Efektif: {formatRange(config)} · sumber {config.source}</div>
                        {config.isActive && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {!config.effectiveUntil && (
                              <Button type="button" variant="outline" size="sm" onClick={() => openCloseDialog(config)} disabled={updateRule.isPending}>
                                <Lock size={14} className="mr-1" /> Tutup periode
                              </Button>
                            )}
                            {status === "scheduled" && (
                              <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeactivatingRule(config)} disabled={updateRule.isPending}>
                                <PowerOff size={14} className="mr-1" /> Nonaktifkan
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!(query.data?.configs ?? []).some((config) => config.companyId === Number(companyId)) && <p className="text-sm text-muted-foreground">Belum ada rule settlement.</p>}
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2"><RefreshCw size={13} /> COA tidak dibuat otomatis dari payment method; gunakan COA ID yang sudah dibuat dan disetujui di master accounting.</div>
        </>
      )}

      <Dialog open={Boolean(overlapRules)} onOpenChange={(open) => !open && setOverlapRules(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Periode settlement bertumpang tindih</DialogTitle>
            <DialogDescription>
              Rule baru memakai periode yang sudah memiliki rule aktif. Tindakan berikut akan menutup periode lama satu hari sebelum {ruleForm.effectiveFrom} dan mencatatnya di audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(overlapRules ?? []).map((rule) => (
              <div key={rule.id} className="rounded border p-3 text-sm">
                <div className="font-medium">Rule #{rule.id} · {rule.bankAccountId}</div>
                <div className="text-muted-foreground">Delay {rule.settlementDelayBusinessDays} hari kerja · {rule.effectiveFrom} — {rule.effectiveUntil ?? "tanpa batas"}</div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOverlapRules(null)}>Batal</Button>
            <Button type="button" onClick={() => createRule.mutate({ closeRuleIds })} disabled={createRule.isPending || !closeRuleIds.length}>
              Tutup rule lama & buat baru
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(closingRule)} onOpenChange={(open) => !open && setClosingRule(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tutup periode rule</DialogTitle>
            <DialogDescription>
              Rule tetap tersimpan untuk histori, tetapi tidak akan berlaku setelah tanggal yang dipilih.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="settlement-close-date">Berlaku sampai</Label>
            <Input id="settlement-close-date" type="date" min={closingRule && closingRule.effectiveFrom > today ? closingRule.effectiveFrom : today} value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setClosingRule(null)}>Batal</Button>
            <Button type="button" onClick={() => closingRule && updateRule.mutate({ id: closingRule.id, action: "close", effectiveUntil: closeDate })} disabled={!closingRule || !closeDate || updateRule.isPending}>
              <Lock size={14} className="mr-1" /> Tutup periode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deactivatingRule)} onOpenChange={(open) => !open && setDeactivatingRule(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan rule settlement?</AlertDialogTitle>
            <AlertDialogDescription>
              Rule #{deactivatingRule?.id} belum mulai berlaku dan akan dibatalkan. Data rule tidak dihapus dan perubahan dicatat di audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivatingRule && updateRule.mutate({ id: deactivatingRule.id, action: "deactivate" })} disabled={updateRule.isPending}>
              <PowerOff size={14} className="mr-1" /> Nonaktifkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}