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
  imageUrl?: string | null;
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

    Promise.all([
      fetch("/api/wa/facilities", { signal: controller.signal, cache: "no-store" }).then(async response => {
        if (!response.ok) throw new Error("Daftar fasilitas sedang tidak tersedia.");
        return response.json();
      }),
      fetch("/api/facilities", { signal: controller.signal, cache: "no-store" })
        .then(async response => response.ok ? response.json() : [])
        .catch(() => []),
    ])
      .then(([bookingPayload, facilityPayload]: [unknown, unknown]) => {
        const items: unknown[] = Array.isArray(bookingPayload)
          ? bookingPayload
          : bookingPayload && typeof bookingPayload === "object" && "facilities" in bookingPayload && Array.isArray((bookingPayload as { facilities?: unknown[] }).facilities)
            ? (bookingPayload as { facilities: unknown[] }).facilities : [];

        const imageById = new Map<number, string>();
        if (Array.isArray(facilityPayload)) {
          for (const raw of facilityPayload) {
            if (!raw || typeof raw !== "object") continue;
            const value = raw as { id?: unknown; images?: unknown };
            if (typeof value.id !== "number" || !Array.isArray(value.images)) continue;
            const images = value.images.filter((image): image is { url: string; isPrimary?: boolean } =>
              !!image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string"
            );
            const primary = images.find(image => image.isPrimary) ?? images[0];
            if (primary?.url) imageById.set(value.id, primary.url);
          }
        }

        const available = items.filter((item): item is Facility => {
          if (!item || typeof item !== "object") return false;
          const value = item as Partial<Facility>;
          return typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0 &&
            typeof value.name === "string" && typeof value.category === "string" &&
            Number.isFinite(Number(value.pricePerHour)) && Number(value.pricePerHour) > 0 &&
            typeof value.openTime === "string" && typeof value.closeTime === "string";
        }).map(facility => ({ ...facility, imageUrl: imageById.get(facility.id) ?? null }));

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
      <section className="relative overflow-hidden border-b border-emerald-900/5 bg-[linear-gradient(135deg,#fffaf3_0%,#ffffff_48%,#eef8f3_100%)]">
        <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-emerald-100/60 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full bg-orange-100/70 blur-3xl" />
        <div className="mx-auto max-w-[1280px] px-5 pb-12 pt-5 sm:px-8 lg:px-10 lg:pb-16">
          <nav aria-label="Navigasi halaman" className="mb-8 flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-white/75 px-5 py-3 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0b3f33] text-white">
                <Dumbbell className="h-5 w-5" />
              </div>
              <div>
                <p className="text-base font-black tracking-tight text-[#0b3f33]">SPORT CENTER</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Bandara Soekarno-Hatta</p>
              </div>
            </div>
            <div className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
              <a href="#pilih-fasilitas" className="hover:text-[#0f5b46]">Fasilitas</a>
              <a href="#cara-booking" className="hover:text-[#0f5b46]">Cara Booking</a>
              <Link href="/facilities" className="hover:text-[#0f5b46]">Informasi</Link>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
              <Clock3 className="h-4 w-4 text-orange-600" /> 06:00 – 23:00 WIB
            </span>
          </nav>

          <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-12">
            <div className="relative z-10 max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-4 py-2 text-xs font-extrabold uppercase tracking-[0.12em] text-orange-700 shadow-sm">
                <CalendarDays className="h-4 w-4" /> Booking online tanpa login
              </div>
              <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-[#0b3f33] sm:text-5xl lg:text-[4rem]">
                Pilih Olahragamu.<br />
                <span className="text-orange-600">Booking Lebih Mudah.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
                Booking fasilitas Sport Center Bandara Soekarno-Hatta dengan praktis.
                Pilih jadwal, lakukan pembayaran, dan dapatkan akses setelah pembayaran diverifikasi.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#pilih-fasilitas" className="inline-flex min-h-12 items-center gap-3 rounded-full bg-gradient-to-r from-[#0b3f33] to-[#0f6b50] px-6 py-3 text-sm font-extrabold text-white shadow-[0_12px_28px_rgba(15,91,70,0.22)] transition hover:-translate-y-0.5">
                  Pilih Fasilitas & Booking <ArrowRight className="h-5 w-5" />
                </a>
                <Link href="/facilities" className="inline-flex min-h-12 items-center rounded-full border border-[#0f5b46]/30 bg-white px-6 py-3 text-sm font-extrabold text-[#0b3f33] shadow-sm transition hover:bg-emerald-50">
                  Lihat Semua Fasilitas
                </Link>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold text-slate-600">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-orange-600" /> Tanpa Login</span>
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-orange-600" /> Booking Online</span>
                <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4 text-orange-600" /> QRIS & Transfer</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-orange-600" /> Aman & Terverifikasi</span>
              </div>
            </div>

            <div className="relative min-w-0">
              <div className="pointer-events-none absolute -bottom-7 -right-7 h-[90%] w-[92%] rounded-[2.5rem] bg-gradient-to-br from-emerald-100 to-orange-100 blur-[1px]" />
              <div className="relative overflow-hidden rounded-[2.5rem] border-[6px] border-white bg-slate-100 shadow-[0_28px_70px_rgba(15,23,42,0.18)]">
                <img
                  src={buildingImg}
                  alt="Gedung Sport Center Bandara Soekarno-Hatta"
                  className="aspect-[16/10] h-full w-full object-cover object-center brightness-[1.06] contrast-[1.04] saturate-[1.05]"
                  decoding="async"
                  fetchPriority="high"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0b3f33]/60 to-transparent" />
                <div className="absolute bottom-5 left-5 rounded-full border border-white/30 bg-white/20 px-4 py-2 text-sm font-bold text-white backdrop-blur-md">
                  Kawasan Bandara Soekarno-Hatta
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pilih-fasilitas" aria-label="Pilihan fasilitas Sport Center" className="scroll-mt-6 mx-auto max-w-[1280px] px-5 pb-12 pt-14 sm:px-8 lg:px-10">
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span className="h-1 w-8 rounded-full bg-[#0f5b46]" />
              <span className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#0f5b46]">Pilih fasilitas</span>
            </div>
            <h2 className="text-3xl font-black tracking-tight text-[#13213b] sm:text-4xl">Pilih Layanan Olahraga</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Pilih fasilitas yang sesuai kebutuhanmu. Harga dan jam layanan mengikuti data fasilitas yang aktif.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm">
            <MapPin className="h-4 w-4 text-orange-600" /> Kawasan Bandara Soekarno-Hatta
          </span>
        </div>

        {loading && <p role="status" className="rounded-3xl bg-white p-10 text-center text-slate-600 shadow-sm">Memuat pilihan layanan...</p>}
        {error && <p role="alert" className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700">{error}</p>}
        {!loading && !error && facilities.length === 0 && (
          <p role="status" className="rounded-3xl bg-white p-10 text-center text-slate-600 shadow-sm">Belum ada fasilitas berbayar yang tersedia untuk booking mandiri.</p>
        )}

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {facilities.map(facility => {
            const gym = isGym(facility);
            const url = getPublicBookingLink(facility);
            return (
              <article key={facility.id} className="group overflow-hidden rounded-[1.5rem] border border-slate-200/90 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.05)] transition duration-300 hover:-translate-y-1.5 hover:border-emerald-200 hover:shadow-[0_24px_55px_rgba(15,91,70,0.12)]">
                <div className="grid h-full grid-cols-[132px_minmax(0,1fr)]">
                  <div className="relative min-h-[220px] overflow-hidden bg-slate-100">
                    {facility.imageUrl ? (
                      <img src={facility.imageUrl} alt={facility.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" decoding="async" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-orange-600"><FacilityIcon facility={facility} /></div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col p-5">
                    <span className="mb-2 w-fit rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-orange-700">
                      {facility.category}
                    </span>
                    <h3 className="text-lg font-black leading-tight tracking-tight text-[#13213b]">{facility.name}</h3>
                    <div className="mt-auto pt-5">
                      <p className="text-2xl font-black tracking-tight text-orange-600">
                        Rp {Number(facility.pricePerHour).toLocaleString("id-ID")}
                        <span className="ml-1 text-xs font-medium text-slate-500">{gym ? "/kunjungan" : "/jam"}</span>
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-600">
                        <Clock3 className="h-4 w-4 text-[#0f5b46]" /> {facility.openTime}–{facility.closeTime} WIB
                      </p>
                      <Link href={url} className="mt-4 flex min-h-11 items-center justify-between rounded-xl bg-gradient-to-r from-[#0b3f33] to-[#0f5b46] px-4 py-2.5 text-sm font-extrabold text-white shadow-[0_8px_18px_rgba(15,91,70,0.16)] transition hover:from-[#0a382d] hover:to-[#0d503f]">
                        Pilih & Booking <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="cara-booking" className="mx-auto max-w-[1280px] px-5 pb-10 sm:px-8 lg:px-10">
        <div className="grid gap-4 rounded-[2rem] border border-emerald-100 bg-gradient-to-r from-[#f3f8f2] via-white to-[#f8f2e9] p-5 shadow-[0_12px_35px_rgba(15,23,42,0.05)] md:grid-cols-[260px_1fr] md:p-7">
          <div className="flex items-center gap-4 border-b border-emerald-100 pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#0f5b46] shadow-sm">
              <CalendarDays className="h-7 w-7" />
            </div>
            <div>
              <p className="text-2xl font-black leading-tight text-[#13213b]">Cara Booking</p>
              <p className="text-2xl font-black leading-tight text-orange-600">Sangat Mudah</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["1. Pilih Fasilitas", "Tentukan fasilitas olahraga yang ingin digunakan."],
              ["2. Isi Data & Bayar", "Lengkapi data, pilih jadwal, dan lakukan pembayaran."],
              ["3. Datang & Akses", "Setelah pembayaran diverifikasi, akses fasilitas akan diberikan."],
            ].map(([title, text], index) => (
              <div key={title} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 font-black text-white">{index + 1}</div>
                <p className="font-black text-[#13213b]">{title}</p>
                <p className="mt-1 text-sm leading-5 text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-5 pb-16 sm:px-8 lg:px-10">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-[#073b2f] via-[#0b5b45] to-[#0e7a58] px-6 py-8 text-white shadow-[0_24px_60px_rgba(7,59,47,0.22)] sm:px-10">
          <div className="pointer-events-none absolute -left-16 -bottom-20 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-3xl font-black">Siap Berolahraga?</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50 sm:text-base">Booking sekarang dan nikmati fasilitas Sport Center Bandara Soekarno-Hatta.</p>
            </div>
            <a href="#pilih-fasilitas" className="inline-flex min-h-12 items-center gap-3 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-3 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5">
              Pilih Fasilitas & Booking <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
