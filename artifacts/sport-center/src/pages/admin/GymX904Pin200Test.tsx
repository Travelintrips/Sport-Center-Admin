import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {getToken} from "@/lib/auth";

const API=import.meta.env.VITE_API_BASE_URL??"/api";
type Machine={user_pin:string;device_group:number;device_role:number;enabled:boolean;identityMatched:boolean};
type Status={available:boolean;observedAt:string|null;users:Machine[]};
type Receipt={command:{state:string;result?:{readBackConfirmed?:boolean}|null;error_code?:string|null}};
async function api(path:string,options?:RequestInit){
  const token=getToken();
  if(!token)throw Error("Login Owner/Super Admin diperlukan");
  const response=await fetch(API+path,{...options,cache:"no-store",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json",...options?.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(String(body.error??"HTTP "+response.status));
  return body;
}
export default function GymX904Pin200Test(){
  const [reference,setReference]=useState<string|null>(null);
  const [commandId,setCommandId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const {data:cap}=useQuery<{allowed:boolean}>({queryKey:["pin200-admin-cap"],queryFn:()=>api("/admin/gym-x904/user-command/capabilities"),retry:false});
  const {data:status,refetch}=useQuery<Status>({queryKey:["pin200-live-status"],queryFn:()=>api("/admin/gym-x904/live-access-status"),enabled:cap?.allowed===true,refetchInterval:15000,retry:false});
  const {data:receipt}=useQuery<Receipt>({queryKey:["pin200-command-receipt",commandId],queryFn:()=>api("/admin/gym-x904/user-command/"+commandId),enabled:!!commandId,refetchInterval:q=>["completed","failed","cancelled"].includes(q.state.data?.command?.state??"")?false:4000,retry:false});
  if(cap?.allowed!==true)return null;
  const target=status?.users?.find(u=>u.user_pin==="200");
  const age=status?.observedAt?Date.now()-new Date(status.observedAt).getTime():Infinity;
  const verified=status?.available===true&&age>=0&&age<=300000&&target?.identityMatched===true&&target?.device_role===0&&target?.enabled===true;
  const inProgress=!!commandId && !["completed","failed","cancelled"].includes(receipt?.command?.state??"");
  const state=target?.device_group===1?"Aktif (grup 1)":target?.device_group===2?"Ditahan (grup 2)":"Tidak diketahui";
  async function send(action:"ACTIVATE_USER"|"SUSPEND_USER"){
    if(!verified||busy||inProgress)return;
    const label=action==="SUSPEND_USER"?"MENAHAN":"MENGAKTIFKAN";
    if(!window.confirm("Anda akan "+label+" akses mesin KHUSUS PIN 200 / UID 337. Ini simulasi nonfinansial, tanpa pembayaran. Lanjutkan?"))return;
    setBusy(true);setMessage("");
    const key=crypto.randomUUID();
    setReference(key);
    try{
      const result=await api("/admin/gym-x904/pin200-payment-test",{method:"POST",body:JSON.stringify({testReference:key,commandType:action,confirmPin:"200",simulationAccepted:true})});
      const id=String(result.command?.command_id??"");
      if(!id)throw Error("Server tidak memberikan ID perintah");
      setCommandId(id);
      setMessage("Perintah tersimpan. Menunggu pelaksana mesin dan baca-balik SDK.");
    }catch(e){setMessage(e instanceof Error?e.message:"Permintaan gagal");}
    finally{setBusy(false);void refetch();}
  }
  return <section className="rounded-xl border bg-card p-5 space-y-3" aria-label="Pengujian akses X904 PIN 200">
    <h3 className="font-semibold">Pengujian akses X904 — PIN 200 (khusus Owner/Super Admin)</h3>
    <p className="text-sm text-muted-foreground">Uji fisik nonfinansial pada TEST SUSPEND X904 / UID 337 saja. Tidak membuat pembayaran, jurnal, atau sinkronisasi Google Sheets.</p>
    <p className="text-sm">Snapshot mesin: {status?.observedAt?new Date(status.observedAt).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})+" WIB":"Tidak tersedia"} · Status PIN 200: <strong>{state}</strong></p>
    <p className="text-xs text-muted-foreground">Identitas: {target?.identityMatched?"Terverifikasi":"Belum terverifikasi"} · Snapshot: {verified?"Segar":"Belum memenuhi syarat"}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={()=>void refetch()}>Perbarui status mesin</button>
      <button type="button" className="rounded-md bg-amber-700 text-white px-3 py-2 text-sm disabled:opacity-40" disabled={!verified||target?.device_group!==1||busy||inProgress} onClick={()=>void send("SUSPEND_USER")}>Suspend PIN 200</button>
      <button type="button" className="rounded-md bg-emerald-700 text-white px-3 py-2 text-sm disabled:opacity-40" disabled={!verified||target?.device_group!==2||busy||inProgress} onClick={()=>void send("ACTIVATE_USER")}>Pulihkan PIN 200</button>
    </div>
    {message&&<p className="text-sm" role="status">{message}</p>}
    {commandId&&<p className="text-sm">Perintah: {commandId} · Status: {receipt?.command?.state??"Memuat"} · Baca-balik: {receipt?.command?.result?.readBackConfirmed===true?"Terkonfirmasi": "Belum terkonfirmasi"}{receipt?.command?.error_code?" · "+receipt.command.error_code:""}</p>}
    {reference&&<p className="text-xs text-muted-foreground">Referensi pengujian: {reference}</p>}
  </section>;
}
