import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListFacilities, useCreateMembership } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, MapPin, Dumbbell, CheckCircle2, Star, Users, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getFacilityImage } from "@/lib/utils";

const PRICE_PER_MONTH = 300000;
const today = new Date().toISOString().split("T")[0];

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function addMonths(dateStr: string, months: number): string {
  const date = new Date(dateStr);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split("T")[0];
}

function MembershipDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [months, setMonths] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", phone: "", startDate: today, notes: "" });
  const [success, setSuccess] = useState<{ name: string; endDate: string; totalPrice: number } | null>(null);

  const createMutation = useCreateMembership({
    mutation: {
      onSuccess: (data) => {
        setSuccess({ name: data.name, endDate: data.endDate, totalPrice: data.totalPrice });
      },
      onError: () => {
        toast({ title: "Gagal mendaftar", description: "Terjadi kesalahan. Silakan coba lagi.", variant: "destructive" });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone || !form.startDate) {
      toast({ title: "Form tidak lengkap", description: "Harap isi semua field yang wajib.", variant: "destructive" });
      return;
    }
    createMutation.mutate({ data: { ...form, months } });
  }

  function handleClose() {
    setSuccess(null);
    setForm({ name: "", email: "", phone: "", startDate: today, notes: "" });
    setMonths(1);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-3xl p-0 border-0">
        <DialogHeader className="p-6 pb-2 border-b bg-muted/30">
          <DialogTitle className="flex items-center gap-2 text-xl font-black text-secondary dark:text-white">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Dumbbell size={18} />
            </div>
            Daftar Member Gym Bulanan
          </DialogTitle>
        </DialogHeader>

        <div className="p-6">
          {success ? (
            <div className="text-center py-4 animate-in fade-in zoom-in duration-500">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6 shadow-inner">
                <CheckCircle2 className="text-green-600 w-10 h-10" />
              </div>
              <h3 className="text-2xl font-black mb-2 text-secondary dark:text-white">Pendaftaran Berhasil!</h3>
              <p className="text-muted-foreground font-medium mb-6">
                Selamat, <span className="font-bold text-foreground">{success.name}</span>!<br />
                Membership gym Anda aktif hingga <span className="font-bold text-foreground">{success.endDate}</span>.
              </p>
              
              <div className="bg-[#F8FAFC] dark:bg-slate-900 border border-border rounded-2xl p-5 mb-8 flex flex-col items-center justify-center shadow-sm">
                <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-1">Total Pembayaran</span>
                <span className="font-black text-primary text-3xl">{formatCurrency(success.totalPrice)}</span>
              </div>
              
              <p className="text-sm font-medium text-muted-foreground mb-6 bg-primary/5 p-4 rounded-xl text-left flex gap-3 items-start border border-primary/10">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">!</span>
                Tunjukkan konfirmasi ini kepada resepsionis saat kunjungan pertama Anda untuk mengaktifkan kartu akses.
              </p>
              <Button onClick={handleClose} size="lg" className="w-full rounded-full font-bold h-12 shadow-lg shadow-primary/20">
                Tutup & Kembali
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="m-name" className="font-bold text-foreground/80">Nama Lengkap <span className="text-destructive">*</span></Label>
                <Input id="m-name" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ketik nama lengkap Anda" required className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-email" className="font-bold text-foreground/80">Email <span className="text-destructive">*</span></Label>
                <Input id="m-email" type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="nama@email.com" required className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="m-phone" className="font-bold text-foreground/80">No. WhatsApp <span className="text-destructive">*</span></Label>
                  <Input id="m-phone" type="tel" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08xxxxxxxxxx" required className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m-start" className="font-bold text-foreground/80">Mulai Tanggal <span className="text-destructive">*</span></Label>
                  <Input id="m-start" type="date" value={form.startDate} min={today} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} required className="h-12 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border-border font-medium" />
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <Label className="font-bold text-foreground/80">Pilih Durasi Membership</Label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 6, 12].map((m) => (
                    <button key={m} type="button" onClick={() => setMonths(m)}
                      className={`h-12 rounded-xl text-sm font-bold border-2 transition-all ${
                        months === m 
                          ? "bg-primary/10 text-primary border-primary shadow-sm" 
                          : "bg-[#F8FAFC] dark:bg-slate-900 border-border text-foreground/70 hover:border-primary/40 hover:bg-white"
                      }`}>
                      {m}<span className="block text-[10px] uppercase font-semibold opacity-70">Bulan</span>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="rounded-2xl bg-[#F8FAFC] dark:bg-slate-900 border border-border p-5 space-y-3 mt-6">
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">Harga Per Bulan</span>
                  <span className="text-foreground">{formatCurrency(PRICE_PER_MONTH)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="text-muted-foreground">Durasi Pilihan</span>
                  <span className="text-foreground">{months} Bulan</span>
                </div>
                <div className="h-px bg-border my-1" />
                <div className="flex justify-between items-end">
                  <span className="font-bold text-foreground/80">Total Bayar</span>
                  <span className="text-2xl font-black text-primary">{formatCurrency(PRICE_PER_MONTH * months)}</span>
                </div>
              </div>
              
              <Button type="submit" size="lg" className="w-full h-14 rounded-full font-bold shadow-lg shadow-primary/20 text-base" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Memproses Data..." : "Konfirmasi & Lanjut Bayar"}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Facilities() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [membershipOpen, setMembershipOpen] = useState(false);

  const { data: facilities, isLoading } = useListFacilities({ activeOnly: true });

  const categories = useMemo(() => {
    if (!facilities) return ["all"];
    const cats = new Set(facilities.map(f => f.category));
    return ["all", ...Array.from(cats)].sort();
  }, [facilities]);

  const filteredFacilities = useMemo(() => {
    if (!facilities) return [];
    return facilities.filter(f => {
      const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase()) ||
                            f.category.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = selectedCategory === "all" || f.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [facilities, search, selectedCategory]);

  const showMembershipCard = selectedCategory === "all" || selectedCategory.toLowerCase() === "gym";

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 pb-20">
      {/* Header section */}
      <div className="bg-white dark:bg-slate-900 border-b border-border/50 pt-12 pb-16">
        <div className="container mx-auto px-4 md:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4 leading-tight">
              Pilih Fasilitas <span className="text-primary">Olahraga Anda</span>
            </h1>
            <p className="text-lg font-medium text-muted-foreground leading-relaxed">
              Dari lapangan berstandar internasional hingga pusat kebugaran modern. Temukan ketersediaan dan pesan jadwal Anda hari ini.
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 -mt-8 relative z-10">
        {/* Filters */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 md:p-6 shadow-xl shadow-primary/5 border border-border/50 flex flex-col md:flex-row gap-4 md:gap-6 mb-12">
          <div className="relative w-full md:w-96 shrink-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
            <Input
              placeholder="Cari nama fasilitas..."
              className="pl-12 h-14 rounded-2xl bg-[#F8FAFC] dark:bg-slate-950 border-transparent focus-visible:ring-primary focus-visible:bg-white focus-visible:border-primary/20 text-base font-medium shadow-inner transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex-1 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:pb-0 hide-scrollbar flex items-center">
            <div className="flex gap-2 min-w-max">
              {categories.map((cat) => (
                <button 
                  key={cat} 
                  onClick={() => setSelectedCategory(cat)} 
                  className={`px-5 py-3 rounded-2xl font-bold text-sm transition-all duration-300 capitalize whitespace-nowrap ${
                    selectedCategory === cat 
                      ? "bg-primary text-white shadow-md shadow-primary/20" 
                      : "bg-[#F8FAFC] dark:bg-slate-950 text-foreground/70 hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {cat === "all" ? "Semua Kategori" : cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-border/50">
                <Skeleton className="h-[240px] w-full rounded-2xl mb-6" />
                <div className="space-y-3 px-2">
                  <Skeleton className="h-6 w-1/4 rounded-full" />
                  <Skeleton className="h-8 w-3/4 rounded-lg" />
                  <Skeleton className="h-4 w-1/2 rounded-md" />
                  <div className="h-px bg-border/50 my-4" />
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-10 w-1/3 rounded-lg" />
                    <Skeleton className="h-12 w-32 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredFacilities.map((facility) => (
              <Card key={facility.id} className="group border-none shadow-md hover:shadow-xl transition-all duration-500 rounded-3xl overflow-hidden bg-white dark:bg-slate-900 h-full flex flex-col">
                <div className="relative aspect-[4/3] overflow-hidden bg-muted p-2 pb-0">
                  <div className="w-full h-full rounded-t-2xl rounded-b-lg overflow-hidden relative">
                    <img 
                      src={getFacilityImage(facility.category, facility.images)} 
                      alt={facility.name} 
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-in-out" 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-80" />
                    
                    <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                      <div className="bg-white/90 backdrop-blur-md text-primary px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider shadow-sm">
                        {facility.category}
                      </div>
                      <div className="flex gap-1 text-yellow-400">
                        <Star className="w-4 h-4 fill-yellow-400" />
                        <span className="text-white font-bold text-xs ml-1">4.9</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <CardContent className="p-6 md:p-8 flex-1 flex flex-col">
                  <h3 className="text-2xl font-black text-secondary dark:text-white mb-2 line-clamp-1 group-hover:text-primary transition-colors">{facility.name}</h3>
                  <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground mb-4">
                    <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Maks {facility.capacity || 10} Org</span>
                    <span className="w-1 h-1 rounded-full bg-border" />
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-500"><CheckCircle2 className="w-4 h-4" /> Tersedia</span>
                  </div>
                  
                  {facility.description && (
                    <p className="text-muted-foreground text-sm font-medium mb-6 line-clamp-2 leading-relaxed">
                      {facility.description}
                    </p>
                  )}
                  
                  <div className="mt-auto pt-6 border-t border-border/70 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Sewa Per Jam</div>
                      <div className="font-black text-xl text-primary">Rp {facility.pricePerHour.toLocaleString('id-ID')}</div>
                    </div>
                    <Button asChild className="rounded-full font-bold shadow-md shadow-primary/20 h-12 px-6">
                      <Link href={`/facilities/${facility.id}`}>Cek Jadwal</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Special Gym Membership Card */}
            {showMembershipCard && !search && (
              <Card 
                className="group relative border-2 border-primary/20 shadow-lg hover:shadow-primary/30 transition-all duration-500 rounded-3xl overflow-hidden cursor-pointer h-full flex flex-col transform hover:-translate-y-1" 
                onClick={() => setMembershipOpen(true)}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 pointer-events-none" />
                
                <div className="p-8 pb-4 relative z-10 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-6">
                    <div className="w-16 h-16 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/30">
                      <Dumbbell size={32} />
                    </div>
                    <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-none font-black tracking-wider px-3 py-1">
                      PENAWARAN SPESIAL
                    </Badge>
                  </div>
                  
                  <h3 className="text-2xl font-black text-secondary dark:text-white mb-3 group-hover:text-primary transition-colors">Membership Gym Eksklusif</h3>
                  <p className="text-muted-foreground font-medium mb-6 leading-relaxed flex-1">
                    Akses tak terbatas ke seluruh alat fitness premium kami. Berlaku untuk 1 bulan penuh tanpa batasan jam kunjungan.
                  </p>
                  
                  <div className="space-y-3 mb-8">
                    {['Akses gym sepuasnya', 'Gratis loker & shower', 'Konsultasi trainer (1x)'].map((b, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-sm font-semibold text-secondary dark:text-gray-300">
                        <CheckCircle2 className="w-5 h-5 text-primary shrink-0" /> {b}
                      </div>
                    ))}
                  </div>
                  
                  <div className="mt-auto pt-6 border-t border-primary/20 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Biaya Langganan</div>
                      <div className="font-black text-xl text-primary">Rp 300.000<span className="text-sm font-bold text-muted-foreground ml-1">/bln</span></div>
                    </div>
                    <Button 
                      className="rounded-full font-bold h-12 px-6 shadow-md"
                      onClick={(e) => { e.stopPropagation(); setMembershipOpen(true); }}
                    >
                      Daftar
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {filteredFacilities.length === 0 && !showMembershipCard && (
              <div className="col-span-full text-center py-28 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-border/80 shadow-sm">
                <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
                  <MapPin className="w-8 h-8 text-muted-foreground opacity-50" />
                </div>
                <h3 className="text-2xl font-black text-secondary dark:text-white mb-2">Fasilitas Tidak Ditemukan</h3>
                <p className="text-muted-foreground font-medium mb-8 max-w-sm mx-auto">Maaf, kami tidak menemukan fasilitas yang cocok dengan pencarian Anda.</p>
                <Button onClick={() => { setSearch(""); setSelectedCategory("all"); }} variant="outline" className="rounded-full font-bold h-12 px-8">
                  Hapus Filter Pencarian
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <MembershipDialog open={membershipOpen} onClose={() => setMembershipOpen(false)} />
    </div>
  );
}