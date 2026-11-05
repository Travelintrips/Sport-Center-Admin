import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, CalendarDays, Clock3, Dumbbell, Wallet,
  ShieldCheck, CreditCard, MapPin, ChevronRight,
  Sparkles, Trophy, Target, CircleDot,
} from "lucide-react";
import buildingImg from "@assets/1780087062_1780089778393.png";

type Facility = {
  id: number;
  name: string;
  category: string;
  bookingMode: string;
  pricePerHour: number;
  openTime: string;
  closeTime: string;
};

function isGym(facility: Facility): boolean {
  return /\bgym\b|fitness/i.test(facility.name + " " + facility.category);
}

export function getPublicBookingLink(facility: Facility): string {
  const path = "/wa/booking/" + encodeURIComponent(String(facility.id));
  return isGym(facility) ? path + "?nonmember=1&self=1" : path;
}

function FacilityIcon({ facility }: { facility: Facility }) {
  const label = facility.name + " " + facility.category;
  if (isGym(facility)) return <Dumbbell className="h-6 w-6" />;
  if (/badminton/i.test(label)) return <Target className="h-6 w-6" />;
  if (/tennis/i.test(label)) return <CircleDot className="h-6 w-6" />;
  if (/billiard/i.test(label)) return <CircleDot className="h-6 w-6" />;
  if (/multiguna|basket|futsal/i.test(label)) return <Trophy className="h-6 w-6" />;
  return <CalendarDays className="h-6 w-6" />;
}

