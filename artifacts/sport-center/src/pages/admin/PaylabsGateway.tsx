import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MoreVertical,
  ChevronRight,
  ChevronLeft,
  CreditCard,
  Save,
  Eye,
  EyeOff,
  AlertTriangle,
  Download,
  Upload,
  Shield,
  ArrowLeftRight,
  SlidersHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PaymentMethod {
  id: string;
  name: string;
  description: string;
  active: boolean;
  iconText: string;
  iconBg: string;
  iconColor: string;
  iconUrl: string;
  enableIcon: boolean;
  customDescription: string;
}

// ─── Initial data ─────────────────────────────────────────────────────────────

const INITIAL_METHODS: PaymentMethod[] = [
  {
    id: "paylabs",
    name: "Paylabs Payment Gateway",
    description: "Online Payment (Bank Transfer, Virtual Account, QRIS, E-Money)",
    active: false,
    iconText: "PL",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "qris",
    name: "Paylabs - QRIS",
    description: "Paylabs QRIS",
    active: true,
    iconText: "QR",
    iconBg: "bg-red-600",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "bri",
    name: "Paylabs - BRI Virtual Account",
    description: "Paylabs BRI Virtual Account",
    active: true,
    iconText: "BRI",
    iconBg: "bg-blue-700",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "bca",
    name: "Paylabs - BCA Virtual Account",
    description: "Paylabs BCA Virtual Account",
    active: false,
    iconText: "BCA",
    iconBg: "bg-blue-500",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "bni",
    name: "Paylabs - BNI VA",
    description: "Paylabs BNI VA",
    active: true,
    iconText: "BNI",
    iconBg: "bg-orange-500",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "mandiri",
    name: "Paylabs - Mandiri VA",
    description: "Paylabs Mandiri VA",
    active: true,
    iconText: "MDR",
    iconBg: "bg-yellow-400",
    iconColor: "text-yellow-900",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "permata",
    name: "Paylabs - Permata VA",
    description: "Paylabs Permata VA",
    active: true,
    iconText: "PRM",
    iconBg: "bg-cyan-500",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "cimb",
    name: "Paylabs - CIMB VA",
    description: "Paylabs CIMB VA",
    active: true,
    iconText: "CIMB",
    iconBg: "bg-red-700",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "btn",
    name: "Paylabs - BTN VA",
    description: "Paylabs BTN VA",
    active: false,
    iconText: "BTN",
    iconBg: "bg-blue-800",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "danamon",
    name: "Paylabs - Danamon VA",
    description: "Paylabs Danamon VA",
    active: false,
    iconText: "DNM",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "ovo",
    name: "Paylabs - Ovo Balance",
    description: "Paylabs Ovo Balance",
    active: false,
    iconText: "OVO",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "dana",
    name: "Paylabs - Dana Balance",
    description: "Paylabs Dana Balance",
    active: false,
    iconText: "DANA",
    iconBg: "bg-blue-400",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "shopeepay",
    name: "Paylabs - ShopeePay",
    description: "Paylabs ShopeePay",
    active: false,
    iconText: "SPay",
    iconBg: "bg-orange-500",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "linkaja",
    name: "Paylabs - LinkAja",
    description: "Paylabs LinkAja",
    active: false,
    iconText: "LA",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "gopay",
    name: "Paylabs - Gopay Balance",
    description: "Paylabs Gopay Balance",
    active: false,
    iconText: "GP",
    iconBg: "bg-teal-500",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "maybank",
    name: "Paylabs - Maybank VA",
    description: "Paylabs Maybank Virtual Account",
    active: false,
    iconText: "MB",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "bsi",
    name: "Paylabs - BSI VA",
    description: "Paylabs BSI Virtual Account",
    active: true,
    iconText: "BSI",
    iconBg: "bg-green-700",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "muamalat",
    name: "Paylabs - Muamalat Virtual Account",
    description: "Paylabs Muamalat Virtual Account",
    active: false,
    iconText: "MML",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "sinarmas",
    name: "Paylabs - Sinarmas VA",
    description: "Paylabs Sinarmas Virtual Account",
    active: false,
    iconText: "SNM",
    iconBg: "bg-red-500",
    iconColor: "text-white",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
  {
    id: "ina",
    name: "Paylabs - INA VA",
    description: "Paylabs INA Virtual Account",
    active: false,
    iconText: "INA",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-500",
    iconUrl: "",
    enableIcon: true,
    customDescription: "",
  },
];

// ─── Icon component ────────────────────────────────────────────────────────────

function MethodIcon({ method }: { method: PaymentMethod }) {
  if (method.iconUrl) {
    return (
      <img
        src={method.iconUrl}
        alt={method.name}
        className="h-10 w-10 rounded-lg object-contain border border-border"
      />
    );
  }
  return (
    <div
      className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${method.iconBg}`}
    >
      <span className={`text-[9px] font-black leading-tight text-center ${method.iconColor}`}>
        {method.iconText}
      </span>
    </div>
  );
}

// ─── Detail / Edit view ───────────────────────────────────────────────────────

function MethodDetail({
  method,
  onBack,
  onSave,
}: {
  method: PaymentMethod;
  onBack: () => void;
  onSave: (updated: PaymentMethod) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<PaymentMethod>({ ...method });

  function handleSave() {
    onSave(form);
    toast({ title: "Perubahan disimpan", description: `${form.name} berhasil diperbarui.` });
    onBack();
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="mt-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-xl font-black text-foreground">{method.name}</h1>
          <p className="text-sm text-muted-foreground">{method.description}</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-5">
          {/* Active toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-background">
            <Label htmlFor="detail-active" className="text-sm font-medium cursor-pointer flex-1">
              Aktifkan atau Nonaktifkan {method.name}
            </Label>
            <Switch
              id="detail-active"
              checked={form.active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              className="data-[state=checked]:bg-cyan-500"
            />
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="detail-title">Judul</Label>
            <Input
              id="detail-title"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Enable icon toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-background">
            <Label htmlFor="detail-icon-enabled" className="text-sm font-medium cursor-pointer flex-1">
              Aktifkan Ikon
            </Label>
            <Switch
              id="detail-icon-enabled"
              checked={form.enableIcon}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enableIcon: v }))}
              className="data-[state=checked]:bg-cyan-500"
            />
          </div>

          {/* Custom icon URL */}
          <div className="space-y-1.5">
            <Label htmlFor="detail-icon-url">Custom URL Ikon</Label>
            <Input
              id="detail-icon-url"
              placeholder="https://example.com/img/bank.png"
              value={form.iconUrl}
              onChange={(e) => setForm((f) => ({ ...f, iconUrl: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">URL harus berekstensi .png</p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="detail-desc">Deskripsi</Label>
            <Textarea
              id="detail-desc"
              placeholder="Deskripsi yang dilihat pengguna saat checkout."
              value={form.customDescription}
              onChange={(e) => setForm((f) => ({ ...f, customDescription: e.target.value }))}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Ini mengontrol deskripsi yang dilihat pengguna saat checkout.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          className="bg-cyan-500 hover:bg-cyan-600 text-white gap-2"
        >
          <Save className="h-4 w-4" />
          Simpan Perubahan
        </Button>
      </div>
    </div>
  );
}

// ─── List row ─────────────────────────────────────────────────────────────────

function MethodRow({
  method,
  onActivate,
  onManage,
}: {
  method: PaymentMethod;
  onActivate: (id: string) => void;
  onManage: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors border-b last:border-b-0">
      <MethodIcon method={method} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{method.name}</p>
        <p className="text-xs text-muted-foreground truncate">{method.description}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!method.active && (
          <Badge
            variant="outline"
            className="text-xs text-muted-foreground border-border bg-background"
          >
            Nonaktif
          </Badge>
        )}
        {!method.active && (
          <Button
            size="sm"
            onClick={() => onActivate(method.id)}
            className="bg-cyan-500 hover:bg-cyan-600 text-white text-xs h-8 px-3 rounded-full"
          >
            Aktifkan
          </Button>
        )}
        {method.active && (
          <Badge className="bg-green-50 text-green-600 border border-green-200 text-xs">
            Aktif
          </Badge>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onManage(method.id)}
          className="h-8 px-3 text-xs rounded-full gap-1"
        >
          Kelola
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        <button className="text-muted-foreground hover:text-foreground p-1">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Secret textarea field ────────────────────────────────────────────────────

function SecretField({
  id,
  label,
  required,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <div className="relative">
        <Textarea
          id={id}
          rows={5}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={show ? "" : ""}
          className={`font-mono text-xs pr-8 resize-none ${!show && value ? "text-security" : ""}`}
          style={!show && value ? { WebkitTextSecurity: "disc" } as React.CSSProperties : {}}
        />
        {value && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PaylabsGateway() {
  const { toast } = useToast();
  const importRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [methods, setMethods] = useState<PaymentMethod[]>(INITIAL_METHODS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Pengaturan Umum
  const [general, setGeneral] = useState({
    title: "Online Payment (Bank Transfer, Virtual Account, QRIS)",
    description: "",
    sendInvoice: true,
    chargeCustomer: false,
    newOrderStatus: "completed",
    debugMode: false,
  });

  // Mode
  const [sandboxMode, setSandboxMode] = useState(true);
  const [storeId, setStoreId] = useState("");

  // Sandbox credentials
  const [sandboxCreds, setSandboxCreds] = useState({
    publicKey: "",
    privateKey: "",
    merchantId: "",
  });

  // Production credentials
  const [prodCreds, setProdCreds] = useState({
    publicKey: "",
    privateKey: "",
    merchantId: "",
  });

  // ── Load from API on mount ──────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/admin/paylabs/settings", {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();

        setGeneral({
          title: d.title ?? "Online Payment (Bank Transfer, Virtual Account, QRIS)",
          description: d.description ?? "",
          sendInvoice: d.sendInvoice ?? true,
          chargeCustomer: d.chargeCustomer ?? false,
          newOrderStatus: d.newOrderStatus ?? "completed",
          debugMode: d.debugMode ?? false,
        });
        setSandboxMode(d.sandboxMode ?? true);
        setStoreId(d.storeId ?? "");
        setSandboxCreds({
          publicKey: d.sandboxPublicKey ?? "",
          privateKey: d.sandboxPrivateKey ?? "",
          merchantId: d.sandboxMerchantId ?? "",
        });
        setProdCreds({
          publicKey: d.prodPublicKey ?? "",
          privateKey: d.prodPrivateKey ?? "",
          merchantId: d.prodMerchantId ?? "",
        });
        if (Array.isArray(d.paymentMethodsConfig)) {
          setMethods((prev) =>
            prev.map((m) => {
              const saved = d.paymentMethodsConfig.find((s: any) => s.id === m.id);
              return saved ? { ...m, ...saved } : m;
            })
          );
        }
      } catch (err) {
        // Not critical — just use defaults
        console.warn("[PaylabsGateway] could not load settings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const selected = selectedId ? methods.find((m) => m.id === selectedId) : null;

  function handleActivate(id: string) {
    setMethods((prev) =>
      prev.map((m) => (m.id === id ? { ...m, active: true } : m))
    );
  }

  function handleSaveMethod(updated: PaymentMethod) {
    setMethods((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      const body = {
        title: general.title,
        description: general.description,
        sendInvoice: general.sendInvoice,
        chargeCustomer: general.chargeCustomer,
        newOrderStatus: general.newOrderStatus,
        debugMode: general.debugMode,
        sandboxMode,
        storeId,
        sandboxPublicKey: sandboxCreds.publicKey,
        sandboxPrivateKey: sandboxCreds.privateKey,
        sandboxMerchantId: sandboxCreds.merchantId,
        prodPublicKey: prodCreds.publicKey,
        prodPrivateKey: prodCreds.privateKey,
        prodMerchantId: prodCreds.merchantId,
        paymentMethodsConfig: methods.map((m) => ({
          id: m.id,
          active: m.active,
          name: m.name,
          iconUrl: m.iconUrl,
          enableIcon: m.enableIcon,
          customDescription: m.customDescription,
        })),
      };

      const res = await fetch("/api/admin/paylabs/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${errBody?.error ?? "unknown"}`);
      }
      toast({ title: "Pengaturan disimpan", description: "Konfigurasi Paylabs berhasil disimpan ke database." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error("[PaylabsGateway] save error:", msg);
      toast({
        title: "Gagal menyimpan",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const data = { general, sandboxMode, storeId, sandboxCreds, prodCreds, methods };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paylabs-config.json";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Konfigurasi diekspor", description: "File paylabs-config.json berhasil diunduh." });
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.general) setGeneral(data.general);
        if (data.sandboxMode !== undefined) setSandboxMode(data.sandboxMode);
        if (data.storeId !== undefined) setStoreId(data.storeId);
        if (data.sandboxCreds) setSandboxCreds(data.sandboxCreds);
        if (data.prodCreds) setProdCreds(data.prodCreds);
        if (data.methods) setMethods(data.methods);
        toast({ title: "Konfigurasi diimpor", description: "Pengaturan berhasil dimuat dari file." });
      } catch {
        toast({ title: "Gagal impor", description: "File JSON tidak valid.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  if (selected) {
    return (
      <MethodDetail
        method={selected}
        onBack={() => setSelectedId(null)}
        onSave={handleSaveMethod}
      />
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 pb-20">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" />
          Paylabs Payment Gateway
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Online Payment (Bank Transfer, Virtual Account, QRIS, E-Money)
        </p>
      </div>

      {/* ── Metode Pembayaran ── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-0 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            Metode Pembayaran
          </CardTitle>
        </CardHeader>
        <Separator className="mt-3" />
        <CardContent className="p-0">
          {methods.map((method) => (
            <MethodRow
              key={method.id}
              method={method}
              onActivate={handleActivate}
              onManage={(id) => setSelectedId(id)}
            />
          ))}
        </CardContent>
      </Card>

      {/* ── Pengaturan Umum ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            Pengaturan Umum
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gen-title">Judul</Label>
            <Input
              id="gen-title"
              value={general.title}
              onChange={(e) => setGeneral((g) => ({ ...g, title: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gen-desc">Deskripsi</Label>
            <Textarea
              id="gen-desc"
              rows={3}
              placeholder="Deskripsi metode pembayaran yang dilihat pelanggan saat checkout."
              value={general.description}
              onChange={(e) => setGeneral((g) => ({ ...g, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-background gap-3">
              <Switch
                id="send-invoice"
                checked={general.sendInvoice}
                onCheckedChange={(v) => setGeneral((g) => ({ ...g, sendInvoice: v }))}
                className="data-[state=checked]:bg-cyan-500 shrink-0"
              />
              <Label htmlFor="send-invoice" className="cursor-pointer flex-1">
                <p className="font-medium text-sm">Kirim Invoice</p>
                <p className="text-xs text-muted-foreground">Email invoice ke pelanggan</p>
              </Label>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border bg-background gap-3">
              <Switch
                id="charge-customer"
                checked={general.chargeCustomer}
                onCheckedChange={(v) => setGeneral((g) => ({ ...g, chargeCustomer: v }))}
                className="data-[state=checked]:bg-cyan-500 shrink-0"
              />
              <Label htmlFor="charge-customer" className="cursor-pointer flex-1">
                <p className="font-medium text-sm">Biaya ke Pelanggan</p>
                <p className="text-xs text-muted-foreground">Service fee ditanggung customer</p>
              </Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status Pesanan Baru</Label>
            <Select
              value={general.newOrderStatus}
              onValueChange={(v) => setGeneral((g) => ({ ...g, newOrderStatus: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="on-hold">On Hold</SelectItem>
                <SelectItem value="pending">Pending Payment</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border bg-background gap-3">
            <Switch
              id="debug-mode"
              checked={general.debugMode}
              onCheckedChange={(v) => setGeneral((g) => ({ ...g, debugMode: v }))}
              className="data-[state=checked]:bg-cyan-500 shrink-0"
            />
            <Label htmlFor="debug-mode" className="cursor-pointer flex-1">
              <p className="font-medium text-sm">Mode Debug</p>
              <p className="text-xs text-muted-foreground">Logging detail untuk debugging</p>
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* ── Mode ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-background gap-3">
            <Switch
              id="sandbox-mode"
              checked={sandboxMode}
              onCheckedChange={setSandboxMode}
              className="data-[state=checked]:bg-cyan-500 shrink-0"
            />
            <Label htmlFor="sandbox-mode" className="cursor-pointer flex-1">
              <p className="font-medium text-sm">Sandbox Mode (Testing)</p>
              <p className="text-xs text-muted-foreground">
                Aktifkan untuk SIT/sandbox. Nonaktifkan untuk produksi.
              </p>
            </Label>
          </div>

          {sandboxMode && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Mode sandbox aktif — gunakan kredensial SIT Paylabs.</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="store-id">
              Store ID <span className="text-muted-foreground font-normal">(opsional)</span>
            </Label>
            <Input
              id="store-id"
              placeholder="(opsional)"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Kredensial Sandbox (SIT) ── */}
      <Card className={sandboxMode ? "border-yellow-300 bg-yellow-50/30" : "opacity-60"}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-yellow-500" />
              Kredensial Sandbox (SIT)
            </CardTitle>
            {sandboxMode && (
              <Badge className="bg-yellow-100 text-yellow-700 border border-yellow-300 text-xs">
                Aktif
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretField
            id="sb-pubkey"
            label="Paylabs Public Key (Sandbox)"
            required
            hint="Public key dari dashboard Paylabs SIT."
            value={sandboxCreds.publicKey}
            onChange={(v) => setSandboxCreds((c) => ({ ...c, publicKey: v }))}
          />
          <SecretField
            id="sb-privkey"
            label="Merchant Private Key (Sandbox)"
            required
            hint="Private key merchant untuk environment SIT."
            value={sandboxCreds.privateKey}
            onChange={(v) => setSandboxCreds((c) => ({ ...c, privateKey: v }))}
          />
          <div className="space-y-1.5">
            <Label htmlFor="sb-mid">
              Merchant ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="sb-mid"
              placeholder="Contoh: 010728"
              value={sandboxCreds.merchantId}
              onChange={(e) => setSandboxCreds((c) => ({ ...c, merchantId: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Merchant ID untuk environment SIT.</p>
          </div>
          <div>
            <Button variant="outline" size="sm" className="gap-2 rounded-full">
              <Shield className="h-3.5 w-3.5" />
              Tampilkan Merchant Public Key
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Public key ini harus diupload ke dashboard Paylabs SIT agar tanda tangan dikenali.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Kredensial Produksi ── */}
      <Card className={!sandboxMode ? "border-green-300 bg-green-50/30" : "opacity-60"}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-green-600" />
              Kredensial Produksi
            </CardTitle>
            {!sandboxMode && (
              <Badge className="bg-green-100 text-green-700 border border-green-300 text-xs">
                Aktif
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretField
            id="prod-pubkey"
            label="Paylabs Public Key"
            required
            hint="Public key dari dashboard Paylabs produksi."
            value={prodCreds.publicKey}
            onChange={(v) => setProdCreds((c) => ({ ...c, publicKey: v }))}
          />
          <SecretField
            id="prod-privkey"
            label="Merchant Private Key"
            required
            hint="Private key merchant untuk produksi. Jangan bagikan ke siapapun."
            value={prodCreds.privateKey}
            onChange={(v) => setProdCreds((c) => ({ ...c, privateKey: v }))}
          />
          <div className="space-y-1.5">
            <Label htmlFor="prod-mid">
              Merchant ID <span className="text-red-500">*</span>
            </Label>
            <Input
              id="prod-mid"
              placeholder="Contoh: 010613"
              value={prodCreds.merchantId}
              onChange={(e) => setProdCreds((c) => ({ ...c, merchantId: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Merchant ID untuk environment produksi.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Sinkronisasi ke Proyek Lain ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
            Sinkronisasi ke Proyek Lain
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Export konfigurasi ini (termasuk icon URL, kredensial, dan status metode pembayaran)
            lalu import di proyek lain agar semua proyek punya pengaturan yang sama.
          </p>
          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" onClick={handleExport} className="gap-2">
              <Download className="h-4 w-4" />
              Export Konfigurasi
            </Button>
            <Button
              variant="outline"
              onClick={() => importRef.current?.click()}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              Import Konfigurasi
            </Button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            File yang didownload berformat JSON — buka halaman Paylabs Settings di proyek lain,
            klik Import, pilih file tersebut.
          </p>
        </CardContent>
      </Card>

      {/* ── Simpan Perubahan ── */}
      <div className="flex justify-end">
        <Button
          onClick={handleSaveAll}
          className="bg-cyan-500 hover:bg-cyan-600 text-white gap-2"
        >
          <Save className="h-4 w-4" />
          Simpan Perubahan
        </Button>
      </div>
    </div>
  );
}
