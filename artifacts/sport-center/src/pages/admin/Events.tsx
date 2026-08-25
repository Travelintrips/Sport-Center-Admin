import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Camera, CheckCircle2, Clock3, Plus, RefreshCw, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getToken } from "@/lib/auth";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const headers = () => ({ Authorization: `Bearer ${getToken()}` });
const jsonHeaders = () => ({ ...headers(), "Content-Type": "application/json" });
const money = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Permintaan gagal diproses";
}

export default function AdminEvents() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [discount, setDiscount] = useState(true);
  const [form, setForm] = useState({
    facilityId: "", bookingDate: "", startTime: "09:00", endTime: "17:00",
    customerName: "", customerEmail: "", customerPhone: "", numberOfPeople: "",
    payerType: "personal", companyCustomerId: "", notes: "",
  });

  const facilities = useQuery({
    queryKey: ["event-facilities"],
    queryFn: async () => {
      const response = await fetch(`${API}/facilities?activeOnly=true`);
      if (!response.ok) throw new Error("Gagal memuat fasilitas");
      return response.json();
    },
  });
  const companies = useQuery({
    queryKey: ["event-companies"],
    queryFn: async () => {
      const response = await fetch(`${API}/customers?accountType=company`, { headers: headers() });
      if (!response.ok) throw new Error("Gagal memuat perusahaan");
      const data = await response.json();
      return Array.isArray(data) ? data : data.customers ?? data.data ?? [];
    },
  });
  const events = useQuery({
    queryKey: ["admin-events"],
    queryFn: async () => {
      const response = await fetch(`${API}/events`, { headers: headers() });
      if (!response.ok) throw new Error("Gagal memuat event");
      return response.json();
    },
  });
  const detail = useQuery({
    queryKey: ["admin-event-detail", selectedId],
    enabled: selectedId !== null,
    queryFn: async () => {
      const [bookingResponse, historyResponse, proofResponse] = await Promise.all([
        fetch(`${API}/bookings/${selectedId}`, { headers: headers() }),
        fetch(`${API}/bookings/${selectedId}/history`, { headers: headers() }),
        fetch(`${API}/bookings/${selectedId}/usage-proof`, { headers: headers() }),
      ]);
      if (!bookingResponse.ok) throw new Error("Gagal memuat detail event");
      return {
        booking: await bookingResponse.json(),
        history: historyResponse.ok ? await historyResponse.json() : [],
        proofs: proofResponse.ok ? await proofResponse.json() : [],
      };
    },
  });
  const selectedFacility = useMemo(
    () => (facilities.data ?? []).find((facility: any) => facility.id === Number(form.facilityId)),
    [facilities.data, form.facilityId],
  );
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const duration = Math.max(0, (toMinutes(form.endTime) - toMinutes(form.startTime)) / 60);
  const baseTotal = selectedFacility ? Math.round(Number(selectedFacility.pricePerHour) * Math.max(1, duration)) : 0;
  const totalPrice = discount ? Math.round(baseTotal * 0.786) : baseTotal;

  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${API}/events`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          ...form,
          facilityId: Number(form.facilityId),
          companyCustomerId: form.payerType === "company" ? Number(form.companyCustomerId) : undefined,
          numberOfPeople: form.numberOfPeople ? Number(form.numberOfPeople) : undefined,
          totalPrice,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: (event) => {
      qc.invalidateQueries({ queryKey: ["admin-events"] });
      setSelectedId(event.id);
      setForm({ facilityId: "", bookingDate: "", startTime: "09:00", endTime: "17:00", customerName: "", customerEmail: "", customerPhone: "", numberOfPeople: "", payerType: "personal", companyCustomerId: "", notes: "" });
    },
  });
  const checkIn = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`${API}/bookings/${id}/check-in`, { method: "POST", headers: jsonHeaders(), body: "{}" });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-events"] }); qc.invalidateQueries({ queryKey: ["admin-event-detail", selectedId] }); },
  });
  const complete = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`${API}/bookings/${id}/status`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ status: "completed" }) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-events"] }); qc.invalidateQueries({ queryKey: ["admin-event-detail", selectedId] }); },
  });
  const uploadProof = useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const body = new FormData();
      body.append("photo", file);
      const response = await fetch(`${API}/bookings/${id}/usage-proof`, { method: "POST", headers: headers(), body });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-event-detail", selectedId] }); },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black flex items-center gap-2"><CalendarDays /> Event</h1>
        <p className="text-muted-foreground mt-1">Event satu kali, check-in, photo proof, dan penyelesaian booking.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Buat Event</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div><Label>Fasilitas</Label><select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={form.facilityId} onChange={e => setForm({ ...form, facilityId: e.target.value })}><option value="">Pilih fasilitas</option>{(facilities.data ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
          <div><Label>Tanggal</Label><Input type="date" value={form.bookingDate} onChange={e => setForm({ ...form, bookingDate: e.target.value })} /></div>
          <div><Label>Mulai</Label><Input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} /></div>
          <div><Label>Selesai</Label><Input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} /></div>
          <div><Label>Nama peserta / PIC</Label><Input value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} /></div>
          <div><Label>Email</Label><Input type="email" value={form.customerEmail} onChange={e => setForm({ ...form, customerEmail: e.target.value })} /></div>
          <div><Label>No. telepon</Label><Input value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} /></div>
          <div><Label>Jumlah peserta</Label><Input type="number" min="1" value={form.numberOfPeople} onChange={e => setForm({ ...form, numberOfPeople: e.target.value })} /></div>
          <div><Label>Pembayar</Label><select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={form.payerType} onChange={e => setForm({ ...form, payerType: e.target.value })}><option value="personal">Personal</option><option value="company">Perusahaan</option></select></div>
          {form.payerType === "company" && <div><Label>Perusahaan</Label><select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={form.companyCustomerId} onChange={e => setForm({ ...form, companyCustomerId: e.target.value })}><option value="">Pilih perusahaan</option>{(companies.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.companyName ?? c.name}</option>)}</select></div>}
          <div className="flex items-center gap-2 pt-6"><input id="event-discount" type="checkbox" checked={discount} onChange={e => setDiscount(e.target.checked)} /><Label htmlFor="event-discount">Diskon Event 21,4%</Label></div>
          <div><Label>Total</Label><div className="h-10 flex items-center font-bold">{money(totalPrice)}</div></div>
          <div className="md:col-span-4"><Label>Catatan</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="md:col-span-4 flex items-center gap-3"><Button disabled={create.isPending || !form.facilityId || !form.bookingDate || !form.customerName} onClick={() => create.mutate()}><Plus className="mr-2 h-4 w-4" />Simpan Event</Button>{create.isError && <span className="text-sm text-destructive">{errorText(create.error)}</span>}</div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3"><CardHeader><CardTitle>Daftar Event</CardTitle></CardHeader><CardContent className="space-y-2">{events.isLoading ? <p>Memuat...</p> : (events.data ?? []).map((event: any) => <button key={event.id} onClick={() => setSelectedId(event.id)} className={`w-full text-left rounded-lg border p-4 transition hover:border-primary ${selectedId === event.id ? "border-primary bg-primary/5" : ""}`}><div className="flex justify-between gap-3"><div><div className="font-semibold">{event.customerName}</div><div className="text-sm text-muted-foreground">{event.bookingDate} · {event.startTime}–{event.endTime}</div><div className="text-xs text-muted-foreground">{event.orderNumber} · {money(Number(event.totalPrice))}</div></div><Badge>{event.status}</Badge></div></button>)}</CardContent></Card>
        <Card className="lg:col-span-2"><CardHeader><CardTitle>Detail Event</CardTitle></CardHeader><CardContent>{!selectedId ? <p className="text-sm text-muted-foreground">Pilih event untuk melihat detail.</p> : detail.isLoading ? <p>Memuat...</p> : detail.data && <div className="space-y-4 text-sm"><div><div className="font-bold text-lg">{detail.data.booking.customerName}</div><div>{detail.data.booking.bookingDate} · {detail.data.booking.startTime}–{detail.data.booking.endTime}</div><div className="text-muted-foreground">{detail.data.booking.orderNumber}</div></div><div className="grid grid-cols-2 gap-2"><span>Status booking</span><Badge>{detail.data.booking.status}</Badge><span>Check-in</span><span>{detail.data.booking.checkedInAt ? "Sudah" : "Wajib"}</span><span>Photo proof</span><span>{detail.data.proofs.length ? "Sudah" : "Wajib"}</span><span>Pembayaran</span><span>{detail.data.booking.payerType === "company" ? "Invoice perusahaan" : detail.data.booking.status}</span></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!detail.data.booking.checkedInAt || checkIn.isPending} onClick={() => checkIn.mutate(selectedId)}><CheckCircle2 className="mr-1 h-4 w-4" />Check-in</Button><label className="inline-flex"><input className="hidden" type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) uploadProof.mutate({ id: selectedId, file }); }} /><Button asChild size="sm" variant="outline"><span><Camera className="mr-1 h-4 w-4" />Upload proof</span></Button></label><Button size="sm" disabled={detail.data.booking.status !== "confirmed" || !detail.data.booking.checkedInAt || complete.isPending} onClick={() => complete.mutate(selectedId)}><Clock3 className="mr-1 h-4 w-4" />Selesaikan</Button></div>{(checkIn.isError || uploadProof.isError || complete.isError) && <p className="text-xs text-destructive">{errorText(checkIn.error ?? uploadProof.error ?? complete.error)}</p>}<div><div className="font-semibold mb-2">History</div>{(detail.data.history ?? []).length ? detail.data.history.map((h: any) => <div key={h.id} className="border-l-2 pl-3 mb-2 text-xs"><div>{h.note ?? `${h.fromStatus} → ${h.toStatus}`}</div><div className="text-muted-foreground">{h.createdAt ? new Date(h.createdAt).toLocaleString("id-ID") : ""}</div></div>) : <span className="text-muted-foreground">Belum ada history.</span>}</div></div>}</CardContent></Card>
      </div>
    </div>
  );
}