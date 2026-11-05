import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CalendarDays, Clock3, Dumbbell, Wallet } from "lucide-react";

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
          return Number.isSafeInteger(value.id) && Number(value.id) > 0 &&
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
    <main className="min-h-screen bg-orange-50 px-4 py-8 text-slate-900 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-2xl bg-gradient-to-br from-orange-600 to-amber-500 px-6 py-8 text-white shadow-lg sm:px-9">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
            <CalendarDays className="h-4 w-4" /> Booking Sport Center
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Booking & Bayar Mandiri</h1>
          <p className="mt-3 max-w-2xl text-sm text-orange-50 sm:text-base">
            Pilih layanan, isi data pengunjung, lalu bayar melalui QRIS atau transfer bank.
            Tidak perlu membuat akun atau login.
          </p>
        </div>

        <section aria-label="Pilihan fasilitas Sport Center" className="mt-7">
          <div className="mb-4">
            <h2 className="text-xl font-bold">Pilih layanan</h2>
            <p className="mt-1 text-sm text-slate-600">Harga dan jam pelayanan mengikuti konfigurasi fasilitas yang aktif.</p>
          </div>

          {loading && <p role="status" className="rounded-xl bg-white p-6 text-center text-slate-600">Memuat pilihan layanan...</p>}
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</p>}
          {!loading && !error && facilities.length === 0 && (
            <p role="status" className="rounded-xl bg-white p-6 text-center text-slate-600">Belum ada fasilitas berbayar yang tersedia untuk booking mandiri.</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {facilities.map(facility => {
              const gym = isGym(facility);
              const url = getPublicBookingLink(facility);
              return (
                <article key={facility.id} className="flex flex-col rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="rounded-xl bg-orange-100 p-2.5 text-orange-700">
                        {gym ? <Dumbbell className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
                      </div>
                      <div>
                        <h3 className="font-bold">{facility.name}</h3>
                        <p className="text-xs text-slate-500">{facility.category}</p>
                      </div>
                    </div>
                    {gym && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">Harian</span>}
                  </div>
                  <div className="mt-auto">
                    <p className="text-lg font-extrabold text-orange-700">
                      Rp {Number(facility.pricePerHour).toLocaleString("id-ID")}
                      <span className="text-xs font-normal text-slate-600">{gym ? "/kunjungan" : "/jam"}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock3 className="h-3.5 w-3.5" /> {facility.openTime}–{facility.closeTime} WIB
                    </p>
                    <Link href={url} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700">
                      Booking layanan ini <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="mt-7 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <div className="flex items-start gap-2">
            <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-orange-700" />
            <p>
              Pembayaran menggunakan metode yang tersedia pada formulir fasilitas.
              Untuk Gym, akses PIN/kartu X904 hanya diproses setelah pembayaran dan identitas diverifikasi oleh petugas.
              Booking layanan lain tidak memerlukan PIN X904.
            </p>
          </div>
        </div>
        <p className="mt-5 text-center text-sm">
          <Link href="/facilities" className="font-semibold text-orange-700 underline">Lihat informasi fasilitas</Link>
        </p>
      </div>
    </main>
  );
}
