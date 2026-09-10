import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { getToken } from "@/lib/auth";
import { CalendarDays, Plus, SquareStop } from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const headers = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

export default function AdminCorporateSubscriptions() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ companyId: "", facilityId: "", dayOfWeek: "1", startTime: "19:00", endTime: "21:00", effectiveStartDate: "", pricePerHour: "" });
  const [range, setRange] = useState({ from: "", to: "" });
  const subscriptions = useQuery({ queryKey: ["corporate-subscriptions"], queryFn: async () => {
    const r = await fetch(`${API}/corporate-subscriptions`, { headers: headers() }); if (!r.ok) throw new Error(await r.text()); return r.json();
  }});
  const create = useMutation({ mutationFn: async () => {
    const r = await fetch(`${API}/corporate-subscriptions`, { method: "POST", headers: headers(), body: JSON.stringify({ ...form, companyId: Number(form.companyId), facilityId: Number(form.facilityId), dayOfWeek: Number(form.dayOfWeek) }) });
    if (!r.ok) throw new Error(await r.text()); return r.json();
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["corporate-subscriptions"] }); setForm({ companyId: "", facilityId: "", dayOfWeek: "1", startTime: "19:00", endTime: "21:00", effectiveStartDate: "", pricePerHour: "" }); }});
  const action = async (url: string, method: string, body?: unknown) => {
    const r = await fetch(`${API}${url}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(await r.text()); return r.json();
  };
  const generate = useMutation({ mutationFn: (id: number) => action(`/corporate-subscriptions/${id}/generate`, "POST", { ...range, pricePerHour: Number(form.pricePerHour) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["corporate-subscriptions"] }) });
  const stop = useMutation({ mutationFn: (id: number) => action(`/corporate-subscriptions/${id}/stop`, "POST", { reason: "Dihentikan oleh admin" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["corporate-subscriptions"] }) });

  return <div className="space-y-6">
    <div><h1 className="text-3xl font-black flex items-center gap-2"><CalendarDays /> Corporate Subscription</h1><p className="text-muted-foreground mt-1">Master jadwal mingguan dan occurrence corporate.</p></div>
    <Card><CardHeader><CardTitle>Buat Subscription</CardTitle></CardHeader><CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {([["companyId", "Company ID"], ["facilityId", "Facility ID"], ["pricePerHour", "Harga / jam"]] as const).map(([key, label]) => <div key={key}><Label>{label}</Label><Input type="number" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></div>)}
      <div><Label>Hari (0 Minggu - 6 Sabtu)</Label><Input type="number" min="0" max="6" value={form.dayOfWeek} onChange={e => setForm({ ...form, dayOfWeek: e.target.value })} /></div>
      <div><Label>Mulai</Label><Input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} /></div>
      <div><Label>Selesai</Label><Input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} /></div>
      <div><Label>Tanggal efektif</Label><Input type="date" value={form.effectiveStartDate} onChange={e => setForm({ ...form, effectiveStartDate: e.target.value })} /></div>
      <div className="col-span-2 md:col-span-4"><Button disabled={create.isPending} onClick={() => create.mutate()}><Plus className="mr-2 h-4 w-4" />Buat Subscription</Button>{create.isError && <p className="text-sm text-destructive mt-2">{(create.error as Error).message}</p>}</div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Generate Occurrence</CardTitle></CardHeader><CardContent className="flex flex-wrap items-end gap-4"><div><Label>Dari</Label><Input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div><div><Label>Sampai</Label><Input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div><p className="text-sm text-muted-foreground">Generation idempotent; subscription berhenti tidak akan membuat occurrence baru.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Daftar Subscription</CardTitle></CardHeader><CardContent className="space-y-3">{subscriptions.isLoading ? <p>Memuat...</p> : (subscriptions.data ?? []).map((s: any) => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><div className="font-semibold">#{s.id} · Company {s.companyId} · Facility {s.facilityId}</div><div className="text-sm text-muted-foreground">Hari {s.dayOfWeek} · {s.startTime}–{s.endTime} · mulai {s.effectiveStartDate}</div></div><div className="flex items-center gap-2"><Badge>{s.status}</Badge>{s.status === "active" && <><Button size="sm" variant="outline" onClick={() => generate.mutate(s.id)}>Generate</Button><Button size="sm" variant="destructive" onClick={() => stop.mutate(s.id)}><SquareStop className="mr-1 h-4 w-4" />Stop</Button></>}</div></div>)}</CardContent></Card>
  </div>;
}