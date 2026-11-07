import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, ExternalLink, Trash2, RefreshCw } from "lucide-react";
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
async function api(path: string,method="GET",body?: unknown): Promise<any> {
 const res = await fetch(API + path,{method,headers:{Authorization:"Bearer "+getToken(),"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json = await res.json(); if(!res.ok) throw Error(json.error || "Permintaan gagal"); return json;
}
const currency = (value: string | number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value));
export default function SCEmployeeKasbon({employee,onBack}:{employee:Employee;onBack:()=>void}) {
 const {toast}=useToast(), qc=useQueryClient();
 const [open,setOpen]=useState(false), [editing,setEditing]=useState<number|null>(null), [form,setForm]=useState<Form>(blank);
 const [uploading,setUploading]=useState(false);
 const [toDelete,setToDelete]=useState<Kasbon|null>(null);
 const [salaryPreview,setSalaryPreview]=useState<{name:string;cell:string;amount:number;previous:string}|null>(null);
 const key=["admin-sc-employee-kasbon",employee.employeeId];
 const {data:records=[],isLoading,isError,error}=useQuery<Kasbon[]>({queryKey:key,queryFn:()=>api(endpoint(employee.employeeId))});
 const sisaGaji = useMemo(() => calculateSisaGaji(employee.salary, records), [employee.salary, records]);
 const totalKasbon = useMemo(() => records.reduce((sum,record) => sum + Number(record.amount), 0), [records]);
 const save=useMutation({mutationFn:(payload:Form)=>api(endpoint(employee.employeeId)+(editing===null?"":"/"+editing),editing===null?"POST":"PATCH",payload),
  onSuccess:()=>{qc.invalidateQueries({queryKey:key});setOpen(false);setEditing(null);setForm(blank());toast({title:"Kasbon tersimpan di Sport Center",description:"Sinkronisasi Google Sheets diproses terpisah; belum dinyatakan berhasil."});},
  onError:(e:Error)=>toast({title:"Gagal menyimpan",description:e.message,variant:"destructive"})});
 const remove = useMutation({
  mutationFn: (record: Kasbon) => api(endpoint(employee.employeeId)+"/"+record.id,"DELETE"),
  onSuccess: () => {
   qc.invalidateQueries({queryKey:key});
   setToDelete(null);
   toast({title:"Catatan kasbon berhasil dihapus"});
  },
  onError: (e:Error) => toast({title:"Gagal menghapus kasbon",description:e.message,variant:"destructive"}),
 });

 const previewSalary=useMutation({
  mutationFn:()=>api(endpoint(employee.employeeId)+"/salary-sync","POST",{action:"preview"}),
  onSuccess:result=>setSalaryPreview(result),
  onError:(e:Error)=>toast({title:"Pratinjau Sync gagal",description:e.message,variant:"destructive"})
 });
 const syncSalary=useMutation({
  mutationFn:()=>api(endpoint(employee.employeeId)+"/salary-sync","POST",{action:"sync"}),
  onSuccess:result=>{setSalaryPreview(null);toast({title:"Kasbon berhasil Sync ke Google Sheets",description:result.cell+" — "+currency(result.amount)});},
  onError:(e:Error)=>{setSalaryPreview(null);toast({title:"Sync belum berhasil",description:e.message,variant:"destructive"});}
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
    <Button variant="outline" disabled={isLoading||isError||previewSalary.isPending||syncSalary.isPending||save.isPending||remove.isPending} onClick={()=>previewSalary.mutate()}>
      <RefreshCw className="mr-2 h-4 w-4"/>{previewSalary.isPending?"Memeriksa...":"Insert / Sync Sheets"}
    </Button>
    <Button onClick={()=>{setEditing(null);setForm(blank());setOpen(true);}}><Plus className="mr-2 h-4 w-4"/>Tambah Kasbon</Button>
   </div>
  </div>
  <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
   <CardTitle>Histori Kasbon ({records.length})</CardTitle>
   <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm" aria-label="Total Kasbon">
    <span className="font-medium text-muted-foreground">Total Kasbon</span>
    <span className="border-l pl-3 text-base font-semibold tabular-nums" aria-live="polite">{isLoading ? "Memuat..." : isError ? "—" : currency(totalKasbon)}</span>
   </div>
  </CardHeader><CardContent>
   {isLoading?<p>Memuat histori...</p>:isError?<p role="alert" className="text-destructive">Gagal memuat: {(error as Error).message}</p>:
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">ID Kasbon</th><th className="p-3">Tanggal Kasbon</th><th className="p-3">Nominal</th><th className="p-3">Bukti Transfer</th><th className="p-3">Sisa Gaji</th><th className="p-3">Keterangan</th><th className="p-3">Tindakan</th></tr></thead><tbody>
    {records.map(r=><tr key={r.id} className="border-b"><td className="p-3 font-medium">KB-{String(r.id).padStart(5,"0")}</td><td className="p-3">{r.kasbonDate}</td><td className="p-3 font-medium">{currency(r.amount)}</td><td className="p-3">{r.proofUrl?<a className="inline-flex items-center gap-1 text-primary underline" href={r.proofUrl} target="_blank" rel="noopener noreferrer">Lihat bukti <ExternalLink className="h-3 w-3"/></a>:"-"}</td><td className="p-3 whitespace-nowrap font-medium" title="Gaji bulanan dikurangi seluruh kasbon pada bulan yang sama sampai transaksi ini">{sisaGaji.get(r.id) == null ? "—" : currency(sisaGaji.get(r.id)!)}</td><td className="p-3 whitespace-pre-wrap">{r.notes||"-"}</td>
    <td className="p-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>{setEditing(r.id);setForm({kasbonDate:r.kasbonDate,amount:fromDatabaseKasbonAmount(r.amount),notes:r.notes,proofUrl:r.proofUrl});setOpen(true);}}><Pencil className="mr-1 h-3 w-3"/>Edit</Button><Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={()=>setToDelete(r)}><Trash2 className="mr-1 h-3 w-3"/>Hapus</Button></div></td></tr>)}
   </tbody></table>{!records.length&&<p className="py-6 text-center text-muted-foreground">Belum ada catatan kasbon untuk karyawan ini.</p>}</div>}
  </CardContent></Card>
  <Dialog open={salaryPreview!==null} onOpenChange={value=>{if(!value&&!syncSalary.isPending)setSalaryPreview(null);}}>
   <DialogContent className="max-w-md">
    <DialogHeader><DialogTitle>Konfirmasi Insert / Sync Kasbon</DialogTitle></DialogHeader>
    <div className="space-y-2 text-sm">
     <p>Karyawan: <strong>{employee.fullName}</strong> ({employee.employeeId})</p>
     <p>Nama Google Sheets: <strong>{salaryPreview?.name}</strong></p>
     <p>Tujuan: Gaji November 2026 — <strong>{salaryPreview?.cell}</strong> (kolom G)</p>
     <p>Total Kasbon terbaru: <strong>{currency(salaryPreview?.amount??0)}</strong></p>
     <p className="text-muted-foreground">Nilai kolom G sebelumnya akan diganti (bukan dijumlah). Jika baris berubah atau nama tidak cocok, sistem menolak penulisan.</p>
    </div>
    <div className="flex justify-end gap-2">
     <Button variant="outline" disabled={syncSalary.isPending} onClick={()=>setSalaryPreview(null)}>Batal</Button>
     <Button disabled={!salaryPreview||syncSalary.isPending} onClick={()=>syncSalary.mutate()}>{syncSalary.isPending?"Menyinkronkan...":"Konfirmasi Insert / Sync"}</Button>
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
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Batal</Button><Button type="submit" disabled={save.isPending||uploading||!form.kasbonDate||Number(form.amount)<=0}>{save.isPending?"Menyimpan...":"Simpan"}</Button></div>
   </form>
  </DialogContent></Dialog>
 </div>;
}