export default function GymNonmemberEntry() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wa/facilities", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Daftar fasilitas sedang tidak tersedia.");
        return response.json();
      })
      .then((payload: unknown) => {
        const items: unknown[] = Array.isArray(payload)
          ? payload
          : payload && typeof payload === "object" && "facilities" in payload && Array.isArray(payload.facilities)
            ? payload.facilities : [];
        const available = items.filter((item): item is Facility => {
          if (!item || typeof item !== "object") return false;
          const value = item as Partial<Facility>;
          return typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0 &&
            typeof value.name === "string" && typeof value.category === "string" &&
            Number.isFinite(Number(value.pricePerHour)) && Number(value.pricePerHour) > 0 &&
            typeof value.openTime === "string" && typeof value.closeTime === "string";
        });
        if (!controller.signal.aborted) setFacilities(available.sort((a, b) => {
          if (isGym(a) !== isGym(b)) return isGym(a) ? -1 : 1;
          return a.name.localeCompare(b.name, "id");
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Gagal memuat fasilitas. Silakan coba buka halaman kembali.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-slate-900">
      <section className="relative isolate overflow-hidden bg-[#0b1730] text-white">
        {/* Reuse the actual Sport Center building photo already used on Home. */}
        <img
          src={buildingImg}
          alt="Gedung Sport Center Bandara Soekarno-Hatta"
          className="absolute inset-0 -z-20 h-full w-full object-cover object-center"
          decoding="async"
          fetchPriority="high"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#09162b]/95 via-[#09162b]/85 to-[#09162b]/30" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#09162b]/70 via-transparent to-transparent" />
        <div className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 sm:pb-20 sm:pt-10 lg:pb-24">
          <nav aria-label="Navigasi halaman" className="mb-16 flex items-center justify-between gap-4 sm:mb-20">
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-white/90 transition-colors hover:text-white">
              <ChevronRight className="h-4 w-4 rotate-180" /> Kembali ke Beranda
            </Link>
            <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium tracking-wide backdrop-blur-sm">
              SPORT CENTER BANDARA SOEKARNO-HATTA
            </span>
          </nav>

          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-300/30 bg-orange-500/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-orange-200 backdrop-blur">
              <Sparkles className="h-4 w-4" /> Booking online tanpa login
            </div>
            <h1 className="text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.6rem]">
              Pilih Olahragamu.<br />
              <span className="text-orange-400">Booking Lebih Mudah.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-200 sm:text-lg">
              Temukan fasilitas olahraga pilihanmu di Sport Center Bandara Soekarno-Hatta.
              Pilih jadwal, lakukan pemesanan, dan unggah bukti pembayaran—tanpa perlu membuat akun.
            </p>
            <a href="#pilih-fasilitas" className="mt-8 inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-orange-500 px-6 py-3 font-bold text-white shadow-lg shadow-orange-950/20 transition hover:bg-orange-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
              Lihat Pilihan Fasilitas <ArrowRight className="h-5 w-5" />
            </a>
          </div>
          <div className="mt-12 flex flex-wrap gap-x-7 gap-y-3 text-sm font-medium text-white/90">
            <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-orange-300" /> Tidak perlu akun</span>
            <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-orange-300" /> Booking langsung online</span>
            <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4 text-orange-300" /> QRIS & transfer bank</span>
          </div>
        </div>
      </section>

      <section id="pilih-fasilitas" aria-label="Pilihan fasilitas Sport Center" className="scroll-mt-6 mx-auto max-w-7xl px-5 pb-16 pt-14 sm:px-8 sm:pt-16">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-[0.2em] text-orange-600">Jelajahi fasilitas</span>
            <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Pilih layanan olahraga</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
              Pilih fasilitas yang sesuai kebutuhanmu. Harga dan jam layanan mengikuti data fasilitas yang aktif.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600">
            <MapPin className="h-4 w-4 text-orange-600" /> Kawasan Bandara Soekarno-Hatta
          </span>
        </div>

        {loading && <p role="status" className="rounded-2xl bg-white p-8 text-center text-slate-600">Memuat pilihan layanan...</p>}
        {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">{error}</p>}
        {!loading && !error && facilities.length === 0 && (
          <p role="status" className="rounded-2xl bg-white p-8 text-center text-slate-600">Belum ada fasilitas berbayar yang tersedia untuk booking mandiri.</p>
        )}

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {facilities.map(facility => {
            const gym = isGym(facility);
            const url = getPublicBookingLink(facility);
            return (
              <article key={facility.id} className="group flex flex-col overflow-hidden rounded-[1.4rem] border border-slate-200/90 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.035)] transition-all duration-200 hover:-translate-y-1 hover:border-orange-200 hover:shadow-[0_20px_50px_rgba(15,23,42,0.10)]">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-600 group-hover:bg-orange-100">
                    <FacilityIcon facility={facility} />
                  </div>
                  {gym && <span className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700">Tiket harian</span>}
                </div>
                <div className="mb-5">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{facility.category}</p>
                  <h3 className="min-h-12 text-xl font-bold leading-tight tracking-tight text-[#13213b]">{facility.name}</h3>
                </div>
                <div className="mt-auto">
                  <div className="border-t border-slate-100 pt-5">
                    <p className="text-xs font-medium text-slate-500">Mulai dari</p>
                    <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                      Rp {Number(facility.pricePerHour).toLocaleString("id-ID")}
                      <span className="ml-1 text-xs font-normal text-slate-500">{gym ? "/kunjungan" : "/jam"}</span>
                    </p>
                    <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                      <Clock3 className="h-4 w-4 text-orange-600" /> {facility.openTime}–{facility.closeTime} WIB
                    </p>
                  </div>
                  <Link href={url} className="mt-6 flex min-h-12 items-center justify-between gap-2 rounded-xl bg-[#142441] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
                    Pilih & Booking <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-10 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-[auto_1fr] sm:gap-5 sm:p-7">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Cara pembayaran dan akses fasilitas</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Pilih QRIS atau transfer bank yang tersedia pada formulir, lalu unggah bukti pembayaran.
              Pembayaran harus diverifikasi sebelum dianggap lunas.
              Khusus Gym, akses PIN/kartu X904 hanya diproses setelah pembayaran dan identitas diverifikasi petugas.
              Layanan olahraga lainnya tidak memerlukan PIN X904.
            </p>
          </div>
        </div>
        <p className="mt-8 text-center text-sm">
          <Link href="/facilities" className="font-semibold text-orange-700 underline underline-offset-4 hover:text-orange-800">Lihat informasi semua fasilitas</Link>
        </p>
      </section>
    </main>
  );
}
