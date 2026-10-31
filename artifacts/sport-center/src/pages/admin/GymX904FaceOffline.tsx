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
    if(!/\.jpe?g$/i.test(file.name)) return rejected("EXTENSION_INVALID");
    if(file.size<100||file.size>20000000) return rejected("INPUT_SIZE_INVALID");
    try {
      const header=new Uint8Array(await file.slice(0,3).arrayBuffer());
      if(header[0]!==255||header[1]!==216||header[2]!==255) return rejected("NOT_JPEG");
      const bitmap=await createImageBitmap(file);
      let output: Uint8Array | null=null;
      let width=0,height=0;
      try {
        if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>24000000) return rejected("DIMENSIONS_INVALID");
        let scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
        for(let pass=0;pass<8&&!output;pass++) {
          const canvas=document.createElement("canvas");
          width=canvas.width=Math.max(1,Math.round(bitmap.width*scale));
          height=canvas.height=Math.max(1,Math.round(bitmap.height*scale));
          const context=canvas.getContext("2d");
          if(!context) return rejected("CANVAS_UNAVAILABLE");
          context.drawImage(bitmap,0,0,width,height);
          for(const quality of [0.82,0.68,0.52,0.36,0.22]) {
            const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
            if(blob&&blob.size>=100&&blob.size<=50000) { output=new Uint8Array(await blob.arrayBuffer());break; }
          }
          scale*=0.7;
        }
      } finally { bitmap.close(); }
      if(!output) return rejected("COMPRESSION_LIMIT");
      if(output[0]!==255||output[1]!==216||output[2]!==255||output.at(-2)!==255||output.at(-1)!==217) return rejected("JPEG_ENCODE_INVALID");
      const digest=await crypto.subtle.digest("SHA-256",output);
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      setResult({status:"STAGED_OFFLINE_ONLY",detail:`Ukuran asli: ${file.size} byte\nUkuran hasil: ${output.length} byte\nDimensi hasil: ${width} × ${height}\nSHA-256 hasil: ${hash}\nTidak disimpan ke server, tidak dikirim ke X904.`});
    } catch { rejected("DECODE_OR_COMPRESS_FAILED"); }
  }
  return <div className="mx-auto max-w-2xl p-4 sm:p-8 space-y-5">
    <div><Link href="/admin/gym-x904" className="text-sm underline">Kembali ke X904</Link><h1 className="text-2xl font-semibold mt-3">Pratinjau Foto Wajah — Offline</h1></div>
    <p role="note" className="rounded-md border border-amber-400 p-3">Belum tersedia pendaftaran wajah ke mesin X904. Ini hanya validasi lokal di HP, khusus gambar uji PIN 500. Jangan memasukkan foto biometrik anggota sebenarnya.</p>
    <div className="space-y-2"><label htmlFor="test-pin" className="block font-medium">PIN uji</label><input id="test-pin" value={pin} onChange={e=>setPin(e.target.value)} inputMode="numeric" className="rounded-md border p-2 w-full" /></div>
    <div className="space-y-2"><label htmlFor="test-photo" className="block font-medium">JPEG uji dari HP</label><input id="test-photo" type="file" accept="image/jpeg,.jpg" capture="user" onChange={e=>setFile(e.target.files?.[0]??null)} className="block w-full rounded-md border p-2" /><p className="text-sm">Nama JPEG bebas. Foto dikompresi otomatis hingga maksimum 50.000 byte. Gunakan gambar sintetis saja.</p></div>
    <button type="button" className="rounded-md bg-slate-800 text-white px-4 py-2" onClick={validate}>Validasi lokal</button>
    <section role="status" aria-live="polite" className="rounded-md bg-slate-100 text-slate-900 p-4"><strong>{result.status}</strong><pre className="whitespace-pre-wrap break-all text-sm mt-2">{result.detail}</pre></section>
  </div>;
}
