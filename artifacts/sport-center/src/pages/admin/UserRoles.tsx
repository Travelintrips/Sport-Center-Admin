import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Role = "owner" | "super_admin" | "admin" | "admin_booking" | "finance" | "staff" | "customer" | "tenant" | "ap2_employee";
type Person = { id: number; name: string; email: string | null; role: Role; accountStatus: string | null };
type ResponseData = { users: Person[]; actorRole: Role };
const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", super_admin: "Super Admin", admin: "Admin",
  admin_booking: "Admin Booking", finance: "Finance", staff: "Staff", customer: "Customer",
  tenant: "Tenant", ap2_employee: "AP2 Employee",
};
const roles: Role[] = ["customer", "staff", "admin_booking", "admin", "finance", "super_admin"];
async function request(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(options?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Permintaan gagal");
  return json;
}

export default function UserRoles() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<number, Role>>({});
  const { data, isLoading, error } = useQuery<ResponseData>({ queryKey: ["admin-user-roles"], queryFn: () => request("/api/admin/user-roles") });
  const mutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) =>
      request(`/api/admin/user-roles/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-roles"] });
      toast({ title: "Jabatan berhasil diperbarui", description: "Perubahan tercatat di Audit Log." });
    },
    onError: (e: Error) => toast({ title: "Gagal mengubah jabatan", description: e.message, variant: "destructive" }),
  });
  const people = (data?.users ?? []).filter((p) => (p.email ?? "").toLowerCase().includes(search.toLowerCase()) || p.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
    <div><h1 className="text-2xl font-bold">Manajemen Pengguna & Hak Akses</h1>
      <p className="text-sm text-muted-foreground">Owner dapat mengatur Admin dan Super Admin. Super Admin hanya dapat mengatur role di bawah Super Admin. Semua perubahan tercatat.</p>
    </div>
    <Card><CardHeader><CardTitle className="text-base">Daftar Pengguna</CardTitle></CardHeader><CardContent className="space-y-4">
      <Input placeholder="Cari nama atau email..." value={search} onChange={(e) => setSearch(e.target.value)} />
      {isLoading && <p>Memuat pengguna...</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}
      <div className="divide-y">
        {people.map((p) => {
          const canEdit = p.role !== "owner" && (data?.actorRole === "owner" || (data?.actorRole === "super_admin" && p.role !== "super_admin"));
          const options = roles.filter((r) => data?.actorRole === "owner" || r !== "super_admin");
          const selected = draft[p.id] ?? p.role;
          return <div key={p.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1"><p className="font-medium break-words">{p.name}</p>
              <p className="text-sm text-muted-foreground break-all">{p.email ?? "Tanpa email"} · {p.accountStatus === "active" ? "Aktif" : "Nonaktif"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Jabatan ${p.name}`} className="rounded-md border bg-background px-3 py-2 text-sm min-w-36" disabled={!canEdit || mutation.isPending}
                value={selected} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value as Role }))}>
                {!options.includes(p.role) && <option value={p.role}>{ROLE_LABEL[p.role] ?? p.role}</option>}
                {options.map((r) => <option value={r} key={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              {canEdit && <Button size="sm" disabled={mutation.isPending || selected === p.role}
                onClick={() => {
                  if (window.confirm(`Ubah jabatan ${p.name} dari ${ROLE_LABEL[p.role]} menjadi ${ROLE_LABEL[selected]}?`)) mutation.mutate({ id: p.id, role: selected });
                }}>Simpan</Button>}
            </div>
          </div>;
        })}
      </div>
    </CardContent></Card>
  </div>;
}
