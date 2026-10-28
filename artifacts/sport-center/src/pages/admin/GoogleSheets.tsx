import { useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/auth";
import { Sheet, ShieldCheck, Clock3, RefreshCw, Info, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
  const [autoStatus,setAutoStatus]=useState<{enabled:boolean;startAt:string|null;counts:Record<string,number>}|null>(null);
  useEffect(()=>{
    let active=true;
    fetch("/api/admin/google-sheets/auto-status",{
      headers:{Authorization:`Bearer ${getToken()}`},
    }).then(r=>r.ok?r.json():Promise.reject(new Error("Auto-sync status unavailable")))
      .then(data=>{if(active)setAutoStatus(data);}).catch(()=>{});
    return ()=>{active=false;};
  },[]);

  const [preview,setPreview] = useState<{headers:string[];rows:string[][];tab:string}|null>(null);
  const [previewError,setPreviewError] = useState("");
  const [previewBusy,setPreviewBusy] = useState(false);
  const previewRequestRef = useRef(0);
  const [syncBusy,setSyncBusy]=useState("");
  const [pendingSync,setPendingSync]=useState<string|null>(null);
  const [syncOrderSearch,setSyncOrderSearch]=useState("");
  const [syncStatuses,setSyncStatuses]=useState<Record<string,{status:string;targetTab?:string|null;sheetRow?:number|null;changedColumns?:string[]}>>({});
  const [pendingBatchOrders,setPendingBatchOrders]=useState<string[]>([]);
  const [batchBusy,setBatchBusy]=useState(false);
  const [batchMessage,setBatchMessage]=useState("");
  const pilotBatchCandidates=preview ? [...new Set(preview.rows.filter(row =>
    !row[17] && Number(row[9])>0 && Number(row[18])>0 &&
    Number(row[9])>=Number(row[18]) && syncStatuses[row[0]]?.status==="not_synced"
  ).map(row=>row[0]))].slice(0,5) : [];
  async function runPilotBatch(orders:string[]) {
    setBatchBusy(true);setBatchMessage("");
    let completed=0,skipped=0,failed="";
    try {
      for(const orderNumber of orders) {
        const response=await fetch("/api/admin/google-sheets/sync-one",{
          method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
          body:JSON.stringify({orderNumber}),
        });
        const result=await response.json();
        if(!response.ok){failed=`${orderNumber}: ${result.error||"Sync One gagal"}`;break;}
        if(result.written)completed++;else skipped++;
        setBatchMessage(`Diproses ${completed+skipped}/${orders.length}; berhasil ${completed}; dilewati ${skipped}.`);
      }
      setBatchMessage(`Batch selesai: ${completed} ditulis, ${skipped} sudah ada/tidak berubah.${failed?` Dihentikan pada ${failed}. Tidak ada retry otomatis.`:""}`);
      await checkSyncStatus(preview?.rows.map(row=>row[0])??orders,false);
    }catch(error){setBatchMessage(`Batch dihentikan: ${error instanceof Error?error.message:"kesalahan jaringan"}. Jangan ulangi tanpa rekonsiliasi.`);}
    finally{setBatchBusy(false);}
  }

  const [pendingRecovery,setPendingRecovery]=useState<string|null>(null);
  const [recoverBusy,setRecoverBusy]=useState(false);
  const [recoveryHistory,setRecoveryHistory]=useState<Record<string,Array<{target_tab:string;old_sheet_row:number|null;new_sheet_row:number;created_at:string}>>>({});
  async function recoverOne(orderNumber:string) {
    setRecoverBusy(true);setSyncMessage("");
    try{
      const response=await fetch("/api/admin/google-sheets/recover-one",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
        body:JSON.stringify({orderNumber}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Pemulihan gagal");
      setSyncMessage(`${orderNumber} dipulihkan di ${result.targetTab} baris ${result.sheetRow} dan diverifikasi.`);
      await checkSyncStatus(preview?.rows.map(row=>row[0])??[orderNumber],true);
      void readRecoveryHistory(orderNumber);
    }catch(error){setSyncMessage(error instanceof Error?error.message:"Pemulihan gagal");}
    finally{setRecoverBusy(false);}
  }
  async function readRecoveryHistory(orderNumber:string) {
    try{
      const response=await fetch("/api/admin/google-sheets/recovery-history?"+new URLSearchParams({orderNumber}),{
        headers:{Authorization:`Bearer ${getToken()}`},
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error);
      setRecoveryHistory(previous=>({...previous,[orderNumber]:data.items??[]}));
    }catch(error){setStatusError(error instanceof Error?error.message:"Gagal membaca riwayat");}
  }


  const [statusBusy,setStatusBusy]=useState(false);
  const [statusError,setStatusError]=useState("");
  async function checkSyncStatus(rows:string[],verifySheets:boolean) {
    setStatusBusy(true);setStatusError("");
    try {
      const response=await fetch("/api/admin/google-sheets/status-check",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
        body:JSON.stringify({orderNumbers:[...new Set(rows)].slice(0,200),verifySheets}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Tidak dapat membaca status");
      setSyncStatuses(Object.fromEntries(data.items.map((item:{orderNumber:string;status:string;targetTab?:string|null;sheetRow?:number|null;changedColumns?:string[]})=>[item.orderNumber,item])));
    }catch(e){setStatusError(e instanceof Error?e.message:"Pemeriksaan gagal");}
    finally{setStatusBusy(false);}
  }

  const normalizedSyncOrder = /^(?:SC-)?[0-9]+$/i.test(syncOrderSearch) ? `SC-${syncOrderSearch.replace(/^SC-/i,"")}` : syncOrderSearch;
  const visiblePreviewRows = preview ? (syncOrderSearch ? preview.rows.filter(row => row[0] === normalizedSyncOrder) : preview.rows) : [];
  const [syncMessage,setSyncMessage]=useState("");
  async function syncOne(orderNumber:string) {
    setSyncBusy(orderNumber);setSyncMessage("");
    try {
      const response=await fetch("/api/admin/google-sheets/sync-one",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
        body:JSON.stringify({orderNumber}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Sinkronisasi gagal");
      setSyncMessage(result.written
        ?`${orderNumber} berhasil diverifikasi di ${result.targetTab} baris ${result.sheetRow}`
        :`${orderNumber} tidak ditulis ulang: ${result.alreadyPresent?"sudah ada di Sheets":"tidak ada perubahan"}`);
    }catch(e){setSyncMessage(e instanceof Error?e.message:"Sinkronisasi gagal");}
    finally{setSyncBusy("");}
  }

  const [sourceAudit,setSourceAudit]=useState<any>(null);
  const [sourceBusy,setSourceBusy]=useState(false);
  const [sourceError,setSourceError]=useState("");
  async function auditPaymentSources() {
    setSourceBusy(true);setSourceAudit(null);setSourceError("");
    try {
      const response=await fetch("/api/admin/google-sheets/payment-sources?"+new URLSearchParams({month}),{
        headers:{Authorization:`Bearer ${getToken()}`}
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Audit pembayaran gagal");
      setSourceAudit(data);
    }catch(e){setSourceError(e instanceof Error?e.message:"Audit pembayaran gagal");}
    finally{setSourceBusy(false);}
  }

  const [reconciliation,setReconciliation] = useState<any>(null);
  const [reconBusy,setReconBusy] = useState(false);
  const [reconError,setReconError] = useState("");
  async function reconcilePreview() {
    if (!preview) return;
    setReconBusy(true);setReconError("");setReconciliation(null);
    try {
      const response=await fetch("/api/admin/google-sheets/reconcile", {
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
        body:JSON.stringify({month,orderNumbers:preview.rows.map(row=>row[0])}),
      });
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error || "Pemeriksaan duplikasi gagal");
      setReconciliation(payload);
    }catch(error){setReconError(error instanceof Error?error.message:"Pemeriksaan duplikasi gagal");}
    finally{setReconBusy(false);}
  }

  const [readiness,setReadiness] = useState<{tab:string;ready:boolean;reason:string|null;expectedHeaders?:string[];headerRow?:number|null;populatedFirstColumn?:number}|null>(null);
  const [readinessBusy,setReadinessBusy] = useState(false);
  const [pendingHeader,setPendingHeader]=useState(false);
  const [headerBusy,setHeaderBusy]=useState(false);
  const [headerMessage,setHeaderMessage]=useState("");
  async function createMonthHeader() {
    setHeaderBusy(true);setHeaderMessage("");
    try {
      const response=await fetch("/api/admin/google-sheets/create-header",{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
        body:JSON.stringify({month}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Gagal membuat header");
      setHeaderMessage(data.written?`Header 14 kolom berhasil dibuat dan diverifikasi di ${data.tab}`:`Header ${data.tab} sudah sesuai; tidak ada data diubah`);
      await checkMonth();
      setReconciliation(null);
    }catch(e){setHeaderMessage(e instanceof Error?e.message:"Gagal membuat header");}
    finally{setHeaderBusy(false);}
  }

  const [readinessError,setReadinessError] = useState("");
  async function checkMonth() {
    setReadinessBusy(true);setReadiness(null);setReadinessError("");
    try {
      const response=await fetch("/api/admin/google-sheets/month-readiness?"+new URLSearchParams({month}),{headers:{Authorization:`Bearer ${getToken()}`}});
      const data=await response.json();
      if(!response.ok)throw new Error(data.reason || data.error || "Pemeriksaan tab gagal");
      setReadiness(data);
    }catch(e){setReadinessError(e instanceof Error?e.message:"Pemeriksaan tab gagal");}
    finally{setReadinessBusy(false);}
  }

  async function loadPreview() {
    const request = ++previewRequestRef.current;
    setPreviewBusy(true);setPreviewError("");setPreview(null);setSyncStatuses({});setReadiness(null);setReconciliation(null);
    try {
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Bulan tidak valid");
      const [year,mon]=month.split("-").map(Number);
      const start=month+"-01";
      const end=new Date(Date.UTC(year,mon,0)).toISOString().slice(0,10);
      const q=new URLSearchParams({dateBasis:"payment",startDate:start,endDate:end});
      const response=await fetch("/api/admin/bookings/export?"+q.toString(),{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!response.ok)throw new Error("Tidak dapat membaca pembayaran terkonfirmasi");
      const parsed=parseCsv(await response.text());
      if(!parsed.length || COLUMNS.some((h,i)=>parsed[0][i]!==h) || parsed[0][14]!=="Payment Date" || parsed[0][15]!=="Payment Type" || parsed[0][16]!=="Payment ID" || parsed[0][17]!=="Group Ref" || parsed[0][18]!=="Booking Total") throw new Error("Struktur ekspor pembayaran tidak sesuai; preview dibatalkan");
      const rows=parsed.slice(1).filter(r=>r.length===19 && r[14]>=start && r[14]<=end);
      if (request === previewRequestRef.current) {setPreview({headers:[...COLUMNS],rows,tab:`PAID ${MONTH_NAMES[mon-1]} ${year}`});void checkSyncStatus(rows.map(r=>r[0]),false);}
    }catch(e){if(request === previewRequestRef.current)setPreviewError(e instanceof Error?e.message:"Preview gagal");}finally{if(request === previewRequestRef.current)setPreviewBusy(false);}
  }

  useEffect(() => { void loadPreview(); return () => {previewRequestRef.current += 1;}; }, [month]);

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
    <>
    <AlertDialog open={pendingHeader} onOpenChange={(open)=>{if(!headerBusy)setPendingHeader(open);}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Buat Header Google Sheets?</AlertDialogTitle>
          <AlertDialogDescription>Menambahkan 14 header ke A1:N1 pada tab {readiness?.tab ?? "terpilih"} hanya jika seluruh tab kosong. Data dan rumus yang sudah ada tidak akan ditimpa.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="text-xs rounded-lg border p-3 max-h-32 overflow-y-auto">{COLUMNS.join(" · ")}</div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={headerBusy}>Batal</AlertDialogCancel>
          <AlertDialogAction disabled={headerBusy} onClick={()=>{setPendingHeader(false);void createMonthHeader();}}>Ya, Buat Header</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={pendingBatchOrders.length>0} onOpenChange={open=>{if(!batchBusy&&!open)setPendingBatchOrders([]);}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sync Now — Pilot Maksimal 5 Booking</AlertDialogTitle>
          <AlertDialogDescription>
            Kirim satu per satu hanya kandidat pembayaran lunas yang belum ada di ledger. Backend memeriksa kelayakan dan antiduplikasi ulang setiap booking. Batch berhenti pada error pertama dan tidak akan mengulang otomatis.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-lg border p-3 text-sm">{pendingBatchOrders.join(" · ")}</div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={batchBusy}>Batal</AlertDialogCancel>
          <AlertDialogAction disabled={batchBusy} onClick={()=>{const orders=pendingBatchOrders;setPendingBatchOrders([]);void runPilotBatch(orders);}}>Ya, Sync Pilot Batch</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={pendingRecovery !== null} onOpenChange={open=>{if(!recoverBusy&&!open)setPendingRecovery(null);}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pulihkan Baris Booking ke Google Sheets?</AlertDialogTitle>
          <AlertDialogDescription>
            Booking {pendingRecovery} tercatat pernah berhasil dikirim, tetapi hilang saat pemeriksaan.
            Server akan mengecek ulang seluruh tab PAID dan menolak pemulihan jika nomor booking masih ditemukan.
            Booking dan pembayaran asli tidak akan diubah.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={recoverBusy}>Batal</AlertDialogCancel>
          <AlertDialogAction disabled={recoverBusy} onClick={()=>{const order=pendingRecovery;setPendingRecovery(null);if(order)void recoverOne(order);}}>Ya, Pulihkan Satu Baris</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={pendingSync !== null} onOpenChange={(open) => { if(!open && !syncBusy) setPendingSync(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Konfirmasi Sinkronisasi Booking</AlertDialogTitle>
          <AlertDialogDescription>
            Periksa data berikut sebelum mengirim satu booking ke Google Sheets.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-3 space-y-2">
            <div className="flex justify-between gap-4"><span className="text-slate-500">Nomor booking</span><strong>{pendingSync}</strong></div>
            <div className="flex justify-between gap-4"><span className="text-slate-500">Tab tujuan (filter)</span><strong>{preview?.tab ?? "-"}</strong></div>
          </div>
          <p className="text-amber-700 dark:text-amber-300">Hanya booking personal non-grup yang sudah lunas penuh. Pembayaran DP, membership, dan corporate akan ditolak server. Bulan tujuan sebenarnya ditentukan dari tanggal pembayaran WIB, bukan pilihan filter.</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={!!syncBusy}>Batal</AlertDialogCancel>
          <AlertDialogAction disabled={!!syncBusy || !pendingSync} onClick={() => {
            if (!pendingSync) return;
            const order = pendingSync;
            setPendingSync(null);
            void syncOne(order);
          }}>Ya, Sinkronkan</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <main className="p-5 md:p-8 space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sheet className="h-6 w-6 text-green-600" /> Google Sheets
          </h1>
          <p className="text-sm text-slate-500 mt-1">Laporan &amp; Sistem · Integrasi laporan pembayaran booking</p>
        </div>
        <Badge variant={autoStatus?.enabled?"default":"secondary"} className="w-fit">{autoStatus?.enabled?"Auto-sync aktif · Personal lunas":"Auto-sync belum aktif / belum diverifikasi"}</Badge>
      </header>
      <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-200 flex gap-2">
        <Info className="h-5 w-5 shrink-0" />
        <span>{autoStatus?.enabled?"Auto-sync aktif untuk pembayaran baru personal non-grup yang lunas penuh. DP, grup, membership dan corporate tetap ditahan.":"Auto-sync belum terverifikasi aktif."} Sync One tersedia untuk satu booking; Sync Now terbatas pada maksimal lima kandidat per konfirmasi admin.</span>
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
            <label htmlFor="sheets-paid-month" className="text-sm font-medium">Filter Bulan Pembayaran</label>
            <input id="sheets-paid-month" aria-label="Filter Bulan Pembayaran" type="month" value={month} onChange={e=>{setPreview(null);setReconciliation(null);setReadiness(null);setSourceAudit(null);setMonth(e.target.value);}} className="border rounded-lg px-3 py-2 text-sm" />
            <button type="button" onClick={loadPreview} disabled={previewBusy} className="border rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{previewBusy?"Memuat...":"Preview Data"}</button>
          </div>
          {previewError&&<p role="alert" className="text-sm text-red-600">{previewError}</p>}
          {preview&&<div className="space-y-2"><p className="text-sm font-medium">Tujuan: {preview.tab} · {preview.rows.length} booking berbayar</p><p className="text-xs text-amber-700">Preview tidak menulis ke Sheets. Gunakan Periksa Status Sheets untuk memverifikasi baris, Sync One untuk satu booking, atau Sync Now pilot maksimal lima.</p>
            <button type="button" onClick={reconcilePreview} disabled={reconBusy} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">{reconBusy?"Mencocokkan...":"Cek Duplikasi Lintas Tab (Dry Run)"}</button>
            {reconError&&<p role="alert" className="text-red-600 text-sm">{reconError}</p>}
            {reconciliation&&<div className="rounded-lg border p-3 text-sm space-y-2">
              <p><strong>{reconciliation.tab}</strong> — {reconciliation.ready?"Pemeriksaan data selesai":"Belum siap untuk sinkronisasi"}</p>
              {reconciliation.ready?<p>Kandidat: {reconciliation.candidateCount} · Belum ada di Sheets: {reconciliation.newCount} · Sudah ada: {reconciliation.existingCount} · Duplikat dalam preview: {reconciliation.repeatedInPreviewCount}</p>:<p className="text-amber-700">Alasan: {reconciliation.reason}</p>}
              {reconciliation.duplicates?.length>0&&<p>Contoh sudah ada: {reconciliation.duplicates.slice(0,10).map((item:any)=>item.orderNumber+" ("+item.tabs.join(", ")+")").join("; ")}</p>}
              <p className="text-xs text-amber-700">Belum dapat digunakan untuk menulis: ledger pembayaran DP/grup dan uji idempotensi E2E belum selesai.</p>
            </div>}
            <p className="text-xs text-slate-500">Pilot manual: Sync One hanya boleh untuk satu booking personal non-grup yang lunas penuh. Jangan gunakan untuk DP, membership, atau corporate.</p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="sheets-sync-order" className="text-sm font-medium">Sync satu nomor booking</label>
              <input id="sheets-sync-order" className="rounded-lg border px-3 py-2 text-sm" placeholder="Contoh: 1634 atau SC-1634" value={syncOrderSearch} onChange={e=>setSyncOrderSearch(e.target.value.toUpperCase().trim())}/>
              <button type="button" className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={!!syncBusy || !preview.rows.some(r=>r[0]===normalizedSyncOrder)} onClick={()=>setPendingSync(normalizedSyncOrder)}>Periksa &amp; Sync One</button>
              {syncOrderSearch && !preview.rows.some(r=>r[0]===normalizedSyncOrder) && <span className="text-xs text-amber-700">Booking tidak ditemukan pada preview bulan ini; tidak dapat diproses.</span>}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={statusBusy} onClick={()=>void checkSyncStatus(preview.rows.map(r=>r[0]),true)}>{statusBusy?"Memeriksa...":"Periksa Status Sheets (Read-only)"}</button>
              <span className="text-xs text-slate-500">Badge awal dari ledger; tombol pemeriksaan membandingkan keberadaan baris di Sheets. Tidak mengubah booking atau Sheets.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={batchBusy||statusBusy||!!syncBusy||pilotBatchCandidates.length===0} onClick={()=>setPendingBatchOrders(pilotBatchCandidates)}>{batchBusy?"Sinkronisasi batch berjalan...":`Sync Now (Pilot ${pilotBatchCandidates.length}/5)`}</button>
              <span className="text-xs text-slate-500">Hanya kandidat tanpa ledger dan bukan grup, maksimal 5 per konfirmasi. DP, corporate, membership dan error ditolak server.</span>
            </div>
            {batchMessage&&<p role="status" className="text-sm text-blue-700">{batchMessage}</p>}
            {statusError&&<p role="alert" className="text-sm text-red-600">{statusError}</p>}
            {syncMessage&&<p role="status" className="text-sm font-medium">{syncMessage}</p>}
            <div className="overflow-x-auto max-h-80"><table className="text-xs whitespace-nowrap border-collapse"><thead><tr>{preview.headers.map(h=><th className="border p-2 text-left" key={h}>{h}</th>)}<th className="border p-2">Status Sync</th><th className="border p-2">Aksi</th></tr></thead><tbody>{visiblePreviewRows.map((row,i)=><tr key={row[0]+"-"+i}>{row.slice(0,14).map((value,n)=><td className="border p-2" key={n}>{value}</td>)}<td className="border p-2"><Badge variant={syncStatuses[row[0]]?.status==="synced"?"default":syncStatuses[row[0]]?.status==="missing"||syncStatuses[row[0]]?.status==="error"?"destructive":"secondary"}>{({synced:"Synced",missing:"Missing in Sheets",needs_review:"Perlu Cek",changed:"Changed",error:"Error",not_synced:"Belum Sync"} as Record<string,string>)[syncStatuses[row[0]]?.status]??"Memuat..."}</Badge>{syncStatuses[row[0]]?.status==="changed"&&<span className="block text-amber-700 text-xs whitespace-normal max-w-52" title={syncStatuses[row[0]].changedColumns?.join(", ")}>Berbeda: {syncStatuses[row[0]].changedColumns?.join(", ")}</span>}</td><td className="border p-2"><button type="button" onClick={()=>setPendingSync(row[0])} disabled={!!syncBusy} className="rounded border px-2 py-1 disabled:opacity-50">{syncBusy===row[0]?"Memproses...":"Sync One"}</button>{syncStatuses[row[0]]?.status==="missing" && <button type="button" className="ml-2 rounded border border-amber-600 text-amber-800 px-2 py-1 disabled:opacity-50" disabled={recoverBusy||!!syncBusy} onClick={()=>setPendingRecovery(row[0])}>Pulihkan ke Sheets</button>}{(syncStatuses[row[0]]?.status==="synced"||syncStatuses[row[0]]?.status==="missing")&&<button type="button" className="ml-2 rounded border px-2 py-1" onClick={()=>void readRecoveryHistory(row[0])}>Riwayat</button>}{recoveryHistory[row[0]] && <div className="text-xs mt-1 text-slate-600 whitespace-normal max-w-64">{recoveryHistory[row[0]].length ? recoveryHistory[row[0]].map((entry,i)=><div key={i}>Dipulihkan: {entry.target_tab}, baris {entry.old_sheet_row??"-"} → {entry.new_sheet_row}, {new Date(entry.created_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</div>) : "Belum ada riwayat pemulihan"}</div>}</td></tr>)}</tbody></table></div>
            {!syncOrderSearch && <p className="text-xs text-slate-500">Menampilkan seluruh {preview.rows.length} booking pada bulan ini.</p>}
          </div>}
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Kesiapan tab bulanan sebelum sinkronisasi</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-slate-500">Setiap pembayaran dipetakan ke tab bulan pembayaran WIB. Jika tab November belum dibuat manual atau belum memiliki 14 header yang benar, sistem harus menahan penulisan; tidak dialihkan ke Oktober.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <span>Periksa bulan: <strong>{month}</strong></span>
            <button type="button" onClick={checkMonth} disabled={readinessBusy} className="rounded-lg border px-3 py-2 font-medium disabled:opacity-50">{readinessBusy?"Memeriksa...":"Periksa Kesiapan Tab"}</button>
            {readiness && !readiness.ready && readiness.reason === "BOOKING_HEADER_MISSING" && <button type="button" onClick={()=>setPendingHeader(true)} disabled={headerBusy || readinessBusy} className="rounded-lg bg-green-700 text-white px-3 py-2 font-medium disabled:opacity-50">{headerBusy?"Menyiapkan...":"Buat Header (Tab Kosong)"}</button>}
          </div>
          {headerMessage&&<p role="status" className="text-green-700">{headerMessage}</p>}
          {readinessError&&<p role="alert" className="text-red-600">{readinessError}</p>}
          {readiness&&<div className="rounded-lg border p-3 space-y-2">
            <p>Tujuan: <strong>{readiness.tab}</strong></p>
            <p>Status: <strong>{readiness.ready?"Header booking valid — pemeriksaan baca lulus":"Belum siap — sinkronisasi harus ditahan"}</strong></p>
            {!readiness.ready&&<p className="text-amber-700">Alasan: {readiness.reason==="MONTH_TAB_MISSING"?"Tab belum dibuat. Buat tab manual menggunakan nama tujuan persis.":readiness.reason==="BOOKING_HEADER_MISSING"?"14 header booking belum ditemukan dalam lima baris pertama.":"Tidak dapat memvalidasi tab."}</p>}
            {readiness.ready&&<p>Baris header: {readiness.headerRow}. Sel terisi di kolom A: {readiness.populatedFirstColumn}.</p>}
            {!readiness.ready&&<p className="text-xs text-slate-500">Header A–N yang harus digunakan: {readiness.expectedHeaders?.join(" · ")}</p>}
            <p className="text-xs text-slate-500">Pemeriksaan kesiapan hanya-baca; proses penulisan tetap melewati pemeriksaan server dan antiduplikasi.</p>
          </div>}
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Audit sumber pembayaran dan alokasi</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-slate-500">Membedakan pembayaran langsung, alokasi grup, dan invoice perusahaan yang lunas berdasarkan bulan pembayaran WIB. Informasi ini untuk validasi ledger, belum mengirim data ke Sheets.</p>
          <div className="flex flex-wrap gap-3 items-center"><span>Bulan: <strong>{month}</strong></span><button type="button" onClick={auditPaymentSources} disabled={sourceBusy} className="rounded-lg border px-3 py-2 font-medium disabled:opacity-50">{sourceBusy?"Memeriksa...":"Audit Sumber Pembayaran"}</button></div>
          {sourceError&&<p role="alert" className="text-red-600">{sourceError}</p>}
          {sourceAudit&&<div className="overflow-x-auto"><table className="w-full text-xs text-left">
            <thead><tr className="border-b"><th className="p-2">Jenis sumber</th><th className="p-2">Validasi</th><th className="p-2">Event</th><th className="p-2">Nilai alokasi</th></tr></thead>
            <tbody>{(sourceAudit.breakdown||[]).map((row:any,i:number)=><tr key={i} className="border-b"><td className="p-2">{row.source_type}</td><td className="p-2">{row.validation_status}</td><td className="p-2">{row.event_count}</td><td className="p-2">{row.allocated_amount}</td></tr>)}</tbody>
          </table><p className="text-xs text-slate-500 mt-2">Event pembayaran tidak sama dengan jumlah booking unik. Pembayaran DP/grup dapat menghasilkan beberapa event.</p></div>}
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
            <p>Sinkron otomatis: <strong>{autoStatus?.enabled?"Aktif · transaksi baru personal lunas":"Belum aktif / belum terverifikasi"}</strong></p>
            {autoStatus&&<p className="text-xs text-slate-500">Antrean: {autoStatus.counts.pending??0} menunggu · {autoStatus.counts.written??0} berhasil · {(autoStatus.counts.blocked??0)+(autoStatus.counts.needs_review??0)} perlu pemeriksaan.</p>}
            <p>Riwayat sinkron: <strong>Belum tersedia</strong></p>
            <div className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-slate-400 cursor-not-allowed" aria-disabled="true"><RefreshCw className="h-4 w-4" /> Sync Now (pilot maksimal 5 pada Preview)</div>
            <p className="text-slate-500">Tahap selanjutnya: audit header dan formula tab PAID, pemetaan kolom, koneksi Google Sheets API, worker transaksi, preview, dan verifikasi end-to-end.</p>
          </CardContent>
        </Card>
      </div>
    </main>
    </>
  );
}
