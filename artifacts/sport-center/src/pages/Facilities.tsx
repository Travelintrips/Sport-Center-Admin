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
import { Search, MapPin, Dumbbell, CheckCircle2, Star } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dumbbell size={20} className="text-primary" />
            Daftar Member Gym Bulanan
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="text-green-600 w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold mb-1">Pendaftaran Berhasil!</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Selamat, <span className="font-semibold text-foreground">{success.name}</span>!<br />
              Membership aktif hingga <span className="font-semibold text-foreground">{success.endDate}</span>.
            </p>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-5 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Pembayaran</span>
              <span className="font-bold text-primary text-lg">{formatCurrency(success.totalPrice)}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Tunjukkan konfirmasi ini kepada petugas saat pertama kali datang.
            </p>
            <Button onClick={handleClose} className="w-full">Tutup</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="m-name">Nama Lengkap <span className="text-destructive">*</span></Label>
              <Input id="m-name" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nama lengkap Anda" required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="m-email">Email <span className="text-destructive">*</span></Label>
              <Input id="m-email" type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@contoh.com" required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="m-phone">No. Telepon <span className="text-destructive">*</span></Label>
              <Input id="m-phone" type="tel" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08xxxxxxxxxx" required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="m-start">Tanggal Mulai <span className="text-destructive">*</span></Label>
              <Input id="m-start" type="date" value={form.startDate} min={today} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} required className="mt-1.5" />
            </div>
            <div>
              <Label>Durasi Membership</Label>
              <div className="flex gap-2 mt-1.5 flex-wrap">
                {[1, 2, 3, 6, 12].map((m) => (
                  <button key={m} type="button" onClick={() => setMonths(m)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${months === m ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:border-primary/50"}`}>
                    {m} Bln
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="m-notes">Catatan (opsional)</Label>
              <Textarea id="m-notes" value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Catatan tambahan..." className="mt-1.5" rows={2} />
            </div>
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Harga per bulan</span>
                <span>{formatCurrency(PRICE_PER_MONTH)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Durasi</span>
                <span>{months} bulan</span>
              </div>
              {form.startDate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Berlaku hingga</span>
                  <span>{addMonths(form.startDate, months)}</span>
                </div>
              )}
              <div className="border-t border-primary/20 pt-2 flex justify-between font-bold">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(PRICE_PER_MONTH * months)}</span>
              </div>
            </div>
            <Button type="submit" className="w-full h-11" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Mendaftarkan..." : "Daftar Sekarang"}
            </Button>
          </form>
        )}
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

  const showMembershipCard = selectedCategory === "all" || selectedCategory === "Gym";

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="mb-10">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">Book a Facility</h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Browse our premium courts and fields. Select a facility to check availability and book your next session.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 mb-10">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
          <Input
            placeholder="Search facilities..."
            className="pl-10 h-12 text-base"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:pb-0 hide-scrollbar">
          <div className="flex gap-2 min-w-max">
            {categories.map((cat) => (
              <Button key={cat} variant={selectedCategory === cat ? "default" : "outline"} onClick={() => setSelectedCategory(cat)} className="capitalize whitespace-nowrap">
                {cat === "all" ? "All Facilities" : cat}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="h-[250px] w-full rounded-xl" />
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredFacilities.map((facility) => (
            <Card key={facility.id} className="overflow-hidden group flex flex-col h-full hover:border-primary/50 transition-colors">
              <div className="aspect-[4/3] relative bg-muted overflow-hidden">
                {facility.images && facility.images.length > 0 ? (
                  <img src={facility.images[0].url} alt={facility.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary">No image available</div>
                )}
                <div className="absolute top-3 left-3 bg-background/90 backdrop-blur px-2.5 py-1 rounded text-xs font-bold shadow-sm uppercase tracking-wider text-primary">
                  {facility.category}
                </div>
              </div>
              <CardContent className="p-6 flex-1 flex flex-col">
                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{facility.name}</h3>
                {facility.description && (
                  <p className="text-muted-foreground text-sm mb-4 line-clamp-2">{facility.description}</p>
                )}
                <div className="mt-auto pt-4 border-t flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Price</div>
                    <div className="font-bold text-lg text-foreground">Rp {facility.pricePerHour.toLocaleString('id-ID')}<span className="text-sm font-normal text-muted-foreground">/hr</span></div>
                  </div>
                  <Button asChild>
                    <Link href={`/facilities/${facility.id}`}>Details</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {showMembershipCard && !search && (
            <Card className="overflow-hidden group flex flex-col h-full border-primary/30 bg-gradient-to-br from-primary/5 to-background hover:border-primary transition-colors cursor-pointer" onClick={() => setMembershipOpen(true)}>
              <div className="aspect-[4/3] relative bg-primary/10 overflow-hidden flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
                    <Dumbbell size={36} className="text-primary" />
                  </div>
                  <Badge className="bg-primary text-primary-foreground">Member Bulanan</Badge>
                </div>
                <div className="absolute top-3 left-3 bg-background/90 backdrop-blur px-2.5 py-1 rounded text-xs font-bold shadow-sm uppercase tracking-wider text-primary">
                  Gym
                </div>
                <div className="absolute top-3 right-3 bg-primary text-primary-foreground px-2.5 py-1 rounded text-xs font-bold">
                  PROMO
                </div>
              </div>
              <CardContent className="p-6 flex-1 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xl font-bold group-hover:text-primary transition-colors">Member Gym Bulanan</h3>
                  <Star size={16} className="text-yellow-500 fill-yellow-500" />
                </div>
                <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
                  Akses penuh ke fasilitas gym setiap hari. Bebas datang kapan saja selama jam operasional.
                </p>
                <div className="mt-auto pt-4 border-t flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Harga</div>
                    <div className="font-bold text-lg text-primary">Rp 300.000<span className="text-sm font-normal text-muted-foreground">/bln</span></div>
                  </div>
                  <Button onClick={(e) => { e.stopPropagation(); setMembershipOpen(true); }}>
                    Daftar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {filteredFacilities.length === 0 && !showMembershipCard && (
            <div className="col-span-full text-center py-24 bg-muted/30 rounded-xl border border-dashed">
              <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-xl font-bold mb-2">No facilities found</h3>
              <p className="text-muted-foreground mb-6">We couldn't find any facilities matching your search.</p>
              <Button onClick={() => { setSearch(""); setSelectedCategory("all"); }} variant="outline">Clear Filters</Button>
            </div>
          )}
        </div>
      )}

      <MembershipDialog open={membershipOpen} onClose={() => setMembershipOpen(false)} />
    </div>
  );
}
