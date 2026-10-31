import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";

const API=import.meta.env.VITE_API_BASE_URL ?? "/api";
const SERIAL="TDBD234200545";
type Action="CREATE_USER"|"UPDATE_USER"|"DELETE_USER";
type DeviceUser={user_pin:string;display_name:string;device_uid:number;device_role:number;last_seen_at:string};
type Capabilities={allowed:boolean;enabled:boolean;deviceSerial:string;operations:Action[];durableBulkEnabled?:boolean};
type BatchHistory={batches:Array<{batchId:string;createdAt:string;commands:Array<{userPin:string;name:string;uid:string;order:number;state:string;result:unknown}>}>};
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
  const [action,setAction]=useState<Action>("UPDATE_USER");
  const [pin,setPin]=useState(initialSelection?.user.user_pin ?? "");
  const [name,setName]=useState(initialSelection?.user.display_name ?? "");
  const [confirmPin,setConfirmPin]=useState("");
  const [busy,setBusy]=useState(false);
  const [bulkPins,setBulkPins]=useState<string[]>(initialSelection?.action==="DELETE_USER" && initialSelection.user.device_role===0 ? [initialSelection.user.user_pin] : []);
  const [bulkResults,setBulkResults]=useState<string[]>([]);
  const [bulkSearch,setBulkSearch]=useState("");
  const [bulkConfirm,setBulkConfirm]=useState(false);
  const [bulkProgress,setBulkProgress]=useState<Record<string,string>>({});
  const [bulkRunning,setBulkRunning]=useState(false);
  const [commandId,setCommandId]=useState<string|null>(null);
  const [message,setMessage]=useState("");
  const {data:capabilities}=useQuery<Capabilities>({
    queryKey:["gym-x904-user-capabilities"],
    queryFn:()=>request("/admin/gym-x904/user-command/capabilities"),
    retry:false,
    staleTime:30000
  });
  const {data:batchHistory}=useQuery<BatchHistory>({
    queryKey:["gym-x904-delete-batches"],
    queryFn:()=>request("/admin/gym-x904/delete-batches"),
    enabled:capabilities?.allowed===true,
    refetchInterval:capabilities?.durableBulkEnabled===true?5000:false,
    retry:false
  });
  const {data:receipt}=useQuery<Receipt>({
    queryKey:["gym-x904-user-command",commandId],
    queryFn:()=>request(`/admin/gym-x904/user-command/${commandId}`),
    enabled:!!commandId,
    refetchInterval:(q)=>["completed","failed","cancelled"].includes(q.state.data?.command.state ?? "")?false:4000,
    retry:false
  });
  useEffect(()=>{ if(receipt?.command.state==="completed") { setMessage("Perubahan pengguna berhasil dikonfirmasi oleh mesin X904."); void queryClient.invalidateQueries({queryKey:["gym-x904-lan-users"]}); } },[receipt?.command.state,queryClient]);
  if(!capabilities?.allowed)return null;
  if(!capabilities.enabled)return <section className="rounded-xl border bg-card p-5 space-y-2">
    <h3 className="font-semibold">Pengelolaan pengguna X904</h3>
    <p className="text-sm text-muted-foreground">Kontrol tulis perangkat belum diaktifkan. Daftar pengguna tetap dapat dibaca tanpa perubahan.</p>
  </section>;
  const chosen=users.find(u=>u.user_pin===pin);
  // Individual deletion is intentionally unavailable in the UI. Use the durable batch flow, even for one user.
  const isExisting=action!=="CREATE_USER";
  const protectedUser=isExisting&&chosen?.device_role!==0;
  const validPin=/^[0-9]{1,8}$/.test(pin);
  const validName=/^[A-Za-z0-9 ._-]{2,24}$/.test(name.trim());
  const permitted=action!=="DELETE_USER"&&capabilities.operations.includes(action)&&validPin&&confirmPin===pin&&!protectedUser&&
    (isExisting ? !!chosen&&Number.isInteger(chosen.device_uid)&&
      validName : !chosen&&validName);
  const eligibleUsers=users.filter(u=>u.device_role===0 && /^[0-9]{1,8}$/.test(u.user_pin) && Number.isInteger(u.device_uid));
  const filteredUsers=eligibleUsers.filter(u=>(u.user_pin+" "+u.display_name).toLowerCase().includes(bulkSearch.trim().toLowerCase()));
  const selectedUsers=bulkPins.map(p=>eligibleUsers.find(u=>u.user_pin===p)).filter((u):u is DeviceUser=>!!u);
  const filteredSelected=filteredUsers.filter(u=>bulkPins.includes(u.user_pin));
  const bulkReady=capabilities.durableBulkEnabled===true && capabilities.operations.includes("DELETE_USER") && !busy && !bulkRunning && selectedUsers.length>0 && selectedUsers.length===bulkPins.length;
  async function submitBulk(){
    if(!bulkReady)return;
    const targets=selectedUsers.map(u=>({userPin:u.user_pin,expectedUid:u.device_uid,expectedName:u.display_name}));
    if(targets.length!==bulkPins.length)return;
    setBulkConfirm(false);setBulkRunning(true);setBulkResults([]);
    try{
      // Retain the same request key if a network timeout occurs after DB commit.
      // Only the idempotency key and PIN/UID fingerprint are stored, never names or biometrics.
      const fingerprint=targets.map(t=>t.userPin+":"+t.expectedUid).join("|");
      const storageKey="x904-pending-bulk-submit";
      let idempotencyKey=crypto.randomUUID().replace(/-/g,"");
      try {
        const saved=JSON.parse(sessionStorage.getItem(storageKey)??"null");
        if(saved?.fingerprint===fingerprint && typeof saved?.key==="string" &&
          /^[a-zA-Z0-9_-]{16,96}$/.test(saved.key)) idempotencyKey=saved.key;
        else sessionStorage.setItem(storageKey,JSON.stringify({fingerprint,key:idempotencyKey}));
      } catch { /* session storage unavailable: server still enforces unique queued PINs */ }
      const result=await request("/admin/gym-x904/delete-batches",{method:"POST",body:JSON.stringify({
        targets,expectedSerial:SERIAL,idempotencyKey
      })});
      if(!result.batchId)throw new Error("ID pekerjaan tidak diterima");
      try { sessionStorage.removeItem(storageKey); } catch { /* storage disabled */ }
      setBulkResults(["Pekerjaan "+String(result.batchId).slice(0,8)+" tersimpan di server. Anda boleh pindah tab atau menutup browser."]);
      setBulkPins([]);
      await queryClient.invalidateQueries({queryKey:["gym-x904-delete-batches"]});
    }catch(error){
      setBulkResults([error instanceof Error?error.message:"Gagal menyimpan antrean"]);
    }finally{setBulkRunning(false);}
  }
  async function submit(){
    if(busy||bulkRunning||!permitted)return;
    const subject=isExisting?chosen:undefined;
    setBusy(true);setMessage("");
    try{
      const body={
        commandType:action,userPin:pin,expectedSerial:SERIAL,confirmPin,
        idempotencyKey:crypto.randomUUID().replace(/-/g,""),
        name:name.trim(),
        ...(isExisting?{expectedUid:subject!.device_uid,expectedName:subject!.display_name}:{})
      };
      const result=await request("/admin/gym-x904/user-command",{method:"POST",body:JSON.stringify(body)});
      setCommandId(result.command_id);
      setMessage("Perintah diterima antrean. Menunggu konfirmasi dari X904.");
    }catch(e){setMessage(e instanceof Error?e.message:"Perintah gagal");}
    finally{setBusy(false);}
  }
  return <section className="rounded-xl border bg-card p-5 space-y-3" aria-label="Kontrol pengguna X904">
    <h3 id="x904-edit-user" className="font-semibold scroll-mt-20">Kelola pengguna mesin X904</h3>
    <p className="text-sm text-muted-foreground">Hanya Owner / Super Admin. Operasi berlaku untuk akun mesin, bukan pembayaran, membership, atau histori absensi.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Operasi
        <select value={action} onChange={e=>{setAction(e.target.value as Action);setPin("");setConfirmPin("");setName("");setCommandId(null);}}
          className="mt-1 block w-full rounded-md border bg-background p-2">
          {capabilities.operations.includes("CREATE_USER")&&<option value="CREATE_USER">Tambah</option>}{capabilities.operations.includes("UPDATE_USER")&&<option value="UPDATE_USER">Ubah nama</option>}<option value="DELETE_USER" disabled hidden>Gunakan hapus beberapa pengguna</option>
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
    <button type="button" disabled={!permitted||busy||bulkRunning} onClick={()=>void submit()}
      className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${permitted&&!busy&&!bulkRunning?"bg-blue-600 text-white border-blue-600 hover:bg-blue-700":"bg-gray-100 text-gray-500 border-gray-200"} disabled:opacity-50`}>
      {busy?"Mengirim...":action==="CREATE_USER"?"Tambah pengguna":action==="UPDATE_USER"?"Simpan perubahan":"Hapus pengguna"}
    </button>

    {capabilities.operations.includes("DELETE_USER")&&<div id="x904-delete-users" className="rounded-xl border p-4 space-y-4 scroll-mt-20">
      <div>
        <h4 className="text-sm font-semibold">Hapus pengguna (satu atau beberapa)</h4>
        <p className="text-xs text-muted-foreground">Pilih satu atau beberapa pengguna, lalu konfirmasi. Semua penghapusan menggunakan antrean massal terverifikasi dan berhenti jika ACK gagal atau belum diterima.</p>
      </div>
      <label className="block text-sm font-medium">Cari nama atau PIN
        <input type="search" value={bulkSearch} disabled={busy||bulkRunning} onChange={e=>setBulkSearch(e.target.value)}
          placeholder="Contoh: EKO atau 45" className="mt-1 block w-full rounded-lg border bg-background px-3 py-2 text-sm"/>
      </label>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{filteredUsers.length} dari {eligibleUsers.length} pengguna biasa</span>
        {bulkSearch&&<button type="button" className="underline" disabled={busy||bulkRunning} onClick={()=>setBulkSearch("")}>Bersihkan pencarian</button>}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={busy||bulkRunning||filteredUsers.length===0}
          checked={filteredUsers.length>0&&filteredSelected.length===filteredUsers.length}
          onChange={e=>{const visible=new Set(filteredUsers.map(u=>u.user_pin));setBulkPins(prev=>e.target.checked?[...new Set([...prev,...visible])]:prev.filter(p=>!visible.has(p)));setBulkProgress({});setBulkResults([]);}}/>
        Pilih semua hasil pencarian ({filteredUsers.length})
      </label>
      <div className="max-h-52 overflow-y-auto rounded-lg border p-3 grid gap-2 sm:grid-cols-2" aria-label="Daftar pengguna biasa">
        {filteredUsers.length===0&&<p className="text-sm text-muted-foreground">Tidak ada pengguna yang cocok.</p>}
        {filteredUsers.map(u=><label key={u.user_pin} className="flex items-center gap-2 rounded-md p-1 text-sm hover:bg-muted/50">
          <input type="checkbox" disabled={busy||bulkRunning} checked={bulkPins.includes(u.user_pin)}
            onChange={e=>{setBulkPins(prev=>e.target.checked?[...prev,u.user_pin]:prev.filter(p=>p!==u.user_pin));setBulkProgress({});setBulkResults([]);}}/>
          <span className="font-medium">{u.display_name}</span><span className="text-muted-foreground">PIN {u.user_pin}</span>
        </label>)}
      </div>
      <div className="rounded-lg border bg-muted/20 p-3 space-y-2" aria-label="Daftar pengguna yang akan dihapus">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-sm font-semibold">Pengguna yang akan dihapus ({selectedUsers.length})</h5>
          {selectedUsers.length>0&&!bulkRunning&&<button type="button" className="text-xs underline" onClick={()=>{setBulkPins([]);setBulkProgress({});setBulkResults([]);}}>Kosongkan pilihan</button>}
        </div>
        {selectedUsers.length===0?<p className="text-xs text-muted-foreground">Belum ada pengguna dipilih.</p>:
          <ul className="space-y-1.5">{selectedUsers.map(u=><li key={u.user_pin} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm">
            <span><strong>{u.display_name}</strong> · PIN {u.user_pin} <span className="text-xs text-muted-foreground">(UID {u.device_uid})</span></span>
            <span className="flex items-center gap-2">
              {bulkProgress[u.user_pin]&&<span className="text-xs text-muted-foreground">{bulkProgress[u.user_pin]}</span>}
              {!bulkRunning&&<button type="button" aria-label={"Batalkan pilihan PIN "+u.user_pin} className="rounded px-1 text-muted-foreground hover:text-destructive" onClick={()=>{setBulkPins(prev=>prev.filter(p=>p!==u.user_pin));setBulkProgress({});setBulkResults([]);}}>×</button>}
            </span>
          </li>)}</ul>}
      </div>
      <button type="button" disabled={!bulkReady} onClick={()=>setBulkConfirm(true)}
        className={"rounded-lg border px-4 py-2 text-sm font-semibold "+(bulkReady?"bg-blue-600 border-blue-600 text-white hover:bg-blue-700":"bg-gray-100 border-gray-200 text-gray-500")}>
        {bulkRunning?"Menyimpan antrean...":"Tinjau penghapusan "+selectedUsers.length+" pengguna"}
      </button>
      {bulkResults.length>0&&<div role="status" aria-live="polite" className="text-xs space-y-1">{bulkResults.map((line,i)=><p key={i}>{line}</p>)}</div>}
      {capabilities.durableBulkEnabled!==true&&<p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Penghapusan massal berbasis server belum diaktifkan. Jangan gunakan antrean browser lama; tunggu verifikasi worker VMSC dan ACK.</p>}
      {!!batchHistory?.batches?.length&&<div className="rounded-lg border p-3 space-y-3" aria-label="Riwayat pekerjaan penghapusan">
        <h5 className="text-sm font-semibold">Pekerjaan penghapusan tersimpan di server</h5>
        <p className="text-xs text-muted-foreground">Status dapat diperiksa kembali meskipun browser ditutup. Berhasil hanya jika ACK mesin terverifikasi.</p>
        {batchHistory?.batches?.map(b=><div key={b.batchId} className="rounded-md border p-3 space-y-1.5 text-xs">
          <p className="font-semibold">Pekerjaan {b.batchId.slice(0,8)} · {b.commands.length} pengguna</p>
          {b.commands.map(c=><div key={c.userPin} className="flex flex-wrap justify-between gap-2">
            <span>{c.name} · PIN {c.userPin}</span>
            <span className={c.state==="completed"?"text-green-700":c.state==="failed"||c.state==="cancelled"||c.state==="needs_review"?"text-red-600":"text-muted-foreground"}>
              {c.state==="completed"?"Berhasil (ACK)":c.state==="claimed"?"Diproses":c.state==="queued"&&b.commands.some(x=>x.state==="failed"||x.state==="cancelled"||x.state==="needs_review")?"Dihentikan · tidak dikirim":c.state==="queued"?"Menunggu":c.state==="failed"?"Gagal · berhenti":c.state==="needs_review"?"ACK kedaluwarsa · perlu pemeriksaan":"Dibatalkan"}
            </span>
          </div>)}
          {b.commands.some(c=>c.state==="failed"||c.state==="cancelled"||c.state==="needs_review")&&<p role="alert" className="text-red-600">Pekerjaan berhenti; periksa hasil sebelum mengirim ulang.</p>}
        </div>)}
      </div>}
      {bulkConfirm&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="x904-bulk-confirm-title" className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-xl space-y-4">
          <h4 id="x904-bulk-confirm-title" className="font-semibold">Konfirmasi penghapusan pengguna X904</h4>
          <p className="text-sm">Pastikan nama dan PIN benar. Menghapus akun mesin dapat menghilangkan sidik jari dan wajah yang terdaftar. Riwayat absensi database tidak ikut dihapus.</p>
          <ul className="max-h-52 overflow-y-auto space-y-2 text-sm">
            {selectedUsers.map(u=><li key={u.user_pin} className="flex justify-between rounded-md border px-3 py-2"><strong>{u.display_name}</strong><span>PIN {u.user_pin} · UID {u.device_uid}</span></li>)}
          </ul>
          <p className="text-xs text-muted-foreground">Perintah berjalan satu per satu dan berhenti jika ACK tidak diterima. Anda boleh berpindah tab atau menutup browser setelah pekerjaan berhasil disimpan di server.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={()=>setBulkConfirm(false)}>Kembali</button>
            <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!bulkReady} onClick={()=>void submitBulk()}>Ya, hapus {selectedUsers.length} pengguna</button>
          </div>
        </div>
      </div>}
    </div>}
    {message&&<p role="status" className="text-sm">{message}</p>}
    {receipt?.command&&<p role="status" className="text-sm">
      Perintah {receipt.command.command_id.slice(0,8)}: <strong>{receipt.command.state}</strong>.
      {receipt.command.state==="completed"?" Pembacaan ulang pada mesin berhasil.":receipt.command.state==="failed"?" Eksekusi gagal dan tidak akan diulang otomatis.":""}
    </p>}
  </section>;
}
