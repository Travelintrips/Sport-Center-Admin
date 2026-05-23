import { useState } from "react";
import { useCreateMembership } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Dumbbell, Calendar, Shield, Star, Users } from "lucide-react";

const PRICE_PER_MONTH = 300000;

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function addMonths(dateStr: string, months: number): string {
  const date = new Date(dateStr);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split("T")[0];
}

const today = new Date().toISOString().split("T")[0];

const BENEFITS = [
  { icon: Dumbbell, label: "Akses Gym Penuh", desc: "Gunakan seluruh peralatan gym tanpa batasan waktu" },
  { icon: Calendar, label: "Bebas Pilih Jadwal", desc: "Datang kapan saja selama jam operasional" },
  { icon: Shield, label: "Locker Pribadi", desc: "Simpan barang Anda dengan aman di locker member" },
  { icon: Star, label: "Diskon Fasilitas Lain", desc: "Dapatkan diskon khusus untuk booking lapangan" },
  { icon: Users, label: "Komunitas Aktif", desc: "Bergabung dengan komunitas olahraga kami" },
];

export default function Membership() {
  const { toast } = useToast();
  const [months, setMonths] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", phone: "", startDate: today, notes: "" });
  const [success, setSuccess] = useState<{ name: string; endDate: string; totalPrice: number } | null>(null);

  const createMutation = useCreateMembership({
    mutation: {
      onSuccess: (data) => {
        setSuccess({ name: data.name, endDate: data.endDate, totalPrice: data.totalPrice });
        setForm({ name: "", email: "", phone: "", startDate: today, notes: "" });
        setMonths(1);
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

  if (success) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="text-green-600 w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Pendaftaran Berhasil!</h1>
        <p className="text-muted-foreground mb-6">
          Selamat datang, <span className="font-semibold text-foreground">{success.name}</span>!<br />
          Member Gym Anda aktif hingga <span className="font-semibold text-foreground">{success.endDate}</span>.
        </p>
        <Card className="mb-6 text-left">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Total Pembayaran</div>
              <div className="text-2xl font-black text-primary">{formatCurrency(success.totalPrice)}</div>
            </div>
            <Badge className="bg-green-100 text-green-700 border-green-200">Member Aktif</Badge>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground mb-6">
          Silakan tunjukkan konfirmasi ini kepada petugas kami saat pertama kali datang.
        </p>
        <Button onClick={() => setSuccess(null)} variant="outline" className="mr-3">
          Daftar Lagi
        </Button>
        <Button asChild>
          <a href="/">Kembali ke Home</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <section className="bg-gradient-to-br from-primary/20 via-background to-background py-16 md:py-24">
        <div className="container px-4 md:px-8 text-center max-w-2xl mx-auto">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">Member Gym Bulanan</Badge>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            Jadilah <span className="text-primary">Member Gym</span> Kami
          </h1>
          <p className="text-xl text-muted-foreground mb-6">
            Akses penuh ke fasilitas gym premium hanya dengan <span className="font-bold text-foreground">{formatCurrency(PRICE_PER_MONTH)}</span> per bulan.
          </p>
          <div className="text-3xl font-black text-primary">{formatCurrency(PRICE_PER_MONTH)} <span className="text-lg font-normal text-muted-foreground">/ bulan</span></div>
        </div>
      </section>

      <section className="py-16 bg-muted/30">
        <div className="container px-4 md:px-8">
          <h2 className="text-2xl font-bold text-center mb-10">Keuntungan Menjadi Member</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {BENEFITS.map((b) => (
              <div key={b.label} className="flex gap-4 p-5 rounded-xl bg-background border border-border">
                <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <b.icon size={22} />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{b.label}</h3>
                  <p className="text-sm text-muted-foreground">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="container px-4 md:px-8">
          <div className="max-w-xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Formulir Pendaftaran Member</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <Label htmlFor="name">Nama Lengkap <span className="text-destructive">*</span></Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Nama lengkap Anda"
                      required
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="email@contoh.com"
                      required
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone">No. Telepon <span className="text-destructive">*</span></Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="08xxxxxxxxxx"
                      required
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="startDate">Tanggal Mulai <span className="text-destructive">*</span></Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={form.startDate}
                      min={today}
                      onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                      required
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label>Durasi Membership</Label>
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      {[1, 2, 3, 6, 12].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMonths(m)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            months === m
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-border text-foreground hover:border-primary/50"
                          }`}
                        >
                          {m} Bulan
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="notes">Catatan (opsional)</Label>
                    <Textarea
                      id="notes"
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="Catatan atau pertanyaan tambahan..."
                      className="mt-1.5"
                      rows={3}
                    />
                  </div>

                  <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Harga per bulan</span>
                      <span>{formatCurrency(PRICE_PER_MONTH)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Durasi</span>
                      <span>{months} bulan</span>
                    </div>
                    {form.startDate && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Berlaku hingga</span>
                        <span>{addMonths(form.startDate, months)}</span>
                      </div>
                    )}
                    <div className="border-t border-primary/20 pt-2 flex justify-between font-bold">
                      <span>Total</span>
                      <span className="text-primary">{formatCurrency(PRICE_PER_MONTH * months)}</span>
                    </div>
                  </div>

                  <Button type="submit" className="w-full h-12 text-base" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Mendaftarkan..." : "Daftar Sekarang"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
