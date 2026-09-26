import { useEffect, useMemo, useState } from "react";
import {
  getGetSettingsQueryKey,
  useGetSettings,
  useUpdateSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, ExternalLink, MessageCircle, Save, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_GREETING = "Halo! Saya Mina, asisten Sport Center. Ada yang bisa saya bantu?";
const DEFAULT_ACTIONS = "Booking Fasilitas\nCek Jadwal\nCek Harga\nGym & Membership";

export default function AdminMinaWidget() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useGetSettings();
  const [enabled, setEnabled] = useState(true);
  const [greeting, setGreeting] = useState(DEFAULT_GREETING);
  const [quickActionsText, setQuickActionsText] = useState(DEFAULT_ACTIONS);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.minaWebChatEnabled !== false);
    setGreeting(settings.minaWebChatGreeting?.trim() || DEFAULT_GREETING);
    setQuickActionsText(settings.minaWebChatQuickActions ?? DEFAULT_ACTIONS);
  }, [settings]);

  const quickActions = useMemo(
    () =>
      quickActionsText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6),
    [quickActionsText],
  );

  const updateMutation = useUpdateSettings({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Pengaturan Widget Chat Mina disimpan" });
      },
      onError: () => {
        toast({
          title: "Gagal menyimpan Widget Chat Mina",
          variant: "destructive",
        });
      },
    },
  });

  const handleSave = () => {
    const cleanGreeting = greeting.trim();
    const cleanActions = quickActionsText
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (!cleanGreeting) {
      toast({ title: "Salam Mina wajib diisi", variant: "destructive" });
      return;
    }
    if (cleanGreeting.length > 500) {
      toast({ title: "Salam Mina maksimal 500 karakter", variant: "destructive" });
      return;
    }
    if (cleanActions.length > 6 || cleanActions.some((item) => item.length > 80)) {
      toast({
        title: "Quick action maksimal 6 baris dan 80 karakter per baris",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      data: {
        minaWebChatEnabled: enabled,
        minaWebChatGreeting: cleanGreeting,
        minaWebChatQuickActions: cleanActions.join("\n"),
      },
    });
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Memuat pengaturan Chat Mina…</div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-black tracking-tight">Widget Chat Mina</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola asisten Mina yang tampil pada website publik Sport Center.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/facilities" target="_blank" rel="noreferrer">
            Lihat Website <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4 text-base">
                <span className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  Status Widget
                </span>
                <Badge variant={enabled ? "default" : "secondary"}>
                  {enabled ? "Aktif" : "Nonaktif"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
                <div>
                  <p className="font-semibold">Chat Mina di Website</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Jika dinonaktifkan, widget tidak dimuat di website dan endpoint chat web ikut ditutup.
                    AI Mina WhatsApp tetap berjalan.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Isi Widget</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="mina-greeting">Salam awal Mina</Label>
                <textarea
                  id="mina-greeting"
                  value={greeting}
                  onChange={(event) => setGreeting(event.target.value)}
                  maxLength={500}
                  rows={4}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">{greeting.length}/500 karakter</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mina-actions">Quick Action</Label>
                <textarea
                  id="mina-actions"
                  value={quickActionsText}
                  onChange={(event) => setQuickActionsText(event.target.value)}
                  rows={6}
                  placeholder={"Booking Fasilitas\nCek Jadwal\nCek Harga"}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Satu tombol per baris. Maksimal 6 tombol, 80 karakter per tombol.
                </p>
              </div>

              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Smartphone className="h-4 w-4 text-primary" />
                  Fallback WhatsApp Mina
                </div>
                <p className="mt-2 font-mono text-sm">
                  {settings?.fonnteCustomerDevice || "Belum dikonfigurasi"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mengikuti Nomor Device Mina/customer. Nomor ini tidak diedit dari halaman Widget Chat Mina.
                </p>
              </div>

              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="w-full md:w-auto"
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "Menyimpan…" : "Simpan Widget Chat Mina"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-3xl border bg-background shadow-lg">
              <div className="bg-primary px-4 py-4 text-primary-foreground">
                <p className="font-bold">Mina — Asisten Sport Center</p>
                <p className="text-xs opacity-75">Bantu cek jadwal, harga, dan booking</p>
              </div>
              <div className="space-y-3 bg-muted/20 p-4">
                <div className="max-w-[90%] rounded-2xl rounded-bl-md border bg-background px-4 py-3 text-sm">
                  {greeting || DEFAULT_GREETING}
                </div>
                {quickActions.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {quickActions.map((action) => (
                      <div
                        key={action}
                        className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary"
                      >
                        {action}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Preview hanya menampilkan tampilan awal. Perubahan berlaku setelah disimpan.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
