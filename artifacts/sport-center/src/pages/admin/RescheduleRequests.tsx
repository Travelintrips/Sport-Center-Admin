import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Calendar, CheckCircle, XCircle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

const STATUS_LABELS: Record<string, string> = { pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak" };
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function AdminRescheduleRequests() {
  const [selected, setSelected] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["reschedule-requests"],
    queryFn: () => fetch(`${API}/reschedule-requests`, { headers: authHeaders() }).then(r => r.json()),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      fetch(`${API}/reschedule-requests/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ action, reviewNote }) }).then(r => r.json()),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["reschedule-requests"] });
      setSelected(null);
      setReviewNote("");
      toast({ title: vars.action === "approve" ? "Reschedule disetujui" : "Reschedule ditolak" });
    },
    onError: () => toast({ title: "Error", description: "Gagal memproses", variant: "destructive" }),
  });

  const pending = requests.filter((r: any) => r.status === "pending");
  const done = requests.filter((r: any) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black flex items-center gap-2"><Calendar size={28} /> Reschedule Booking</h1>
        <p className="text-muted-foreground mt-1">Kelola permintaan perubahan jadwal dari customer</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Menunggu Persetujuan ({pending.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <div className="text-center py-8 text-muted-foreground">Memuat...</div> :
          pending.length === 0 ? <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-2"><Clock size={32} className="opacity-30" /><p>Tidak ada permintaan yang menunggu</p></div> : (
            <div className="space-y-3">
              {pending.map((r: any) => (
                <div key={r.id} className="flex items-start justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{r.booking?.orderNumber}</span>
                      <Badge className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">{r.booking?.customerName}</span>
                      {" — "}{r.booking?.facilityName}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      <span className="line-through">{r.booking?.bookingDate} {r.booking?.startTime}–{r.booking?.endTime}</span>
                      {" → "}
                      <span className="text-foreground font-medium">{r.newDate} {r.newStartTime}–{r.newEndTime}</span>
                    </div>
                    {r.reason && <div className="text-xs text-muted-foreground mt-1">Alasan: {r.reason}</div>}
                    <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</div>
                  </div>
                  <div className="flex gap-2 ml-3">
                    <Button size="sm" variant="outline" className="text-destructive border-destructive hover:bg-destructive/10" onClick={() => { setSelected(r); setReviewNote(""); }}>
                      Review
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {done.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-muted-foreground">Riwayat ({done.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {done.slice(0, 20).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg opacity-70">
                  <div className="text-sm">
                    <span className="font-medium">{r.booking?.orderNumber}</span>
                    {" · "}{r.newDate} {r.newStartTime}–{r.newEndTime}
                  </div>
                  <Badge className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Permintaan Reschedule</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-1">
                <div><strong>Booking:</strong> {selected.booking?.orderNumber}</div>
                <div><strong>Customer:</strong> {selected.booking?.customerName}</div>
                <div><strong>Fasilitas:</strong> {selected.booking?.facilityName}</div>
                <div><strong>Jadwal Lama:</strong> <span className="line-through">{selected.booking?.bookingDate} {selected.booking?.startTime}–{selected.booking?.endTime}</span></div>
                <div><strong>Jadwal Baru:</strong> <span className="text-primary font-medium">{selected.newDate} {selected.newStartTime}–{selected.newEndTime}</span></div>
                {selected.reason && <div><strong>Alasan Customer:</strong> {selected.reason}</div>}
              </div>
              <div className="space-y-1">
                <Label>Catatan (opsional)</Label>
                <Textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Catatan untuk customer..." rows={3} />
              </div>
              <div className="flex gap-3">
                <Button
                  className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                  onClick={() => reviewMutation.mutate({ id: selected.id, action: "approve" })}
                  disabled={reviewMutation.isPending}
                >
                  <CheckCircle size={16} /> Setujui
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 gap-2"
                  onClick={() => reviewMutation.mutate({ id: selected.id, action: "reject" })}
                  disabled={reviewMutation.isPending}
                >
                  <XCircle size={16} /> Tolak
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
