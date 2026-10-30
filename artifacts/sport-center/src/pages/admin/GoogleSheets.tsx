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
  const [section,setSection]=useState<"events"|"bookings"|"audit">("events");
  const [eventStatus,setEventStatus]=useState<{enabled:boolean;startAt:string|null;counts:Record<string,number>}|null>(null);
  const [eventStatusError,setEventStatusError]=useState("");
  async function refreshEventStatus(){
    try {
      const response=await fetch("/api/admin/google-sheets/payment-events-status",{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!response.ok)throw new Error("Status Payment Events belum bisa dibaca");
      setEventStatus(await response.json());setEventStatusError("");
    }catch(error){setEventStatusError(error instanceof Error?error.message:"Gagal memeriksa status");}
  }
  useEffect(()=>{void refreshEventStatus();},[]);
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
  const [expandedGroup,setExpandedGroup]=useState<string|null>(null);
  const [previewError,setPreviewError] = useState("");
  const [previewBusy,setPreviewBusy] = useState(false);
  const previewRequestRef = useRef(0);
  const [syncBusy,setSyncBusy]=useState("");
  const [pendingSync,setPendingSync]=useState<string|null>(null);
  const [syncOrderSearch,setSyncOrderSearch]=useState("");
  const [syncStatuses,setSyncStatuses]=useState<Record<string,{status:string;targetTab?:string|null;sheetRow?:number|null;changedColumns?:string[]}>>({});
  const [eligibility,setEligibility]=useState<Record<string,{eligible:boolean;reason:string|null}>>({});
  const [eligibilityError,setEligibilityError]=useState("");
  const [eligibilityBusy,setEligibilityBusy]=useState(false);
  async function checkEligibility(orders:string[]) {
    setEligibilityBusy(true);setEligibilityError("");setEligibility({});
    try{
      const result:Record<string,{eligible:boolean;reason:string|null}>={};
      for(let offset=0;offset<orders.length;offset+=100){
        const response=await fetch("/api/admin/google-sheets/sync-eligibility",{
          method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
          body:JSON.stringify({orderNumbers:orders.slice(offset,offset+100)}),
        });
        if(!response.ok)throw Error("Pemeriksaan kelayakan booking gagal");
        const data=await response.json();
        for(const item of data.items??[])result[item.orderNumber]={eligible:item.eligible===true,reason:item.reason??null};
      }
      if(Object.keys(result).length!==new Set(orders).size)throw Error("Data kelayakan tidak lengkap");
      setEligibility(result);
    }catch(error){setEligibilityError(error instanceof Error?error.message:"Pemeriksaan kelayakan gagal");}
    finally{setEligibilityBusy(false);}
  }
  const [pendingBatchOrders,setPendingBatchOrders]=useState<string[]>([]);
  const [batchBusy,setBatchBusy]=useState(false);
  const [batchMessage,setBatchMessage]=useState("");
  const allBatchCandidates=preview ? [...new Set(preview.rows.filter(row =>
    Number(row[9])>0 && Number(row[18])>0 &&
    Number(row[9])>=Number(row[18]) && syncStatuses[row[0]]?.status==="not_synced" && eligibility[row[0]]?.eligible===true
  ).map(row=>row[0]))] : [];
  // The preview includes group bookings, while the safe bulk writer excludes them.
  // Counts are scoped to this preview and never imply a live Google Sheets row count.
  const previewSummary = preview ? {
    total: preview.rows.length,
    group: preview.rows.filter(row => Boolean(row[17]?.trim())).length,
    uniqueGroups: new Set(preview.rows.map(row=>row[17]?.trim()).filter(Boolean)).size,
    individual: preview.rows.filter(row=>!row[17]?.trim()).length,
    synced: preview.rows.filter(row => syncStatuses[row[0]]?.status === "synced").length,
    pending: preview.rows.filter(row => !row[17]?.trim() && syncStatuses[row[0]]?.status === "not_synced").length,
    problems: preview.rows.filter(row => ["missing","changed","error","needs_review"].includes(syncStatuses[row[0]]?.status ?? "")).length,
    checked: preview.rows.filter(row => Boolean(syncStatuses[row[0]]?.status)).length,
  } : null;
  // Status from ledger and server eligibility are independent; no physical
  // Sheets availability is inferred until the read-only verification is run.
  const paidPreviewCategories = preview ? {
    recorded: preview.rows.filter(row=>syncStatuses[row[0]]?.status==="synced").length,
    ready: preview.rows.filter(row=>syncStatuses[row[0]]?.status==="not_synced" && eligibility[row[0]]?.eligible===true).length,
    held: preview.rows.filter(row=> {
      const status=syncStatuses[row[0]]?.status;
      return ["missing","changed","error","needs_review"].includes(status??"") ||
        (status==="not_synced" && eligibility[row[0]]?.eligible===false);
    }).length,
    checking: preview.rows.filter(row=>!syncStatuses[row[0]]?.status ||
      (syncStatuses[row[0]]?.status==="not_synced" && eligibility[row[0]]==null)).length,
  } : null;
  const paidCategory=(row:string[])=>{
    const status=syncStatuses[row[0]]?.status;
    if(status==="synced")return "Sudah Tercatat (Ledger)";
    if(status==="not_synced" && eligibility[row[0]]?.eligible===true)return "Layak Sync (Server)";
    if(["missing","changed","error","needs_review"].includes(status??"") ||
       (status==="not_synced" && eligibility[row[0]]?.eligible===false))return "Ditahan — Perlu Verifikasi";
    return "Sedang Diperiksa";
  };
  async function runPilotBatch(orders:string[]) {
    setBatchBusy(true);setBatchMessage("");
    let completed=0,skipped=0,failed="";
    try {
      // Eligibility must still match the server before any write; never trust preview fields.
      for(let offset=0;offset<orders.length;offset+=100){
        const response=await fetch("/api/admin/google-sheets/sync-eligibility",{
          method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
          body:JSON.stringify({orderNumbers:orders.slice(offset,offset+100)}),
        });
        if(!response.ok)throw Error("Pemeriksaan kelayakan terbaru gagal; tidak ada data ditulis.");
        const data=await response.json();
        if(data.items?.length!==orders.slice(offset,offset+100).length || data.items.some((item:{eligible:boolean})=>!item.eligible))throw Error("Kelayakan booking berubah; jalankan ulang pemeriksaan sebelum sync.");
      }
      // Read-only preflight for every requested order; enforce fail-closed if any status has changed.
      const verified:string[]=[];
      for(let offset=0;offset<orders.length;offset+=100){
        const chunk=orders.slice(offset,offset+100);
        const response=await fetch("/api/admin/google-sheets/status-check",{
          method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
          body:JSON.stringify({orderNumbers:chunk,verifySheets:true}),
        });
        if(!response.ok)throw Error(`Pemeriksaan awal gagal (HTTP ${response.status}); tidak ada penulisan dilakukan.`);
        const data=await response.json();
        if(!data.checkedSheets)throw Error("Pemeriksaan dua arah Sheets belum dijalankan; batch dibatalkan.");
        for(const item of data.items??[]){
          if(item.status!=="not_synced")throw Error(`${item.orderNumber}: status ${item.status} berubah; batch dibatalkan untuk menghindari duplikasi.`);
          verified.push(item.orderNumber);
        }
        setBatchMessage(`Pemeriksaan awal ${Math.min(offset+chunk.length,orders.length)}/${orders.length} booking...`);
      }
      if(verified.length!==orders.length)throw Error("Jumlah hasil pemeriksaan tidak cocok; batch dibatalkan.");
      for(const orderNumber of verified) {
        const response=await fetch("/api/admin/google-sheets/sync-one",{
          method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
          body:JSON.stringify({orderNumber}),
        });
        const result=await response.json();
        if(!response.ok){
          if(response.status===409 && result.error==="Booking grup/corporate/membership belum didukung Sync One"){
            skipped++;setBatchMessage(`${orderNumber} dilewati karena tipe booking tidak didukung; lanjut kandidat berikutnya.`);continue;
          }
          failed=`${orderNumber}: ${result.error||"Sync One gagal"}`;break;
        }
        if(result.written)completed++;else skipped++;
        setBatchMessage(`Diproses ${completed+skipped}/${orders.length}; berhasil ${completed}; dilewati ${skipped}.`);
      }
      setBatchMessage(`Batch selesai: ${completed} ditulis, ${skipped} sudah ada/tidak berubah.${failed?` Dihentikan pada ${failed}. Tidak ada retry otomatis.`:""}`);
      await checkSyncStatus(orders.slice(0,200),false);
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
  const [syncSuccess,setSyncSuccess]=useState<{orderNumber:string;targetTab:string;sheetRow:number}|null>(null);
  async function syncOne(orderNumber:string) {
    setSyncBusy(orderNumber);setSyncMessage("");
    try {
      const response=await fetch("/api/admin/google-sheets/sync-one",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
        body:JSON.stringify({orderNumber}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Sinkronisasi gagal");
      // A successful write is not a verified physical Sheets row until read-back.
      const check=await fetch("/api/admin/google-sheets/status-check",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${getToken()}`},
        body:JSON.stringify({orderNumbers:[orderNumber],verifySheets:true}),
      });
      const checked=await check.json();
      const verified=checked.items?.find((item:{orderNumber:string})=>item.orderNumber===orderNumber);
      if(check.ok && verified?.status==="synced" && verified.targetTab && Number(verified.sheetRow)>0) {
        setSyncStatuses(previous=>({...previous,[orderNumber]:verified}));
        setSyncSuccess({orderNumber,targetTab:verified.targetTab,sheetRow:Number(verified.sheetRow)});
        setSyncMessage("");
      }else{
        setSyncMessage(`${orderNumber}: proses sync selesai, tetapi verifikasi baris fisik Sheets belum berhasil. Jalankan Periksa Status Sheets (Read-only); jangan sync ulang dahulu.`);
      }
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
  const [paymentEventCheck,setPaymentEventCheck] = useState<{tab?:string;ready:boolean;reason?:string|null;writeEnabled?:boolean}|null>(null);
  const [paymentEventCheckBusy,setPaymentEventCheckBusy] = useState(false);
  const [paymentEventCheckError,setPaymentEventCheckError] = useState("");
  async function checkPaymentEventConnection() {
    setPaymentEventCheckBusy(true);setPaymentEventCheck(null);setPaymentEventCheckError("");
    try {
      const response=await fetch("/api/admin/google-sheets/payment-event-readiness?"+new URLSearchParams({month}),{
        headers:{Authorization:`Bearer ${getToken()}`},
      });
      const result=await response.json();
      if(!response.ok)throw new Error(response.status===401?"Sesi admin tidak dikenali. Login ulang ke Admin Sport Center.":`HTTP ${response.status}: ${result.reason||result.error||"Pemeriksaan koneksi gagal"}`);
      setPaymentEventCheck(result);
    }catch(error){setPaymentEventCheckError(error instanceof Error?error.message:"Tidak dapat memeriksa koneksi");}
    finally{setPaymentEventCheckBusy(false);}
  }

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
       const groupsResponse=await fetch("/api/admin/google-sheets/group-preview?"+new URLSearchParams({month}),{headers:{Authorization:`Bearer ${getToken()}`}});
       if(!groupsResponse.ok)throw new Error("Preview grup tidak tersedia; hasil belum lengkap");
       const groupData=await groupsResponse.json();
       const groupRows:string[][]=(groupData.items??[]).map((g:any)=>[
         String(g.order_number),String(g.customer_name??""),String(g.customer_email??""),String(g.customer_phone??""),
         String(g.facility_name??""),String(g.booking_date??""),String(g.start_time??""),String(g.end_time??""),
         String(g.duration_hours??""),String(g.amount),String(g.status??""),String(g.notes??""),
         String(g.admin_notes??""),String(g.created_at??""),String(g.payment_date_wib),"allocation",
         String(g.payment_id),String(g.group_ref),String(g.booking_total)
       ]);
       // The CSV export can contain partial/DP group rows that have been
       // rejected by the authoritative group-preview endpoint. Never bring
       // those group rows back when combining the two sources.
       const nonGroupRows=rows.filter(r=>!String(r[17]??"").trim());
       const combined=[...nonGroupRows,...groupRows];
      if (request === previewRequestRef.current) {setPreview({headers:[...COLUMNS],rows:combined,tab:`PAID ${MONTH_NAMES[mon-1]} ${year}`});void checkSyncStatus(combined.map(r=>r[0]),false);void checkEligibility([...new Set(combined.map(r=>r[0]))]);}
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
          <AlertDialogTitle>Sinkronkan Semua Booking yang Belum Sync?</AlertDialogTitle>
          <AlertDialogDescription>
            Sistem terlebih dahulu memeriksa status ledger dan baris Sheets. Hanya booking personal non-grup lunas yang belum tersinkron diproses satu per satu. Jika ada kesalahan, proses berhenti tanpa retry otomatis. Jangan menutup halaman selama proses berjalan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-lg border p-3 text-sm">Total kandidat: {pendingBatchOrders.length} booking. Contoh: {pendingBatchOrders.slice(0,12).join(" · ")}{pendingBatchOrders.length>12?" · ...":""}</div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={batchBusy}>Batal</AlertDialogCancel>
          <AlertDialogAction disabled={batchBusy} onClick={()=>{const orders=pendingBatchOrders;setPendingBatchOrders([]);void runPilotBatch(orders);}}>Ya, Sync Semua yang Belum Sync</AlertDialogAction>
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
    <AlertDialog open={syncSuccess!==null} onOpenChange={open=>{if(!open)setSyncSuccess(null);}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sinkronisasi Google Sheets Berhasil</AlertDialogTitle>
          <AlertDialogDescription>
            Booking <strong>{syncSuccess?.orderNumber}</strong> berhasil diverifikasi pada tab <strong>{syncSuccess?.targetTab}</strong>, baris <strong>{syncSuccess?.sheetRow}</strong>. Status sudah diperbarui menjadi Synced tanpa memuat ulang halaman.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogAction onClick={()=>setSyncSuccess(null)}>Tutup</AlertDialogAction></AlertDialogFooter>
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
          <p className="text-amber-700 dark:text-amber-300">Booking personal lunas dan sesi anak grup dengan alokasi terverifikasi dapat diproses. DP, corporate, dan alokasi tidak lengkap ditolak server. Tab tujuan ditentukan dari tanggal pembayaran WIB.</p>
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
        <Badge variant={eventStatus?.enabled?"default":"secondary"} className="w-fit">{eventStatus===null?"Status Payment Events belum terverifikasi":eventStatus.enabled?"Payment Events otomatis aktif":"Payment Events otomatis nonaktif"}</Badge>
      </header>
      <div className="flex flex-wrap gap-2 border-b pb-3" role="group" aria-label="Bagian integrasi Google Sheets">
        {([ ["events","Pembayaran Otomatis"], ["bookings","Laporan Booking PAID"], ["audit","Audit & Pengaturan"] ] as const).map(([key,label])=><button key={key} type="button" onClick={()=>setSection(key)} aria-pressed={section===key} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${section===key?"bg-slate-900 text-white dark:bg-white dark:text-slate-900":"hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{label}</button>)}
      </div>
      {section==="events"&&<div className="rounded-xl border p-4 space-y-2 text-sm">
        <div className="flex flex-wrap justify-between items-center gap-2"><strong>Status auto-sync Payment Events</strong><button type="button" onClick={()=>void refreshEventStatus()} className="rounded-lg border px-3 py-1.5">Perbarui Status</button></div>
        <p>{eventStatus===null?"Belum terverifikasi":eventStatus.enabled?"Aktif — pembayaran yang dikonfirmasi diproses otomatis":"Nonaktif — pembayaran baru belum dikirim otomatis"}</p>
        {eventStatus&&<p className="text-slate-500">Ledger: {eventStatus.counts.written??0} ditulis · {eventStatus.counts.blocked??0} diblokir · {eventStatus.counts.needs_review??0} perlu pemeriksaan</p>}
        {eventStatusError&&<p role="alert" className="text-red-600">{eventStatusError}</p>}
        <p className="text-slate-500">Tab PAYMENT EVENTS mencatat transaksi; tab PAID mencatat booking. Pemrosesan otomatis tidak menggunakan tombol Sync Now.</p>
      </div>}
      {section!=="bookings"&&<Card>
        <CardHeader><CardTitle className="text-lg">Spreadsheet tujuan</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="font-medium">Laporan paid order Sport Center</div>
          <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">Buka spreadsheet <ExternalLink className="h-4 w-4" /></a>
          <p className="text-sm text-slate-500">Satu spreadsheet untuk dua laporan berbeda: PAYMENT EVENTS (transaksi) dan PAID (ringkasan booking). Jangan menghapus tab yang sudah digunakan.</p>
        </CardContent>
      </Card>}
      {section==="audit"&&<Card>
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
      </Card>}
      {section==="events"&&<Card>
        <CardHeader><CardTitle className="text-lg">Uji Koneksi Payment Events (hanya baca)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">Memeriksa koneksi aplikasi Hostinger ke Google Sheets pembayaran untuk bulan yang dipilih. Tidak menambah baris dan tidak mengaktifkan auto-sync.</p>
          <button type="button" onClick={checkPaymentEventConnection} disabled={paymentEventCheckBusy} className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{paymentEventCheckBusy?"Menguji koneksi...":"Uji Koneksi Payment Events"}</button>
          {paymentEventCheckError&&<p role="alert" className="text-sm text-red-600">GAGAL: {paymentEventCheckError}</p>}
          {paymentEventCheck&&<div role="status" className="text-sm space-y-1">
            <p><strong>{paymentEventCheck.ready?"PASS — koneksi dan 10 header valid":"BELUM SIAP — periksa konfigurasi atau header"}</strong></p>
            <p>Tab: {paymentEventCheck.tab||"Tidak diketahui"}</p>
            {paymentEventCheck.reason&&<p>Alasan: {paymentEventCheck.reason}</p>}
            <p>Pengujian ini tidak menulis data ke spreadsheet.</p>
          </div>}
        </CardContent>
      </Card>}
      {section==="bookings"&&<Card><CardHeader><CardTitle className="text-lg">Preview pembayaran terkonfirmasi (tanpa menulis Sheets)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">Menggunakan filter tanggal pembayaran WIB pada ekspor resmi booking. Booking yang belum memiliki bukti pembayaran sah tidak ikut.</p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="sheets-paid-month" className="text-sm font-medium">Filter Bulan Pembayaran</label>
            <input id="sheets-paid-month" aria-label="Filter Bulan Pembayaran" type="month" value={month} onChange={e=>{setPreview(null);setEligibility({});setReconciliation(null);setReadiness(null);setSourceAudit(null);setMonth(e.target.value);}} className="border rounded-lg px-3 py-2 text-sm" />
            <button type="button" onClick={loadPreview} disabled={previewBusy} className="border rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{previewBusy?"Memuat...":"Preview Data"}</button>
          </div>
          {previewError&&<p role="alert" className="text-sm text-red-600">{previewError}</p>}
          {preview&&<div className="space-y-2"><p className="text-sm font-medium">Tujuan: {preview.tab} · {preview.rows.length} booking berbayar (termasuk grup)</p>
             {previewSummary&&<div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Ringkasan preview dan status ledger">
               <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Total preview</p><p className="text-xl font-semibold">{previewSummary.total}</p></div>
               <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Synced (status ledger)</p><p className="text-xl font-semibold">{previewSummary.synced}</p></div>
               <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Sesi anak group (preview)</p><p className="text-xl font-semibold">{previewSummary.group}</p></div>
               <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Belum sync non-grup</p><p className="text-xl font-semibold">{previewSummary.pending}</p></div>
             </div>}
             {paidPreviewCategories&&<div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Status kelayakan laporan PAID">
               <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Sudah Tercatat (Ledger)</p><p className="text-xl font-semibold">{paidPreviewCategories.recorded}</p></div>
               <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Layak Sync (Server)</p><p className="text-xl font-semibold">{paidPreviewCategories.ready}</p></div>
               <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Ditahan — Perlu Verifikasi</p><p className="text-xl font-semibold">{paidPreviewCategories.held}</p></div>
               <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Sedang Diperiksa</p><p className="text-xl font-semibold">{paidPreviewCategories.checking}</p></div>
             </div>}
             <p className="text-xs text-slate-500">Kategori berasal dari ledger dan pemeriksaan kelayakan server. Ini belum membuktikan keberadaan baris fisik; gunakan Periksa Status Sheets (Read-only). Data ditahan tidak dapat disimpulkan belum dibayar tanpa audit pembayaran.</p>
             {previewSummary&&<p className="text-xs font-medium">Rincian preview: {previewSummary.uniqueGroups} group unik · {previewSummary.group} sesi anak · {previewSummary.individual} sesi non-group · total {previewSummary.total} sesi booking. Group induk tidak dihitung tambahan.</p>}
             {previewSummary&&<p className="text-xs text-slate-500">Status tersedia untuk {previewSummary.checked} dari {previewSummary.total} booking. {previewSummary.problems>0?`${previewSummary.problems} perlu pemeriksaan (missing/changed/error/review). `:""}Angka Synced berasal dari ledger; klik Periksa Status Sheets (Read-only) untuk memastikan baris fisik. Booking grup belum termasuk Sync Semua; Sync One dapat dipakai setelah validasi alokasi pembayaran induk.</p>}<p className="text-xs text-amber-700">Preview tidak menulis ke Sheets. Gunakan Periksa Status Sheets untuk memverifikasi baris, Sync One untuk satu booking, atau Sync Semua hanya untuk booking yang belum tersinkron.</p>
            <button type="button" onClick={reconcilePreview} disabled={reconBusy} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">{reconBusy?"Mencocokkan...":"Cek Duplikasi Lintas Tab (Dry Run)"}</button>
            {reconError&&<p role="alert" className="text-red-600 text-sm">{reconError}</p>}
            {reconciliation&&<div className="rounded-lg border p-3 text-sm space-y-2">
              <p><strong>{reconciliation.tab}</strong> — {reconciliation.ready?"Pemeriksaan data selesai":"Belum siap untuk sinkronisasi"}</p>
              {reconciliation.ready?<p>Kandidat: {reconciliation.candidateCount} · Belum ada di Sheets: {reconciliation.newCount} · Sudah ada: {reconciliation.existingCount} · Duplikat dalam preview: {reconciliation.repeatedInPreviewCount}</p>:<p className="text-amber-700">Alasan: {reconciliation.reason}</p>}
              {reconciliation.duplicates?.length>0&&<p>Contoh sudah ada: {reconciliation.duplicates.slice(0,10).map((item:any)=>item.orderNumber+" ("+item.tabs.join(", ")+")").join("; ")}</p>}
              <p className="text-xs text-amber-700">Belum dapat digunakan untuk menulis: ledger pembayaran DP/grup dan uji idempotensi E2E belum selesai.</p>
            </div>}
            <p className="text-xs text-slate-500">Sync One mendukung booking personal lunas dan booking grup dengan alokasi terverifikasi. DP dan corporate tetap ditolak server.</p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="sheets-sync-order" className="text-sm font-medium">Sync satu nomor booking</label>
              <input id="sheets-sync-order" className="rounded-lg border px-3 py-2 text-sm" placeholder="Contoh: 1634 atau SC-1634" value={syncOrderSearch} onChange={e=>setSyncOrderSearch(e.target.value.toUpperCase().trim())}/>
              <button type="button" className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={!!syncBusy || !/^SC-[0-9]{1,12}$/.test(normalizedSyncOrder)} onClick={()=>setPendingSync(normalizedSyncOrder)}>Periksa &amp; Sync One</button>
              {syncOrderSearch && !preview.rows.some(r=>r[0]===normalizedSyncOrder) && <span className="text-xs text-amber-700">Booking tidak ditemukan dalam preview ekspor; sesi anak booking grup tetap dapat diperiksa melalui Sync One dengan validasi server.</span>}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={statusBusy} onClick={()=>void checkSyncStatus(preview.rows.map(r=>r[0]),true)}>{statusBusy?"Memeriksa...":"Periksa Status Sheets (Read-only)"}</button>
              <span className="text-xs text-slate-500">Badge awal dari ledger; tombol pemeriksaan membandingkan keberadaan baris di Sheets. Tidak mengubah booking atau Sheets.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={batchBusy||statusBusy||eligibilityBusy||!!syncBusy||!!eligibilityError||allBatchCandidates.length===0} onClick={()=>setPendingBatchOrders(allBatchCandidates)}>{batchBusy?"Sinkronisasi batch berjalan...":`Sync Semua yang Belum Sync (${allBatchCandidates.length})`}</button>
              <span className="text-xs text-slate-500">Termasuk membership Gym yang lunas dan terkonfirmasi. Booking grup hanya melalui Sync One dengan pemeriksaan alokasi; corporate, DP dan transaksi ambigu tetap dikecualikan.</span>
            </div>
            {eligibilityError&&<p role="alert" className="text-sm text-red-600">{eligibilityError}</p>}
              {preview&&<p className="text-xs text-slate-500">Kandidat layak: {allBatchCandidates.length} dari {preview.rows.length} booking preview.</p>}
              {batchMessage&&<p role="status" className="text-sm text-blue-700">{batchMessage}</p>}
            {statusError&&<p role="alert" className="text-sm text-red-600">{statusError}</p>}
            {syncMessage&&<p role="status" className="text-sm font-medium">{syncMessage}</p>}
            {preview.rows.some(r=>Boolean(r[17]))&&<div className="rounded-lg border p-3 space-y-2 text-sm">
              <strong>Booking group — rincian alokasi (induk tidak dijumlahkan ulang)</strong>
              {[...new Set(preview.rows.map(r=>r[17]).filter(Boolean))].map(group=>{
                const children=preview.rows.filter(r=>r[17]===group);
                const total=children.reduce((sum,r)=>sum+Number(r[9]||0),0);
                return <div key={group} className="border rounded-md p-2">
                  <button type="button" className="w-full text-left font-medium" onClick={()=>setExpandedGroup(expandedGroup===group?null:group)}>{expandedGroup===group?"▾":"▸"} {group} · {children.length} sesi · Rp {total.toLocaleString("id-ID")}</button>
                  {expandedGroup===group&&<div className="mt-2 space-y-1">{children.map(child=><div key={child[0]} className="flex justify-between gap-2 border-t py-1"><span>{child[0]} · {child[4]}</span><span>Rp {Number(child[9]).toLocaleString("id-ID")} · {syncStatuses[child[0]]?.status??"Memeriksa"}</span></div>)}</div>}
                </div>;
              })}
            </div>}
            <div className="overflow-x-auto max-h-80"><table className="text-xs whitespace-nowrap border-collapse"><thead><tr>{preview.headers.map(h=><th className="border p-2 text-left" key={h}>{h}</th>)}<th className="border p-2">Kategori PAID</th><th className="border p-2">Status Sync</th><th className="border p-2">Aksi</th></tr></thead><tbody>{visiblePreviewRows.map((row,i)=><tr key={row[0]+"-"+i}>{row.slice(0,14).map((value,n)=><td className="border p-2" key={n}>{n===9 && Number.isFinite(Number(value)) ? new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(Number(value)) : value}</td>)}<td className="border p-2">{paidCategory(row)}{eligibility[row[0]]?.reason&&paidCategory(row)==="Ditahan — Perlu Verifikasi"&&<span className="block text-amber-700 max-w-56 whitespace-normal">{eligibility[row[0]].reason}</span>}</td><td className="border p-2"><Badge variant={syncStatuses[row[0]]?.status==="synced"?"default":syncStatuses[row[0]]?.status==="missing"||syncStatuses[row[0]]?.status==="error"?"destructive":"secondary"}>{row[17]?.trim() && syncStatuses[row[0]]?.status==="not_synced" ? "Grup · Belum Sync" : (({synced:"Synced",missing:"Missing in Sheets",needs_review:"Perlu Cek",changed:"Changed",error:"Error",not_synced:"Belum Sync"} as Record<string,string>)[syncStatuses[row[0]]?.status]??"Memuat...")}</Badge>{syncStatuses[row[0]]?.status==="changed"&&<span className="block text-amber-700 text-xs whitespace-normal max-w-52" title={syncStatuses[row[0]].changedColumns?.join(", ")}>Berbeda: {syncStatuses[row[0]].changedColumns?.join(", ")}</span>}</td><td className="border p-2"><button type="button" onClick={()=>setPendingSync(row[0])} disabled={!!syncBusy} className="rounded border px-2 py-1 disabled:opacity-50">{syncBusy===row[0]?"Memproses...":"Sync One"}</button>{syncStatuses[row[0]]?.status==="missing" && <button type="button" className="ml-2 rounded border border-amber-600 text-amber-800 px-2 py-1 disabled:opacity-50" disabled={recoverBusy||!!syncBusy} onClick={()=>setPendingRecovery(row[0])}>Pulihkan ke Sheets</button>}{(syncStatuses[row[0]]?.status==="synced"||syncStatuses[row[0]]?.status==="missing")&&<button type="button" className="ml-2 rounded border px-2 py-1" onClick={()=>void readRecoveryHistory(row[0])}>Riwayat</button>}{recoveryHistory[row[0]] && <div className="text-xs mt-1 text-slate-600 whitespace-normal max-w-64">{recoveryHistory[row[0]].length ? recoveryHistory[row[0]].map((entry,i)=><div key={i}>Dipulihkan: {entry.target_tab}, baris {entry.old_sheet_row??"-"} → {entry.new_sheet_row}, {new Date(entry.created_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</div>) : "Belum ada riwayat pemulihan"}</div>}</td></tr>)}</tbody></table></div>
            {!syncOrderSearch && <p className="text-xs text-slate-500">Menampilkan seluruh {preview.rows.length} booking pada bulan ini.</p>}
          </div>}
        </CardContent></Card>}
      {section==="audit"&&<Card><CardHeader><CardTitle className="text-lg">Kesiapan tab bulanan sebelum sinkronisasi</CardTitle></CardHeader>
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
        </CardContent></Card>}
      {section==="audit"&&<Card><CardHeader><CardTitle className="text-lg">Audit sumber pembayaran dan alokasi</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-slate-500">Membedakan pembayaran langsung, alokasi grup, dan invoice perusahaan yang lunas berdasarkan bulan pembayaran WIB. Informasi ini untuk validasi ledger, belum mengirim data ke Sheets.</p>
          <div className="flex flex-wrap gap-3 items-center"><span>Bulan: <strong>{month}</strong></span><button type="button" onClick={auditPaymentSources} disabled={sourceBusy} className="rounded-lg border px-3 py-2 font-medium disabled:opacity-50">{sourceBusy?"Memeriksa...":"Audit Sumber Pembayaran"}</button></div>
          {sourceError&&<p role="alert" className="text-red-600">{sourceError}</p>}
          {sourceAudit&&<div className="overflow-x-auto"><table className="w-full text-xs text-left">
            <thead><tr className="border-b"><th className="p-2">Jenis sumber</th><th className="p-2">Validasi</th><th className="p-2">Event</th><th className="p-2">Nilai alokasi</th></tr></thead>
            <tbody>{(sourceAudit.breakdown||[]).map((row:any,i:number)=><tr key={i} className="border-b"><td className="p-2">{row.source_type}</td><td className="p-2">{row.validation_status}</td><td className="p-2">{row.event_count}</td><td className="p-2">{row.allocated_amount}</td></tr>)}</tbody>
          </table><p className="text-xs text-slate-500 mt-2">Event pembayaran tidak sama dengan jumlah booking unik. Pembayaran DP/grup dapat menghasilkan beberapa event.</p></div>}
        </CardContent></Card>}
      {section==="audit"&&<div className="grid md:grid-cols-2 gap-4">
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
            <p><strong>Antiduplikasi:</strong> PAYMENT EVENTS menggunakan source key unik dan mengecualikan cerminan pembayaran membership; laporan PAID memakai ledger booking terpisah.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Clock3 className="h-5 w-5 text-slate-600" /> Kontrol dan riwayat</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Status koneksi: <strong>{paymentEventCheck?.ready?"Payment Events terhubung": "Gunakan Uji Koneksi di tab Pembayaran Otomatis"}</strong></p>
            <p>Sinkron otomatis PAID (legacy): <strong>{autoStatus===null?"Belum terverifikasi":autoStatus.enabled?"Aktif":"Nonaktif"}</strong></p>
            <p>Sinkron otomatis Payment Events: <strong>{eventStatus===null?"Belum terverifikasi":eventStatus.enabled?"Aktif":"Nonaktif"}</strong></p>
            {autoStatus&&<p className="text-xs text-slate-500">Antrean: {autoStatus.counts.pending??0} menunggu · {autoStatus.counts.written??0} berhasil · {(autoStatus.counts.blocked??0)+(autoStatus.counts.needs_review??0)} perlu pemeriksaan.</p>}
            <p>Riwayat Payment Events: <strong>{eventStatus?(eventStatus.counts.written??0)+" transaksi tertulis":"Belum dapat dibaca"}</strong></p>
            <div className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-slate-400 cursor-not-allowed" aria-disabled="true"><RefreshCw className="h-4 w-4" /> Sync Semua tersedia di Laporan Booking PAID</div>
            <p className="text-slate-500">Tombol Sync Semua hanya untuk laporan booking PAID; bukan auto-sync Payment Events.</p>
          </CardContent>
        </Card>
      </div>}
    </main>
    </>
  );
}
