import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Trophy,
  Clock,
  MapPin,
  Phone,
  ArrowRight,
  ShieldCheck,
  Zap,
  CreditCard,
  Star,
  Quote,
  CheckCircle2,
  Users,
  Building,
  Plane,
  ChevronLeft,
  ChevronRight,
  Flame,
  Dumbbell,
  Crown,
  Sparkles,
  CalendarCheck,
  TrendingUp,
} from "lucide-react";
import { useListFacilities, useGetSettings, useListPromos } from "@workspace/api-client-react";
import { getFacilityImage } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import buildingImg from "@assets/1780087062_1780089778393.png";
import { useEffect, useRef, useState, useCallback } from "react";

/* ─── Animated Counter ───────────────────────────────────────────── */
function useCountUp(target: number, duration = 1800, enabled = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    setValue(0);
    const start = performance.now();
    const raf = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, [target, duration, enabled]);
  return value;
}

function AnimatedCounter({
  end,
  label,
  suffix = "+",
  prefix = "",
  highlight = false,
}: {
  end: number;
  label: string;
  suffix?: string;
  prefix?: string;
  highlight?: boolean;
  icon?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [triggered, setTriggered] = useState(false);
  const value = useCountUp(end, 1800, triggered);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setTriggered(true); observer.disconnect(); } },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (highlight) {
    return (
      <div ref={ref} className="flex flex-col items-center justify-center p-6 bg-primary rounded-3xl shadow-lg shadow-primary/30 text-white">
        <div className="text-4xl md:text-5xl font-black mb-2 flex items-end gap-0.5 tabular-nums">
          {prefix}{value.toLocaleString("id-ID")}<span className="text-2xl opacity-70">{suffix}</span>
        </div>
        <div className="text-sm font-bold uppercase tracking-widest opacity-90 text-center">{label}</div>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex flex-col items-center justify-center p-6 bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-border/50">
      <div className="text-4xl md:text-5xl font-black text-primary mb-2 flex items-end gap-0.5 tabular-nums">
        {prefix}{value.toLocaleString("id-ID")}<span className="text-xl opacity-60">{suffix}</span>
      </div>
      <div className="text-sm font-semibold text-muted-foreground uppercase tracking-widest text-center">{label}</div>
    </div>
  );
}

/* ─── Testimonial Slider ─────────────────────────────────────────── */
const TESTIMONIALS = [
  {
    quote: "Lantai lapangan futsalnya berstandar tinggi, empuk di lutut. Sistem bookingnya cepat tanpa antri. Fix jadi tempat rutin tim kami!",
    quoteEn: "The futsal court flooring is high-standard, gentle on the knees. The booking system is fast. Definitely our team's regular spot!",
    name: "Bima Arya",
    role: "Kapten Tim Futsal",
    roleEn: "Futsal Team Captain",
    rating: 5,
    avatar: "BA",
    color: "from-orange-500 to-red-500",
  },
  {
    quote: "Transit 4 jam nunggu pesawat? Nge-gym di sini solusinya. Alatnya lengkap, shower room-nya sekelas hotel. Badan langsung segar!",
    quoteEn: "A 4-hour transit? Hitting the gym here is the solution. Complete equipment, hotel-class showers. Instantly refreshing!",
    name: "Dian Pratiwi",
    role: "Frequent Traveler",
    roleEn: "Frequent Traveler",
    rating: 5,
    avatar: "DP",
    color: "from-blue-500 to-cyan-500",
  },
  {
    quote: "Sangat rekomended untuk event korporat. Panitia dibantu dari awal, parkir luas, dan lapangannya terang benderang. Mantap!",
    quoteEn: "Highly recommended for corporate events. Helped from the start, ample parking, brightly lit courts. Excellent!",
    name: "Reza Kurniawan",
    role: "HRD Manager",
    roleEn: "HR Manager",
    rating: 5,
    avatar: "RK",
    color: "from-green-500 to-teal-500",
  },
  {
    quote: "Court badminton A maupun B kondisinya sama-sama oke. Sudah 3 bulan rutin main di sini, belum pernah kecewa. Booking online-nya simpel banget.",
    quoteEn: "Both badminton courts are in great condition. Playing here for 3 months, never disappointed. The online booking is super simple.",
    name: "Siti Rahayu",
    role: "Atlet Badminton",
    roleEn: "Badminton Athlete",
    rating: 5,
    avatar: "SR",
    color: "from-purple-500 to-pink-500",
  },
  {
    quote: "Harga member bulanan sangat worth it. Datang setiap hari ke gym, fasilitas loker aman, dan staffnya ramah. Paling recommended!",
    quoteEn: "Monthly membership price is very worth it. Daily gym visits, secure lockers, friendly staff. Highly recommended!",
    name: "Ahmad Fauzi",
    role: "Member Gym",
    roleEn: "Gym Member",
    rating: 5,
    avatar: "AF",
    color: "from-yellow-500 to-orange-500",
  },
  {
    quote: "Lapangan Multiguna-nya serbaguna banget — minggu ini main basket, minggu depan futsal. Harga per jam kompetitif. Cocok buat komunitas kami.",
    quoteEn: "The multipurpose court is super versatile — basketball this week, futsal next week. Competitive hourly rates. Perfect for our community.",
    name: "Rina Wulandari",
    role: "Koordinator Komunitas",
    roleEn: "Community Coordinator",
    rating: 5,
    avatar: "RW",
    color: "from-indigo-500 to-blue-500",
  },
];

