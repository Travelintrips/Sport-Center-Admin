import {useState} from "react";
import {CalendarPlus,ExternalLink} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {useToast} from "@/hooks/use-toast";
import {getToken} from "@/lib/auth";

type Draft={period:string;sourceTitle:string;targetTitle:string;employeeCount:number;clearCells:string[];retainedFormulas:number;writeEnabled:boolean};
type RestorePreview={sourceTitle:string;targetTitle:string;employeeCount:number;missingCells:number;sampleCells:string[];writeEnabled:boolean};
type Created={created:boolean;period:string;targetTitle:string;employeeCount:number;clearedCells:number;url:string};
const API=import.meta.env.VITE_API_BASE_URL??"/api";
async function post(path:string,period:string):Promise<any>{
 const response=await fetch(API+path,{method:"POST",
  headers:{Authorization:"Bearer "+getToken(),"Content-Type":"application/json"},
  body:JSON.stringify({period})});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||"Permintaan gagal");
 return result;
}
export default function PayrollTabDialog(){
 const {toast}=useToast();
 const [open,setOpen]=useState(false);
 const [period,setPeriod]=useState("2026-12");
 const [preview,setPreview]=useState<Draft|null>(null);
 const [created,setCreated]=useState<Created|null>(null);
 const [busy,setBusy]=useState(false);
 const [repairPreview,setRepairPreview]=useState<RestorePreview|null>(null);
 const [repairDone,setRepairDone]=useState<string|null>(null);
 const restorePreview=async()=>{
  setBusy(true);setRepairPreview(null);setRepairDone(null);
  try{
   const r=await fetch(API+"/admin/sc-employees/payroll-tabs/restore-december-preview",
    {method:"POST",headers:{Authorization:"Bearer "+getToken(),"Content-Type":"application/json"},body:"{}"});
   const data=await r.json();if(!r.ok)throw Error(data.error||"Pratinjau pemulihan gagal");
   setRepairPreview(data);
  }catch(e){toast({title:"Pemulihan tidak tersedia",description:(e as Error).message,variant:"destructive"});}
  finally{setBusy(false);}
 };
 const restore=async()=>{
  if(!repairPreview?.writeEnabled||busy)return;
  setBusy(true);
  try{
   const r=await fetch(API+"/admin/sc-employees/payroll-tabs/restore-december",
    {method:"POST",headers:{Authorization:"Bearer "+getToken(),"Content-Type":"application/json"},body:"{}"});
   const data=await r.json();if(!r.ok)throw Error(data.error||"Pemulihan gagal");
   setRepairDone(data.restoredCells+" sel dipulihkan dan diverifikasi di "+data.targetTitle);
   setRepairPreview(null);toast({title:"Data tab Desember berhasil dipulihkan"});
  }catch(e){setRepairPreview(null);toast({title:"Pemulihan belum berhasil",description:(e as Error).message,variant:"destructive"});}
  finally{setBusy(false);}
 };
 const check=async()=>{
  setBusy(true);setPreview(null);setCreated(null);
  try{setPreview(await post("/admin/sc-employees/payroll-tabs/preview",period));}
  catch(e){toast({title:"Tab gaji belum bisa dipratinjau",description:(e as Error).message,variant:"destructive"});}
  finally{setBusy(false);}
 };
 const create=async()=>{
  if(!preview?.writeEnabled||busy||preview.period!==period)return;
  setBusy(true);
  try{
   const result:Created=await post("/admin/sc-employees/payroll-tabs/create",period);
   setCreated(result);setPreview(null);
   toast({title:result.targetTitle+" berhasil dibuat"});
  }catch(e){setPreview(null);toast({title:"Pembuatan tab gaji belum berhasil",description:(e as Error).message,variant:"destructive"});}
  finally{setBusy(false);}
 };
 return <>
  <Button variant="outline" onClick={()=>setOpen(true)}><CalendarPlus className="mr-2 h-4 w-4"/>Buat Tab Gaji Baru</Button>
  <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}>
   <DialogContent className="max-w-lg">
    <DialogHeader><DialogTitle>Buat Tab Gaji Bulanan</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">Buat tab bulan berikutnya di file Google Sheets GAJI JULI 2025 menggunakan tab gaji bulan sebelumnya sebagai template. Tab lama tidak diubah.</p>
    <div className="space-y-2">
     <Label htmlFor="sc-payroll-new-period">Bulan dan Tahun</Label>
     <Input id="sc-payroll-new-period" type="month" value={period} onChange={e=>{setPeriod(e.target.value);setPreview(null);setCreated(null);}}/>
    </div>
    <div className="rounded-md border p-3 text-sm space-y-1">
     <p className="font-medium">Aturan tab baru</p>
     <p>Nama karyawan, rekening, format, dan rumus tetap mengikuti template.</p>
     <p>Seluruh isi kolom, nominal, rumus, format, nama dan rekening disalin dari tab bulan sebelumnya. Tidak ada angka yang otomatis dikosongkan.</p>
     <p className="text-muted-foreground">Tab ini terpisah dari Kasbon POOL. Pembuatan tab tidak otomatis mengubah target tombol Sync Total Kasbon yang saat ini masih Gaji November 2026.</p>
    </div>
    {preview&&<div className="rounded-md border p-3 text-sm space-y-1">
     <p>Template: <strong>{preview.sourceTitle}</strong></p>
     <p>Tab baru: <strong>{preview.targetTitle}</strong></p>
     <p>Karyawan: <strong>{preview.employeeCount}</strong></p>
     <p>Semua data template ikut disalin; <strong>tidak ada kolom nominal yang dikosongkan</strong>.</p>
     <p>Rumus yang dipertahankan: <strong>{preview.retainedFormulas}</strong></p>
     {!preview.writeEnabled&&<p className="text-amber-700">Pratinjau tersedia. Pembuatan tab belum diaktifkan pada server.</p>}
    </div>}
    {created&&<div className="rounded-md border p-3 text-sm space-y-2" role="status">
      <p><strong>{created.targetTitle}</strong> berhasil dibuat dan diverifikasi.</p>
      <a href={created.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">Buka tab Google Sheets <ExternalLink className="h-3 w-3"/></a>
    </div>}
    {period==="2026-12"&&<div className="rounded-md border p-3 text-sm space-y-2">
     <p className="font-medium">Perbaiki tab Desember yang sudah dibuat</p>
     <p className="text-muted-foreground">Pulihkan hanya sel kosong dari November. Sel yang sudah diedit tidak ditimpa. Jika ada perbedaan pada sel terisi, proses ditolak.</p>
     {repairPreview&&<p role="status">Sel kosong yang dapat dipulihkan: <strong>{repairPreview.missingCells}</strong> · Karyawan: {repairPreview.employeeCount}. Contoh: {repairPreview.sampleCells.join(", ")||"Tidak ada"}.</p>}
     {repairDone&&<p role="status" className="text-green-700">{repairDone}</p>}
     <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={()=>void restorePreview()}>Pratinjau Pemulihan Desember</Button>
      <Button type="button" disabled={busy||!repairPreview?.writeEnabled} onClick={()=>void restore()}>Pulihkan Data Desember</Button>
     </div>
    </div>}
    <div className="flex justify-end gap-2 flex-wrap">
     <Button type="button" variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Tutup</Button>
     <Button type="button" variant="outline" disabled={busy||!period} onClick={()=>void check()}>{busy?"Memeriksa...":"Pratinjau Tab"}</Button>
     <Button type="button" disabled={busy||!preview?.writeEnabled||preview.period!==period} onClick={()=>void create()}>{busy?"Memproses...":"Buat Tab Gaji"}</Button>
    </div>
   </DialogContent>
  </Dialog>
 </>;
}
