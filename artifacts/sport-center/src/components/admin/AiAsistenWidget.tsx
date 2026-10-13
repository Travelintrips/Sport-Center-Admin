import { useState, type FormEvent } from "react";
import { Bot, Send, X, ShieldCheck, Download } from "lucide-react";
import { Link } from "wouter";
import { getToken } from "@/lib/auth";

type Message = { role: "admin" | "assistant"; text: string };
type TaxItem = {
  id?: number; referenceNumber?: string | null; taxCode?: string | null;
  taxRate?: number; taxAmount?: number; dpp?: number; payerType?: string | null;
  status?: string | null; transactionType?: string | null; transactionDate?: string | null;
};
type TaxReport = { summary?: { totalDpp?: number; totalTaxAmount?: number; totalTransactions?: number }; transactions?: TaxItem[] };
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const currentPeriod = () => new Date().toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Jakarta" }).slice(0, 7);
function periodFromQuestion(question: string, selected: string) {
  const found = question.match(/(20\d{2})[-/](0[1-9]|1[0-2])/);
  return found ? `${found[1]}-${found[2]}` : selected;
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
    duplicates
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
    if (!year || !month || month > 12) throw new Error("Masa pajak tidak valid.");
    const startDate = `${selected}-01`;
    const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const token = getToken();
    if (!token) throw new Error("Sesi admin berakhir. Silakan masuk kembali.");
    const params = new URLSearchParams({ startDate, endDate });
    const response = await fetch(`${BASE}/admin/tax-report?${params}`, { headers: { Authorization: `Bearer ${token}` }, credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: TaxReport = await response.json();
    const result = audit(body, selected);
    return result.text;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setInput(""); setMessages(v => [...v, { role: "admin", text: question }]);
    if (!/pajak|ppn|laporan|audit|transaksi|sport center|rekap/i.test(question) || /pph|vendor|bizportal|coretax/i.test(question)) {
      setMessages(v => [...v, { role: "assistant", text: "Data yang bisa saya audit sekarang adalah PPN Sport Center. PPh Unifikasi, invoice vendor BizPortal dan Coretax belum memiliki koneksi terverifikasi. Saya tidak akan membuat angka perkiraan." }]);
      return;
    }
    setBusy(true);
    try { const answer = await queryTax(question); setMessages(v => [...v, { role: "assistant", text: answer }]); }
    catch (err) { setMessages(v => [...v, { role: "assistant", text: `Audit gagal: ${err instanceof Error ? err.message : "Kesalahan tidak diketahui"}. Tidak ada data yang diubah.` }]); }
    finally { setBusy(false); }
  }
  async function exportCsv() {
    const token = getToken();
    if (!token || busy) return;
    const [y, m] = period.split("-").map(Number);
    const startDate = `${period}-01`;
    const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    setBusy(true);
    try {
      const query = new URLSearchParams({ startDate, endDate });
      const response = await fetch(`${BASE}/admin/tax-report/export/csv?${query}`, { headers: { Authorization: `Bearer ${token}` }, credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `sport-center-ppn-${period}.csv`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (err) { setMessages(v => [...v, { role: "assistant", text: `Ekspor gagal: ${err instanceof Error ? err.message : "Kesalahan tidak diketahui"}` }]); }
    finally { setBusy(false); }
  }
  return <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
    {open && <section aria-label="Percakapan AI Asisten" className="flex h-[min(75dvh,600px)] w-[min(calc(100vw-2rem),410px)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
      <header className="flex items-center gap-2 border-b p-3"><Bot className="h-5 w-5 text-primary" /><div className="flex-1"><p className="text-sm font-semibold">AI Asisten</p><p className="text-xs text-muted-foreground">Administrasi CST · Audit baca-saja</p></div><button onClick={() => setOpen(false)} aria-label="Tutup AI Asisten" className="rounded p-2 hover:bg-muted"><X className="h-4 w-4" /></button></header>
      <div className="flex items-center gap-2 border-b p-2 text-xs"><label htmlFor="ai-tax-period">Masa pajak</label><input id="ai-tax-period" type="month" value={period} onChange={e => setPeriod(e.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-1" /><button title="Ekspor laporan pajak PPN CSV" aria-label="Ekspor CSV" type="button" disabled={busy} onClick={() => void exportCsv()} className="rounded border p-2 disabled:opacity-50"><Download className="h-4 w-4" /></button></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm" role="log" aria-live="polite">{messages.map((m,i)=><div key={i} className={`max-w-[95%] whitespace-pre-wrap rounded-xl px-3 py-2 ${m.role === "admin" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>{m.text}</div>)}{busy && <p className="text-muted-foreground">Memproses...</p>}</div>
      <div className="border-t p-3"><Link href="/admin/tax-report" onClick={() => setOpen(false)} className="mb-2 block text-xs text-primary underline">Buka laporan PPN Sport Center</Link><form className="flex gap-2" onSubmit={submit}><input aria-label="Pesan AI Asisten" value={input} onChange={e => setInput(e.target.value)} maxLength={1000} placeholder="Audit PPN masa pajak ini..." className="min-w-0 flex-1 rounded border bg-background px-3 py-2 text-sm" /><button type="submit" aria-label="Kirim pesan" disabled={busy || !input.trim()} className="rounded bg-primary px-3 text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /></button></form><p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3 w-3" /> PPh / BizPortal / Coretax belum terhubung.</p></div>
    </section>}
    <button type="button" aria-expanded={open} aria-label={open ? "Tutup AI Asisten" : "Buka AI Asisten"} onClick={() => setOpen(v => !v)} className="flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg"><Bot className="h-5 w-5" />AI Asisten</button>
  </div>;
}
