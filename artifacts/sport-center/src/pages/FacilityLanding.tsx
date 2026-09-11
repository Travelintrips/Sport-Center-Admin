import SEOHead from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Clock3, MapPin, Phone } from "lucide-react";
import { Link, useLocation } from "wouter";

type SportSlug = "futsal" | "badminton" | "basket" | "gym";

type LandingConfig = {
  slug: SportSlug;
  title: string;
  description: string;
  h1: string;
  image: string;
  imageAlt: string;
  facilityHref: string;
  facilityLabel: string;
  intro: string;
  highlights: string[];
  audience: string;
  related: SportSlug[];
};

const LANDINGS: Record<SportSlug, LandingConfig> = {
  futsal: {
    slug: "futsal",
    title: "Futsal Soekarno-Hatta | Booking Lapangan di Sport Center",
    description:
      "Booking lapangan futsal Soekarno-Hatta di Sport Center Bandara. Lapangan multiguna untuk tim dan komunitas, buka 06:00–22:00 WIB.",
    h1: "Futsal Soekarno-Hatta",
    image: "/futsal.png",
    imageAlt: "Lapangan futsal di Sport Center Bandara Soekarno-Hatta",
    facilityHref: "/facilities/1",
    facilityLabel: "Lihat jadwal lapangan futsal",
    intro:
      "Sport Center Bandara Soekarno-Hatta menyediakan lapangan multiguna yang dapat digunakan untuk futsal. Lapangan ini cocok untuk latihan tim, pertandingan persahabatan, dan komunitas yang membutuhkan lokasi olahraga dekat area bandara.",
    highlights: [
      "Satu lapangan multiguna yang dapat digunakan untuk futsal, basket, dan voli",
      "Jadwal bermain tersedia mulai pukul 06:00 sampai 22:00 WIB",
      "Pemesanan online dengan pilihan tanggal, jam, dan durasi bermain",
      "Lokasi strategis di Pajang, Benda, Kota Tangerang",
    ],
    audience: "Pilihan praktis untuk tim kantor, komunitas futsal, pemain rutin, dan traveler yang memiliki waktu transit di sekitar Bandara Soekarno-Hatta.",
    related: ["basket", "badminton", "gym"],
  },
  badminton: {
    slug: "badminton",
    title: "Badminton Soekarno-Hatta | Booking Lapangan Indoor",
    description:
      "Booking lapangan badminton Soekarno-Hatta di Sport Center Bandara. Tersedia Badminton Court A dan B, indoor, dan buka setiap hari 06:00–22:00 WIB.",
    h1: "Badminton Soekarno-Hatta",
    image: "/badminton.png",
    imageAlt: "Lapangan badminton indoor di Sport Center Bandara Soekarno-Hatta",
    facilityHref: "/facilities/5",
    facilityLabel: "Lihat jadwal lapangan badminton",
    intro:
      "Nikmati sesi badminton yang lebih nyaman di Sport Center Bandara Soekarno-Hatta. Badminton Court A dan B tersedia untuk latihan, bermain bersama keluarga, atau sesi rutin komunitas di lokasi indoor yang mudah dijangkau dari kawasan bandara.",
    highlights: [
      "Tersedia Badminton Court A dan Badminton Court B",
      "Pencahayaan dan kondisi lapangan dirancang untuk sesi bermain yang nyaman",
      "Pilih tanggal, jam, dan durasi sebelum melakukan booking online",
      "Buka setiap hari pukul 06:00–22:00 WIB",
    ],
    audience: "Cocok untuk pemain pemula, komunitas badminton, latihan rutin, dan keluarga yang mencari lapangan badminton di sekitar Soekarno-Hatta.",
    related: ["futsal", "basket", "gym"],
  },
  basket: {
    slug: "basket",
    title: "Basket Soekarno-Hatta | Booking Lapangan Multiguna",
    description:
      "Booking lapangan basket Soekarno-Hatta di Sport Center Bandara. Gunakan lapangan multiguna untuk latihan dan permainan basket, buka 06:00–22:00 WIB.",
    h1: "Basket Soekarno-Hatta",
    image: "/basket.png",
    imageAlt: "Lapangan basket multiguna di Sport Center Bandara Soekarno-Hatta",
    facilityHref: "/facilities/1",
    facilityLabel: "Lihat jadwal lapangan basket",
    intro:
      "Lapangan multiguna Sport Center Bandara Soekarno-Hatta dapat digunakan untuk bermain basket. Satu lapangan yang sama juga mendukung futsal dan voli, sehingga komunitas dapat memilih jenis olahraga sesuai jadwal dan kebutuhan mereka.",
    highlights: [
      "Lapangan multiguna untuk basket, futsal, dan voli",
      "Kapasitas hingga 14 orang berdasarkan data fasilitas aktif",
      "Booking online berdasarkan tanggal, jam, dan durasi bermain",
      "Jam operasional setiap hari 06:00–22:00 WIB",
    ],
    audience: "Tempat bermain basket untuk komunitas, latihan tim, permainan santai, dan aktivitas olahraga setelah bekerja di area Bandara Soekarno-Hatta.",
    related: ["futsal", "badminton", "gym"],
  },
  gym: {
    slug: "gym",
    title: "Gym Soekarno-Hatta | Fitness & Membership",
    description:
      "Gym Soekarno-Hatta di Sport Center Bandara menyediakan akses fitness per kunjungan dan membership. Gym buka 06:00–22:00 WIB di Kota Tangerang.",
    h1: "Gym Soekarno-Hatta",
    image: "/gym.png",
    imageAlt: "Gym dan fitness center di Sport Center Bandara Soekarno-Hatta",
    facilityHref: "/facilities/6",
    facilityLabel: "Lihat jadwal dan akses gym",
    intro:
      "Gym / Fitness Center Sport Center Bandara Soekarno-Hatta membantu Anda tetap aktif tanpa perlu keluar jauh dari kawasan bandara. Tersedia akses per kunjungan dan pilihan membership untuk kebutuhan latihan rutin.",
    highlights: [
      "Akses gym per kunjungan dengan tarif mulai Rp30.000 berdasarkan data fasilitas aktif",
      "Area cardio, beban, dan functional training sesuai deskripsi fasilitas",
      "Loker, ruang ganti, shower, toilet, parkir, dan air minum tersedia",
      "Akses fasilitas setiap hari pukul 06:00–22:00 WIB",
    ],
    audience: "Pilihan untuk pekerja sekitar bandara, traveler transit, pemula, dan member yang ingin menjaga rutinitas fitness dengan lokasi yang mudah dijangkau.",
    related: ["futsal", "badminton", "basket"],
  },
};

