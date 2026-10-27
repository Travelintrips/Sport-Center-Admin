import { useState } from "react";
import { getToken } from "@/lib/auth";
import { Sheet, ShieldCheck, Clock3, RefreshCw, Info, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const sheetUrl = "https://docs.google.com/spreadsheets/d/1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E/edit";

const COLUMNS = ["Order Number","Customer Name","Customer Email","Customer Phone","Facility","Date","Start Time","End Time","Duration (hours)","Total Price","Status","Notes","Admin Notes","Created At"] as const;
const MONTH_NAMES = ["JANUARI","FEBRUARI","MARET","APRIL","MEI","JUNI","JULI","AGUSTUS","SEPTEMBER","OKTOBER","NOVEMBER","DESEMBER"];
// RFC4180 quote handling: commas, escaped quotes and embedded newlines.
function parseCsv(raw: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  const text = raw.replace(/^\uFEFF/, "");
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){ cell+='"';i++; }else quoted=!quoted; }
    else if(c===',' && !quoted){row.push(cell);cell="";}
    else if((c==='\n'||c==='\r') && !quoted){ if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))out.push(row);row=[];cell="";}
    else cell+=c;
  }
  if(cell || row.length){row.push(cell);out.push(row);}
  return out;
}
export default function GoogleSheets() {
  const [audit, setAudit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [month,setMonth] = useState("2026-10");
  const [preview,setPreview] = useState<{headers:string[];rows:string[][];tab:string}|null>(null);
  const [previewError,setPreviewError] = useState("");
  const [previewBusy,setPreviewBusy] = useState(false);
  async function loadPreview() {
    setPreviewBusy(true);setPreviewError("");setPreview(null);
    try {
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Bulan tidak valid");
      const [year,mon]=month.split("-").map(Number);
      const start=month+"-01";
      const end=new Date(Date.UTC(year,mon,0)).toISOString().slice(0,10);
      const q=new URLSearchParams({dateBasis:"payment",startDate:start,endDate:end});
      const response=await fetch("/api/admin/bookings/export?"+q.toString(),{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!response.ok)throw new Error("Tidak dapat membaca pembayaran terkonfirmasi");
      const parsed=parseCsv(await response.text());
      if(!parsed.length || COLUMNS.some((h,i)=>parsed[0][i]!==h) || parsed[0][14]!=="Payment Date") throw new Error("Struktur ekspor pembayaran tidak sesuai; preview dibatalkan");
      const rows=parsed.slice(1).filter(r=>r.length===15 && r[14]>=start && r[14]<=end);
      setPreview({headers:[...COLUMNS],rows,tab:`PAID ${MONTH_NAMES[mon-1]} ${year}`});
    }catch(e){setPreviewError(e instanceof Error?e.message:"Preview gagal");}finally{setPreviewBusy(false);}
  }

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
            <div className="overflow-x-auto"><table className="w-full text-xs text-left border-collapse">
              <thead><tr className="border-b"><th className="p-2">Tab</th><th className="p-2">Baris contoh</th><th className="p-2">Formula (3 baris)</th><th className="p-2">Header</th></tr></thead>
              <tbody>{(audit.tabs || []).map((tab:any)=><tr key={tab.name} className="border-b"><td className="p-2 font-medium">{tab.name}</td><td className="p-2">{tab.sampleHeaders?.length || 0}</td><td className="p-2">{tab.formulaCountInFirst3Rows}</td><td className="p-2">{tab.sampleHeaders?.some((r:string[])=>r[0]==="Order Number")?"Terdeteksi":"Perlu mapping"}</td></tr>)}</tbody>
            </table></div>

          </div>}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="text-lg">Preview pembayaran terkonfirmasi (tanpa menulis Sheets)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">Menggunakan filter tanggal pembayaran WIB pada ekspor resmi booking. Booking yang belum memiliki bukti pembayaran sah tidak ikut.</p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="sheets-paid-month" className="text-sm font-medium">Bulan pembayaran</label>
            <input id="sheets-paid-month" aria-label="Bulan pembayaran" type="month" value={month} onChange={e=>setMonth(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
            <button type="button" onClick={loadPreview} disabled={previewBusy} className="border rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{previewBusy?"Memuat...":"Preview Data"}</button>
          </div>
          {previewError&&<p role="alert" className="text-sm text-red-600">{previewError}</p>}
          {preview&&<div className="space-y-2"><p className="text-sm font-medium">Tujuan: {preview.tab} · {preview.rows.length} booking berbayar</p><p className="text-xs text-amber-700">Preview saja. Belum ada insert, update atau pengecekan duplikasi lintas sheet; Sync Now tetap terkunci.</p>
            <div className="overflow-x-auto max-h-80"><table className="text-xs whitespace-nowrap border-collapse"><thead><tr>{preview.headers.map(h=><th className="border p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{preview.rows.slice(0,50).map((row,i)=><tr key={row[0]+"-"+i}>{row.slice(0,14).map((value,n)=><td className="border p-2" key={n}>{value}</td>)}</tr>)}</tbody></table></div>
            {preview.rows.length>50&&<p className="text-xs text-slate-500">Menampilkan 50 contoh dari {preview.rows.length} booking.</p>}
          </div>}
        </CardContent></Card>
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
