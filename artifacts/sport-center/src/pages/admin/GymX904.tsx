import { Link } from "wouter";
import { Activity, ArrowRight, Fingerprint, Info, ShieldCheck } from "lucide-react";

/**
 * SC authenticated admin screen. X904 integration is intentionally not
 * activated: firmware ADMS protocol, scoped device credentials and isolated
 * Gym service must be validated before enabling real attendance ingestion.
 */
export default function GymX904() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Absensi Gym X904</h1>
        <p className="text-sm text-muted-foreground mt-1">Pengelolaan absensi mesin Gym, terpisah dari data pembayaran dan membership SC.</p>
      </div>
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-3"><Fingerprint className="h-6 w-6 text-primary" aria-hidden="true" /><h2 className="font-semibold">Solution X904</h2></div>
        <p className="text-sm text-muted-foreground">Integrasi ADMS belum diaktifkan. Status koneksi langsung dan absensi otomatis belum tersedia.</p>
        <div role="status" className="inline-flex items-center rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 border border-amber-200">Menunggu verifikasi kompatibilitas ADMS dan koneksi backend Gym</div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">Absensi yang berjalan</h2></div>
          <p className="text-sm text-muted-foreground">Check-in manual dan member yang sudah ada di SC tetap menjadi layanan aktif. Tidak ada data duplikat yang dibuat di sini.</p>
          <Link href="/admin/memberships" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Buka Member Gym <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section>
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">Keamanan dan isolasi</h2></div>
          <p className="text-sm text-muted-foreground">Akses mengikuti login Admin SC. Koneksi perangkat, histori X904 dan pengaturan mesin baru akan tersedia setelah backend terisolasi, izin khusus dan pengujian diterapkan.</p>
        </section>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="h-4 w-4 shrink-0" aria-hidden="true" />Halaman ini tidak mengubah mesin X904, data member, pembayaran maupun halaman Gym publik.</p>
    </div>
  );
}
