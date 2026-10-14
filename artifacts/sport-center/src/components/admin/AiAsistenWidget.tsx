import { useState, type FormEvent } from "react";
import { Bot, Send, X, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { getToken } from "@/lib/auth";

type Message = { role: "admin" | "assistant"; text: string };
type TaxItem = {
  id?: number; customerName?: string | null; facilityName?: string | null; referenceNumber?: string | null; taxCode?: string | null;
  taxRate?: number; taxAmount?: number; dpp?: number; payerType?: string | null;
  status?: string | null; transactionType?: string | null; transactionDate?: string | null;
};
type TaxReport = { summary?: { totalDpp?: number; totalTaxAmount?: number; totalTransactions?: number }; transactions?: TaxItem[] };
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const currentPeriod = () => new Date().toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Jakarta" }).slice(0, 7);
const MONTHS = ["januari","februari","maret","april","mei","juni","juli","agustus","september","oktober","november","desember"];
function periodFromQuestion(question: string, selected: string) {
  const lower = question.toLowerCase();
  const numeric = lower.match(/(20\d{2})[-/](0?[1-9]|1[0-2])/);
  if (numeric) return `${numeric[1]}-${numeric[2].padStart(2,"0")}`;
  const named = lower.match(/(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*(20\d{2})?/);
  if (named) return `${named[2] || selected.slice(0,4)}-${String(MONTHS.indexOf(named[1])+1).padStart(2,"0")}`;
  if (/bulan (ini|berjalan)/.test(lower)) return currentPeriod();
  if (/bulan lalu|bulan sebelumnya/.test(lower)) {
    const [year, month] = currentPeriod().split("-").map(Number);
    return new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
  }
  return selected;
}
function audit(report: TaxReport, period: string) {
  if (!Array.isArray(report.transactions) || !report.summary) throw new Error("Skema respons pajak tidak sesuai.");
  const tx = report.transactions;
  const active = tx.filter(r => r.transactionType === "original" && r.status !== "reversed");
  const missingRef = active.filter(r => !r.referenceNumber?.trim());
  const invalidNumbers = active.filter(r => !Number.isFinite(Number(r.dpp)) || !Number.isFinite(Number(r.taxAmount)) || Number(r.dpp) < 0 || Number(r.taxAmount) < 0);
  const missingTaxCode = active.filter(r => !r.taxCode?.trim());
  const personal = active.filter(r => r.payerType === "personal");
  const personalWithTax = personal.filter(r => Number(r.taxAmount) !== 0);
  const seen = new Set<string>(); const duplicates: string[] = [];
  for (const t of active) {
    const key = `${t.referenceNumber ?? ""}|${t.taxCode ?? ""}|${t.transactionDate ?? ""}`;
    if (!t.referenceNumber) continue;
    if (seen.has(key)) duplicates.push(t.referenceNumber);
    seen.add(key);
  }
  return {
    text: `Audit pajak Sport Center — ${period}\nTransaksi aktif: ${active.length}\nDPP tercatat: ${money(Number(report.summary.totalDpp ?? 0))}\nPPN tercatat: ${money(Number(report.summary.totalTaxAmount ?? 0))}\nReferensi kosong: ${missingRef.length}\nKode pajak kosong: ${missingTaxCode.length}\nNilai tidak valid: ${invalidNumbers.length}\nKandidat duplikasi: ${duplicates.length}\nTransaksi personal dengan PPN tercatat: ${personalWithTax.length}\n\nTemuan merupakan kandidat audit, bukan koreksi atau kesimpulan pajak final. Transaksi personal perlu dinilai menurut aturan yang berlaku. Belum mencakup PPh, BizPortal, pajak masukan, atau data Coretax.`,
    flagged: [...missingRef, ...missingTaxCode, ...invalidNumbers, ...personalWithTax],
    duplicates, active, personalWithTax
  };
}
/** Widget hanya dimuat di layout admin setelah autentikasi. Tidak memiliki akses tulis. */
export default function AiAsistenWidget() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(currentPeriod);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: "Halo! Saya AI Asisten CST. Saya bisa mengaudit data PPN Sport Center per masa pajak (baca-saja). Koneksi PPh, BizPortal, dan Coretax belum aktif." }]);
  async function queryTax(question: string) {
    const selected = periodFromQuestion(question, period);
    const [year, month] = selected.split("-").map(Number);
    if (!year || month < 1 || month > 12) throw new Error("Masa pajak tidak valid.");
    const startDate = `${selected}-01`;
    const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const token = getToken();
    if (!token) throw new Error("Sesi admin berakhir. Silakan masuk kembali.");
    const params = new URLSearchParams({ startDate, endDate });
    const response = await fetch(`${BASE}/admin/tax-report?${params}`, { headers: { Authorization: `Bearer ${token}` }, credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: TaxReport = await response.json();
    const result = audit(body, selected);
    setPeriod(selected);
    const detail = /tampilkan|daftar|rincian|detail|urutkan|kelompokkan|44 transaksi|transaksi itu/i.test(question);
    const personalOnly = /personal|perorangan|pribadi|44 transaksi/i.test(question);
    if (!detail) return result.text + (result.personalWithTax.length ? "\n\nStatus: BELUM SIAP dinyatakan siap lapor — verifikasi transaksi personal dengan PPN serta rekonsiliasi pajak di luar Sport Center diperlukan." : "\n\nStatus: Perlu verifikasi silang sebelum pelaporan; audit ini belum mencakup pajak masukan dan PPh.");
    let rows = personalOnly ? result.personalWithTax : result.active.filter(r => !r.referenceNumber?.trim() || !r.taxCode?.trim() || Number(r.taxAmount) < 0 || Number(r.dpp) < 0);
    if (/terbesar|urutkan/i.test(question)) rows = [...rows].sort((a,b) => Number(b.taxAmount ?? 0)-Number(a.taxAmount ?? 0));
    const list = rows.slice(0,50).map((r,i) => `${i+1}. ID ${r.id ?? "-"} | Ref ${r.referenceNumber || "-"} | ${r.transactionDate || "-"} | ${r.customerName || "Customer tidak tercatat"} | ${r.payerType || "payer tidak ada"} | DPP ${money(Number(r.dpp || 0))} | PPN ${money(Number(r.taxAmount || 0))}`);
    return `Detail kandidat audit — ${selected}\nTotal: ${rows.length} transaksi; menampilkan ${list.length} pertama.\n${list.join("\n") || "Tidak ada kandidat untuk kriteria ini."}\n\nSumber: Sport Center Tax Report. Temuan perlu pemeriksaan bukti, bukan instruksi koreksi otomatis.`;
  }
  async function queryAiCore(message: string): Promise<string> {
    const token = getToken();
    if (!token) throw new Error("Sesi admin berakhir. Silakan masuk kembali.");
    const response = await fetch(`${BASE}/admin/ai-asisten/chat`, {
      method: "POST", credentials: "same-origin",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    const payload: { reply?: string; error?: string } = await response.json();
    if (!response.ok || !payload.reply) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.reply;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setInput(""); setMessages(v => [...v, { role: "admin", text: question }]);
    setBusy(true);
    try {
      const localAudit = /audit|rekap|total ppn|laporan ppn|transaksi personal|transaksi perorangan|44 transaksi|tampilkan.*transaksi|rincian.*transaksi|detail.*transaksi|urutkan.*transaksi|siap lapor/i.test(question) && !/pph|vendor|bizportal|coretax/i.test(question);
      const answer = localAudit ? await queryTax(question) : await queryAiCore(question);
      setMessages(v => [...v, { role: "assistant", text: answer }]);
    } catch (err) {
      setMessages(v => [...v, { role: "assistant", text: `Permintaan gagal: ${err instanceof Error ? err.message : "Kesalahan tidak diketahui"}. Tidak ada data yang diubah.` }]);
    } finally { setBusy(false); }
  }
  return <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
    {open && <section aria-label="Percakapan AI Asisten" className="flex h-[min(75dvh,600px)] w-[min(calc(100vw-2rem),410px)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
      <header className="flex items-center gap-2 border-b p-3"><Bot className="h-5 w-5 text-primary" /><div className="flex-1"><p className="text-sm font-semibold">AI Asisten</p><p className="text-xs text-muted-foreground">Administrasi CST · Audit baca-saja</p></div><button onClick={() => setOpen(false)} aria-label="Tutup AI Asisten" className="rounded p-2 hover:bg-muted"><X className="h-4 w-4" /></button></header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm" role="log" aria-live="polite">{messages.map((m,i)=><div key={i} className={`max-w-[95%] whitespace-pre-wrap rounded-xl px-3 py-2 ${m.role === "admin" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>{m.text}</div>)}{busy && <p className="text-muted-foreground">Memproses...</p>}</div>
      <div className="border-t p-3"><Link href="/admin/tax-report" onClick={() => setOpen(false)} className="mb-2 block text-xs text-primary underline">Buka laporan PPN Sport Center</Link><form className="flex gap-2" onSubmit={submit}><input aria-label="Pesan AI Asisten" value={input} onChange={e => setInput(e.target.value)} maxLength={1000} placeholder="Tanya AI Asisten atau audit PPN..." className="min-w-0 flex-1 rounded border bg-background px-3 py-2 text-sm" /><button type="submit" aria-label="Kirim pesan" disabled={busy || !input.trim()} className="rounded bg-primary px-3 text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /></button></form><p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3 w-3" /> PPh / BizPortal / Coretax belum terhubung.</p></div>
    </section>}
    <button type="button" aria-expanded={open} aria-label={open ? "Tutup AI Asisten" : "Buka AI Asisten"} onClick={() => setOpen(v => !v)} className="flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg"><Bot className="h-5 w-5" />AI Asisten</button>
  </div>;
}
