import {useState} from "react";
import {CalendarPlus} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {useToast} from "@/hooks/use-toast";
import {getToken} from "@/lib/auth";

type CarryMode="zero"|"previous_total";
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
 const [carryMode,setCarryMode]=useState<CarryMode|null>(null);
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
  if(!preview?.writeEnabled||busy||!carryMode)return;
  setBusy(true);
  try{
   const data=await request("/admin/sc-kasbon-periods/create",{period,carryMode});
   setResult("Periode "+data.period+" berhasil dibuat di workbook DEV, verifikasi baca ulang PASS.");
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
    <fieldset className="space-y-2">
     <legend className="text-sm font-medium">Saldo awal bulan baru</legend>
     <label className="flex items-start gap-2 text-sm"><input type="radio" name="sc-carry" checked={carryMode==="previous_total"} onChange={()=>{setCarryMode("previous_total");reset();}}/>
      <span>Bawa total periode sebelumnya ke saldo awal (termasuk kasbon yang belum disesuaikan).</span></label>
     <label className="flex items-start gap-2 text-sm"><input type="radio" name="sc-carry" checked={carryMode==="zero"} onChange={()=>{setCarryMode("zero");reset();}}/>
      <span>Mulai saldo awal Rp0. Kasbon bulan sebelumnya tidak ikut dibawa.</span></label>
    </fieldset>
    {preview&&<div className="rounded-md border p-3 text-sm space-y-1">
      <p>Periode baru: <strong>{preview.period}</strong></p>
      <p>Template: {preview.sourcePeriod} · {preview.employeeCount} baris karyawan</p>
      <p>Posisi baru: baris {preview.destinationStart}–{preview.destinationEnd}</p>
      <p className="text-muted-foreground">{preview.writeEnabled?"Pembuatan pada salinan DEV dapat diuji.":"Pratinjau saja; pembuatan periode masih dibatasi sampai uji DEV PASS."}</p>
     </div>}
    {result&&<p role="status" className="text-sm">{result}</p>}
    <div className="flex flex-wrap justify-end gap-2">
     <Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Tutup</Button>
     <Button variant="outline" disabled={busy||!period||!carryMode} onClick={()=>void runPreview()}>{busy?"Memeriksa...":"Periksa Periode"}</Button>
     <Button disabled={busy||!preview?.writeEnabled||preview.period!==period||preview.carryMode!==carryMode} onClick={()=>void create()}>{busy?"Memproses...":"Buat di DEV"}</Button>
    </div>
   </DialogContent>
  </Dialog>
 </>;
}
