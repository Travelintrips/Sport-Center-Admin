import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Bell,
  Send,
  Wifi,
  WifiOff,
  Phone,
  Users,
  RefreshCw,
  CheckCircle,
  XCircle,
  MessageSquare,
  Zap,
} from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({
  Authorization: `Bearer ${getToken()}`,
  "Content-Type": "application/json",
});

interface FonnteStatus {
  connected: boolean;
  device?: string;
  deviceStatus?: string;
  name?: string;
  quota?: number;
  messages?: number;
  package?: string;
  expired?: string;
  adminPhones?: string[];
  error?: string;
}

interface SendResult {
  phone: string;
  status: "sent" | "failed" | "error";
  id?: number;
}

const APP_ORIGIN = typeof window !== "undefined" ? window.location.origin : "";

const QUICK_TEMPLATES = [
  {
    label: "Reminder Pembayaran",
    message:
      `Halo! Ini pengingat dari *Sport Center* 🏟️\n\nAnda memiliki booking yang menunggu pembayaran. Segera selesaikan pembayaran sebelum deadline agar slot tidak dibatalkan.\n\nInfo: ${APP_ORIGIN}`,
  },
  {
    label: "Info Operasional",
    message:
      "Halo dari *Sport Center* 🏟️\n\nKami ingin menyampaikan informasi penting mengenai operasional kami. Silakan hubungi admin jika ada pertanyaan.\n\nTerima kasih! 🙏",
  },
  {
    label: "Promo Spesial",
    message:
      `🎉 *PROMO SPESIAL Sport Center!*\n\nDapatkan penawaran terbaik untuk booking fasilitas olahraga pilihan Anda.\n\nInfo & booking: ${APP_ORIGIN}/promos\n\nJangan lewatkan! 🏅`,
  },
];

