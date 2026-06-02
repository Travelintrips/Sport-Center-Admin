import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/lib/i18n";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import {
  Building2, CheckCircle2, ShoppingBag, Megaphone, Users,
  Star, ArrowRight, Zap, Shield, Clock, ChevronRight,
} from "lucide-react";

const BENEFITS = [
  {
    icon: Users,
    title: "Ribuan Pengunjung / Bulan",
    desc: "Sport Center dikunjungi ribuan member aktif setiap bulan — calon pelanggan siap untuk bisnis Anda.",
  },
  {
    icon: Zap,
    title: "Setup Cepat & Mudah",
    desc: "Proses pendaftaran online, tanpa birokrasi. Daftar hari ini, langsung ajukan booking space.",
  },
  {
    icon: Shield,
    title: "Harga Transparan",
    desc: "Satu harga flat Rp 3.000.000 / bulan, sudah termasuk PPN. Tidak ada biaya tersembunyi.",
  },
  {
    icon: Clock,
    title: "Kontrak Fleksibel",
    desc: "Pilih durasi sewa mulai dari 1 bulan. Perpanjang kapan saja sesuai kebutuhan bisnis.",
  },
];

const SPACE_TYPES = [
  {
    icon: ShoppingBag,
    label: "Booth / Kios",
    desc: "Area penjualan produk, minuman, atau makanan di dalam kawasan Sport Center.",
    colorClass: "bg-orange-50 text-orange-600 border-orange-200",
  },
  {
    icon: Star,
    label: "Ruang Event",
    desc: "Ruang serbaguna untuk workshop, seminar, peluncuran produk, atau acara komunitas.",
    colorClass: "bg-blue-50 text-blue-600 border-blue-200",
  },
  {
    icon: Megaphone,
    label: "Ruang Iklan",
    desc: "Banner, signage, dan media promosi di lokasi strategis dengan lalu lintas tinggi.",
    colorClass: "bg-purple-50 text-purple-600 border-purple-200",
  },
];

