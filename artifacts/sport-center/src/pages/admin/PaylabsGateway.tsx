import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  CreditCard,
  Settings,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Landmark,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BANK_CHANNELS = [
  { code: "02", name: "BRI Virtual Account", logo: "BRI" },
  { code: "08", name: "Mandiri Virtual Account", logo: "Mandiri" },
  { code: "09", name: "BNI Virtual Account", logo: "BNI" },
  { code: "11", name: "BCA Virtual Account", logo: "BCA" },
  { code: "22", name: "CIMB Virtual Account", logo: "CIMB" },
  { code: "25", name: "Permata Virtual Account", logo: "Permata" },
  { code: "14", name: "BSI Virtual Account", logo: "BSI" },
];

export default function PaylabsGateway() {
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [isSandbox, setIsSandbox] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");

  const [config, setConfig] = useState({
    merchantId: "",
    password: "",
    serviceCode: "VA",
  });

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} disalin`, description: text });
    });
  }

  async function handleTestConnection() {
    if (!config.merchantId || !config.password) {
      toast({
        title: "Konfigurasi tidak lengkap",
        description: "Masukkan Merchant ID dan Password terlebih dahulu.",
        variant: "destructive",
      });
      return;
    }
    setIsTesting(true);
    setConnectionStatus("idle");
    // Simulate test — in production this hits a backend endpoint
    await new Promise((r) => setTimeout(r, 1500));
    setIsTesting(false);
    setConnectionStatus("error");
    toast({
      title: "Koneksi gagal",
      description: "Belum terhubung ke Paylabs. Pastikan kredensial benar dan backend sudah dikonfigurasi.",
      variant: "destructive",
    });
  }

  function handleSave() {
    toast({
      title: "Konfigurasi disimpan",
      description: "Pengaturan Paylabs berhasil disimpan.",
    });
  }

  const baseUrl = isSandbox
    ? "https://api.page.link/paylabs-sandbox"
    : "https://api.page.link/paylabs-prod";

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" />
            Paylabs Payment Gateway
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Integrasi Virtual Account (VA) Paylabs untuk pembayaran otomatis.
          </p>
        </div>
        <a
          href="https://docs.paylabs.co.id/id/docs/v4.8.1/va/01-create-va"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm" className="gap-1.5">
            <ExternalLink className="h-4 w-4" />
            Dokumentasi API
          </Button>
        </a>
      </div>

      <Tabs defaultValue="credentials">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="credentials">Kredensial</TabsTrigger>
          <TabsTrigger value="channels">Saluran Pembayaran</TabsTrigger>
          <TabsTrigger value="info">Info Integrasi</TabsTrigger>
        </TabsList>

        {/* === TAB: CREDENTIALS === */}
        <TabsContent value="credentials" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Konfigurasi API Paylabs
              </CardTitle>
              <CardDescription>
                Masukkan kredensial dari merchant dashboard Paylabs Anda.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Environment toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div>
                  <p className="text-sm font-medium">Mode Environment</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isSandbox ? "Sandbox — untuk testing, tidak ada transaksi nyata" : "Production — transaksi akan diproses secara nyata"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Sandbox</span>
                  <Switch
                    checked={!isSandbox}
                    onCheckedChange={(v) => setIsSandbox(!v)}
                  />
                  <span className="text-xs text-muted-foreground">Production</span>
                  <Badge variant={isSandbox ? "secondary" : "default"} className="ml-1">
                    {isSandbox ? "Sandbox" : "Production"}
                  </Badge>
                </div>
              </div>

              <Separator />

              {/* Merchant ID */}
              <div className="space-y-1.5">
                <Label htmlFor="merchantId">Merchant ID</Label>
                <Input
                  id="merchantId"
                  placeholder="Contoh: 123456789"
                  value={config.merchantId}
                  onChange={(e) => setConfig((c) => ({ ...c, merchantId: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Ditemukan di Merchant Dashboard → Profile → Merchant ID
                </p>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="password">Password / Secret Key</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••••••••"
                    value={config.password}
                    onChange={(e) => setConfig((c) => ({ ...c, password: e.target.value }))}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Service Code */}
              <div className="space-y-1.5">
                <Label htmlFor="serviceCode">Service Code</Label>
                <Input
                  id="serviceCode"
                  value={config.serviceCode}
                  onChange={(e) => setConfig((c) => ({ ...c, serviceCode: e.target.value }))}
                  placeholder="VA"
                />
                <p className="text-xs text-muted-foreground">
                  Default: <code className="bg-muted px-1 rounded text-xs">VA</code> untuk Virtual Account
                </p>
              </div>

              {/* API Endpoint */}
              <div className="space-y-1.5">
                <Label>API Base URL (otomatis)</Label>
                <div className="flex items-center gap-2">
                  <Input value={baseUrl} readOnly className="text-xs text-muted-foreground bg-muted" />
                  <Button variant="ghost" size="icon" onClick={() => handleCopy(baseUrl, "URL")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Connection status */}
              {connectionStatus !== "idle" && (
                <div
                  className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                    connectionStatus === "success"
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {connectionStatus === "success" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  )}
                  {connectionStatus === "success"
                    ? "Koneksi berhasil. Paylabs siap digunakan."
                    : "Koneksi gagal. Periksa kredensial atau hubungi dukungan Paylabs."}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} className="flex-1">
                  Simpan Konfigurasi
                </Button>
                <Button variant="outline" onClick={handleTestConnection} disabled={isTesting}>
                  {isTesting ? (
                    <RefreshCw className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Test Koneksi
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* === TAB: CHANNELS === */}
        <TabsContent value="channels" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark className="h-4 w-4" />
                Saluran Virtual Account
              </CardTitle>
              <CardDescription>
                Bank yang didukung Paylabs untuk pembayaran Virtual Account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {BANK_CHANNELS.map((bank) => (
                  <div
                    key={bank.code}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center">
                        <span className="text-[10px] font-black text-primary leading-tight text-center">
                          {bank.logo}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{bank.name}</p>
                        <p className="text-xs text-muted-foreground">Kode: {bank.code}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 text-xs">
                      Aktif
                    </Badge>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Ketersediaan bank tergantung pada paket langganan Paylabs merchant Anda.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* === TAB: INFO === */}
        <TabsContent value="info" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cara Integrasi</CardTitle>
              <CardDescription>
                Langkah-langkah menghubungkan Paylabs ke sistem booking.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="space-y-3 text-sm">
                {[
                  {
                    step: "1",
                    title: "Daftar & dapatkan kredensial",
                    desc: "Daftar di portal merchant Paylabs, ambil Merchant ID dan Password dari halaman profil.",
                  },
                  {
                    step: "2",
                    title: "Isi konfigurasi di tab Kredensial",
                    desc: "Masukkan Merchant ID dan Password, pilih mode Sandbox untuk testing.",
                  },
                  {
                    step: "3",
                    title: "Konfigurasi backend API",
                    desc: "Backend perlu mengimplementasikan endpoint Create VA dan Callback Notification dari Paylabs.",
                  },
                  {
                    step: "4",
                    title: "Daftarkan Callback URL",
                    desc: "Set URL callback di dashboard Paylabs: /api/paylabs/callback — pastikan dapat diakses publik.",
                  },
                  {
                    step: "5",
                    title: "Test & aktifkan Production",
                    desc: "Lakukan test di Sandbox, lalu ganti ke mode Production setelah berhasil.",
                  },
                ].map((item) => (
                  <li key={item.step} className="flex gap-3">
                    <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                      {item.step}
                    </span>
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium">Endpoint API yang dibutuhkan backend:</p>
                <div className="space-y-1.5">
                  {[
                    { method: "POST", path: "/api/paylabs/create-va", desc: "Buat nomor VA baru per booking" },
                    { method: "POST", path: "/api/paylabs/callback", desc: "Terima notifikasi pembayaran dari Paylabs" },
                    { method: "GET", path: "/api/paylabs/status/:vaNumber", desc: "Cek status VA" },
                  ].map((ep) => (
                    <div key={ep.path} className="flex items-center gap-2 p-2 rounded-md bg-muted/50 font-mono text-xs">
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${ep.method === "POST" ? "text-orange-600 border-orange-300" : "text-blue-600 border-blue-300"}`}
                      >
                        {ep.method}
                      </Badge>
                      <span className="text-foreground">{ep.path}</span>
                      <span className="text-muted-foreground ml-auto hidden sm:block">{ep.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <a
                href="https://docs.paylabs.co.id/id/docs/v4.8.1/va/01-create-va"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Buka dokumentasi lengkap Paylabs VA API
              </a>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
