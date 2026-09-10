import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Search, Shield } from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";

function apiFetch(path: string) {
  return fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } }).then((r) => r.json());
}

const ACTION_COLORS: Record<string, string> = {
  login: "bg-blue-100 text-blue-700",
  logout: "bg-gray-100 text-gray-700",
  confirm_payment: "bg-green-100 text-green-700",
  update_payment: "bg-green-100 text-green-700",
  cancel_booking: "bg-red-100 text-red-700",
  delete_booking: "bg-red-100 text-red-700",
  create_pricing_rule: "bg-purple-100 text-purple-700",
  update_pricing_rule: "bg-purple-100 text-purple-700",
  delete_pricing_rule: "bg-purple-100 text-purple-700",
  create_maintenance: "bg-orange-100 text-orange-700",
  delete_maintenance: "bg-orange-100 text-orange-700",
  checkin: "bg-teal-100 text-teal-700",
  reschedule_approve: "bg-indigo-100 text-indigo-700",
  reschedule_reject: "bg-pink-100 text-pink-700",
};

export default function AdminAuditLog() {
  const [search, setSearch] = useState("");
  const [entity, setEntity] = useState("all");
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", entity, page],
    queryFn: () => apiFetch(`/admin/audit-logs?limit=${limit}&offset=${page * limit}${entity !== "all" ? `&entity=${entity}` : ""}`),
    staleTime: 10000,
  });

  const logs: any[] = (data?.logs ?? []).filter((l: any) =>
    !search || l.action?.includes(search) || l.userName?.toLowerCase().includes(search.toLowerCase()) || l.entity?.includes(search)
  );
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black flex items-center gap-2"><Shield size={28} /> Audit Log</h1>
        <p className="text-muted-foreground mt-1">Rekam jejak semua aksi admin</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Cari aksi, user, entity..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Semua entity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua</SelectItem>
            <SelectItem value="booking">Booking</SelectItem>
            <SelectItem value="payment">Payment</SelectItem>
            <SelectItem value="facility">Fasilitas</SelectItem>
            <SelectItem value="pricing_rule">Pricing Rule</SelectItem>
            <SelectItem value="maintenance_schedule">Maintenance</SelectItem>
            <SelectItem value="reschedule_request">Reschedule</SelectItem>
            <SelectItem value="company_invoice">Tagihan Perusahaan</SelectItem>
            <SelectItem value="company">Pengaturan Billing Perusahaan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Log Aktivitas ({total} total)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Memuat...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Tidak ada log ditemukan</div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-700"}`}>
                        {log.action}
                      </span>
                      {log.entity && <span className="text-xs text-muted-foreground">{log.entity}{log.entityId ? ` #${log.entityId}` : ""}</span>}
                    </div>
                    <div className="text-sm flex items-center gap-2">
                      <span className="font-medium">{log.userName ?? "System"}</span>
                      {log.userRole && <Badge variant="outline" className="text-xs">{log.userRole}</Badge>}
                    </div>
                    {(log.before || log.after) && (
                      <div className="text-xs text-muted-foreground mt-1 font-mono">
                        {log.before && <span className="text-red-500">before: {JSON.stringify(log.before)}</span>}
                        {log.before && log.after && " → "}
                        {log.after && <span className="text-green-600">after: {JSON.stringify(log.after)}</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                    {new Date(log.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mt-4">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Sebelumnya</Button>
            <span className="text-sm text-muted-foreground">Halaman {page + 1}</span>
            <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Selanjutnya →</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
