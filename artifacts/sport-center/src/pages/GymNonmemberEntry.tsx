import { useEffect, useState } from "react";
import { Link } from "wouter";

type Facility = { id: number; name: string; category: string; bookingMode: string };

export default function GymNonmemberEntry() {
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/wa/facilities")
      .then(async response => {
        if (!response.ok) throw new Error("Daftar fasilitas tidak tersedia.");
        return response.json();
      })
      .then((payload: unknown) => {
        if (!active) return;
        const facilities: Facility[] = Array.isArray(payload) ? payload : 
          (payload && typeof payload === "object" && "facilities" in payload && Array.isArray(payload.facilities) ? payload.facilities : []);
        const gym = facilities.filter(f => f.bookingMode === "walk_in" && /gym|fitness/i.test(f.name + " " + f.category));
        if (gym.length !== 1) {
          setError(gym.length ? "Ada lebih dari satu fasilitas Gym. Hubungi petugas untuk memilih fasilitas." : "Fasilitas Gym harian belum tersedia.");
          return;
        }
        window.location.replace("/wa/booking/" + encodeURIComponent(String(gym[0].id)) + "?nonmember=1&self=1");
      })
      .catch(() => { if (active) setError("Tidak dapat memuat fasilitas Gym. Silakan coba lagi."); });
    return () => { active = false; };
  }, []);

  return <main className="mx-auto max-w-lg px-5 py-16 text-center">
    <h1 className="text-2xl font-bold">Akses Harian Gym Nonmember</h1>
    <p className="mt-3 text-gray-600">Booking dan bayar mandiri tanpa membuat akun. Isi nama serta WhatsApp, pilih QRIS/transfer, lalu unggah bukti. Akses X904 memerlukan verifikasi identitas dan penyerahan kartu oleh petugas.</p>
    <p className="mt-6" role="status">{error || "Membuka formulir pembayaran Gym..."}</p>
    <Link href="/gym" className="mt-6 inline-block underline">Kembali ke Gym</Link>
  </main>;
}
