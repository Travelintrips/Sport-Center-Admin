import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, FileText, CheckCircle2, TrendingUp, Store, Megaphone, Calendar, ChevronRight, ArrowRight, ShieldCheck, Clock, Users, Star } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

const BOOKING_TYPES = [
  {
    icon: Store,
    label: "Booth / Kios",
    labelEn: "Booth / Kiosk",
    desc: "Sewa area booth atau kios untuk berjualan produk/layanan Anda di kawasan Sport Center.",
    descEn: "Rent a booth or kiosk area to sell your products/services at Sport Center.",
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/20",
  },
  {
    icon: Calendar,
    label: "Ruang Event",
    labelEn: "Event Space",
    desc: "Sewa ruang khusus untuk menyelenggarakan event, seminar, atau turnamen olahraga.",
    descEn: "Rent a dedicated space for events, seminars, or sports tournaments.",
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/20",
  },
  {
    icon: Megaphone,
    label: "Ruang Iklan",
    labelEn: "Advertising Space",
    desc: "Pasang banner, spanduk, atau media iklan di lokasi strategis dalam kawasan Sport Center.",
    descEn: "Place banners, billboards, or advertising media at strategic locations in the Sport Center.",
    color: "text-purple-500",
    bg: "bg-purple-50 dark:bg-purple-950/20",
  },
];

const STEPS = [
  { num: "01", label: "Daftar Akun", labelEn: "Create Account", desc: "Hubungi admin untuk membuat akun Penyewa Tenan Anda.", descEn: "Contact admin to create your Tenant account." },
  { num: "02", label: "Ajukan Booking", labelEn: "Submit Booking", desc: "Isi form pengajuan sewa dengan detail kebutuhan Anda.", descEn: "Fill in the rental request form with your requirements." },
  { num: "03", label: "Tunggu Persetujuan", labelEn: "Await Approval", desc: "Admin meninjau dan menetapkan harga sesuai kesepakatan.", descEn: "Admin reviews and sets the price per agreement." },
  { num: "04", label: "Bayar & Aktif", labelEn: "Pay & Activate", desc: "Upload bukti pembayaran dan tenan Anda siap beroperasi.", descEn: "Upload proof of payment and your tenant is ready to operate." },
];

const BENEFITS = [
  { icon: Users, label: "Ribuan Pengunjung", labelEn: "Thousands of Visitors", desc: "Akses ke 1,200+ member aktif dan pengunjung harian Sport Center.", descEn: "Access to 1,200+ active members and daily Sport Center visitors." },
  { icon: ShieldCheck, label: "Lokasi Strategis", labelEn: "Strategic Location", desc: "Berada di kawasan Bandara Soekarno-Hatta, mudah dijangkau dari seluruh penjuru.", descEn: "Located in the Soekarno-Hatta Airport area, easily accessible from everywhere." },
  { icon: TrendingUp, label: "Potensi Tinggi", labelEn: "High Potential", desc: "Komunitas olahraga yang aktif dan memiliki daya beli tinggi.", descEn: "An active sports community with high purchasing power." },
  { icon: Clock, label: "Fleksibel", labelEn: "Flexible", desc: "Pilihan durasi sewa mulai dari event satu hari hingga tahunan.", descEn: "Rental duration options from a single-day event to annual contracts." },
];