export default function TenantLanding() {
  const { t } = useLang();
  const { data: user } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });
  const isTenant = user?.role === "tenant";

  return (
    <div className="bg-background">

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, hsl(16 90% 55%) 0%, transparent 50%), radial-gradient(circle at 80% 20%, hsl(16 90% 45%) 0%, transparent 40%)" }} />
        </div>
        <div className="relative container mx-auto px-6 py-20 md:py-28 max-w-5xl">
          <div className="max-w-2xl">
            <Badge className="mb-5 bg-primary/20 text-primary border-primary/30 hover:bg-primary/20 text-xs font-bold uppercase tracking-widest px-4 py-1.5">
              <Building2 size={11} className="mr-1.5" />
              {t("Program Sewa Tenan", "Tenant Program")}
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black leading-tight mb-5">
              {t("Buka Bisnis Anda", "Open Your Business")}<br />
              <span className="text-primary">{t("di Sport Center", "at Sport Center")}</span>
            </h1>
            <p className="text-lg text-white/70 mb-8 leading-relaxed">
              {t(
                "Jadilah bagian dari ekosistem Sport Center Bandara Soekarno-Hatta. Sewa booth, ruang event, atau space iklan — daftar online, langsung booking.",
                "Be part of the Sport Center Soekarno-Hatta ecosystem. Rent a booth, event space, or advertising space — register online, book instantly."
              )}
            </p>

            {/* Pricing box */}
            <div className="inline-flex flex-wrap items-center gap-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl px-5 py-4 mb-8">
              <div>
                <p className="text-xs text-white/50 font-semibold uppercase tracking-wider">{t("Harga Sewa", "Monthly Rate")}</p>
                <p className="text-3xl font-black text-white">Rp 3.000.000<span className="text-lg font-bold text-white/60"> / bulan</span></p>
                <p className="text-xs text-white/50 mt-0.5">{t("Sudah termasuk PPN 11%", "Inclusive of 11% VAT")}</p>
              </div>
              <div className="hidden sm:block w-px h-12 bg-white/20" />
              <div className="space-y-1">
                {[t("Harga flat, tanpa biaya tambahan", "Flat price, no hidden fees"),
                  t("Kontrak fleksibel mulai 1 bulan", "Flexible contract from 1 month"),
                  t("Daftar online, langsung booking", "Register online, book instantly"),
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-xs text-white/70">
                    <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {isTenant ? (
                <>
                  <Button asChild size="lg" className="rounded-full font-black px-8 py-6 text-base shadow-lg shadow-primary/30">
                    <Link href="/tenant/booking">{t("Ajukan Booking Sewa", "Submit Rental Booking")} <ArrowRight size={16} className="ml-2" /></Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="rounded-full font-bold px-8 py-6 border-white/30 text-white hover:bg-white/10">
                    <Link href="/tenant/dashboard">{t("Dashboard Tenant", "Tenant Dashboard")}</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild size="lg" className="rounded-full font-black px-8 py-6 text-base shadow-lg shadow-primary/30">
                    <Link href="/tenant/register">{t("Daftar Sekarang — Gratis", "Register Now — Free")} <ArrowRight size={16} className="ml-2" /></Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="rounded-full font-bold px-8 py-6 border-white/30 text-white hover:bg-white/10">
                    <Link href="/login">{t("Sudah punya akun? Login", "Have an account? Login")}</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Space Types ── */}
      <section className="py-16 md:py-20 container mx-auto px-6 max-w-5xl">
        <div className="text-center mb-12">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t("Pilihan Area", "Available Spaces")}</p>
          <h2 className="text-3xl font-black">{t("Jenis Area yang Tersedia", "Available Space Types")}</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {SPACE_TYPES.map(({ icon: Icon, label, desc, colorClass }) => (
            <div key={label} className={`rounded-2xl border p-6 ${colorClass}`}>
              <div className="w-11 h-11 rounded-xl bg-white/60 flex items-center justify-center mb-4">
                <Icon size={22} />
              </div>
              <h3 className="font-black text-lg mb-2">{label}</h3>
              <p className="text-sm opacity-80 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Benefits ── */}
      <section className="py-16 md:py-20 bg-muted/40">
        <div className="container mx-auto px-6 max-w-5xl">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t("Keuntungan", "Benefits")}</p>
            <h2 className="text-3xl font-black">{t("Mengapa Sewa di Sport Center?", "Why Rent at Sport Center?")}</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {BENEFITS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4 bg-background rounded-2xl p-6 border border-border/60">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon size={20} className="text-primary" />
                </div>
                <div>
                  <h3 className="font-black mb-1.5">{t(title, title)}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t(desc, desc)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-16 md:py-20 container mx-auto px-6 max-w-4xl">
        <div className="text-center mb-12">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t("Cara Daftar", "How It Works")}</p>
          <h2 className="text-3xl font-black">{t("3 Langkah Mudah", "3 Simple Steps")}</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { step: "01", title: t("Daftar Online", "Register Online"), desc: t("Isi form pendaftaran dengan data diri dan informasi bisnis Anda. Proses cepat, hanya 2 menit.", "Fill in the registration form with your personal and business info. Quick process, only 2 minutes.") },
            { step: "02", title: t("Ajukan Booking", "Submit Booking"), desc: t("Setelah daftar, langsung pilih jenis area, durasi sewa, dan kirim pengajuan booking.", "After registering, select the area type, rental duration, and submit your booking request.") },
            { step: "03", title: t("Tim Kami Konfirmasi", "Our Team Confirms"), desc: t("Admin kami akan meninjau dan menghubungi Anda dalam 1-3 hari kerja untuk konfirmasi.", "Our admin will review and contact you within 1-3 business days for confirmation.") },
          ].map(({ step, title, desc }, i) => (
            <div key={step} className="relative text-center">
              {i < 2 && (
                <div className="hidden md:block absolute top-6 left-[calc(100%-12px)] w-6 text-muted-foreground/30">
                  <ChevronRight size={24} />
                </div>
              )}
              <div className="w-14 h-14 rounded-2xl bg-primary text-white font-black text-xl flex items-center justify-center mx-auto mb-4">
                {step}
              </div>
              <h3 className="font-black mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 md:py-20 bg-gradient-to-br from-primary to-orange-600">
        <div className="container mx-auto px-6 max-w-3xl text-center text-white">
          <h2 className="text-3xl md:text-4xl font-black mb-4">
            {t("Siap Buka Bisnis di Sport Center?", "Ready to Open Your Business at Sport Center?")}
          </h2>
          <p className="text-white/80 mb-8 text-lg">
            {t("Rp 3.000.000 / bulan • Include PPN • Daftar online sekarang", "Rp 3,000,000 / month • VAT inclusive • Register online now")}
          </p>
          {isTenant ? (
            <Button asChild size="lg" variant="secondary" className="rounded-full font-black px-10 py-6 text-base">
              <Link href="/tenant/booking">{t("Ajukan Booking Sewa", "Submit Rental Booking")} <ArrowRight size={16} className="ml-2" /></Link>
            </Button>
          ) : (
            <Button asChild size="lg" variant="secondary" className="rounded-full font-black px-10 py-6 text-base">
              <Link href="/tenant/register">{t("Daftar Sebagai Tenant Sekarang", "Register as Tenant Now")} <ArrowRight size={16} className="ml-2" /></Link>
            </Button>
          )}
        </div>
      </section>

    </div>
  );
}
