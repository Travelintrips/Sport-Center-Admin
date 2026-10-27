import { Sheet, ShieldCheck, Clock3, RefreshCw, Info, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const sheetUrl = "https://docs.google.com/spreadsheets/d/1ZvHAvdIYhdfnDZmOCcPNKtOnj-O3-I9bY84927bYN7E/edit";

export default function GoogleSheets() {
  return (
    <main className="p-5 md:p-8 space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sheet className="h-6 w-6 text-green-600" /> Google Sheets
          </h1>
          <p className="text-sm text-slate-500 mt-1">Laporan &amp; Sistem · Integrasi laporan pembayaran booking</p>
        </div>
        <Badge variant="secondary" className="w-fit">Belum terhubung · Mode persiapan</Badge>
      </header>
      <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-200 flex gap-2">
        <Info className="h-5 w-5 shrink-0" />
        <span>Halaman konfigurasi tahap awal. Sinkronisasi otomatis dan manual belum diaktifkan. Tidak ada data yang ditulis ke Google Sheets melalui halaman ini.</span>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-lg">Spreadsheet tujuan</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="font-medium">Laporan paid order Sport Center</div>
          <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">Buka spreadsheet <ExternalLink className="h-4 w-4" /></a>
          <p className="text-sm text-slate-500">Koneksi Google dan izin akses spreadsheet harus divalidasi sebelum sinkronisasi diaktifkan. Tab dan rumus yang sudah ada tidak akan diubah pada tahap ini.</p>
        </CardContent>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-green-600" /> Aturan sinkronisasi</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><strong>Pemicu:</strong> hanya pembayaran yang sah dan telah dikonfirmasi, bukan saat booking baru dibuat.</p>
            <p><strong>Dasar tab:</strong> tanggal pembayaran dalam WIB, bukan tanggal bermain atau tanggal dibuat.</p>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
              <div className="font-medium">Contoh: PT Avia</div>
              <div>Booking September 2026 · Dibayar Oktober 2026</div>
              <div className="font-semibold text-green-700 dark:text-green-400 mt-1">Tujuan: PAID OKTOBER 2026</div>
            </div>
            <p><strong>Antiduplikasi:</strong> rencana identifikasi unik berdasarkan booking, pembayaran, dan alokasi pembayaran untuk booking grup.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Clock3 className="h-5 w-5 text-slate-600" /> Kontrol dan riwayat</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Status koneksi: <strong>Belum diverifikasi</strong></p>
            <p>Sinkron otomatis: <strong>Belum aktif</strong></p>
            <p>Riwayat sinkron: <strong>Belum tersedia</strong></p>
            <div className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-slate-400 cursor-not-allowed" aria-disabled="true"><RefreshCw className="h-4 w-4" /> Sync Now (belum aktif)</div>
            <p className="text-slate-500">Tahap selanjutnya: audit header dan formula tab PAID, pemetaan kolom, koneksi Google Sheets API, worker transaksi, preview, dan verifikasi end-to-end.</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