function TestimonialSlider() {
  const { t } = useLang();
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((idx: number) => {
    setCurrent((idx + TESTIMONIALS.length) % TESTIMONIALS.length);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setInterval(() => goTo(current + 1), 4500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [current, isPlaying, goTo]);

  const pause = () => setIsPlaying(false);
  const resume = () => setIsPlaying(true);

  const visible = [
    TESTIMONIALS[(current + TESTIMONIALS.length - 1) % TESTIMONIALS.length],
    TESTIMONIALS[current],
    TESTIMONIALS[(current + 1) % TESTIMONIALS.length],
  ];

  return (
    <div onMouseEnter={pause} onMouseLeave={resume}>
      {/* Main cards — 3-up on desktop, 1-up on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-10">
        {visible.map((testimonial, idx) => {
          const isCenter = idx === 1;
          return (
            <div
              key={`${current}-${idx}`}
              className={`relative rounded-3xl p-8 border transition-all duration-500 ${
                isCenter
                  ? "bg-white/12 border-white/20 scale-100 md:scale-105 shadow-2xl z-10"
                  : "bg-white/5 border-white/8 scale-100 md:scale-95 opacity-70 hidden md:block"
              }`}
            >
              <Quote className="absolute top-8 right-8 text-primary/25 w-10 h-10" />
              <div className="flex gap-0.5 mb-5">
                {Array.from({ length: testimonial.rating }).map((_, s) => (
                  <Star key={s} className="w-4 h-4 fill-primary text-primary" />
                ))}
              </div>
              <p className="text-base md:text-lg text-white/90 font-medium leading-relaxed mb-8">
                "{t(testimonial.quote, testimonial.quoteEn)}"
              </p>
              <div className="flex items-center gap-4 mt-auto">
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${testimonial.color} flex items-center justify-center font-black text-white text-sm shadow-lg`}>
                  {testimonial.avatar}
                </div>
                <div>
                  <div className="font-bold text-white">{testimonial.name}</div>
                  <div className="text-sm text-white/55 font-medium">{t(testimonial.role, testimonial.roleEn)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6">
        <button
          onClick={() => { pause(); goTo(current - 1); }}
          className="w-11 h-11 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex gap-2">
          {TESTIMONIALS.map((_, i) => (
            <button
              key={i}
              onClick={() => { pause(); goTo(i); }}
              className={`rounded-full transition-all duration-300 ${
                i === current ? "w-8 h-2.5 bg-primary" : "w-2.5 h-2.5 bg-white/30 hover:bg-white/50"
              }`}
            />
          ))}
        </div>

        <button
          onClick={() => { pause(); goTo(current + 1); }}
          className="w-11 h-11 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────── */
export default function Home() {
  const { t } = useLang();
  const { data: facilities } = useListFacilities({ activeOnly: true });
  const { data: settings } = useGetSettings();
  const { data: promos } = useListPromos({ activeOnly: true });

  const highlightFacilities = facilities?.slice(0, 3) || [];

  return (
    <div className="flex flex-col min-h-screen">

      {/* ── Hero (full-bleed building photo) ─────────────────────── */}
      <section className="relative min-h-[92vh] flex flex-col justify-end overflow-hidden">

        {/* Background image */}
        <img
          src={buildingImg}
          alt="Sport Center Bandara Soekarno-Hatta"
          className="absolute inset-0 w-full h-full object-cover object-center scale-105 transition-transform duration-[8s] ease-out"
          style={{ animation: "heroZoom 12s ease-out forwards" }}
        />

        {/* Multi-stop overlay: subtle top → rich dark bottom */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/85" />
        {/* Warm color accent sweep from right */}
        <div className="absolute inset-0 bg-gradient-to-tl from-primary/30 via-transparent to-transparent" />

        {/* Content */}
        <div className="relative z-10 container px-4 md:px-8 pb-36 md:pb-44 pt-24 md:pt-32">
          <div className="max-w-3xl">

            {/* Live badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md text-white font-bold text-sm mb-8 border border-white/20 shadow-lg">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-80" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
              </span>
              {t("Buka Sekarang · 06:00 – 22:00 WIB", "Open Now · 06:00 – 22:00 WIB")}
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tight text-white leading-[1.05] mb-6">
              {t("Sport Center", "Sport Center")}<br />
              <span className="text-primary drop-shadow-[0_2px_16px_rgba(249,115,22,0.6)]">
                {t("Soekarno-Hatta", "Soekarno-Hatta")}
              </span>
            </h1>

            <p className="text-lg md:text-xl text-white/75 mb-10 leading-relaxed font-medium max-w-xl">
              {t(
                "Pusat olahraga premium di kawasan Bandara. Booking lapangan futsal, basket, badminton, hingga gym langsung dari smartphone.",
                "Premium sports hub near the Airport. Book futsal, basketball, badminton, and gym courts straight from your phone."
              )}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <Button size="lg" className="h-14 px-8 text-base font-black shadow-2xl shadow-primary/40 hover:shadow-primary/60 hover:scale-105 transition-all rounded-full group bg-primary hover:bg-primary/90" asChild>
                <Link href="/facilities">
                  {t("Booking Sekarang", "Book Now")}
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-14 px-8 text-base font-bold rounded-full border-white/30 bg-white/10 backdrop-blur-md text-white hover:bg-white/20 hover:border-white/50 transition-all" asChild>
                <Link href="/facilities">{t("Lihat Fasilitas", "View Facilities")}</Link>
              </Button>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-5">
              <div className="flex -space-x-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="w-10 h-10 rounded-full border-2 border-white/40 bg-slate-700 overflow-hidden shadow-md">
                    <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=${i+10}&backgroundColor=374151`} alt="User" />
                  </div>
                ))}
              </div>
              <div>
                <div className="flex gap-0.5 mb-0.5">
                  {[...Array(5)].map((_, i) => <Star key={i} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />)}
                </div>
                <div className="text-sm font-semibold text-white/80">
                  <span className="text-white font-black">1,200+</span> {t("member aktif · rated 4.9/5", "active members · rated 4.9/5")}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Scroll cue */}
        <div className="absolute bottom-36 md:bottom-44 right-8 hidden md:flex flex-col items-center gap-2 text-white/40">
          <div className="w-px h-12 bg-gradient-to-b from-transparent to-white/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] rotate-90 origin-center mt-2">scroll</span>
        </div>
      </section>

      {/* ── Stats strip — floats above next section ───────────────── */}
      <section className="relative z-20 -mt-20 mb-16 px-4 md:px-8 max-w-6xl mx-auto w-full">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
          <AnimatedCounter end={5800} label={t("Total Booking", "Total Bookings")} />
          <AnimatedCounter end={7} label={t("Lapangan Aktif", "Active Courts")} suffix="+" />
          <AnimatedCounter end={1200} label={t("Member Aktif", "Active Members")} suffix="+" />
          <AnimatedCounter end={49} suffix="/5" label={t("Kepuasan Pelanggan", "Customer Satisfaction")} highlight />
        </div>
      </section>

      <style>{`
        @keyframes heroZoom {
          from { transform: scale(1.08); }
          to   { transform: scale(1); }
        }
      `}</style>

      {/* ── Facilities Highlight ──────────────────────────────────── */}
      <section className="py-20 md:py-28 bg-white dark:bg-slate-950">
        <div className="container px-4 md:px-8">
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
            <div className="max-w-2xl">
              <h2 className="text-3xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4">
                {t("Fasilitas", "The Best")} <span className="text-primary">{t("Terbaik", "Facilities")}</span> {t("Untuk Anda", "For You")}
              </h2>
              <p className="text-lg text-muted-foreground font-medium">
                {t(
                  "Pilih dari beragam lapangan olahraga standar profesional yang dirawat dengan sempurna setiap harinya.",
                  "Choose from a variety of professional-standard sports courts that are perfectly maintained every day."
                )}
              </p>
            </div>
            <Button size="lg" variant="outline" asChild className="rounded-full hidden md:flex items-center gap-2 border-border font-bold">
              <Link href="/facilities">{t("Lihat Semua Kategori", "View All Categories")} <ArrowRight className="w-4 h-4" /></Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {highlightFacilities.map((facility) => (
              <Card key={facility.id} className="group border-none shadow-lg hover:shadow-xl transition-all duration-500 rounded-3xl overflow-hidden bg-white dark:bg-slate-900 h-full flex flex-col translate-y-0 hover:-translate-y-2">
                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                  <img
                    src={getFacilityImage(facility.category, facility.images)}
                    alt={facility.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-in-out"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60" />
                  <div className="absolute top-4 left-4">
                    <Badge className="bg-primary text-white font-bold uppercase tracking-wider shadow-md border-0">{t("Populer", "Popular")}</Badge>
                  </div>
                  <div className="absolute bottom-4 left-4 right-4">
                    <div className="bg-white/20 backdrop-blur-md text-white border border-white/20 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider inline-block">
                      {facility.category}
                    </div>
                  </div>
                </div>
                <CardContent className="p-6 md:p-8 flex-1 flex flex-col">
                  <h3 className="text-2xl font-black text-secondary dark:text-white mb-2 line-clamp-1 group-hover:text-primary transition-colors">{facility.name}</h3>
                  <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-4">
                    <Users className="w-4 h-4" />
                    <span>{t("Kapasitas", "Capacity")} {facility.capacity || 10} {t("Orang", "People")}</span>
                  </div>
                  <div className="mt-auto pt-6 border-t border-border flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t("Mulai Dari", "Starting From")}</div>
                      <div className="text-xl font-black text-primary">Rp {facility.pricePerHour.toLocaleString("id-ID")}</div>
                    </div>
                    <Button className="rounded-full shadow-md shadow-primary/20 font-bold" asChild>
                      <Link href={`/facilities/${facility.id}`}>{t("Booking", "Book")}</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button size="lg" asChild className="w-full mt-8 rounded-xl h-14 font-bold md:hidden text-base">
            <Link href="/facilities">{t("Jelajahi Semua Fasilitas", "Explore All Facilities")}</Link>
          </Button>
        </div>
      </section>

      {/* ── Venue / About ─────────────────────────────────────────── */}
      <section className="py-20 md:py-28 bg-[#F8FAFC] dark:bg-slate-950 overflow-hidden">
        <div className="container px-4 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="relative animate-in fade-in slide-in-from-left-8 duration-1000">
              <div className="absolute -inset-3 bg-gradient-to-tr from-primary/20 via-primary/5 to-transparent rounded-[2rem] transform -rotate-2" />
              <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border-4 border-white dark:border-slate-900 aspect-[16/10]">
                <img src={buildingImg} alt="Gedung Sport Center" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
              </div>
              <div className="absolute -bottom-6 -right-2 md:right-6 p-4 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-border/50 flex items-center gap-3 max-w-[260px]">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Plane className="w-6 h-6" />
                </div>
                <div>
                  <div className="font-black text-secondary dark:text-white leading-tight">{t("Dekat Bandara", "Near The Airport")}</div>
                  <div className="text-xs font-semibold text-muted-foreground">{t("Menit dari Soekarno-Hatta", "Minutes from Soekarno-Hatta")}</div>
                </div>
              </div>
            </div>

            <div className="max-w-xl animate-in fade-in slide-in-from-right-8 duration-1000 delay-150">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-bold text-sm mb-6 border border-primary/20">
                <Building className="w-4 h-4" />
                {t("Tentang Gedung Kami", "About Our Venue")}
              </div>
              <h2 className="text-3xl md:text-5xl font-black tracking-tight text-secondary dark:text-white leading-[1.1] mb-6">
                {t("Gedung Olahraga Modern di Jantung", "A Modern Sports Venue in the Heart of")}{" "}
                <span className="text-primary">{t("Kawasan Bandara", "the Airport Area")}</span>
              </h2>
              <p className="text-lg text-muted-foreground font-medium leading-relaxed mb-8">
                {t(
                  "Sport Center Bandara Soekarno-Hatta hadir sebagai pusat kebugaran terpadu dengan bangunan kokoh dan arsitektur modern. Lokasinya yang strategis menjadikannya pilihan utama bagi warga sekitar maupun para pelancong yang transit.",
                  "Sport Center Soekarno-Hatta is an integrated fitness hub with a solid structure and modern architecture. Its strategic location makes it the top choice for locals and transit travelers alike."
                )}
              </p>
              <div className="space-y-4 mb-10">
                {[
                  t("Bangunan luas dengan area parkir yang memadai", "Spacious building with ample parking area"),
                  t("Akses mudah dari Terminal Bandara Soekarno-Hatta", "Easy access from Soekarno-Hatta Airport Terminals"),
                  t("Fasilitas lengkap berstandar profesional", "Complete facilities with professional standards"),
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center text-green-600 shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <span className="font-semibold text-secondary dark:text-white">{item}</span>
                  </div>
                ))}
              </div>
              <Button size="lg" className="h-14 px-8 text-base font-bold shadow-xl shadow-primary/25 rounded-full group" asChild>
                <Link href="/contact">
                  {t("Lihat Lokasi", "View Location")} <MapPin className="ml-2 w-5 h-5 group-hover:scale-110 transition-transform" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Why Choose Us ─────────────────────────────────────────── */}
      <section className="py-20 md:py-28 bg-white dark:bg-slate-950">
        <div className="container px-4 md:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4">
              {t("Mengapa Memilih Kami?", "Why Choose Us?")}
            </h2>
            <p className="text-lg text-muted-foreground font-medium">
              {t("Kami berkomitmen memberikan pengalaman olahraga terbaik dari awal pemesanan hingga sesi Anda berakhir.", "We are committed to providing the best sports experience from start to finish.")}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {[
              { Icon: Trophy, title: t("Fasilitas Premium", "Premium Facilities"), desc: t("Standar lapangan dan peralatan profesional yang dirawat ketat setiap hari.", "Professional-standard courts maintained strictly every day."), href: "/facilities" },
              { Icon: Zap, title: t("Booking Online Mudah", "Easy Online Booking"), desc: t("Cek jadwal real-time dan pesan lapangan langsung dari smartphone Anda.", "Check real-time schedules and book courts from your smartphone."), href: "/facilities" },
              { Icon: CreditCard, title: t("Harga Transparan", "Transparent Pricing"), desc: t("Tidak ada biaya tersembunyi. Bayar sesuai harga yang tertera di sistem.", "No hidden fees. Pay exactly the price shown in the system."), href: "/facilities" },
              { Icon: MapPin, title: t("Lokasi Strategis", "Strategic Location"), desc: t("Sangat mudah diakses, berdekatan dengan area Bandara Soekarno-Hatta.", "Very accessible, adjacent to the Soekarno-Hatta Airport area."), href: "/contact" },
              { Icon: Phone, title: t("Customer Support 24/7", "24/7 Customer Support"), desc: t("Tim kami siap membantu Anda kapan saja melalui WhatsApp.", "Our team is ready to help you anytime via WhatsApp."), href: "/contact" },
              { Icon: ShieldCheck, title: t("Pembayaran Aman", "Secure Payment"), desc: t("Transaksi terjamin dengan berbagai metode pembayaran digital yang aman.", "Secure transactions with various digital payment methods."), href: "/terms" },
            ].map((feature, i) => (
              <Link key={i} href={feature.href} className="block group bg-white dark:bg-slate-900 p-8 rounded-3xl border border-border/50 shadow-sm hover:shadow-md hover:-translate-y-1 hover:border-primary/30 transition-all duration-300 cursor-pointer">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-white transition-colors duration-300">
                  <feature.Icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-secondary dark:text-white mb-3 group-hover:text-primary transition-colors duration-300">{feature.title}</h3>
                <p className="text-muted-foreground font-medium leading-relaxed">{feature.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Promos ────────────────────────────────────────────────── */}
      {promos && promos.length > 0 && (
        <section className="py-20 md:py-28 bg-[#F8FAFC] dark:bg-slate-950 overflow-hidden">
          <div className="container px-4 md:px-8">
            <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
              <div className="max-w-2xl">
                <h2 className="text-3xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4">
                  {t("Promo &", "Promos &")} <span className="text-primary">{t("Event", "Events")}</span>
                </h2>
                <p className="text-lg text-muted-foreground font-medium">{t("Jangan lewatkan kesempatan hemat dan acara seru dari kami bulan ini.", "Don't miss savings and exciting events from us this month.")}</p>
              </div>
              <Button size="lg" variant="ghost" asChild className="font-bold text-primary hover:text-primary hover:bg-primary/10 rounded-full hidden md:flex items-center gap-2">
                <Link href="/promos">{t("Lihat Semua Promo", "View All Promos")} <ArrowRight className="w-4 h-4" /></Link>
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {promos.slice(0, 2).map((promo) => (
                <div key={promo.id} className="group relative bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-border/50 flex flex-col sm:flex-row shadow-sm hover:shadow-xl transition-all duration-500">
                  <div className="w-full sm:w-2/5 aspect-square sm:aspect-auto relative overflow-hidden bg-muted shrink-0">
                    <img src={promo.imageUrl || "/hero.png"} alt={promo.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                    {promo.discountPercent && (
                      <div className="absolute top-4 left-4 bg-red-500 text-white px-3 py-1.5 rounded-xl text-sm font-black shadow-lg transform -rotate-2">
                        {t("DISKON", "DISCOUNT")} {promo.discountPercent}%
                      </div>
                    )}
                  </div>
                  <div className="w-full sm:w-3/5 p-6 md:p-8 flex flex-col justify-center">
                    <div className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4 w-fit bg-primary/10 text-primary">
                      {promo.type === "promo" ? t("Penawaran Spesial", "Special Offer") : t("Acara Spesial", "Special Event")}
                    </div>
                    <h3 className="font-black text-2xl text-secondary dark:text-white mb-3 line-clamp-2">{promo.title}</h3>
                    <p className="text-muted-foreground font-medium text-sm mb-6 line-clamp-3 leading-relaxed">{promo.description}</p>
                    <div className="mt-auto">
                      <Button asChild className="rounded-full font-bold shadow-md shadow-primary/20 w-full sm:w-auto">
                        <Link href="/promos">{t("Ambil Promo", "Get Promo")}</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Testimonial Slider ────────────────────────────────────── */}
      <section className="py-20 md:py-28 bg-secondary dark:bg-slate-950 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="container relative z-10 px-4 md:px-8">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 text-primary font-bold text-sm mb-6 border border-primary/20">
              <Star className="w-4 h-4 fill-primary" />
              {t("4.9/5 dari 1.000+ ulasan", "4.9/5 from 1,000+ reviews")}
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              {t("Apa Kata", "What")} <span className="text-primary">{t("Atlet Kami", "Our Athletes Say")}</span>
            </h2>
            <p className="text-lg text-white/60 font-medium max-w-2xl mx-auto">
              {t(
                "Testimoni nyata dari pelanggan yang telah membuktikan kualitas fasilitas dan pelayanan kami.",
                "Real testimonials from customers who have proven the quality of our facilities and service."
              )}
            </p>
          </div>

          <TestimonialSlider />
        </div>
      </section>

      {/* ── Membership CTA ────────────────────────────────────────── */}
      <section className="py-20 md:py-28 bg-[#F8FAFC] dark:bg-slate-950 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

        <div className="container relative z-10 px-4 md:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-bold text-sm mb-6 border border-primary/20">
              <Crown className="w-4 h-4" />
              {t("Program Membership Eksklusif", "Exclusive Membership Program")}
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight text-secondary dark:text-white mb-4">
              {t("Akses Tak Terbatas.", "Unlimited Access.")} <span className="text-primary">{t("Harga Terjangkau.", "Affordable Price.")}</span>
            </h2>
            <p className="text-lg text-muted-foreground font-medium">
              {t(
                "Bergabunglah sebagai member dan nikmati harga spesial, prioritas booking, dan akses fasilitas lengkap setiap bulannya.",
                "Join as a member and enjoy special pricing, booking priority, and full facility access every month."
              )}
            </p>
          </div>

          {/* Membership Tiers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 max-w-5xl mx-auto mb-16">
            {[
              {
                icon: <Dumbbell className="w-7 h-7" />,
                tier: t("Gym Pass", "Gym Pass"),
                desc: t("Akses gym harian tanpa batas reservasi", "Daily gym access without reservation"),
                price: "Rp 250.000",
                period: t("/bulan", "/month"),
                color: "border-border",
                perks: [
                  t("Akses Gym / Fitness setiap hari", "Gym / Fitness access every day"),
                  t("Loker pribadi gratis", "Free personal locker"),
                  t("Air minum gratis", "Free drinking water"),
                  t("Shower room inklusif", "Inclusive shower room"),
                ],
                cta: t("Daftar Gym Pass", "Get Gym Pass"),
                featured: false,
              },
              {
                icon: <Flame className="w-7 h-7" />,
                tier: t("All Access", "All Access"),
                desc: t("Akses penuh semua fasilitas + diskon booking", "Full access to all facilities + booking discount"),
                price: "Rp 500.000",
                period: t("/bulan", "/month"),
                color: "border-primary",
                perks: [
                  t("Semua benefit Gym Pass", "All Gym Pass benefits"),
                  t("Diskon 15% semua lapangan", "15% discount all courts"),
                  t("Prioritas booking jam peak", "Priority booking at peak hours"),
                  t("1x booking lapangan gratis/bulan", "1x free court booking/month"),
                  t("Akses kelas fitness eksklusif", "Exclusive fitness class access"),
                ],
                cta: t("Daftar All Access", "Get All Access"),
                featured: true,
              },
              {
                icon: <Crown className="w-7 h-7" />,
                tier: t("Corporate", "Corporate"),
                desc: t("Paket korporat untuk tim Anda (min. 5 orang)", "Corporate package for your team (min. 5 people)"),
                price: "Rp 350.000",
                period: t("/orang/bulan", "/person/month"),
                color: "border-border",
                perks: [
                  t("Semua benefit All Access", "All Access benefits"),
                  t("Invoice korporat bulanan", "Monthly corporate invoice"),
                  t("Dedicated customer support", "Dedicated customer support"),
                  t("Laporan aktivitas tim", "Team activity reports"),
                ],
                cta: t("Hubungi Kami", "Contact Us"),
                featured: false,
              },
            ].map((plan, i) => (
              <div
                key={i}
                className={`relative rounded-3xl bg-white dark:bg-slate-900 border-2 ${plan.color} p-8 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${
                  plan.featured ? "shadow-2xl shadow-primary/20 scale-[1.02] md:scale-105" : "shadow-sm"
                }`}
              >
                {plan.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <div className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-white rounded-full text-xs font-black shadow-lg shadow-primary/40">
                      <Sparkles className="w-3.5 h-3.5" /> {t("PALING POPULER", "MOST POPULAR")}
                    </div>
                  </div>
                )}

                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${plan.featured ? "bg-primary text-white shadow-lg shadow-primary/30" : "bg-primary/10 text-primary"}`}>
                  {plan.icon}
                </div>

                <div className="mb-1 text-xs font-black uppercase tracking-widest text-muted-foreground">{plan.tier}</div>
                <div className="text-2xl font-black text-secondary dark:text-white mb-1">{plan.price}<span className="text-sm font-semibold text-muted-foreground">{plan.period}</span></div>
                <p className="text-sm text-muted-foreground font-medium mb-6 pb-6 border-b border-border">{plan.desc}</p>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.perks.map((perk, j) => (
                    <li key={j} className="flex items-start gap-2.5 text-sm font-medium text-secondary dark:text-white">
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      {perk}
                    </li>
                  ))}
                </ul>

                <Button
                  size="lg"
                  className={`w-full rounded-full font-bold h-12 ${plan.featured ? "shadow-lg shadow-primary/30" : ""}`}
                  variant={plan.featured ? "default" : "outline"}
                  asChild
                >
                  <Link href="/facilities">{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </div>

          {/* Trust row */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 md:gap-12 text-center">
            {[
              { Icon: CalendarCheck, text: t("Batalkan kapan saja", "Cancel anytime") },
              { Icon: ShieldCheck, text: t("Garansi uang kembali 7 hari", "7-day money back guarantee") },
              { Icon: TrendingUp, text: t("Sudah 1.200+ member aktif", "Already 1,200+ active members") },
            ].map(({ Icon, text }, i) => (
              <div key={i} className="flex items-center gap-2.5 text-muted-foreground font-semibold text-sm">
                <Icon className="w-5 h-5 text-primary shrink-0" />
                {text}
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
