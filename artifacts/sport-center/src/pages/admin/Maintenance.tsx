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
import { Plus, Trash2, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

const TYPE_LABELS: Record<string, string> = {
  maintenance: "Maintenance",
  renovation: "Renovasi",
  internal_event: "Event Internal",
  cleaning: "Kebersihan",
};

const TYPE_COLORS: Record<string, string> = {
  maintenance: "bg-orange-100 text-orange-700",
  renovation: "bg-red-100 text-red-700",
  internal_event: "bg-blue-100 text-blue-700",
  cleaning: "bg-green-100 text-green-700",
};

const DEFAULT_FORM = { facilityId: "", title: "", maintenanceType: "maintenance", startDate: "", endDate: "", startTime: "", endTime: "", allDay: false, reason: "" };

export default function AdminMaintenance() {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ["maintenance-schedules"],
    queryFn: () => fetch(`${API}/maintenance-schedules`, { headers: authHeaders() }).then(r => r.json()),
  });

  const { data: facilities = [] } = useQuery({
    queryKey: ["facilities"],
    queryFn: () => fetch(`${API}/facilities`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => fetch(`${API}/maintenance-schedules`, { method: "POST", headers: authHeaders(), body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["maintenance-schedules"] }); setIsOpen(false); setForm(DEFAULT_FORM); toast({ title: "Jadwal maintenance dibuat" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(`${API}/maintenance-schedules/${id}`, { method: "DELETE", headers: authHeaders() }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["maintenance-schedules"] }); toast({ title: "Jadwal dihapus" }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      fetch(`${API}/maintenance-schedules/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ isActive }) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance-schedules"] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      facilityId: Number(form.facilityId),
      allDay: form.allDay,
      startTime: form.allDay ? null : form.startTime || null,
      endTime: form.allDay ? null : form.endTime || null,
    });
  }

  const active = schedules.filter((s: any) => s.isActive);
  const inactive = schedules.filter((s: any) => !s.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-2"><Wrench size={28} /> Maintenance Schedule</h1>
          <p className="text-muted-foreground mt-1">Atur jadwal maintenance, renovasi, dan event internal. Slot akan otomatis diblokir.</p>
        </div>
        <Button onClick={() => setIsOpen(true)} className="gap-2"><Plus size={16} /> Tambah Jadwal</Button>
      </div>

      {/* Active */}
      <Card>
        <CardHeader><CardTitle>Jadwal Aktif ({active.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <div className="text-center py-8 text-muted-foreground">Memuat...</div> :
          active.length === 0 ? <div className="text-center py-8 text-muted-foreground">Tidak ada jadwal aktif</div> : (
            <div className="space-y-3">
              {active.map((s: any) => (
                <div key={s.id} className="flex items-start justify-between p-4 border rounded-lg">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{s.title}</span>
                      <Badge className={TYPE_COLORS[s.maintenanceType] ?? "bg-gray-100 text-gray-700"}>{TYPE_LABELS[s.maintenanceType] ?? s.maintenanceType}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">{s.facilityName}</span>
                      {" • "}
                      {s.startDate === s.endDate ? s.startDate : `${s.startDate} s/d ${s.endDate}`}
                      {s.allDay ? " (Seharian)" : s.startTime ? ` • ${s.startTime}–${s.endTime}` : ""}
                    </div>
                    {s.reason && <div className="text-xs text-muted-foreground mt-1">Alasan: {s.reason}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <Switch checked={s.isActive} onCheckedChange={(v) => toggleMutation.mutate({ id: s.id, isActive: v })} />
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteMutation.mutate(s.id)}><Trash2 size={16} /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {inactive.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-muted-foreground">Riwayat Nonaktif ({inactive.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {inactive.map((s: any) => (
                <div key={s.id} className="flex items-start justify-between p-3 border rounded-lg opacity-60">
                  <div className="text-sm">
                    <span className="font-medium">{s.title}</span> — {s.facilityName}
                    <span className="text-muted-foreground"> • {s.startDate} s/d {s.endDate}</span>
                  </div>
                  <div className="flex gap-2">
                    <Switch checked={false} onCheckedChange={(v) => toggleMutation.mutate({ id: s.id, isActive: v })} />
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteMutation.mutate(s.id)}><Trash2 size={14} /></Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Jadwal Maintenance</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>Fasilitas *</Label>
              <Select value={form.facilityId} onValueChange={v => setForm(f => ({ ...f, facilityId: v }))} required>
                <SelectTrigger><SelectValue placeholder="Pilih fasilitas..." /></SelectTrigger>
                <SelectContent>{facilities.map((f: any) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Judul *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="cth: Pengecatan lapangan" />
            </div>
            <div className="space-y-1">
              <Label>Tipe</Label>
              <Select value={form.maintenanceType} onValueChange={v => setForm(f => ({ ...f, maintenanceType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Tanggal Mulai *</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
              </div>
              <div className="space-y-1">
                <Label>Tanggal Selesai *</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value, startDate: form.startDate || e.target.value }))} required />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.allDay} onCheckedChange={v => setForm(f => ({ ...f, allDay: v }))} />
              <Label>Seharian penuh</Label>
            </div>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Jam Mulai</Label>
                  <Input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Jam Selesai</Label>
                  <Input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label>Alasan / Keterangan</Label>
              <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Opsional" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Batal</Button>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Menyimpan..." : "Buat Jadwal"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
