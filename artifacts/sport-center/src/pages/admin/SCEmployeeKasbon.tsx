import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, ExternalLink, Trash2, RefreshCw, CheckCircle2, LockKeyhole, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { formatKasbonAmount, normalizeKasbonAmount, fromDatabaseKasbonAmount } from "./kasbonAmount";
import { calculateSisaGaji } from "./kasbonSalaryBalance";

export type Employee = { employeeId: string; fullName: string; salary: string | null };
type Kasbon = { id: number; employeeId: string; kasbonDate: string; amount: string; notes: string; proofUrl: string | null };
type Form = { kasbonDate: string; amount: string; notes: string; proofUrl: string | null };
const blank = (): Form => ({kasbonDate: new Date().toLocaleDateString("en-CA"),amount:"",notes:"",proofUrl:null});
const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const endpoint = (id: string) => "/admin/sc-employees/" + encodeURIComponent(id) + "/kasbon";
async function api(path: string,method="GET",body?: unknown,actionGrant?:string): Promise<any> {
 const res = await fetch(API + path,{method,headers:{Authorization:"Bearer "+getToken(),"Content-Type":"application/json",...(actionGrant?{"x-sc-kasbon-authorization":actionGrant}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json = await res.json(); if(!res.ok) throw Error(json.error || "Permintaan gagal"); return json;
}
const currency = (value: string | number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value));
export default function SCEmployeeKasbon({employee,onBack}:{employee:Employee;onBack:()=>void}) {
 const {toast}=useToast(), qc=useQueryClient();
 const [open,setOpen]=useState(false), [editing,setEditing]=useState<number|null>(null), [form,setForm]=useState<Form>(blank);
 const [uploading,setUploading]=useState(false);
 const [toDelete,setToDelete]=useState<Kasbon|null>(null);
 const [unlockRecord,setUnlockRecord]=useState<Kasbon|null>(null);
 const [actionPassword,setActionPassword]=useState("");
 const [actionGrant,setActionGrant]=useState<{recordId:number;authorization:string;expiresAt:number}|null>(null);
 const hasActionGrant=(recordId:number)=>actionGrant?.recordId===recordId&&actionGrant.expiresAt>Date.now();
 const [salaryPreview,setSalaryPreview]=useState<{name:string;cell:string;amount:number;previous:string;period:string;tab:string}|null>(null);
 type SalaryCheck={period:string;tab:string;matched:boolean;allSynced:boolean;syncedRecordIds:number[];name:string;cell:string;amount:number;sheetRow:{row:number;number:string;name:string;uangMakan:string;hariKerja:string;persentase:string;totalSalary:string;kasbon:string|number;sisaGaji:string|number}};
 const [salaryCheck,setSalaryCheck]=useState<SalaryCheck|null>(null);
 const [checkOpen,setCheckOpen]=useState(false);
 const [selectedPeriod,setSelectedPeriod]=useState(()=>{const d=new Date();const value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");return value<"2026-10"?"2026-10":value;});
 const [showAllMonths,setShowAllMonths]=useState(false);
 const monthLabel=new Date(selectedPeriod+"-01T12:00:00").toLocaleDateString("id-ID",{month:"long",year:"numeric"});
 const monthRecords=(records:Kasbon[])=>records.filter(r=>r.kasbonDate.slice(0,7)===selectedPeriod);

 const key=["admin-sc-employee-kasbon",employee.employeeId];
 const {data:records=[],isLoading,isError,error}=useQuery<Kasbon[]>({queryKey:key,queryFn:()=>api(endpoint(employee.employeeId))});
 const monthlyRecords=monthRecords(records);
 const visibleRecords=showAllMonths?records:monthlyRecords;
 const syncKey=["admin-sc-kasbon-salary-check",employee.employeeId,selectedPeriod,monthlyRecords.map(r=>r.id+":"+r.amount).join("|")];
 const {data:initialSalaryCheck,isFetching:isSalaryChecking,isError:isSalaryCheckError,error:salaryCheckLoadError}=useQuery<SalaryCheck>({
  queryKey:syncKey,
  queryFn:()=>api(endpoint(employee.employeeId)+"/salary-sync","POST",{action:"preview",period:selectedPeriod}),
  enabled:!showAllMonths&&!isLoading&&!isError,
  staleTime:0,
  refetchOnWindowFocus:true,
  retry:false,
 });
 const sisaGaji = useMemo(() => calculateSisaGaji(employee.salary, records), [employee.salary, records]);
 const totalKasbon = monthlyRecords.reduce((sum,record) => sum + Number(record.amount), 0);
 const syncEvidence=showAllMonths?null:(initialSalaryCheck??salaryCheck);
 const isSalarySynced=Boolean(!showAllMonths&&!isSalaryChecking&&!isSalaryCheckError&&syncEvidence?.matched&&syncEvidence?.allSynced && Number(syncEvidence.amount)===totalKasbon);
 // Historical receipt alone cannot prove the current payroll G cell matches.
 const syncedRecordIds=new Set(syncEvidence?.syncedRecordIds??[]);
 const payrollMatches=Boolean(!showAllMonths&&!isSalaryChecking&&!isSalaryCheckError&&syncEvidence?.matched && Number(syncEvidence.amount)===totalKasbon);
 const save=useMutation({
  mutationFn:async(payload:Form)=>{
   const isCreate=editing===null;
   if(!isCreate && (editing===null||!hasActionGrant(editing)))throw Error("Otorisasi Edit Kasbon sudah kedaluwarsa. Buka proteksi kembali.");
   const row=await api(endpoint(employee.employeeId)+(isCreate?"":"/"+editing),isCreate?"POST":"PATCH",payload,isCreate?undefined:actionGrant?.authorization);
   if(!isCreate)return {row,created:false,pool:null};
   // Simpan / Sync only targets the per-transaction Kasbon POOL outbox.
   // Total Kasbon payroll (kolom G) is exclusively updated by Sync Total.
   // Never retry the create request if POOL fails: the KB row already exists.
   const pool=await api(endpoint(employee.employeeId)+"/"+row.id+"/pool-sync","POST",{}).catch((e:Error)=>({status:"needs_review",errorCode:e.message}));
   return {row,created:true,pool};
  },
  retry:false,
  onSuccess:(result)=>{
   setSalaryCheck(null);qc.invalidateQueries({queryKey:syncKey.slice(0,2)});qc.invalidateQueries({queryKey:key});
   setOpen(false);setEditing(null);setForm(blank());setActionGrant(null);
   if(!result.created){
    toast({title:"Kasbon berhasil diperbarui",description:"Data perubahan disimpan. Periksa kebutuhan rekonsiliasi Sheets."});return;
   }
   const poolOk=result.pool?.status==="synced";
   if(poolOk){
    toast({title:"Kasbon tersimpan dan Kasbon POOL tersinkron",description:"KB-"+String(result.row.id).padStart(5,"0")+" · Insert ke Kasbon POOL telah terverifikasi. Gunakan Sync Total secara terpisah untuk laporan gaji."});
   }else{
    toast({title:"Kasbon tersimpan, Sync Kasbon POOL belum berhasil",
     description:"KB-"+String(result.row.id).padStart(5,"0")+" · POOL: "+String(result.pool?.status??"gagal")+" ("+String(result.pool?.errorCode??"-")+"). Sync Total laporan gaji tidak dijalankan.",
     variant:"destructive"});
   }
  },
  onError:(e:Error)=>toast({title:"Gagal menyimpan kasbon",description:e.message,variant:"destructive"})
 });
 const remove = useMutation({
  mutationFn: (record: Kasbon) => {
   if(!hasActionGrant(record.id))throw Error("Otorisasi Hapus Kasbon sudah kedaluwarsa. Buka proteksi kembali.");
   return api(endpoint(employee.employeeId)+"/"+record.id,"DELETE",undefined,actionGrant?.authorization);
  },
  onSuccess: () => {
   setSalaryCheck(null);qc.invalidateQueries({queryKey:syncKey.slice(0,2)});qc.invalidateQueries({queryKey:key});
   setToDelete(null);setActionGrant(null);
   toast({title:"Catatan kasbon berhasil dihapus"});
  },
  onError: (e:Error) => toast({title:"Gagal menghapus kasbon",description:e.message,variant:"destructive"}),
 });

 const unlockAction=useMutation({
  mutationFn:async()=>{
   if(!unlockRecord)throw Error("Catatan kasbon belum dipilih");
   return api(endpoint(employee.employeeId)+"/"+unlockRecord.id+"/unlock","POST",{password:actionPassword});
  },
  retry:false,
  onSuccess:(result:{authorization:string;expiresInSeconds:number})=>{
   if(!unlockRecord)return;
   setActionGrant({recordId:unlockRecord.id,authorization:result.authorization,
    expiresAt:Date.now()+Math.min(90,result.expiresInSeconds)*1000});
   setUnlockRecord(null);setActionPassword("");
   toast({title:"Otorisasi Kasbon berhasil",description:"Edit dan Hapus terbuka sementara hanya untuk catatan yang dipilih."});
  },
  onError:(error:Error)=>{
   setActionPassword("");
   toast({title:"Otorisasi ditolak",description:error.message,variant:"destructive"});
  }
 });
 const checkSalary=useMutation({
  mutationFn:()=>api(endpoint(employee.employeeId)+"/salary-sync","POST",{action:"preview",period:selectedPeriod}),
  onSuccess:(result:SalaryCheck)=>{if(result.period!==selectedPeriod)return;setSalaryCheck(result);qc.setQueryData(syncKey,result);setCheckOpen(true);},
  onError:(e:Error)=>{setSalaryCheck(null);toast({title:e.message==="SALARY_WORKSHEET_NOT_VERIFIED"?"Tab Gaji belum tersedia":"Check Sync gagal",description:e.message,variant:"destructive"});}
 });
 const previewSalary=useMutation({
  mutationFn:()=>api(endpoint(employee.employeeId)+"/salary-sync","POST",{action:"preview",period:selectedPeriod}),
  onSuccess:result=>{if(result.period===selectedPeriod)setSalaryPreview(result);},
  onError:(e:Error)=>toast({title:"Pratinjau Sync gagal",description:e.message,variant:"destructive"})
 });
 const syncSalary=useMutation({
  mutationFn:()=>api(endpoint(employee.employeeId)+"/salary-sync","POST",{action:"sync",period:selectedPeriod}),
  onSuccess:result=>{setSalaryPreview(null);setSalaryCheck(null);setCheckOpen(false);qc.invalidateQueries({queryKey:syncKey.slice(0,2)});toast({title:"Total Kasbon berhasil Sync ke laporan gaji",description:result.cell+" — "+currency(result.amount)});},
  onError:(e:Error)=>{setSalaryPreview(null);setSalaryCheck(null);toast({title:"Sync belum berhasil",description:e.message,variant:"destructive"});}
 });
 const uploadProof=async (file:File)=>{
  if(file.size>10*1024*1024 || !["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type)){toast({title:"Gunakan JPG, PNG, WebP, atau PDF maksimal 10 MB",variant:"destructive"});return;}
  setUploading(true);
  try{
   const data=new FormData();data.append("file",file);
   const res=await fetch(API+"/storage/upload-proof",{method:"POST",headers:{Authorization:"Bearer "+getToken()},body:data});
   const json=await res.json();if(!res.ok)throw Error(json.error||"Upload gagal");
   setForm(v=>({...v,proofUrl:json.url}));toast({title:"Bukti transfer berhasil diunggah"});
  }catch(e){toast({title:"Upload gagal",description:(e as Error).message,variant:"destructive"});}finally{setUploading(false);}
 };
 return <div className="space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex items-start gap-3"><Button variant="outline" size="icon" aria-label="Kembali ke daftar karyawan" onClick={onBack}><ArrowLeft className="h-4 w-4"/></Button>
    <div><h2 className="text-xl font-bold">Histori Kasbon — {employee.fullName}</h2><p className="text-sm text-muted-foreground">ID Karyawan: {employee.employeeId} · Histori pencatatan kasbon</p></div></div>
   <div className="flex flex-wrap gap-2">
    <Button onClick={()=>{setEditing(null);setForm(blank());setOpen(true);}}><Plus className="mr-2 h-4 w-4"/>Tambah Kasbon</Button>
   </div>
  </div>
  <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-background px-4 py-3">
   <div className="space-y-1">
    <Label htmlFor="kasbon-period"><CalendarDays className="mr-1 inline h-4 w-4"/>Bulan Kasbon &amp; Laporan Gaji</Label>
    <Input id="kasbon-period" type="month" min="2026-10" max="2099-12" value={selectedPeriod}
     disabled={checkSalary.isPending||syncSalary.isPending||previewSalary.isPending}
     onChange={e=>{if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)||e.target.value<"2026-10")return;
      setSelectedPeriod(e.target.value);setShowAllMonths(false);setSalaryCheck(null);setSalaryPreview(null);setCheckOpen(false);}}/>
   </div>
   <Button variant={showAllMonths?"default":"outline"} onClick={()=>{setShowAllMonths(v=>!v);setSalaryCheck(null);setSalaryPreview(null);setCheckOpen(false);}}
    disabled={syncSalary.isPending||previewSalary.isPending||checkSalary.isPending}>Semua Bulan</Button>
   <p className="w-full text-xs text-muted-foreground">{showAllMonths?"Menampilkan seluruh riwayat. Pilih satu bulan untuk Check Sync atau Sync Total.":"Tujuan sinkronisasi: GAJI JULI 2025 → Gaji "+monthLabel+" → Kolom G. Transaksi bulan lain tidak ikut."}</p>
  </div>
  <div className="rounded-xl border bg-background px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-semibold">Check Sync Total — Gaji</p><p className="text-xs text-muted-foreground">Periksa Kasbon {monthLabel} pada kolom G tab gaji yang dipilih.</p></div>
      <Button variant="outline" disabled={showAllMonths||checkSalary.isPending||isLoading||isError} onClick={()=>{if(checkOpen){setCheckOpen(false);}else{checkSalary.mutate();}}}>
        <RefreshCw className="mr-2 h-4 w-4"/>{checkSalary.isPending?"Memeriksa...":checkOpen?"Tutup":"Check Sync"}
      </Button>
    </div>
    {isSalaryCheckError&&!showAllMonths&&<p role="alert" className="mt-2 text-xs text-destructive">{(salaryCheckLoadError as Error)?.message==="SALARY_WORKSHEET_NOT_VERIFIED"?"Tab gaji "+monthLabel+" belum tersedia. Buat tab terlebih dahulu dari Data Karyawan SC.":"Gagal memeriksa tab gaji "+monthLabel+". Silakan Check Sync ulang."}</p>}
    {checkOpen&&salaryCheck&&<div className="mt-4 space-y-3">
     <div className="flex flex-wrap items-center gap-2 text-sm"><span>Nama Sheets: <strong>{salaryCheck.name}</strong></span><span>· Sel: <strong>{salaryCheck.cell}</strong></span>
      <span className={salaryCheck.matched?"rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700":"rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700"}>{salaryCheck.matched?"Total cocok dengan Sheets":"Total belum cocok"}</span>
     </div>
     <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr className="border-b">{["No","Nama","Uang Makan","Hari Kerja","Persentase","Total Salary","Kasbon","Sisa Gaji"].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead>
      <tbody><tr>{[salaryCheck.sheetRow.number,salaryCheck.sheetRow.name,salaryCheck.sheetRow.uangMakan,salaryCheck.sheetRow.hariKerja,salaryCheck.sheetRow.persentase,salaryCheck.sheetRow.totalSalary,salaryCheck.sheetRow.kasbon,salaryCheck.sheetRow.sisaGaji].map((v,i)=><td key={i} className="border-b p-2 whitespace-nowrap">{i===6 && Number.isFinite(Number(v))?currency(v):String(v||"—")}</td>)}</tr></tbody></table></div>
    </div>}
  </div>
  <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
   <CardTitle>Histori Kasbon — {showAllMonths?"Semua Bulan":monthLabel} ({visibleRecords.length})</CardTitle>
   <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" disabled={showAllMonths||isSalaryChecking||isSalaryCheckError||checkSalary.isPending||isSalarySynced||isLoading||isError||previewSalary.isPending||syncSalary.isPending||save.isPending||remove.isPending} title={isSalaryChecking||checkSalary.isPending?"Sedang memeriksa laporan gaji; Sync Total belum tersedia":isSalaryCheckError?"Pemeriksaan Sheets gagal; lakukan Check Sync ulang":isSalarySynced?"Seluruh transaksi sudah tersinkron dengan Google Sheets":"Sync total kasbon ke kolom G laporan gaji, bukan ke Kasbon POOL"} onClick={()=>previewSalary.mutate()}>
      {isSalarySynced?<CheckCircle2 className="mr-2 h-4 w-4"/>:<RefreshCw className="mr-2 h-4 w-4"/>}
      {showAllMonths?"Pilih Bulan":isSalaryChecking||checkSalary.isPending||previewSalary.isPending?"Memeriksa Sheets...":isSalarySynced?"Synced":"Sync Total"}
    </Button>
   <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm" aria-label="Total Kasbon">
    <span className="font-medium text-muted-foreground">Total Kasbon {showAllMonths?"":monthLabel}</span>
    <span className="border-l pl-3 text-base font-semibold tabular-nums" aria-live="polite">{isLoading ? "Memuat..." : isError ? "—" : currency(showAllMonths?records.reduce((sum,r)=>sum+Number(r.amount),0):totalKasbon)}</span>
   </div>
   </div>
  </CardHeader><CardContent>
   {isLoading?<p>Memuat histori...</p>:isError?<p role="alert" className="text-destructive">Gagal memuat: {(error as Error).message}</p>:
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">ID Kasbon</th><th className="p-3">Tanggal Kasbon</th>{showAllMonths&&<th className="p-3">Bulan</th>}<th className="p-3">Nominal</th><th className="p-3">Bukti Transfer</th><th className="p-3">Sisa Gaji</th><th className="p-3">Keterangan</th><th className="p-3">Status Sync Total</th><th className="p-3">Tindakan</th></tr></thead><tbody>
    {visibleRecords.map(r=><tr key={r.id} className="border-b"><td className="p-3 font-medium">KB-{String(r.id).padStart(5,"0")}</td><td className="p-3">{r.kasbonDate}</td>{showAllMonths&&<td className="p-3 whitespace-nowrap">{new Date(r.kasbonDate+"T12:00:00").toLocaleDateString("id-ID",{month:"short",year:"numeric"})}</td>}<td className="p-3 font-medium">{currency(r.amount)}</td><td className="p-3">{r.proofUrl?<a className="inline-flex items-center gap-1 text-primary underline" href={r.proofUrl} target="_blank" rel="noopener noreferrer">Lihat bukti <ExternalLink className="h-3 w-3"/></a>:"-"}</td><td className="p-3 whitespace-nowrap font-medium" title="Gaji bulanan dikurangi seluruh kasbon pada bulan yang sama sampai transaksi ini">{sisaGaji.get(r.id) == null ? "—" : currency(sisaGaji.get(r.id)!)}</td><td className="p-3 whitespace-pre-wrap">{r.notes||"-"}</td>
    <td className="p-3">{showAllMonths?<span className="text-xs text-muted-foreground">Pilih bulan untuk cek status</span>:isSalaryChecking?<span className="text-xs text-muted-foreground">Memeriksa Sheets...</span>:payrollMatches&&syncedRecordIds.has(r.id)?<span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700"><CheckCircle2 className="h-3 w-3"/>Synced</span>:syncedRecordIds.has(r.id)?<span className="text-xs font-medium text-amber-700">Perlu Sync Total</span>:<span className="text-xs text-muted-foreground">Belum diverifikasi</span>}</td>
    <td className="p-3"><div className="flex flex-wrap gap-2">
    {hasActionGrant(r.id)?<>
    <Button size="sm" variant="outline" onClick={()=>{setEditing(r.id);setForm({kasbonDate:r.kasbonDate,amount:fromDatabaseKasbonAmount(r.amount),notes:r.notes,proofUrl:r.proofUrl});setOpen(true);}}><Pencil className="mr-1 h-3 w-3"/>Edit</Button>
    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={()=>setToDelete(r)}><Trash2 className="mr-1 h-3 w-3"/>Hapus</Button>
   </>:<Button size="sm" variant="outline" onClick={()=>{setActionGrant(null);setActionPassword("");setUnlockRecord(r);}}><LockKeyhole className="mr-1 h-3 w-3"/>Insert Password</Button>}</div></td></tr>)}
   </tbody></table>{!visibleRecords.length&&<p className="py-6 text-center text-muted-foreground">Belum ada catatan kasbon untuk periode yang dipilih.</p>}</div>}
  </CardContent></Card>
  <Dialog open={salaryPreview!==null} onOpenChange={value=>{if(!value&&!syncSalary.isPending)setSalaryPreview(null);}}>
   <DialogContent className="max-w-md">
    <DialogHeader><DialogTitle>Konfirmasi Sync Total Kasbon</DialogTitle></DialogHeader>
    <div className="space-y-2 text-sm">
     <p>Karyawan: <strong>{employee.fullName}</strong> ({employee.employeeId})</p>
     <p>Nama Google Sheets: <strong>{salaryPreview?.name}</strong></p>
     <p>Tujuan: <strong>{salaryPreview?.tab}</strong> — <strong>{salaryPreview?.cell}</strong> (kolom G)</p>
     <p>Transaksi yang akan dicakup: <strong>{monthlyRecords.length} transaksi kasbon {monthLabel}</strong></p>
     <p>Total Kasbon bulan {monthLabel}: <strong>{currency(salaryPreview?.amount??0)}</strong></p>
     <p className="text-muted-foreground">Sync Total hanya mengganti total kasbon karyawan pada kolom G laporan gaji. Setelah read-back berhasil, setiap transaksi yang tercakup dicatat dalam bukti sinkronisasi. Jika data berubah, jalankan Sync Total kembali.</p>
    </div>
    <div className="flex justify-end gap-2">
     <Button variant="outline" disabled={syncSalary.isPending} onClick={()=>setSalaryPreview(null)}>Batal</Button>
     <Button disabled={!salaryPreview||salaryPreview.period!==selectedPeriod||syncSalary.isPending} onClick={()=>syncSalary.mutate()}>{syncSalary.isPending?"Menyinkronkan...":"Konfirmasi Sync Total"}</Button>
    </div>
   </DialogContent>
  </Dialog>
  <Dialog open={unlockRecord!==null} onOpenChange={value=>{if(!value&&!unlockAction.isPending){setUnlockRecord(null);setActionPassword("");}}}>
   <DialogContent className="max-w-sm">
    <DialogHeader><DialogTitle>Insert Password — Edit / Hapus Kasbon</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">Verifikasi khusus untuk KB-{String(unlockRecord?.id??0).padStart(5,"0")}. Role admin, owner, atau super_admin tidak dapat melewati verifikasi ini.</p>
    {/* This is a second-factor action gate, NOT a login or password-change form.
        Avoid a credential-form submit event, which may prompt browser password
        managers to overwrite the administrator's saved login credentials. */}
    <div className="space-y-3">
     <div className="space-y-1"><Label htmlFor="kasbon-action-password">Password Otorisasi</Label>
      <Input id="kasbon-action-password" name="kasbon-action-authorization-only" type="password"
       autoComplete="off" data-lpignore="true" data-1p-ignore="true"
       minLength={1} maxLength={256} required value={actionPassword}
       onChange={e=>setActionPassword(e.target.value)}
       onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(!unlockAction.isPending&&actionPassword.length>0)unlockAction.mutate();}}}
       placeholder="Masukkan password khusus Kasbon"/></div>
     <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" disabled={unlockAction.isPending} onClick={()=>{setUnlockRecord(null);setActionPassword("");}}>Batal</Button>
      <Button type="button" disabled={unlockAction.isPending||actionPassword.length===0} onClick={()=>unlockAction.mutate()}>{unlockAction.isPending?"Memverifikasi...":"Buka Edit / Hapus"}</Button>
     </div>
    </div>
   </DialogContent>
  </Dialog>
  <Dialog open={toDelete!==null} onOpenChange={value=>{if(!value&&!remove.isPending)setToDelete(null);}}>
   <DialogContent className="max-w-md">
    <DialogHeader><DialogTitle>Hapus catatan kasbon?</DialogTitle></DialogHeader>
    <div className="space-y-2 text-sm">
     <p>Hapus <strong>KB-{String(toDelete?.id??0).padStart(5,"0")}</strong> milik <strong>{employee.fullName}</strong> ({employee.employeeId})?</p>
     <p>Tanggal: {toDelete?.kasbonDate} · Nominal: {toDelete?currency(toDelete.amount):"-"}</p>
     <p className="text-muted-foreground">Catatan ini akan dihapus dari histori. Tindakan dicatat dalam audit log dan tidak dapat dibatalkan.</p>
    </div>
    <div className="flex justify-end gap-2">
     <Button variant="outline" disabled={remove.isPending} onClick={()=>setToDelete(null)}>Batal</Button>
     <Button variant="destructive" disabled={!toDelete||remove.isPending} onClick={()=>{if(toDelete)remove.mutate(toDelete);}}><Trash2 className="mr-2 h-4 w-4"/>{remove.isPending?"Menghapus...":"Ya, Hapus"}</Button>
    </div>
   </DialogContent>
  </Dialog>
  <Dialog open={open} onOpenChange={v=>{if(!save.isPending&&!uploading)setOpen(v);}}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{editing===null?"Tambah Kasbon":"Edit Kasbon"} — {employee.fullName}</DialogTitle></DialogHeader>
   <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate(form);}}>
    <div className="space-y-1"><Label>ID Kasbon</Label><Input readOnly className="bg-muted" value={editing===null?"Otomatis setelah disimpan":"KB-"+String(editing).padStart(5,"0")}/></div>
    <div className="space-y-1"><Label htmlFor="kb-date">Tanggal Kasbon</Label><Input id="kb-date" type="date" required value={form.kasbonDate} onChange={e=>setForm({...form,kasbonDate:e.target.value})}/></div>
    <div className="space-y-1"><Label htmlFor="kb-amount">Nominal (Rp)</Label><Input id="kb-amount" type="text" inputMode="numeric" autoComplete="off" required placeholder="Contoh: 1.000.000" value={formatKasbonAmount(form.amount)} onChange={e=>setForm({...form,amount:normalizeKasbonAmount(e.target.value)})}/></div>
    <div className="space-y-1"><Label htmlFor="kb-notes">Keterangan</Label><Textarea id="kb-notes" maxLength={2000} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>
    <div className="space-y-1"><Label htmlFor="kb-proof">Upload Bukti Transfer (opsional)</Label><Input id="kb-proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={uploading} onChange={e=>{const f=e.target.files?.[0];if(f)void uploadProof(f);}}/><p className="text-xs text-muted-foreground">JPG, PNG, WebP, atau PDF; maksimal 10 MB.</p>{form.proofUrl&&<div className="flex items-center gap-3"><a className="text-sm text-primary underline" href={form.proofUrl} target="_blank" rel="noopener noreferrer">Lihat bukti terunggah</a><Button type="button" size="sm" variant="outline" onClick={()=>setForm({...form,proofUrl:null})}>Hapus lampiran</Button></div>}</div>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Batal</Button><Button type="submit" disabled={save.isPending||uploading||!form.kasbonDate||Number(form.amount)<=0}>{save.isPending?"Menyimpan / Sync...":editing===null?"Simpan / Sync":"Simpan"}</Button></div>
   </form>
  </DialogContent></Dialog>
 </div>;
}