export default function TenantLanding() {
  const { t } = useLang();
  const { data: user } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });

  const isTenant = user?.role === "tenant";

  return (
    <div className="pb-20">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-secondary via-secondary to-secondary/90 text-white">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/5 pointer-events-none" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-primary/10 blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none" />
        <div className="container mx-auto px-4 md:px-8 py-24 md:py-32 relative z-10">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary mb-6">
              <Building2 size={12} /> {t("Program Penyewa Tenan", "Tenant Program")}
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black leading-tight mb-6">
              {t("Buka Bisnis Anda di Sport Center", "Open Your Business at Sport Center")}
            </h1>
            <p className="text-lg text-white/70 mb-8 leading-relaxed max-w-xl">
              {t(
                "Jadilah bagian dari ekosistem Sport Center Bandara Soekarno-Hatta. Sewa booth, ruang event, atau space iklan di kawasan olahraga premium kami.",
                "Be part of the Sport Center Soekarno-Hatta ecosystem. Rent booths, event spaces, or advertising space in our premium sports venue."
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              {isTenant ? (
                <Button asChild size="lg" className="rounded-full px-8 font-bold shadow-lg shadow-primary/30">
                  <Link href="/tenant/dashboard">
                    <Building2 size={16} className="mr-2" />
                    {t("Dashboard Saya", "My Dashboard")}
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild size="lg" className="rounded-full px-8 font-bold shadow-lg shadow-primary/30">
                    <Link href="/contact">
                      {t("Hubungi Kami", "Contact Us")} <ArrowRight size={16} className="ml-2" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="rounded-full px-8 font-bold border-white/30 bg-white/10 text-white hover:bg-white/20">
                    <Link href="/login">
                      {t("Login Tenant", "Tenant Login")}
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
        {/* Stats strip */}
        <div className="border-t border-white/10 bg-white/5 backdrop-blur-sm">
          <div className="container mx-auto px-4 md:px-8 py-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { n: "1,200+", l: t("Member Aktif", "Active Members") },
              { n: "10+", l: t("Jenis Fasilitas", "Facility Types") },
              { n: "100+", l: t("Tenant Bergabung", "Tenants Joined") },
              { n: "24/7", l: t("Keamanan", "Security") },
            ].map((s) => (
              <div key={s.l} className="text-center">
                <div className="text-2xl font-black text-primary">{s.n}</div>
                <div className="text-xs text-white/50 mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Booking Types */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-12">
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t("Pilihan Sewa", "Rental Options")}</div>
            <h2 className="text-3xl md:text-4xl font-black">{t("Jenis Area yang Tersedia", "Available Space Types")}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {BOOKING_TYPES.map((type) => (
              <Card key={type.label} className="border border-border/60 hover:border-primary/30 hover:shadow-lg transition-all duration-300 group">
                <CardContent className="p-7">
                  <div className={`w-14 h-14 rounded-2xl ${type.bg} flex items-center justify-center mb-5 group-hover:scale-105 transition-transform`}>
                    <type.icon size={26} className={type.color} />
                  </div>
                  <h3 className="text-lg font-black mb-2">{t(type.label, type.labelEn)}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t(type.desc, type.descEn)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-12">
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t("Keuntungan", "Benefits")}</div>
            <h2 className="text-3xl md:text-4xl font-black">{t("Mengapa Bergabung?", "Why Join Us?")}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {BENEFITS.map((b) => (
              <div key={b.label} className="text-center p-6">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <b.icon size={24} className="text-primary" />
                </div>
                <h3 className="font-black mb-2">{t(b.label, b.labelEn)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(b.desc, b.descEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-12">
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t("Cara Kerja", "How It Works")}</div>
            <h2 className="text-3xl md:text-4xl font-black">{t("Proses Mudah & Cepat", "Easy & Fast Process")}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
            <div className="hidden lg:block absolute top-8 left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            {STEPS.map((step, i) => (
              <div key={step.num} className="relative text-center group">
                <div className="w-16 h-16 rounded-2xl bg-primary text-white flex items-center justify-center mx-auto mb-4 text-xl font-black shadow-lg shadow-primary/30 group-hover:scale-105 transition-transform">
                  {step.num}
                </div>
                <h3 className="font-black mb-2">{t(step.label, step.labelEn)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(step.desc, step.descEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-primary to-primary/80 text-white">
        <div className="container mx-auto px-4 md:px-8 text-center">
          <Star className="w-10 h-10 mx-auto mb-5 text-white/60" />
          <h2 className="text-3xl md:text-4xl font-black mb-4">
            {t("Siap Bergabung?", "Ready to Join?")}
          </h2>
          <p className="text-white/70 max-w-md mx-auto mb-8 leading-relaxed">
            {t(
              "Hubungi tim kami untuk informasi lebih lanjut atau daftarkan bisnis Anda sebagai Penyewa Tenan Sport Center sekarang.",
              "Contact our team for more information or register your business as a Sport Center Tenant now."
            )}
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild size="lg" variant="secondary" className="rounded-full px-8 font-bold">
              <Link href="/contact">{t("Hubungi Kami", "Contact Us")} <ChevronRight size={16} className="ml-1" /></Link>
            </Button>
            {isTenant && (
              <Button asChild size="lg" className="rounded-full px-8 font-bold bg-white text-primary hover:bg-white/90">
                <Link href="/tenant/dashboard">{t("Dashboard Tenant", "Tenant Dashboard")}</Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
