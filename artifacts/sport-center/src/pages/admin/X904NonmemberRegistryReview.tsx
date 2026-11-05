import { useState } from "react";
import { getToken } from "@/lib/auth";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
interface Candidate {
  user_pin: string;
  display_name: string;
  device_uid: number;
  verification_state: string;
  mapping_count: number;
  duplicate_name_count: number;
  membership_name_count: number;
  live_grants: number;
  pending_commands: number;
}
export default function X904NonmemberRegistryReview() {
  const [open,setOpen] = useState(false);
  const [rows,setRows] = useState<Candidate[]>([]);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  const [busyPin,setBusyPin] = useState("");
  const [notice,setNotice] = useState("");
  const [search,setSearch] = useState("");
  async function reload() {
    const token=getToken();
    if (!token) {setError("Sesi admin tidak tersedia.");return;}
    setLoading(true);setError("");
    try {
      const r=await fetch(API+"/admin/gym-x904/nonmember-registry-review",{
        headers:{Authorization:"Bearer "+token},cache:"no-store"
      });
      const data=await r.json();
      if(!r.ok)throw new Error(data.error??"Daftar verifikasi tidak tersedia.");
      setRows(Array.isArray(data.candidates)?data.candidates:[]);
    }catch(e){setError(e instanceof Error?e.message:"Gagal mengambil registry");}
    finally{setLoading(false);}
  }
  async function verify(row:Candidate) {
    if (busyPin) return;
    if (!window.confirm("Konfirmasi secara independen bahwa PIN "+row.user_pin+
      " ("+row.display_name+", UID "+row.device_uid+
      ") benar-benar NONMEMBER biasa, bukan member, staf, kartu VIS, akun khusus, atau identitas ganda?\n\n"+
      "Setelah disetujui, worker dapat melakukan suspend otomatis bila tidak ada akses berbayar aktif."))return;
    const typed=window.prompt("Ketik ulang PIN "+row.user_pin+" untuk menyetujui identitas nonmember:");
    if(typed!==row.user_pin)return;
    setBusyPin(row.user_pin);setNotice("");setError("");
    try {
      const token=getToken();
      if (!token)throw new Error("Sesi admin tidak tersedia.");
      const response=await fetch(API+"/admin/gym-x904/nonmember-registry-review/verify",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify({pin:row.user_pin,uid:Number(row.device_uid),confirmPin:typed,confirmedNonmember:true})
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"Verifikasi tidak dapat dilakukan.");
      setNotice("PIN "+row.user_pin+" verified. Tidak ada perintah manual dibuat. Worker akan memeriksa hak akses dan snapshot.");
      await reload();
    }catch(e){setError(e instanceof Error?e.message:"Verifikasi gagal");}
    finally{setBusyPin("");}
  }
  const visible=rows.filter(row=>!search.trim() ||
    row.user_pin.includes(search.trim()) ||
    row.display_name.toLocaleLowerCase("id-ID").includes(search.trim().toLocaleLowerCase("id-ID")));
  return <div className="rounded-lg border p-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="font-semibold text-sm">Verifikasi Registry Nonmember</p>
        <p className="text-xs text-muted-foreground">Tidak ada suspend otomatis sebelum verifikasi oleh Owner / Super Admin. Proses ini tidak mengirim perintah mesin secara langsung.</p></div>
      <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={()=>{setOpen(!open);if(!open)void reload();}}>
        {open?"Tutup daftar":"Periksa kandidat nonmember"}</button>
    </div>
    {open && <>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Cari kandidat nonmember" className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Cari nama atau PIN" value={search} onChange={e=>setSearch(e.target.value)}/>
        <button type="button" disabled={loading} onClick={()=>void reload()} className="rounded-lg border px-3 py-2 text-sm">Muat ulang</button>
        <span className="text-xs text-muted-foreground">{rows.length} kandidat menunggu</span>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
      {loading && <p className="text-xs">Memuat identitas...</p>}
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">PIN</th><th className="p-2">Nama</th><th className="p-2">UID</th><th className="p-2">Pemeriksaan</th><th className="p-2">Tindakan</th></tr></thead>
        <tbody>{visible.map(row=>{
          const issues=Number(row.mapping_count)+Number(row.duplicate_name_count)+
            Number(row.membership_name_count)+Number(row.live_grants)+Number(row.pending_commands);
          const blocked=issues>0;
          return <tr key={row.user_pin} className="border-b">
            <td className="p-2">{row.user_pin}</td><td className="p-2">{row.display_name}</td>
            <td className="p-2">{row.device_uid}</td>
            <td className="p-2">{blocked?
              <span className="text-amber-700">Perlu rekonsiliasi{Number(row.duplicate_name_count)>0?" · nama ganda":""}{Number(row.mapping_count)>0?" · mapping member":""}{Number(row.membership_name_count)>0?" · nama member":""}{Number(row.live_grants)>0?" · akses aktif":""}{Number(row.pending_commands)>0?" · perintah berjalan":""}</span>:
              <span className="text-muted-foreground">Data cocok; status nonmember perlu konfirmasi</span>}</td>
            <td className="p-2"><button type="button" disabled={blocked || Boolean(busyPin)}
              className="rounded border px-2 py-1 disabled:opacity-40" onClick={()=>void verify(row)}>
              {busyPin===row.user_pin?"Memeriksa...":"Verifikasi"}</button></td>
          </tr>;
        })}</tbody></table>
      </div>
      <p className="text-xs text-muted-foreground">Nama sama, role khusus, anggota terdaftar, kartu VIS dan akun uji harus ditinjau terpisah. PIN+UID cocok saja bukan bukti nonmember.</p>
    </>}
  </div>;
}
