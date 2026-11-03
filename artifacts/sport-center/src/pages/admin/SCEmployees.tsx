import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { Pencil, Plus, Search, Users } from "lucide-react";

type Employee = { employeeId: string; fullName: string; whatsappNumber: string; isActive: boolean; notes: string | null };
type Form = { employeeId: string; fullName: string; whatsappNumber: string; isActive: boolean; notes: string };
const emptyForm: Form = { employeeId: "", fullName: "", whatsappNumber: "", isActive: true, notes: "" };
const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(API + path, {
    method, headers: { Authorization: "Bearer " + getToken(), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Permintaan gagal");
  return json;
}
export default function SCEmployees() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const { data: employees = [], isLoading, isError, error } = useQuery<Employee[]>({
    queryKey: ["admin-sc-employees"], queryFn: () => request("/admin/sc-employees"),
  });
  const save = useMutation({
    mutationFn: (value: Form) => editing
      ? request("/admin/sc-employees/" + encodeURIComponent(editing), "PATCH", {
        fullName: value.fullName, whatsappNumber: value.whatsappNumber, isActive: value.isActive, notes: value.notes,
      })
      : request("/admin/sc-employees", "POST", value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-sc-employees"] });
      setOpen(false); setEditing(null); setForm(emptyForm);
      toast({ title: "Data karyawan berhasil disimpan" });
    },
    onError: (e: Error) => toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: (employee: Employee) => request("/admin/sc-employees/" + encodeURIComponent(employee.employeeId), "PATCH", { isActive: !employee.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-sc-employees"] });
      toast({ title: "Status karyawan berhasil diperbarui" });
    },
    onError: (e: Error) => toast({ title: "Gagal memperbarui status", description: e.message, variant: "destructive" }),
  });
  const filtered = employees.filter((employee) =>
    (filter === "all" || employee.isActive === (filter === "active")) &&
    [employee.employeeId, employee.fullName, employee.whatsappNumber].some((s) => s.toLowerCase().includes(search.toLowerCase()))
  );
  const edit = (employee: Employee) => {
    setEditing(employee.employeeId);
    setForm({ employeeId: employee.employeeId, fullName: employee.fullName, whatsappNumber: employee.whatsappNumber, isActive: employee.isActive, notes: employee.notes ?? "" });
    setOpen(true);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.employeeId.trim() || !form.fullName.trim() || !form.whatsappNumber.trim()) return;
    save.mutate(form);
  };
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Data Karyawan SC</h1><p className="text-sm text-muted-foreground">Master karyawan Sport Center untuk identitas WhatsApp Mina AI.</p></div>
        <Button onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }}><Plus className="mr-2 h-4 w-4"/>Tambah Karyawan</Button>
      </div>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5"/>Daftar Karyawan ({employees.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="pl-9" placeholder="Cari ID, nama atau WhatsApp..." value={search} onChange={(e) => setSearch(e.target.value)}/></div>
          <select className="rounded-md border bg-background px-3 py-2 text-sm" aria-label="Filter status" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">Semua Status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select>
        </div>
        {isLoading ? <p>Memuat data karyawan...</p> : isError ? <p role="alert" className="text-destructive">Gagal memuat: {(error as Error).message}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead><tr className="border-b"><th className="p-3">ID Karyawan</th><th className="p-3">Nama Lengkap</th><th className="p-3">Nomor WhatsApp</th><th className="p-3">Status</th><th className="p-3">Keterangan</th><th className="p-3">Tindakan</th></tr></thead>
            <tbody>{filtered.map((employee) => <tr key={employee.employeeId} className="border-b">
              <td className="p-3 font-medium">{employee.employeeId}</td><td className="p-3">{employee.fullName}</td><td className="p-3">{employee.whatsappNumber}</td>
              <td className="p-3"><Badge variant={employee.isActive ? "default" : "secondary"}>{employee.isActive ? "Aktif" : "Nonaktif"}</Badge></td>
              <td className="max-w-xs whitespace-pre-wrap p-3">{employee.notes || "-"}</td>
              <td className="p-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => edit(employee)}><Pencil className="mr-1 h-3 w-3"/>Edit</Button><Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(employee)}>{employee.isActive ? "Nonaktifkan" : "Aktifkan"}</Button></div></td>
            </tr>)}</tbody>
          </table>{!filtered.length && <p className="py-6 text-center text-muted-foreground">Belum ada karyawan yang sesuai.</p>}</div>
        )}
      </CardContent></Card>
      <Dialog open={open} onOpenChange={(value) => { if (!save.isPending) setOpen(value); }}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{editing ? "Edit Karyawan SC" : "Tambah Karyawan SC"}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1"><Label htmlFor="sc-id">ID Karyawan</Label><Input id="sc-id" required maxLength={32} disabled={!!editing} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value.toUpperCase() })} placeholder="SC001"/></div>
            <div className="space-y-1"><Label htmlFor="sc-name">Nama Lengkap</Label><Input id="sc-name" required maxLength={150} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })}/></div>
            <div className="space-y-1"><Label htmlFor="sc-phone">Nomor WhatsApp</Label><Input id="sc-phone" required type="tel" value={form.whatsappNumber} onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })} placeholder="081234567890"/></div>
            <div className="space-y-1"><Label htmlFor="sc-status">Status</Label><select id="sc-status" className="block w-full rounded-md border bg-background p-2" value={form.isActive ? "active" : "inactive"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></div>
            <div className="space-y-1"><Label htmlFor="sc-notes">Keterangan</Label><Textarea id="sc-notes" maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button><Button type="submit" disabled={save.isPending || !form.employeeId.trim() || !form.fullName.trim() || !form.whatsappNumber.trim()}>{save.isPending ? "Menyimpan..." : "Simpan"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
