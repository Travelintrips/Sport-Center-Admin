import { useState } from "react";
import { getToken } from "@/lib/auth";
import { Sheet, ShieldCheck, Clock3, RefreshCw, Info, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const sheetUrl = "https://docs.google.com/spreadsheets/d/1ZvHAydIYhdfnDZmOCcPNKtOnj-O3-I9bY84927bYN7E/edit";

export default function GoogleSheets() {
  const [audit, setAudit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function inspect() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/google-sheets/audit", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`${result.error || "Pemeriksaan gagal"}${result.reason ? ` (Kode: ${result.reason})` : ""}`);
      setAudit(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pemeriksaan gagal");
    } finally { setBusy(false); }
  }
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
      <Card>
        <CardHeader><CardTitle className="text-lg">Audit struktur spreadsheet (hanya baca)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <button type="button" onClick={inspect} disabled={busy} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
            {busy ? "Memeriksa..." : "Periksa Struktur Sheets"}
          </button>
          <p className="text-xs text-slate-500">Memeriksa akses, nama tab PAID, dan contoh tiga baris pertama; tidak mengirim maupun mengganti data.</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {audit && <div className="space-y-3 text-sm">
            <p>Status: <strong>{audit.connected ? "Akses baca berhasil" : "Belum terhubung"}</strong></p>
            {audit.title && <p>Spreadsheet: {audit.title}</p>}
            {audit.reason && <p>{audit.reason}</p>}
            {audit.rules && <p>Contoh PT Avia (bayar Oktober): <strong>{audit.rules.sampleSepBookingOctPaymentTab}</strong></p>}
            {(audit.tabs || []).map((tab: any) => <div key={tab.name} className="rounded-lg border p-3 space-y-1">
              <p className="font-semibold">{tab.name}</p>
              <p>Formula (3 baris awal): {tab.formulaCountInFirst3Rows}</p>
              <p className="text-xs text-slate-500">Contoh baris (read-only):</p>
              <pre className="overflow-x-auto text-xs whitespace-pre-wrap">{JSON.stringify(tab.sampleHeaders, null, 2)}</pre>
            </div>)}
          </div>}
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