function getLandingConfig(pathname: string): LandingConfig {
  const slug = pathname.split("/").filter(Boolean)[0] as SportSlug;
  return LANDINGS[slug] ?? LANDINGS.futsal;
}

export default function FacilityLanding() {
  const [location] = useLocation();
  const landing = getLandingConfig(location);

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-20 dark:bg-slate-950">
      <SEOHead title={landing.title} description={landing.description} path={`/${landing.slug}`} image={`${window.location.origin}${landing.image}`} />

      <main>
        <section className="border-b border-border/50 bg-white dark:bg-slate-900">
          <div className="container mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 py-12 md:px-8 md:py-20 lg:grid-cols-2 lg:gap-16">
            <div className="max-w-2xl">
              <nav aria-label="Breadcrumb" className="mb-6 text-sm font-semibold text-muted-foreground">
                <Link href="/" className="hover:text-primary">Beranda</Link>
                <span className="mx-2">/</span>
                <Link href="/facilities" className="hover:text-primary">Fasilitas</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{landing.h1}</span>
              </nav>
              <p className="mb-4 text-sm font-black uppercase tracking-[0.18em] text-primary">
                Sport Center Bandara Soekarno-Hatta
              </p>
              <h1 className="mb-6 text-4xl font-black leading-tight tracking-tight text-secondary dark:text-white md:text-6xl">
                {landing.h1}
              </h1>
              <p className="mb-8 max-w-xl text-lg font-medium leading-relaxed text-muted-foreground">
                {landing.intro}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-13 rounded-full px-7 font-black shadow-lg shadow-primary/20">
                  <Link href={landing.facilityHref}>
                    {landing.facilityLabel}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-13 rounded-full px-7 font-bold">
                  <Link href="/facilities">Lihat semua fasilitas</Link>
                </Button>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-muted shadow-2xl dark:border-slate-800">
              <img
                src={landing.image}
                alt={landing.imageAlt}
                width="1408"
                height="768"
                fetchPriority="high"
                decoding="async"
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="aspect-[1408/768] w-full object-cover"
              />
            </div>
          </div>
        </section>

        <section className="container mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-14 md:px-8 lg:grid-cols-[1.25fr_0.75fr] lg:py-20">
          <article className="rounded-3xl border border-border/50 bg-white p-7 shadow-sm dark:bg-slate-900 md:p-10">
            <h2 className="mb-6 text-2xl font-black tracking-tight text-secondary dark:text-white md:text-3xl">
              Fasilitas {landing.h1.replace(" Soekarno-Hatta", "")} di kawasan bandara
            </h2>
            <ul className="grid gap-4 md:grid-cols-2">
              {landing.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-3 text-sm font-medium leading-relaxed text-foreground/80">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-border/60 pt-8 text-base font-medium leading-relaxed text-muted-foreground">
              {landing.audience}
            </p>
          </article>

          <aside className="rounded-3xl bg-secondary p-7 text-white shadow-xl md:p-8">
            <h2 className="mb-6 text-2xl font-black">Informasi lokasi</h2>
            <div className="space-y-5 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <a href="https://maps.app.goo.gl/iiXurNzUPFZpEA5s6" target="_blank" rel="noopener noreferrer" className="leading-relaxed text-white/80 hover:text-white">
                  Jl. C3 No. 831, Pajang, Benda, Kota Tangerang, Banten 15126
                </a>
              </div>
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="text-white/80">Setiap hari, 06:00–22:00 WIB</span>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <a href="tel:+6281216104734" className="text-white/80 hover:text-white">+62 812-1610-4734</a>
              </div>
            </div>
            <Button asChild variant="secondary" className="mt-8 w-full rounded-full font-bold">
              <Link href={landing.facilityHref}>Booking sekarang</Link>
            </Button>
          </aside>
        </section>

        <section className="container mx-auto max-w-7xl px-4 md:px-8">
          <div className="rounded-3xl border border-primary/20 bg-primary/5 p-7 md:p-10">
            <h2 className="mb-5 text-2xl font-black text-secondary dark:text-white">Jelajahi olahraga lainnya</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {landing.related.map((slug) => (
                <Link
                  key={slug}
                  href={`/${slug}`}
                  className="flex items-center justify-between rounded-2xl border border-border/70 bg-white px-4 py-3 font-bold text-foreground transition-colors hover:border-primary hover:text-primary dark:bg-slate-900"
                >
                  <span>{LANDINGS[slug].h1}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ))}
            </div>
            <p className="mt-6 text-sm font-medium text-muted-foreground">
              Butuh pilihan lapangan lain? <Link href="/facilities" className="font-bold text-primary hover:underline">Lihat daftar fasilitas lengkap</Link> atau <Link href="/contact" className="font-bold text-primary hover:underline">hubungi Sport Center</Link>.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}