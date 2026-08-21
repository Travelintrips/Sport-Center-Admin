import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Percent, Save, Plane, Banknote } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

interface DiscountSetting {
  id: number;
  customerType: string;
  discountPercentage: number;
  discountAmount: number | null;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  angkasa_pura: "Angkasa Pura",
  corporate: "Korporat",
  government: "Pemerintah",
  vip: "VIP",
};

export default function AdminDiscountSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings = [], isLoading } = useQuery<DiscountSetting[]>({
    queryKey: ["discount-settings"],
    queryFn: async () => {
      const res = await fetch(`${API}/discount-settings`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Gagal memuat pengaturan diskon");
      return res.json();
    },
  });

  const [form, setForm] = useState<Record<string, { discountPercentage: number; discountAmount: number | null; description: string; isActive: boolean }>>({});

  const getFormVal = (ct: string, field: "discountPercentage" | "discountAmount" | "description" | "isActive", setting?: DiscountSetting) => {
    if (form[ct] !== undefined) return form[ct][field];
    if (setting) {
      if (field === "discountPercentage") return setting.discountPercentage;
      if (field === "discountAmount") return setting.discountAmount;
      if (field === "description") return setting.description ?? "";
      if (field === "isActive") return setting.isActive;
    }
    return field === "isActive" ? false : field === "discountAmount" ? null : field === "discountPercentage" ? 0 : "";
  };

  const setFormVal = (ct: string, field: string, value: unknown, setting?: DiscountSetting) => {
    const defaults = {
      discountPercentage: Number(getFormVal(ct, "discountPercentage", setting)),
      discountAmount: getFormVal(ct, "discountAmount", setting) == null ? null : Number(getFormVal(ct, "discountAmount", setting)),
      description: String(getFormVal(ct, "description", setting)),
      isActive: Boolean(getFormVal(ct, "isActive", setting)),
    };
    setForm(prev => ({
      ...prev,
      [ct]: { ...defaults, ...prev[ct], [field]: value },
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async ({ customerType, data }: { customerType: string; data: { discountPercentage: number; discountAmount: number | null; description: string; isActive: boolean } }) => {
      const res = await fetch(`${API}/discount-settings/${customerType}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Gagal menyimpan");
      }
      return res.json();
    },
    onSuccess: (_, { customerType }) => {
      toast({ title: "Disimpan", description: `Diskon ${CUSTOMER_TYPE_LABELS[customerType] ?? customerType} berhasil diperbarui.` });
      queryClient.invalidateQueries({ queryKey: ["discount-settings"] });
      setForm(prev => { const next = { ...prev }; delete next[customerType]; return next; });
    },
    onError: (err: any) => {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = (setting: DiscountSetting) => {
    const ct = setting.customerType;
    saveMutation.mutate({
      customerType: ct,
      data: {
        discountPercentage: Number(getFormVal(ct, "discountPercentage", setting)),
        discountAmount: getFormVal(ct, "discountAmount", setting) == null ? null : Number(getFormVal(ct, "discountAmount", setting)),
        description: String(getFormVal(ct, "description", setting)),
        isActive: Boolean(getFormVal(ct, "isActive", setting)),
      },
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Percent className="text-primary" size={22} />
          Pengaturan Diskon
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Kelola persentase diskon per tipe pelanggan</p>
      </div>

      {isLoading && (
        <div className="text-center py-16 text-muted-foreground">Memuat...</div>
      )}

      {!isLoading && settings.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Belum ada pengaturan diskon. Diskon akan muncul otomatis saat verifikasi pelanggan pertama.
          </CardContent>
        </Card>
      )}

      {settings.map(setting => {
        const ct = setting.customerType;
        const label = CUSTOMER_TYPE_LABELS[ct] ?? ct;
        const isActive = Boolean(getFormVal(ct, "isActive", setting));
        const pct = Number(getFormVal(ct, "discountPercentage", setting));
        const fixedAmount = getFormVal(ct, "discountAmount", setting);
        const desc = String(getFormVal(ct, "description", setting));
        const isDirty = form[ct] !== undefined;

        return (
          <Card key={ct} className={`transition-all ${isActive ? "border-primary/30 shadow-sm" : "opacity-70"}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Plane size={16} className="text-primary" />
                  {label}
                </CardTitle>
                <div className="flex items-center gap-3">
                  <Badge variant={isActive ? "default" : "secondary"}>
                    {isActive ? "Aktif" : "Nonaktif"}
                  </Badge>
                  <Switch
                    checked={isActive}
                    onCheckedChange={v => setFormVal(ct, "isActive", v, setting)}
                  />
                </div>
              </div>
              <CardDescription className="text-xs">
                Diperbarui: {new Date(setting.updatedAt).toLocaleString("id-ID")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Persentase Diskon (%)</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={e => setFormVal(ct, "discountPercentage", Number(e.target.value), setting)}
                      className="pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                </div>
                {ct === "angkasa_pura" && (
                  <div className="space-y-1.5">
                    <Label><Banknote className="inline mr-1" size={14} />Nominal Diskon Tetap (Rp)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={fixedAmount == null ? "" : fixedAmount}
                      onChange={e => setFormVal(ct, "discountAmount", e.target.value === "" ? null : Number(e.target.value), setting)}
                      placeholder="Kosongkan untuk memakai persen"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Keterangan</Label>
                  <Input
                    value={desc}
                    onChange={e => setFormVal(ct, "description", e.target.value, setting)}
                    placeholder="Deskripsi diskon..."
                  />
                </div>
              </div>

              {ct === "angkasa_pura" && fixedAmount != null && Number(fixedAmount) > 0 ? (
                <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-2 text-sm">
                  Nominal tetap: <span className="font-bold text-primary">Rp {Number(fixedAmount).toLocaleString("id-ID")}</span>{" "}
                  <span className="text-muted-foreground">per sesi/booking. Nominal diprioritaskan daripada persen.</span>
                </div>
              ) : pct > 0 && (
                <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-2 text-sm">
                  <span className="text-muted-foreground">Contoh: tarif Rp 100.000 →</span>{" "}
                  <span className="font-bold text-primary">
                    Rp {Math.round(100000 * (1 - pct / 100)).toLocaleString("id-ID")}
                  </span>
                  <span className="text-muted-foreground ml-1">(-{pct}%)</span>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => handleSave(setting)}
                  disabled={saveMutation.isPending || !isDirty}
                  className="gap-2"
                >
                  <Save size={14} />
                  {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
