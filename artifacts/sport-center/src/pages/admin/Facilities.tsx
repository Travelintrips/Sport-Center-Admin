import { useState, useRef } from "react";
import {
  useListFacilities, useCreateFacility, useUpdateFacility, useDeleteFacility,
  getListFacilitiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Upload, X, WrenchIcon, CheckCircle2, ImageIcon, Clock, DollarSign, Info, Star } from "lucide-react";
import { getToken } from "@/lib/auth";

const CATEGORIES = ["Futsal", "Basket", "Voli", "Tenis", "Badminton", "Gym", "Biliar", "Lainnya"];

const emptyForm = {
  name: "", category: "Futsal", description: "",
  pricePerHour: "", openTime: "06:00", closeTime: "23:00",
  minDuration: 1, maxDuration: "", capacity: "",
  isActive: true,
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

type FacilityImage = { id: number; url: string; isPrimary: boolean };

export default function AdminFacilities() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editFacility, setEditFacility] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [images, setImages] = useState<FacilityImage[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<{ file: File; preview: string }[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [activeSection, setActiveSection] = useState<"info" | "hours" | "photos" | "status">("info");

  const { data: facilities, isLoading } = useListFacilities();

  const createMutation = useCreateFacility({
    mutation: {
      onError: (e: any) => toast({ title: "Gagal membuat fasilitas", description: e?.message, variant: "destructive" }),
    }
  });

  const updateMutation = useUpdateFacility({
    mutation: {
      onError: (e: any) => toast({ title: "Gagal memperbarui fasilitas", description: e?.message, variant: "destructive" }),
    }
  });

  const deleteMutation = useDeleteFacility({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListFacilitiesQueryKey() }); toast({ title: "Fasilitas dihapus" }); setDeleteId(null); },
      onError: () => toast({ title: "Gagal menghapus fasilitas", variant: "destructive" }),
    }
  });

  const handleToggleMaintenance = (f: any) => {
    updateMutation.mutate({ id: f.id, data: { isActive: !f.isActive } });
  };

  const openCreate = () => {
    setEditFacility(null);
    setForm(emptyForm);
    setImages([]);
    setNewImagePreviews([]);
    setActiveSection("info");
    setDialogOpen(true);
  };

  const openEdit = (f: any) => {
    setEditFacility(f);
    setForm({
      name: f.name, category: f.category, description: f.description ?? "",
      pricePerHour: String(f.pricePerHour), openTime: f.openTime, closeTime: f.closeTime,
      minDuration: f.minDuration, maxDuration: f.maxDuration ? String(f.maxDuration) : "",
      capacity: f.capacity ? String(f.capacity) : "",
      isActive: f.isActive,
    });
    setImages(f.images ?? []);
    setNewImagePreviews([]);
    setActiveSection("info");
    setDialogOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setNewImagePreviews(prev => [...prev, { file, preview: ev.target?.result as string }]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeNewPreview = (idx: number) => {
    setNewImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const removeExistingImage = async (imgId: number) => {
    try {
      const token = getToken();
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      await fetch(`${base}/api/facilities/${editFacility.id}/images/${imgId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setImages(prev => prev.filter(img => img.id !== imgId));
      queryClient.invalidateQueries({ queryKey: getListFacilitiesQueryKey() });
    } catch {
      toast({ title: "Gagal menghapus foto", variant: "destructive" });
    }
  };

  const setPrimaryImage = async (facilityId: number, imgId: number) => {
    try {
      const token = getToken();
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      await fetch(`${base}/api/facilities/${facilityId}/images/${imgId}/primary`, {
        method: "PATCH",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setImages(prev => prev.map(img => ({ ...img, isPrimary: img.id === imgId })));
      queryClient.invalidateQueries({ queryKey: getListFacilitiesQueryKey() });
      toast({ title: "Foto utama diperbarui" });
    } catch {
      toast({ title: "Gagal mengatur foto utama", variant: "destructive" });
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      name: form.name, category: form.category, description: form.description,
      pricePerHour: Number(form.pricePerHour), openTime: form.openTime, closeTime: form.closeTime,
      minDuration: Number(form.minDuration), isActive: form.isActive,
    };
    if (form.capacity) payload.capacity = Number(form.capacity);
    if (form.maxDuration) payload.maxDuration = Number(form.maxDuration);

    const pendingImages = newImagePreviews.slice();

    try {
      setUploadingImages(true);
      if (editFacility) {
        const facilityId = editFacility.id;
        await new Promise<void>((res, rej) => {
          updateMutation.mutate({ id: facilityId, data: payload }, {
            onSuccess: () => res(), onError: rej,
          });
        });
        if (pendingImages.length > 0) {
          const total = pendingImages.length;
          for (let i = 0; i < total; i++) {
            const { file } = pendingImages[i];
            const formData = new FormData();
            formData.append("image", file);
            const token = getToken();
            const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
            const resp = await fetch(`${base}/api/facilities/${facilityId}/images`, {
              method: "POST",
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              body: formData,
            });
            if (!resp.ok) throw new Error(`Gagal upload foto: ${resp.status}`);
            setUploadProgress(Math.round(((i + 1) / total) * 100));
          }
          setUploadProgress(0);
        }
        queryClient.invalidateQueries({ queryKey: getListFacilitiesQueryKey() });
        toast({ title: "Fasilitas berhasil diperbarui" });
        setDialogOpen(false);
      } else {
        const facilityId = await new Promise<number>((res, rej) => {
          createMutation.mutate({ data: payload }, {
            onSuccess: (data: any) => res(data.id),
            onError: rej,
          });
        });
        if (pendingImages.length > 0) {
          const total = pendingImages.length;
          for (let i = 0; i < total; i++) {
            const { file } = pendingImages[i];
            const formData = new FormData();
            formData.append("image", file);
            const token = getToken();
            const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
            const resp = await fetch(`${base}/api/facilities/${facilityId}/images`, {
              method: "POST",
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              body: formData,
            });
            if (!resp.ok) throw new Error(`Gagal upload foto: ${resp.status}`);
            setUploadProgress(Math.round(((i + 1) / total) * 100));
          }
          setUploadProgress(0);
        }
        queryClient.invalidateQueries({ queryKey: getListFacilitiesQueryKey() });
        toast({ title: "Fasilitas berhasil dibuat" });
        setDialogOpen(false);
      }
    } catch (err: any) {
      toast({ title: err?.message ?? "Terjadi kesalahan", variant: "destructive" });
    } finally {
      setUploadingImages(false);
      setUploadProgress(0);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending || uploadingImages;

  const sections = [
    { id: "info", label: "Info", icon: Info },
    { id: "hours", label: "Jam & Harga", icon: Clock },
    { id: "photos", label: "Foto", icon: ImageIcon },
    { id: "status", label: "Status", icon: CheckCircle2 },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Facility Management</h1>
          <p className="text-muted-foreground text-sm">Kelola fasilitas, foto, harga, jam operasional, dan mode maintenance</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} className="mr-2" /> Tambah Fasilitas
        </Button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {facilities?.map((f) => (
            <Card key={f.id} className={`transition-all ${!f.isActive ? "border-orange-300 bg-orange-50/30" : ""}`}>
              <CardContent className="p-0">
                <div className="relative">
                  {f.images?.[0] ? (
                    <img src={f.images[0].url} alt={f.name} className="w-full h-36 object-cover rounded-t-xl" />
                  ) : (
                    <div className="w-full h-36 rounded-t-xl bg-muted flex items-center justify-center">
                      <ImageIcon size={32} className="text-muted-foreground/40" />
                    </div>
                  )}
                  {!f.isActive && (
                    <div className="absolute inset-0 bg-orange-900/40 rounded-t-xl flex items-center justify-center">
                      <Badge className="bg-orange-500 text-white text-sm px-3 py-1 gap-1.5">
                        <WrenchIcon size={13} /> MODE MAINTENANCE
                      </Badge>
                    </div>
                  )}
                  {f.images && f.images.length > 1 && (
                    <Badge className="absolute bottom-2 right-2 bg-black/60 text-white text-xs">{f.images.length} foto</Badge>
                  )}
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h3 className="font-bold text-base">{f.name}</h3>
                      <Badge variant="secondary" className="text-xs">{f.category}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-muted-foreground">{f.isActive ? "Aktif" : "Maintenance"}</span>
                      <Switch
                        checked={f.isActive}
                        onCheckedChange={() => handleToggleMaintenance(f)}
                        className="data-[state=checked]:bg-green-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground mb-3">
                    <span className="flex items-center gap-1"><DollarSign size={11} /> {formatCurrency(f.pricePerHour)}/jam</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> {f.openTime} – {f.closeTime}</span>
                    {f.capacity && <span>Kapasitas: {f.capacity} orang</span>}
                    <span>Min: {f.minDuration} jam</span>
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(f)}>
                      <Pencil size={13} className="mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setDeleteId(f.id)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {!facilities?.length && (
            <div className="col-span-2 py-16 text-center text-muted-foreground">
              <ImageIcon size={40} className="mx-auto mb-3 opacity-30" />
              <p>Belum ada fasilitas. Klik "Tambah Fasilitas" untuk memulai.</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>{editFacility ? `Edit: ${editFacility.name}` : "Tambah Fasilitas Baru"}</DialogTitle>
          </DialogHeader>

          <div className="flex border-b px-6 pt-3 gap-0">
            {sections.map(s => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSection(s.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    activeSection === s.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={14} /> {s.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {activeSection === "info" && (
                <>
                  <div className="space-y-2">
                    <Label>Nama Fasilitas *</Label>
                    <Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Lapangan Futsal A" />
                  </div>
                  <div className="space-y-2">
                    <Label>Kategori *</Label>
                    <select
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Deskripsi</Label>
                    <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Deskripsi singkat fasilitas..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Kapasitas (orang)</Label>
                    <Input type="number" min={1} value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} placeholder="Opsional" />
                  </div>
                </>
              )}

              {activeSection === "hours" && (
                <>
                  <div className="space-y-2">
                    <Label>Harga per Jam (IDR) *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                      <Input
                        required type="number" min={0} step={1000}
                        value={form.pricePerHour}
                        onChange={e => setForm(f => ({ ...f, pricePerHour: e.target.value }))}
                        placeholder="150000" className="pl-8"
                      />
                    </div>
                    {form.pricePerHour && (
                      <p className="text-xs text-muted-foreground">{formatCurrency(Number(form.pricePerHour))} per jam</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Jam Buka</Label>
                      <Input type="time" value={form.openTime} onChange={e => setForm(f => ({ ...f, openTime: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Jam Tutup</Label>
                      <Input type="time" value={form.closeTime} onChange={e => setForm(f => ({ ...f, closeTime: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Durasi Minimum (jam)</Label>
                      <Input type="number" min={1} value={form.minDuration} onChange={e => setForm(f => ({ ...f, minDuration: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Durasi Maksimum (jam)</Label>
                      <Input type="number" min={1} value={form.maxDuration} onChange={e => setForm(f => ({ ...f, maxDuration: e.target.value }))} placeholder="Opsional" />
                    </div>
                  </div>
                </>
              )}

              {activeSection === "photos" && (
                <div className="space-y-4">
                  <div>
                    <Label className="mb-2 block">Upload Foto</Label>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-muted-foreground/30 rounded-xl p-8 text-center hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Klik untuk upload foto<br /><span className="text-xs">JPG, PNG, WebP — maks 5MB per file</span></p>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </div>

                  {uploadProgress > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Mengupload ke Supabase Storage…</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {(images.length > 0 || newImagePreviews.length > 0) && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label>Foto Fasilitas</Label>
                        <span className="text-xs text-muted-foreground">Hover foto → ☆ untuk jadikan utama</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {images.map((img, i) => (
                          <div key={img.id} className="relative group rounded-lg overflow-hidden aspect-square border">
                            <img src={img.url} alt={`foto-${i}`} className="w-full h-full object-cover" />
                            {img.isPrimary && (
                              <Badge className="absolute top-1 left-1 text-xs bg-primary/90 py-0 gap-1">
                                <Star size={9} fill="currentColor" /> Utama
                              </Badge>
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors rounded-lg" />
                            {!img.isPrimary && editFacility && (
                              <button
                                type="button"
                                title="Jadikan foto utama"
                                onClick={() => setPrimaryImage(editFacility.id, img.id)}
                                className="absolute top-1 left-1 bg-yellow-400 text-yellow-900 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Star size={12} />
                              </button>
                            )}
                            <button
                              type="button"
                              title="Hapus foto"
                              onClick={() => removeExistingImage(img.id)}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        {newImagePreviews.map((p, i) => (
                          <div key={`new-${i}`} className="relative group rounded-lg overflow-hidden aspect-square border border-dashed border-primary/50">
                            <img src={p.preview} alt={`preview-${i}`} className="w-full h-full object-cover" />
                            <Badge className="absolute top-1 left-1 text-xs bg-blue-500/80 py-0">Baru</Badge>
                            <button
                              type="button"
                              onClick={() => removeNewPreview(i)}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {images.length + newImagePreviews.length} foto • Foto pertama ditampilkan sebagai thumbnail
                      </p>
                    </div>
                  )}

                  {images.length === 0 && newImagePreviews.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      <ImageIcon size={28} className="mx-auto mb-2 opacity-30" />
                      <p>Belum ada foto. Upload foto di atas.</p>
                    </div>
                  )}
                </div>
              )}

              {activeSection === "status" && (
                <div className="space-y-4">
                  <div className={`rounded-xl border-2 p-5 transition-colors ${form.isActive ? "border-green-200 bg-green-50/50" : "border-orange-300 bg-orange-50/50"}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {form.isActive ? <CheckCircle2 size={20} className="text-green-600" /> : <WrenchIcon size={20} className="text-orange-500" />}
                        <span className="font-bold">{form.isActive ? "Fasilitas Aktif" : "Mode Maintenance"}</span>
                      </div>
                      <Switch
                        checked={form.isActive}
                        onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))}
                        className="data-[state=checked]:bg-green-500"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {form.isActive
                        ? "Fasilitas aktif dan bisa dipesan oleh pelanggan."
                        : "Fasilitas dalam mode maintenance. Pelanggan tidak bisa memesan fasilitas ini. Gunakan saat sedang perbaikan atau tutup sementara."}
                    </p>
                  </div>

                  {!form.isActive && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm text-orange-800">
                      <p className="font-semibold mb-1">⚠️ Perhatian</p>
                      <p>Booking yang sudah ada sebelum maintenance tidak akan dibatalkan secara otomatis. Konfirmasi manual jika diperlukan.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="px-6 py-4 border-t bg-background">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Menyimpan..." : (editFacility ? "Simpan Perubahan" : "Buat Fasilitas")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Fasilitas?</AlertDialogTitle>
            <AlertDialogDescription>Tindakan ini tidak dapat dibatalkan. Semua booking terkait mungkin terpengaruh.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
