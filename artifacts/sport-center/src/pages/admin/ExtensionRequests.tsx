import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Clock, CheckCircle, XCircle, Search, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

const STATUS_LABELS: Record<string, string> = { pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak" };
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

function formatRupiah(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

export default function AdminExtensionRequests() {
  const [selected, setSelected] = useState<any>(null);
  const [adminNote, setAdminNote] = useState("");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["extension-requests"],
    queryFn: () => fetch(`${API}/extension-requests`, { headers: authHeaders() }).then(r => r.json()),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      fetch(`${API}/extension-requests/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ action, adminNote }),
      }).then(r => r.json()),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["extension-requests"] });
      setSelected(null);
      setAdminNote("");
      toast({ title: vars.action === "approve" ? "Perpanjangan disetujui" : "Perpanjangan ditolak" });
    },
    onError: () => toast({ title: "Error", description: "Gagal memproses", variant: "destructive" }),
  });

  const filtered = requests.filter((r: any) => {
    const matchSearch = !search ||
      r.booking?.customerName?.toLowerCase().includes(search.toLowerCase()) ||
      r.booking?.orderNumber?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || r.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const pending = filtered.filter((r: any) => r.status === "pending");
  const done = filtered.filter((r: any) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black flex items-center gap-2"><Clock size={28} /> Tambah Waktu</h1>
        <p className="text-muted-foreground mt-1">Kelola permintaan perpanjangan durasi booking dari customer</p>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari nama customer atau nomor order..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="pending">Menunggu</SelectItem>
                <SelectItem value="approved">Disetujui</SelectItem>
                <SelectItem value="rejected">Ditolak</SelectItem>
              </SelectContent>
            </Select>
            {(search || filterStatus !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterStatus("all"); }}>Reset</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pending */}
      {(filterStatus === "all" || filterStatus === "pending") && (
        <div>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
            Menunggu Review
            {pending.length > 0 && <Badge className="bg-yellow-100 text-yellow-700 ml-1">{pending.length}</Badge>}
          </h2>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Memuat...</p>
          ) : pending.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Tidak ada permintaan pending</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {pending.map((r: any) => (
                <RequestCard key={r.id} request={r} onReview={() => { setSelected(r); setAdminNote(""); }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Done */}
      {(filterStatus === "all" || filterStatus === "approved" || filterStatus === "rejected") && done.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3 text-muted-foreground">Sudah Diproses</h2>
          <div className="space-y-3">
            {done.map((r: any) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </div>
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review Perpanjangan</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <p className="font-semibold">{selected.booking?.customerName}</p>
                <p className="text-muted-foreground">{selected.booking?.orderNumber} · {selected.booking?.facilityName}</p>
                <p className="text-muted-foreground">{selected.booking?.bookingDate} · {selected.booking?.startTime}–{selected.booking?.endTime}</p>
                <p className="font-medium text-primary">+{selected.extraHours} jam → selesai pukul {selected.newEndTime}</p>
                <p className="text-orange-600 font-semibold">Biaya tambahan: {formatRupiah(selected.additionalPrice)}</p>
                {selected.reason && <p className="italic text-muted-foreground">"{selected.reason}"</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Catatan Admin (opsional)</Label>
                <Textarea
                  placeholder="Tulis catatan untuk customer..."
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate({ id: selected.id, action: "reject" })}
                >
                  <XCircle size={16} className="mr-1" /> Tolak
                </Button>
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate({ id: selected.id, action: "approve" })}
                >
                  <CheckCircle size={16} className="mr-1" /> Setujui
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequestCard({ request, onReview }: { request: any; onReview?: () => void }) {
  const b = request.booking;
  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">{b?.orderNumber}</span>
              <Badge className={`text-xs ${STATUS_COLORS[request.status]}`}>{STATUS_LABELS[request.status]}</Badge>
            </div>
            <p className="text-sm font-medium">{b?.customerName}</p>
            <p className="text-xs text-muted-foreground">{b?.facilityName} · {b?.bookingDate}</p>
            <p className="text-xs text-muted-foreground">{b?.startTime}–{b?.endTime} <span className="text-primary font-semibold">+{request.extraHours} jam → {request.newEndTime}</span></p>
            <p className="text-xs text-orange-600 font-semibold">+Rp {request.additionalPrice?.toLocaleString("id-ID")}</p>
          </div>
          {onReview && (
            <Button size="sm" variant="outline" onClick={onReview} className="shrink-0">
              <Plus size={14} className="mr-1" /> Review
            </Button>
          )}
          {!onReview && request.adminNote && (
            <p className="text-xs text-muted-foreground italic max-w-xs">"{request.adminNote}"</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
