import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Bell, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  booking_created: "Dikirim ke customer saat booking baru dibuat",
  payment_reminder: "Pengingat pembayaran (dikirim manual atau scheduler)",
  payment_confirmed: "Notifikasi ke customer saat pembayaran dikonfirmasi",
  booking_cancelled: "Notifikasi ke customer saat booking dibatalkan",
  booking_completed: "Notifikasi setelah booking selesai (dengan link review)",
  reminder_h1: "Reminder H-1 sebelum jadwal bermain (dikirim jam 8-10 pagi)",
  booking_expired: "Notifikasi ke customer saat booking expired",
  admin_new_booking: "Notifikasi ke admin saat ada booking baru",
  admin_payment_proof: "Notifikasi ke admin saat ada bukti transfer baru",
  admin_booking_expired: "Notifikasi ke admin saat booking expired",
};

const VARIABLES = "{{customerName}} {{orderNumber}} {{facilityName}} {{bookingDate}} {{startTime}} {{endTime}} {{totalPrice}} {{paymentDeadline}} {{bankName}} {{bankAccount}} {{bankAccountName}} {{reason}} {{reviewUrl}}";

export default function AdminNotificationTemplates() {
  const [editing, setEditing] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editName, setEditName] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["notification-templates"],
    queryFn: () => fetch(`${API}/notification-templates`, { headers: authHeaders() }).then(r => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body, name, isActive }: { id: number; body?: string; name?: string; isActive?: boolean }) =>
      fetch(`${API}/notification-templates/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ body, name, isActive }) }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-templates"] });
      setEditing(null);
      toast({ title: "Template disimpan" });
    },
    onError: () => toast({ title: "Error", description: "Gagal menyimpan template", variant: "destructive" }),
  });

  function openEdit(tpl: any) {
    setEditing(tpl.id);
    setEditBody(tpl.body);
    setEditName(tpl.name);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black flex items-center gap-2"><Bell size={28} /> Template Notifikasi WhatsApp</h1>
        <p className="text-muted-foreground mt-1">Kelola pesan WhatsApp otomatis yang dikirim ke customer dan admin</p>
      </div>

      <Card>
        <CardContent className="pt-4 pb-3">
          <p className="text-sm text-muted-foreground">
            <strong>Variabel tersedia:</strong>{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{VARIABLES}</code>
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Memuat template...</div>
      ) : (
        <div className="space-y-4">
          {templates.map((tpl: any) => (
            <Card key={tpl.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{tpl.name}</CardTitle>
                      <Badge variant="outline" className="text-xs font-mono">{tpl.key}</Badge>
                      {!tpl.isActive && <Badge variant="secondary">Nonaktif</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{TEMPLATE_DESCRIPTIONS[tpl.key] ?? ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={tpl.isActive}
                      onCheckedChange={(v) => updateMutation.mutate({ id: tpl.id, isActive: v })}
                    />
                    <Button variant="outline" size="sm" onClick={() => openEdit(tpl)}>Edit</Button>
                  </div>
                </div>
              </CardHeader>
              {editing === tpl.id ? (
                <CardContent className="pt-0 space-y-3">
                  <div className="space-y-1">
                    <Label>Nama Template</Label>
                    <Input value={editName} onChange={e => setEditName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Isi Pesan</Label>
                    <Textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={8} className="font-mono text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => updateMutation.mutate({ id: tpl.id, body: editBody, name: editName })} disabled={updateMutation.isPending} className="gap-2">
                      <Save size={14} /> {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(null)}>Batal</Button>
                  </div>
                </CardContent>
              ) : (
                <CardContent className="pt-0">
                  <pre className="text-xs bg-muted p-3 rounded-md whitespace-pre-wrap font-mono text-muted-foreground">{tpl.body}</pre>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
