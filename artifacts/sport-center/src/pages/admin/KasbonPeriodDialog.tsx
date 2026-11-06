import {useState} from "react";
import {CalendarPlus} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {useToast} from "@/hooks/use-toast";
import {getToken} from "@/lib/auth";

type CarryMode="febri_andi_only";
type Preview={period:string;sourcePeriod:string;employeeCount:number;
 destinationStart:number;destinationEnd:number;mode:string;writeEnabled:boolean;carryMode:CarryMode};
const base=import.meta.env.VITE_API_BASE_URL??"/api";
async function request(path:string,body:unknown):Promise<any>{
 const response=await fetch(base+path,{method:"POST",
  headers:{Authorization:"Bearer "+getToken(),"Content-Type":"application/json"},
  body:JSON.stringify(body)});
 const json=await response.json();
 if(!response.ok)throw Error(json.error||"Permintaan gagal");
 return json;
}
export default function KasbonPeriodDialog(){
 const {toast}=useToast();
 const [open,setOpen]=useState(false);
 const [period,setPeriod]=useState("2026-12");
 const carryMode:CarryMode="febri_andi_only";
 const [preview,setPreview]=useState<Preview|null>(null);
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState("");
 const reset=()=>{setPreview(null);setResult("");};
 const runPreview=async()=>{
  if(!carryMode)return;
  setBusy(true);reset();
  try {const data=await request("/admin/sc-kasbon-periods/preview",{period,carryMode});setPreview(data);}
  catch(e){toast({title:"Belum bisa membuat periode",description:(e as Error).message,variant:"destructive"});}
  finally{setBusy(false);}
 };
 const create=async()=>{
  if(!preview?.writeEnabled||busy)return;
  setBusy(true);
  try{
   const data=await request("/admin/sc-kasbon-periods/create",{period,carryMode});
   setResult("Periode "+data.period+" dibuat di Google Sheets DEV dan telah dibaca ulang.");
   setPreview(null);
   toast({title:"Periode DEV berhasil dibuat"});
  }catch(e){toast({title:"Pembuatan periode belum berhasil",description:(e as Error).message,variant:"destructive"});}
  finally{setBusy(false);}
 };
 return <>
  <Button variant="outline" onClick={()=>setOpen(true)}><CalendarPlus className="mr-2 h-4 w-4"/>Buat Periode Kasbon</Button>
  <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}>
   <DialogContent className="max-w-lg">
    <DialogHeader><DialogTitle>Buat Periode Kasbon Baru</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">Siapkan bagian bulan berikutnya di tab Kasbon POOL tanpa membuka Google Sheets. Periode baru hanya bisa dibuat setelah pratinjau dan verifikasi struktur aman.</p>
    <div className="space-y-2">
     <Label htmlFor="sc-period-month">Bulan dan Tahun</Label>
     <Input id="sc-period-month" type="month" value={period} onChange={e=>{setPeriod(e.target.value);reset();}}/>
    </div>
    <div className="rounded-md border p-3 text-sm space-y-1">
     <p className="font-medium">Aturan saldo awal otomatis</p>
     <p>Hanya <strong>Kasbon Febri</strong> dan <strong>Kasbon Andi</strong> yang membawa total bulan sebelumnya.</p>
     <p>Seluruh karyawan lain mulai dari <strong>Rp0</strong>, dan kolom tanggal bulan baru kosong.</p>
    </div>
    {preview&&<div className="rounded-md border p-3 text-sm space-y-1">
      <p>Periode baru: <strong>{preview.period}</strong></p>
      <p>Template: {preview.sourcePeriod} · {preview.employeeCount} baris karyawan</p>
      <p>Posisi baru: baris {preview.destinationStart}–{preview.destinationEnd}</p>
      <p className="text-muted-foreground">{preview.writeEnabled?"Tujuan pengujian: Google Sheets DEV saja, bukan PROD.":"Pratinjau saja, penulisan ke DEV belum tersedia."}</p>
     </div>}
    {result&&<p role="status" className="text-sm">{result}</p>}
    <div className="flex flex-wrap justify-end gap-2">
     <Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Tutup</Button>
     <Button variant="outline" disabled={busy||!period} onClick={()=>void runPreview()}>{busy?"Memeriksa...":"Periksa Periode"}</Button>
     <Button disabled={busy||!preview?.writeEnabled||preview.period!==period||preview.carryMode!==carryMode} onClick={()=>void create()}>{busy?"Memproses...":"Buat di Sheets DEV"}</Button>
    </div>
   </DialogContent>
  </Dialog>
 </>;
}
