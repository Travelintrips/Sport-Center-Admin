import { useState } from "react";
import { Link } from "wouter";

type Result = { status: string; detail: string };
export default function GymX904FaceOffline() {
  const [pin,setPin]=useState("500");
  const [file,setFile]=useState<File|null>(null);
  const [result,setResult]=useState<Result>({status:"BELUM DIPERIKSA",detail:"Foto tetap di perangkat HP Anda."});
  async function validate() {
    const rejected=(reason:string)=>setResult({status:"DITOLAK",detail:reason});
    if(pin!=="500") return rejected("TEST_PIN_ONLY");
    if(!file) return rejected("FILE_MISSING");
    if(file.name!=="verify_biophoto_9_500.jpg") return rejected("FILENAME_MISMATCH");
    if(file.size<100||file.size>50000) return rejected("SIZE_INVALID");
    try {
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217) return rejected("NOT_JPEG");
      const bitmap=await createImageBitmap(file); const dimensions=`${bitmap.width} × ${bitmap.height}`;bitmap.close();
      const digest=await crypto.subtle.digest("SHA-256",bytes);
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      setResult({status:"STAGED_OFFLINE_ONLY",detail:`Dimensi: ${dimensions}\nUkuran: ${file.size} byte\nSHA-256: ${hash}\nTidak disimpan ke server, tidak dikirim ke X904.`});
    } catch { rejected("DECODE_OR_HASH_FAILED"); }
  }
  return <div className="mx-auto max-w-2xl p-4 sm:p-8 space-y-5">
    <div><Link href="/admin/gym-x904" className="text-sm underline">Kembali ke X904</Link><h1 className="text-2xl font-semibold mt-3">Pratinjau Foto Wajah — Offline</h1></div>
    <p role="note" className="rounded-md border border-amber-400 p-3">Belum tersedia pendaftaran wajah ke mesin X904. Ini hanya validasi lokal di HP, khusus gambar uji PIN 500. Jangan memasukkan foto biometrik anggota sebenarnya.</p>
    <div className="space-y-2"><label htmlFor="test-pin" className="block font-medium">PIN uji</label><input id="test-pin" value={pin} onChange={e=>setPin(e.target.value)} inputMode="numeric" className="rounded-md border p-2 w-full" /></div>
    <div className="space-y-2"><label htmlFor="test-photo" className="block font-medium">JPEG uji dari HP</label><input id="test-photo" type="file" accept="image/jpeg,.jpg" capture="user" onChange={e=>setFile(e.target.files?.[0]??null)} className="block w-full rounded-md border p-2" /><p className="text-sm">Nama wajib verify_biophoto_9_500.jpg, maksimum 50.000 byte.</p></div>
    <button type="button" className="rounded-md bg-slate-800 text-white px-4 py-2" onClick={validate}>Validasi lokal</button>
    <section role="status" aria-live="polite" className="rounded-md bg-slate-100 text-slate-900 p-4"><strong>{result.status}</strong><pre className="whitespace-pre-wrap break-all text-sm mt-2">{result.detail}</pre></section>
  </div>;
}
