import { useState, useEffect, useRef } from "react";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save, Upload, Trash2, QrCode, ImageIcon } from "lucide-react";
import { getToken } from "@/lib/auth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AdminSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useGetSettings();
  const qrisInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    centerName: "", address: "", phone: "", whatsapp: "", email: "",
    openHour: "", closeHour: "", logoUrl: "", bankName: "", bankAccount: "", bankAccountName: "",
  });
  const [qrisPreview, setQrisPreview] = useState<string | null>(null);
  const [qrisUploading, setQrisUploading] = useState(false);
  const [qrisDeleting, setQrisDeleting] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        centerName: settings.centerName ?? "",
        address: settings.address ?? "",
        phone: settings.phone ?? "",
        whatsapp: settings.whatsapp ?? "",
        email: settings.email ?? "",
        openHour: settings.openHour ?? "",
        closeHour: settings.closeHour ?? "",
        logoUrl: settings.logoUrl ?? "",
        bankName: settings.bankName ?? "",
        bankAccount: settings.bankAccount ?? "",
        bankAccountName: settings.bankAccountName ?? "",
      });
      setQrisPreview((settings as any).qrisImageUrl ?? null);
    }
  }, [settings]);

  const updateMutation = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Pengaturan disimpan" });
      },
      onError: () => toast({ title: "Gagal menyimpan", variant: "destructive" }),
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form };
    Object.keys(payload).forEach(k => { if (!payload[k]) delete payload[k]; });
    updateMutation.mutate({ data: payload });
  };

  const handleQrisUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setQrisUploading(true);
    try {
      const fd = new FormData();
      fd.append("qris", file);
      const token = getToken();
      if (!token) throw new Error("Tidak terautentikasi");
      const res = await fetch(`${BASE}/api/settings/qris`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error(`Upload gagal: ${res.status}`);
      const data = await res.json();
      setQrisPreview(data.qrisImageUrl);
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Foto QRIS berhasil diupload" });
    } catch {
      toast({ title: "Gagal upload foto QRIS", variant: "destructive" });
    } finally {
      setQrisUploading(false);
      if (qrisInputRef.current) qrisInputRef.current.value = "";
    }
  };

  const handleQrisDelete = async () => {
    setQrisDeleting(true);
    try {
      const token = getToken();
      if (!token) throw new Error("Tidak terautentikasi");
      const res = await fetch(`${BASE}/api/settings/qris`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      setQrisPreview(null);
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Foto QRIS dihapus" });
    } catch {
      toast({ title: "Gagal menghapus QRIS", variant: "destructive" });
    } finally {
      setQrisDeleting(false);
    }
  };

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-96" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Pengaturan</h1>
        <p className="text-muted-foreground">Konfigurasi informasi sport center</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Informasi Sport Center</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nama Sport Center</Label>
                <Input value={form.centerName} onChange={(e) => setForm(f => ({ ...f, centerName: e.target.value }))} placeholder="Sport Center" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="info@sportcenter.com" />
              </div>
              <div className="space-y-2">
                <Label>Nomor Telepon</Label>
                <Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+62 21 1234567" />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp (dengan kode negara, tanpa +)</Label>
                <Input value={form.whatsapp} onChange={(e) => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="6281234567890" />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>Alamat</Label>
                <Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Alamat lengkap..." />
              </div>
              <div className="space-y-2">
                <Label>Jam Buka</Label>
                <Input type="time" value={form.openHour} onChange={(e) => setForm(f => ({ ...f, openHour: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Jam Tutup</Label>
                <Input type="time" value={form.closeHour} onChange={(e) => setForm(f => ({ ...f, closeHour: e.target.value }))} />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>URL Logo</Label>
                <Input value={form.logoUrl} onChange={(e) => setForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://..." />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">Informasi Rekening Bank (Transfer Manual)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Nama Bank</Label>
                <Input value={form.bankName} onChange={(e) => setForm(f => ({ ...f, bankName: e.target.value }))} placeholder="BCA, BNI, Mandiri..." />
              </div>
              <div className="space-y-2">
                <Label>Nomor Rekening</Label>
                <Input value={form.bankAccount} onChange={(e) => setForm(f => ({ ...f, bankAccount: e.target.value }))} placeholder="1234567890" />
              </div>
              <div className="space-y-2">
                <Label>Atas Nama</Label>
                <Input value={form.bankAccountName} onChange={(e) => setForm(f => ({ ...f, bankAccountName: e.target.value }))} placeholder="PT Sport Center" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateMutation.isPending} className="px-8">
            <Save size={16} className="mr-2" />
            {updateMutation.isPending ? "Menyimpan..." : "Simpan Pengaturan"}
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <QrCode size={18} />
            Foto QRIS (Pembayaran QRIS)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload foto QR Code QRIS yang akan ditampilkan kepada pelanggan saat melakukan pembayaran.
          </p>

          {qrisPreview ? (
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="border rounded-xl overflow-hidden w-48 h-48 flex items-center justify-center bg-gray-50 flex-shrink-0">
                <img
                  src={qrisPreview}
                  alt="QRIS"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
                  ✓ Foto QRIS sudah diupload dan aktif
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => qrisInputRef.current?.click()}
                    disabled={qrisUploading}
                  >
                    <Upload size={14} className="mr-1.5" />
                    Ganti Foto
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={handleQrisDelete}
                    disabled={qrisDeleting}
                  >
                    <Trash2 size={14} className="mr-1.5" />
                    {qrisDeleting ? "Menghapus..." : "Hapus"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => qrisInputRef.current?.click()}
              disabled={qrisUploading}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-orange-50/40 transition-colors cursor-pointer disabled:opacity-50"
            >
              <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
                <ImageIcon size={28} className="text-orange-500" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-700">
                  {qrisUploading ? "Mengupload..." : "Upload Foto QRIS"}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Klik untuk pilih gambar (JPG, PNG, maks 5MB)
                </p>
              </div>
            </button>
          )}

          <input
            ref={qrisInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleQrisUpload}
          />
        </CardContent>
      </Card>
    </div>
  );
}
