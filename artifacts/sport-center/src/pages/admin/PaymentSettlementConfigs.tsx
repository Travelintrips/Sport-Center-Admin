import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Landmark, Plus, RefreshCw } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const headers = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

type ConfigData = {
  companies: Array<{ id: number; code: string | null; name: string }>;
  bankAccounts: Array<{ id: number; company_id: number; bank_name: string; name: string; account_number: string; coa_id: number | null; is_active: boolean }>;
  configs: Array<{ id: number; companyId: number; providerCode: string; bankAccountId: string; effectiveFrom: string; effectiveUntil: string | null; source: string; isActive: boolean }>;
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export default function PaymentSettlementConfigs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [accountForm, setAccountForm] = useState({ bankName: "Bank Mandiri", name: "Bank Mandiri CST", accountNumber: "", coaId: "" });
  const [ruleForm, setRuleForm] = useState({ bankAccountId: "", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveUntil: "", delay: "1" });
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
    mutationFn: () => request("/admin/payment-settlement-configs/rules", { method: "POST", body: JSON.stringify({ companyId: Number(companyId), bankAccountId: ruleForm.bankAccountId, effectiveFrom: ruleForm.effectiveFrom, effectiveUntil: ruleForm.effectiveUntil || null, settlementDelayBusinessDays: Number(ruleForm.delay) }) }),
    onSuccess: () => { toast({ title: "Rule QRIS Mandiri CST dibuat" }); queryClient.invalidateQueries({ queryKey: ["payment-settlement-configs"] }); },
    onError: (error: Error) => toast({ title: "Gagal membuat rule", description: error.message, variant: "destructive" }),
  });

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
                <Label>Efektif mulai</Label><Input type="date" value={ruleForm.effectiveFrom} onChange={(e) => setRuleForm({ ...ruleForm, effectiveFrom: e.target.value })} />
                <Label>Efektif sampai (opsional)</Label><Input type="date" value={ruleForm.effectiveUntil} onChange={(e) => setRuleForm({ ...ruleForm, effectiveUntil: e.target.value })} />
                <Label>Delay settlement (hari kerja)</Label><Input type="number" min="0" value={ruleForm.delay} onChange={(e) => setRuleForm({ ...ruleForm, delay: e.target.value })} />
                <Button disabled={!ruleForm.bankAccountId || createRule.isPending} onClick={() => createRule.mutate()}><Plus size={16} className="mr-2" /> Buat rule `mandiri_direct`</Button>
                <div className="border-t pt-4 space-y-2"><h3 className="font-medium">Rule tersimpan</h3>{(query.data?.configs ?? []).filter((config) => config.companyId === Number(companyId)).map((config) => <div key={config.id} className="text-sm rounded border p-2">{config.providerCode} · {config.bankAccountId} · mulai {config.effectiveFrom} <Badge className="ml-2">{config.source}</Badge></div>)}</div>
              </CardContent>
            </Card>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2"><RefreshCw size={13} /> COA tidak dibuat otomatis dari payment method; gunakan COA ID yang sudah dibuat dan disetujui di master accounting.</div>
        </>
      )}
    </div>
  );
}