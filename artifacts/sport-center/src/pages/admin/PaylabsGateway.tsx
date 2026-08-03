import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  MoreVertical,
  ChevronRight,
  ChevronLeft,
  CreditCard,
  Save,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PaylabsGateway() {
  const [methods, setMethods] = useState<PaymentMethod[]>(INITIAL_METHODS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? methods.find((m) => m.id === selectedId) : null;

  function handleActivate(id: string) {
    setMethods((prev) =>
      prev.map((m) => (m.id === id ? { ...m, active: true } : m))
    );
  }

  function handleSave(updated: PaymentMethod) {
    setMethods((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  if (selected) {
    return (
      <MethodDetail
        method={selected}
        onBack={() => setSelectedId(null)}
        onSave={handleSave}
      />
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
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

      {/* Methods card */}
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
    </div>
  );
}