export default function AdminNotifications() {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sendResults, setSendResults] = useState<SendResult[]>([]);

  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<FonnteStatus>({
    queryKey: ["fonnte-status"],
    queryFn: async () => {
      const r = await fetch(`${API}/notification-templates/fonnte-status`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Gagal cek status");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { phone?: string; message: string; target?: string }) => {
      const r = await fetch(`${API}/notification-templates/send`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Gagal kirim");
      return data as { success: boolean; results: SendResult[] };
    },
    onSuccess: (data) => {
      setSendResults(data.results);
      const ok = data.results.filter((r) => r.status === "sent").length;
      const fail = data.results.length - ok;
      toast({
        title: `${ok} pesan terkirim${fail > 0 ? `, ${fail} gagal` : ""}`,
        description: "Pesan WA telah diproses oleh Fonnte",
      });
      refetchStatus();
    },
    onError: (err: any) => {
      toast({ title: "Gagal kirim", description: err.message, variant: "destructive" });
    },
  });

  function handleSendToPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || !message.trim()) return;
    setSendResults([]);
    sendMutation.mutate({ phone: phone.trim(), message });
  }

  function handleSendToAdmins() {
    if (!message.trim()) {
      toast({ title: "Isi pesan terlebih dahulu", variant: "destructive" });
      return;
    }
    setSendResults([]);
    sendMutation.mutate({ target: "admins", message });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Notifikasi WhatsApp</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Status Fonnte & kirim pesan WA manual ke customer atau admin
        </p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <MessageSquare size={16} className="text-primary" />
              Status Perangkat Fonnte
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchStatus()}
              disabled={statusLoading}
            >
              <RefreshCw size={14} className={statusLoading ? "animate-spin" : ""} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <RefreshCw size={14} className="animate-spin" /> Mengecek status...
            </div>
          ) : status ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Status</p>
                <div className="flex items-center gap-1.5">
                  {status.connected ? (
                    <>
                      <Wifi size={14} className="text-green-500" />
                      <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                        Terhubung
                      </Badge>
                    </>
                  ) : (
                    <>
                      <WifiOff size={14} className="text-red-500" />
                      <Badge variant="destructive" className="text-xs">
                        Terputus
                      </Badge>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Nomor WA</p>
                <p className="text-sm font-semibold">{status.device ?? "-"}</p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Sisa Kuota</p>
                <div className="flex items-center gap-1">
                  <Zap size={13} className="text-amber-500" />
                  <p className="text-sm font-bold text-amber-600">
                    {status.quota?.toLocaleString("id-ID") ?? "-"}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Paket / Expired</p>
                <p className="text-sm font-medium">
                  {status.package ?? "-"}
                  {status.expired && (
                    <span className="block text-xs text-muted-foreground">{status.expired}</span>
                  )}
                </p>
              </div>

              {status.adminPhones && status.adminPhones.length > 0 && (
                <div className="col-span-2 md:col-span-4 pt-2 border-t space-y-1">
                  <p className="text-xs text-muted-foreground">Nomor Admin Penerima Notif</p>
                  <div className="flex flex-wrap gap-2">
                    {status.adminPhones.map((p) => (
                      <Badge key={p} variant="outline" className="text-xs gap-1">
                        <Phone size={10} /> {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Gagal memuat status</p>
          )}
        </CardContent>
      </Card>

      {/* Send Form */}
      <Tabs defaultValue="customer">
        <TabsList className="mb-4">
          <TabsTrigger value="customer" className="gap-1.5">
            <Phone size={13} /> Ke Customer
          </TabsTrigger>
          <TabsTrigger value="admin" className="gap-1.5">
            <Users size={13} /> Ke Admin
          </TabsTrigger>
        </TabsList>

        {/* Quick templates */}
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">
            Template Cepat
          </p>
          <div className="flex flex-wrap gap-2">
            {QUICK_TEMPLATES.map((t) => (
              <Button
                key={t.label}
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => setMessage(t.message)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        <TabsContent value="customer">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Send size={15} className="text-primary" />
                Kirim WA ke Nomor Customer
              </CardTitle>
              <CardDescription>
                Kirim pesan WhatsApp langsung ke nomor pelanggan tertentu
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSendToPhone} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Nomor HP Customer</Label>
                  <Input
                    id="phone"
                    placeholder="08xxxxxxxxxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="message">Pesan</Label>
                  <Textarea
                    id="message"
                    placeholder="Tulis pesan WA di sini... (mendukung *bold*, _italic_)"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={5}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Format WA: *tebal*, _miring_, ~coret~
                  </p>
                </div>
                <Button
                  type="submit"
                  className="gap-2"
                  disabled={sendMutation.isPending || !phone || !message}
                >
                  <Send size={14} />
                  {sendMutation.isPending ? "Mengirim..." : "Kirim WhatsApp"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="admin">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Users size={15} className="text-primary" />
                Kirim WA ke Semua Admin
              </CardTitle>
              <CardDescription>
                Pesan akan dikirim ke semua nomor admin:{" "}
                <span className="font-medium text-foreground">
                  {status?.adminPhones?.join(", ") ?? "memuat..."}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Pesan</Label>
                <Textarea
                  placeholder="Tulis pesan untuk admin... (mendukung *bold*, _italic_)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground">
                  Format WA: *tebal*, _miring_, ~coret~
                </p>
              </div>
              <Button
                className="gap-2"
                onClick={handleSendToAdmins}
                disabled={sendMutation.isPending || !message}
              >
                <Send size={14} />
                {sendMutation.isPending ? "Mengirim..." : "Kirim ke Semua Admin"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Results */}
      {sendResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Bell size={15} className="text-primary" />
              Hasil Pengiriman
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sendResults.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                >
                  <div className="flex items-center gap-2">
                    {r.status === "sent" ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : (
                      <XCircle size={16} className="text-red-500" />
                    )}
                    <span className="text-sm font-medium">
                      {r.phone.replace(/^62/, "0")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.id && (
                      <span className="text-xs text-muted-foreground">ID: {r.id}</span>
                    )}
                    <Badge
                      className={
                        r.status === "sent"
                          ? "bg-green-100 text-green-700 border-green-200"
                          : "bg-red-100 text-red-700 border-red-200"
                      }
                    >
                      {r.status === "sent" ? "Terkirim" : "Gagal"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
