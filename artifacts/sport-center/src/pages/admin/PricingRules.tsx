import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Plus, Trash2, DollarSign, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" };
}

const RULE_TYPES = [
  { value: "weekday", label: "Hari Kerja (Sen–Jum)" },
  { value: "weekend", label: "Akhir Pekan (Sab–Min)" },
  { value: "peak_hour", label: "Jam Ramai (Peak Hour)" },
  { value: "off_peak_hour", label: "Jam Sepi (Off-Peak)" },
  { value: "member", label: "Member" },
  { value: "promo", label: "Promo Khusus" },
];

const DEFAULT_FORM = { facilityId: "", name: "", ruleType: "weekend", dayType: "", peakStartTime: "", peakEndTime: "", priceOverride: "", priceAddon: "", priceMultiplier: "", priority: "0" };

export default function AdminPricingRules() {
  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["pricing-rules"],
    queryFn: () => fetch(`${API}/pricing-rules`, { headers: authHeaders() }).then(r => r.json()),
  });

  const { data: facilities = [] } = useQuery({
    queryKey: ["facilities"],
    queryFn: () => fetch(`${API}/facilities`).then(r => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = editId ? `${API}/pricing-rules/${editId}` : `${API}/pricing-rules`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing-rules"] });
      setIsOpen(false);
      setEditId(null);
      setForm(DEFAULT_FORM);
      toast({ title: "Berhasil", description: editId ? "Rule diupdate" : "Rule dibuat" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(`${API}/pricing-rules/${id}`, { method: "DELETE", headers: authHeaders() }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pricing-rules"] }); toast({ title: "Rule dihapus" }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      fetch(`${API}/pricing-rules/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ isActive }) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing-rules"] }),
  });

  function openCreate() { setEditId(null); setForm(DEFAULT_FORM); setIsOpen(true); }
  function openEdit(rule: any) {
    setEditId(rule.id);
    setForm({
      facilityId: String(rule.facilityId ?? ""),
      name: rule.name, ruleType: rule.ruleType, dayType: rule.dayType ?? "",
      peakStartTime: rule.peakStartTime ?? "", peakEndTime: rule.peakEndTime ?? "",
      priceOverride: rule.priceOverride != null ? String(rule.priceOverride) : "",
      priceAddon: rule.priceAddon != null ? String(rule.priceAddon) : "",
      priceMultiplier: rule.priceMultiplier != null ? String(rule.priceMultiplier) : "",
      priority: String(rule.priority ?? 0),
    });
    setIsOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate({
      facilityId: form.facilityId ? Number(form.facilityId) : null,
      name: form.name, ruleType: form.ruleType,
      dayType: form.dayType || null,
      peakStartTime: form.peakStartTime || null,
      peakEndTime: form.peakEndTime || null,
      priceOverride: form.priceOverride ? Number(form.priceOverride) : null,
      priceAddon: form.priceAddon ? Number(form.priceAddon) : null,
      priceMultiplier: form.priceMultiplier ? Number(form.priceMultiplier) : null,
      priority: Number(form.priority) || 0,
    });
  }

  const needsPeakTime = form.ruleType === "peak_hour" || form.ruleType === "off_peak_hour";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-2"><DollarSign size={28} /> Pricing Rules</h1>
          <p className="text-muted-foreground mt-1">Atur harga weekday, weekend, peak hour, dll.</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus size={16} /> Tambah Rule</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Memuat...</div>
          ) : rules.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <DollarSign size={48} className="mx-auto mb-3 opacity-30" />
              <p>Belum ada pricing rule. Klik tombol di atas untuk mulai.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule: any) => (
                <div key={rule.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{rule.name}</span>
                      <Badge variant="outline">{RULE_TYPES.find(r => r.value === rule.ruleType)?.label ?? rule.ruleType}</Badge>
                      {!rule.isActive && <Badge variant="secondary">Nonaktif</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {rule.facilityId ? `Fasilitas #${rule.facilityId}` : "Semua fasilitas"}
                      {rule.peakStartTime && ` • ${rule.peakStartTime}–${rule.peakEndTime}`}
                      {rule.priceOverride != null && ` • Override: Rp ${Number(rule.priceOverride).toLocaleString("id-ID")}/jam`}
                      {rule.priceAddon != null && ` • +Rp ${Number(rule.priceAddon).toLocaleString("id-ID")}/jam`}
                      {rule.priceMultiplier != null && ` • ×${rule.priceMultiplier}`}
                      {` • Prioritas: ${rule.priority}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={rule.isActive} onCheckedChange={(v) => toggleMutation.mutate({ id: rule.id, isActive: v })} />
                    <Button variant="ghost" size="icon" onClick={() => openEdit(rule)}><Pencil size={16} /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteMutation.mutate(rule.id)}><Trash2 size={16} /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Aturan Harga" : "Tambah Aturan Harga"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>Nama Rule *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="cth: Weekend Premium" />
            </div>
            <div className="space-y-1">
              <Label>Tipe Rule *</Label>
              <Select value={form.ruleType} onValueChange={v => setForm(f => ({ ...f, ruleType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RULE_TYPES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Fasilitas (opsional)</Label>
              <Select value={form.facilityId || "all"} onValueChange={v => setForm(f => ({ ...f, facilityId: v === "all" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Fasilitas</SelectItem>
                  {facilities.map((f: any) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {needsPeakTime && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Jam Mulai Peak</Label>
                  <Input type="time" value={form.peakStartTime} onChange={e => setForm(f => ({ ...f, peakStartTime: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Jam Selesai Peak</Label>
                  <Input type="time" value={form.peakEndTime} onChange={e => setForm(f => ({ ...f, peakEndTime: e.target.value }))} />
                </div>
              </div>
            )}
            <div className="text-sm font-medium text-muted-foreground pt-1">Penyesuaian Harga (pilih salah satu):</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Override Harga/jam</Label>
                <Input type="number" value={form.priceOverride} onChange={e => setForm(f => ({ ...f, priceOverride: e.target.value }))} placeholder="Rp" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tambah Harga/jam</Label>
                <Input type="number" value={form.priceAddon} onChange={e => setForm(f => ({ ...f, priceAddon: e.target.value }))} placeholder="+Rp" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Multiplier (×)</Label>
                <Input type="number" step="0.01" value={form.priceMultiplier} onChange={e => setForm(f => ({ ...f, priceMultiplier: e.target.value }))} placeholder="1.5" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Prioritas (lebih tinggi = didahulukan)</Label>
              <Input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Batal</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Menyimpan..." : editId ? "Update" : "Tambah"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
