import { useState, type FormEvent } from "react";
import { Bot, Send, X, ShieldCheck, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { getToken } from "@/lib/auth";

type Message = { role: "admin" | "assistant"; text: string };
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** Mounted exclusively inside authenticated AdminLayout. No public route or client-held AI credentials. */
export default function AiAsistenWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    text: "Halo! Saya AI Asisten CST. Saat ini tersedia pengecekan koneksi laporan pajak Sport Center (baca-saja). AI Core, BizPortal, PPh, dan Coretax belum terhubung di widget ini.",
  }]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setInput("");
    setMessages(v => [...v, { role: "admin", text: question }]);
    if (!/pajak|ppn|laporan|transaksi|sport center/i.test(question)) {
      setMessages(v => [...v, { role: "assistant", text: "Pemeriksaan yang tersedia saat ini hanya konektivitas laporan pajak Sport Center. Untuk analisis PPh dan invoice vendor, konektor BizPortal perlu diaktifkan dan diverifikasi dahulu." }]);
      return;
    }
    setBusy(true);
    try {
      const token = getToken();
      if (!token) throw new Error("Sesi admin berakhir. Silakan masuk kembali.");
      const today = new Date();
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const params = new URLSearchParams({ startDate: first.toISOString().slice(0, 10), endDate: today.toISOString().slice(0, 10) });
      const response = await fetch(`${BASE}/admin/tax-report?${params}`, { headers: { Authorization: `Bearer ${token}` }, credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result: unknown = await response.json();
      if (!result || typeof result !== "object") throw new Error("Respons tidak valid");
      setMessages(v => [...v, { role: "assistant", text: "Koneksi endpoint laporan pajak berhasil. Saya belum menyajikan angka pajak karena validasi skema dan aturan perhitungan masih diperlukan. Buka menu Laporan Pajak PPN untuk data yang tersedia." }]);
    } catch (err) {
      setMessages(v => [...v, { role: "assistant", text: `Pemeriksaan tidak berhasil: ${err instanceof Error ? err.message : "Kesalahan tidak diketahui"}. Data tidak diubah.` }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <section aria-label="Percakapan AI Asisten" className="flex h-[min(70dvh,560px)] w-[min(calc(100vw-2rem),390px)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
          <header className="flex items-center gap-2 border-b bg-background p-3">
            <Bot className="h-5 w-5 text-primary" />
            <div className="min-w-0 flex-1"><div className="font-semibold text-sm">AI Asisten</div><p className="text-xs text-muted-foreground">Administrasi CST · Baca-saja</p></div>
            <button aria-label="Tutup AI Asisten" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-muted"><X className="h-4 w-4" /></button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm" role="log" aria-live="polite">
            {messages.map((m, i) => <div key={i} className={`max-w-[95%] whitespace-pre-wrap rounded-xl px-3 py-2 ${m.role === "admin" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>{m.text}</div>)}
            {busy && <p className="text-muted-foreground">Memeriksa koneksi...</p>}
          </div>
          <div className="border-t p-3">
            <Link href="/admin/tax-report" onClick={() => setOpen(false)} className="mb-2 flex items-center gap-1 text-xs text-primary underline">Laporan Pajak PPN <ExternalLink className="h-3 w-3" /></Link>
            <form onSubmit={submit} className="flex gap-2">
              <input aria-label="Pesan AI Asisten" value={input} onChange={e => setInput(e.target.value)} maxLength={1000} placeholder="Tanyakan laporan pajak..." className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
              <button type="submit" aria-label="Kirim pesan" disabled={busy || !input.trim()} className="rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /></button>
            </form>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3 w-3" /> Belum terhubung dengan Coretax atau BizPortal.</p>
          </div>
        </section>
      )}
      <button type="button" aria-expanded={open} aria-label={open ? "Tutup AI Asisten" : "Buka AI Asisten"} onClick={() => setOpen(v => !v)} className="flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg hover:opacity-90">
        <Bot className="h-5 w-5" /> AI Asisten
      </button>
    </div>
  );
}
