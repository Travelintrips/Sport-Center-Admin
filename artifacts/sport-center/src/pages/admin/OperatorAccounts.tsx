import { useState } from "react";
import { getToken } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UserCog, Plus, Pencil, Trash2, KeyRound, ToggleLeft, ToggleRight } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

type Operator = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  accountStatus: string;
  createdAt: string;
};

type FormData = { name: string; email: string; phone: string; password: string };

const EMPTY_FORM: FormData = { name: "", email: "", phone: "", password: "" };

async function apiFetch(path: string, options?: RequestInit) {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Terjadi kesalahan");
  }
  return res.json();
}

export default function OperatorAccounts() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Operator | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Operator | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);

  const { data: operators = [], isLoading } = useQuery<Operator[]>({
    queryKey: ["operator-accounts"],
    queryFn: () => apiFetch("/api/operator-accounts"),
  });

  const createMut = useMutation({
    mutationFn: (data: FormData) => apiFetch("/api/operator-accounts", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operator-accounts"] }); setShowForm(false); setForm(EMPTY_FORM); toast({ title: "Akun operator berhasil dibuat" }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<FormData> & { accountStatus?: string } }) =>
      apiFetch(`/api/operator-accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operator-accounts"] }); setEditTarget(null); setForm(EMPTY_FORM); toast({ title: "Akun berhasil diperbarui" }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/operator-accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operator-accounts"] }); setDeleteTarget(null); toast({ title: "Akun berhasil dihapus" }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  function openEdit(op: Operator) {
    setEditTarget(op);
    setForm({ name: op.name, email: op.email, phone: op.phone ?? "", password: "" });
  }

  function handleSubmitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) return;
    createMut.mutate(form);
  }

  function handleSubmitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    const payload: Partial<FormData> = { name: form.name, email: form.email, phone: form.phone };
    if (form.password) payload.password = form.password;
    updateMut.mutate({ id: editTarget.id, data: payload });
  }

  function toggleStatus(op: Operator) {
    const next = op.accountStatus === "active" ? "inactive" : "active";
    updateMut.mutate({ id: op.id, data: { accountStatus: next } });
  }

  const setF = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2"><UserCog size={22} className="text-primary" /> Akun Operator Booking</h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola akun yang bisa booking atas nama customer</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 gap-2" onClick={() => { setShowForm(true); setForm(EMPTY_FORM); }}>
          <Plus size={15} /> Tambah Akun
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {operators.length} Akun Operator
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Memuat...</div>
          ) : operators.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <UserCog size={36} className="mx-auto mb-3 opacity-30" />
              <p className="font-semibold">Belum ada akun operator</p>
              <p className="text-sm mt-1">Klik "Tambah Akun" untuk membuat yang pertama</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {operators.map((op) => (
                <div key={op.id} className="flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base">{op.name}</span>
                      <Badge className={op.accountStatus === "active" ? "bg-green-100 text-green-700 border-green-200 text-xs" : "bg-gray-100 text-gray-500 border-gray-200 text-xs"}>
                        {op.accountStatus === "active" ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{op.email}{op.phone ? ` · ${op.phone}` : ""}</div>
                    <div className="text-xs text-muted-foreground/60 mt-0.5">
                      Dibuat {format(new Date(op.createdAt), "d MMM yyyy", { locale: idLocale })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2" onClick={() => toggleStatus(op)} title={op.accountStatus === "active" ? "Nonaktifkan" : "Aktifkan"}>
                      {op.accountStatus === "active" ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} />}
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2" onClick={() => openEdit(op)}>
                      <Pencil size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2" onClick={() => setDeleteTarget(op)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Tambah */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus size={16} /> Tambah Akun Operator</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmitCreate} className="space-y-4 mt-2">
            <div className="space-y-2"><Label>Nama Lengkap *</Label><Input required value={form.name} onChange={setF("name")} placeholder="Nama operator" /></div>
            <div className="space-y-2"><Label>Email Login *</Label><Input required type="email" value={form.email} onChange={setF("email")} placeholder="email@contoh.com" /></div>
            <div className="space-y-2"><Label>No. HP / WA</Label><Input value={form.phone} onChange={setF("phone")} placeholder="08xxxxxxxxxx" /></div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><KeyRound size={13} /> Sandi *</Label>
              <Input required type="password" value={form.password} onChange={setF("password")} placeholder="Minimal 6 karakter" minLength={6} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={createMut.isPending}>
                {createMut.isPending ? "Menyimpan..." : "Buat Akun"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Edit */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil size={16} /> Edit Akun: {editTarget?.name}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmitEdit} className="space-y-4 mt-2">
            <div className="space-y-2"><Label>Nama Lengkap *</Label><Input required value={form.name} onChange={setF("name")} /></div>
            <div className="space-y-2"><Label>Email Login *</Label><Input required type="email" value={form.email} onChange={setF("email")} /></div>
            <div className="space-y-2"><Label>No. HP / WA</Label><Input value={form.phone} onChange={setF("phone")} placeholder="08xxxxxxxxxx" /></div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><KeyRound size={13} /> Ganti Sandi</Label>
              <Input type="password" value={form.password} onChange={setF("password")} placeholder="Kosongkan jika tidak ingin mengganti" minLength={6} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Batal</Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={updateMut.isPending}>
                {updateMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog Hapus */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-destructive flex items-center gap-2"><Trash2 size={16} /> Hapus Akun</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Akun <span className="font-semibold text-foreground">{deleteTarget?.name}</span> ({deleteTarget?.email}) akan dihapus permanen.</p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}>
              {deleteMut.isPending ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
