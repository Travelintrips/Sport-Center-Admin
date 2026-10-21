import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";

const API=import.meta.env.VITE_API_BASE_URL ?? "/api";
const SERIAL="TDBD234200545";
type Action="CREATE_USER"|"UPDATE_USER"|"DELETE_USER";
type DeviceUser={user_pin:string;display_name:string;device_uid:number;device_role:number;last_seen_at:string};
type Capabilities={allowed:boolean;enabled:boolean;deviceSerial:string;operations:Action[]};
type Receipt={command:{command_id:string;state:string;created_at:string;completed_at:string|null;result:Record<string,unknown>|null}};
async function request(path:string,options?:RequestInit){
  const token=getToken();
  if(!token)throw new Error("Sesi administrator tidak tersedia");
  const response=await fetch(`${API}${path}`,{...options,cache:"no-store",
    headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json",...options?.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}
export default function GymX904UserControl({users,initialSelection}:{users:DeviceUser[];initialSelection?:{user:DeviceUser;action:"UPDATE_USER"|"DELETE_USER"}}){
  const queryClient=useQueryClient();
  const [action,setAction]=useState<Action>(initialSelection?.action ?? "CREATE_USER");
  const [pin,setPin]=useState(initialSelection?.user.user_pin ?? "");
  const [name,setName]=useState(initialSelection?.user.display_name ?? "");
  const [confirmPin,setConfirmPin]=useState("");
  const [busy,setBusy]=useState(false);
  const [commandId,setCommandId]=useState<string|null>(null);
  const [message,setMessage]=useState("");
  const {data:capabilities}=useQuery<Capabilities>({
    queryKey:["gym-x904-user-capabilities"],
    queryFn:()=>request("/admin/gym-x904/user-command/capabilities"),
    retry:false,
    staleTime:30000
  });
  const {data:receipt}=useQuery<Receipt>({
    queryKey:["gym-x904-user-command",commandId],
    queryFn:()=>request(`/admin/gym-x904/user-command/${commandId}`),
    enabled:!!commandId,
    refetchInterval:(q)=>["completed","failed","cancelled"].includes(q.state.data?.command.state ?? "")?false:4000,
    retry:false
  });
  useEffect(()=>{ if(receipt?.command.state==="completed") void queryClient.invalidateQueries({queryKey:["gym-x904-lan-users"]}); },[receipt?.command.state,queryClient]);
  if(!capabilities?.allowed)return null;
  if(!capabilities.enabled)return <section className="rounded-xl border bg-card p-5 space-y-2">
    <h3 className="font-semibold">Pengelolaan pengguna X904</h3>
    <p className="text-sm text-muted-foreground">Kontrol tulis perangkat belum diaktifkan. Daftar pengguna tetap dapat dibaca tanpa perubahan.</p>
  </section>;
  const chosen=users.find(u=>u.user_pin===pin);
  const isExisting=action!=="CREATE_USER";
  const protectedUser=isExisting&&chosen?.device_role!==0;
  const validPin=/^[0-9]{1,8}$/.test(pin);
  const validName=/^[A-Za-z0-9 ._-]{2,24}$/.test(name.trim());
  const permitted=validPin&&confirmPin===pin&&!protectedUser&&
    (isExisting ? !!chosen&&Number.isInteger(chosen.device_uid)&&
      (action==="DELETE_USER"||validName) : !chosen&&validName);
  async function submit(){
    if(busy||!permitted)return;
    const subject=isExisting?chosen:undefined;
    if(action==="DELETE_USER"&&!window.confirm(`Hapus PIN ${pin} (${subject?.display_name}) dari X904? Riwayat absensi tetap ada.`))return;
    setBusy(true);setMessage("");setCommandId(null);
    try{
      const body={
        commandType:action,userPin:pin,expectedSerial:SERIAL,confirmPin,
        idempotencyKey:crypto.randomUUID().replace(/-/g,""),
        ...(action==="DELETE_USER"?{}:{name:name.trim()}),
        ...(isExisting?{expectedUid:subject!.device_uid,expectedName:subject!.display_name}:{})
      };
      const result=await request("/admin/gym-x904/user-command",{method:"POST",body:JSON.stringify(body)});
      setCommandId(result.command_id);
      setMessage("Perintah diterima antrean. Menunggu pembacaan ulang dan ACK dari X904; belum berarti berhasil.");
    }catch(e){setMessage(e instanceof Error?e.message:"Perintah gagal");}
    finally{setBusy(false);}
  }
  return <section className="rounded-xl border bg-card p-5 space-y-3" aria-label="Kontrol pengguna X904">
    <h3 className="font-semibold">Kelola pengguna mesin X904</h3>
    <p className="text-sm text-muted-foreground">Hanya Owner / Super Admin. Operasi berlaku untuk akun mesin, bukan pembayaran, membership, atau histori absensi.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Operasi
        <select value={action} onChange={e=>{setAction(e.target.value as Action);setPin("");setConfirmPin("");setName("");setCommandId(null);}}
          className="mt-1 block w-full rounded-md border bg-background p-2">
          <option value="CREATE_USER">Tambah</option><option value="UPDATE_USER">Ubah nama</option><option value="DELETE_USER">Hapus</option>
        </select>
      </label>
      {isExisting?<label className="text-sm">Pengguna mesin
        <select value={pin} onChange={e=>{const v=e.target.value;setPin(v);setConfirmPin("");setName(users.find(u=>u.user_pin===v)?.display_name??"");}}
          className="mt-1 block w-full rounded-md border bg-background p-2">
          <option value="">Pilih akun mesin...</option>
          {users.map(u=><option key={u.user_pin} value={u.user_pin}>{u.user_pin} — {u.display_name} (UID {u.device_uid})</option>)}
        </select>
      </label>:<label className="text-sm">PIN baru
        <input value={pin} onChange={e=>setPin(e.target.value)} maxLength={8} inputMode="numeric" placeholder="1–8 digit"
          className="mt-1 block w-full rounded-md border bg-background p-2"/>
      </label>}
      {action!=="DELETE_USER"&&<label className="text-sm">Nama pada mesin (ASCII, maks 24)
        <input value={name} onChange={e=>setName(e.target.value)} maxLength={24} placeholder="Nama pengguna"
          className="mt-1 block w-full rounded-md border bg-background p-2"/>
      </label>}
      <label className="text-sm">Ketik ulang PIN untuk konfirmasi
        <input value={confirmPin} onChange={e=>setConfirmPin(e.target.value)} maxLength={8}
          className="mt-1 block w-full rounded-md border bg-background p-2"/>
      </label>
    </div>
    {protectedUser&&<p role="alert" className="text-sm text-destructive">Akun dengan hak administrator perangkat dilindungi dari perubahan otomatis.</p>}
    {action==="CREATE_USER"&&!!chosen&&<p role="alert" className="text-sm text-destructive">PIN sudah terdaftar pada perangkat.</p>}
    <button type="button" disabled={!permitted||busy} onClick={()=>void submit()}
      className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">
      {busy?"Mengirim...":action==="CREATE_USER"?"Tambah pengguna":action==="UPDATE_USER"?"Simpan perubahan":"Hapus pengguna"}
    </button>
    {message&&<p role="status" className="text-sm">{message}</p>}
    {receipt?.command&&<p role="status" className="text-sm">
      Perintah {receipt.command.command_id.slice(0,8)}: <strong>{receipt.command.state}</strong>.
      {receipt.command.state==="completed"?" Pembacaan ulang pada mesin berhasil.":receipt.command.state==="failed"?" Eksekusi gagal dan tidak akan diulang otomatis.":""}
    </p>}
  </section>;
}
