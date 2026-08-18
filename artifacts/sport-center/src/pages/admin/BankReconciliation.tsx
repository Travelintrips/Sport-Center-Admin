import { useState, useRef, useEffect } from "react";
import {
  useListBankMutations, useGetBankMutationMatches, useApproveBankMutation,
  useRejectBankMutation, useRunBankMatching,
  useConnectBankReconSheet, usePullBankMutationsFromSheet, usePushBankReconToSheet,
  useClearBankMutations,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListBankMutationsQueryKey, getGetBankMutationMatchesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Upload, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Search,
  ChevronDown, ChevronUp, Banknote, ArrowDownCircle, ArrowUpCircle,
  Filter, FileText, Zap, Sheet, Download, Link, Save, Trash2,
} from "lucide-react";

function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([\w-]+)/);
  return m ? m[1]! : input.trim();
}

const LS_RECON_SHEET_KEY = "recon_connected_sheet";
const LS_RECON_SHEET_URL_KEY = "recon_sheet_raw_url";
const LS_RECON_SHEET_NAMES_KEY = "recon_sheet_names";
const LS_RECON_SELECTED_TAB_KEY = "recon_selected_tab";

function SheetSyncPanel({ onImported }: { onImported: () => void }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [rawInput, setRawInput] = useState(() => {
    try { return localStorage.getItem(LS_RECON_SHEET_URL_KEY) ?? ""; } catch { return ""; }
  });
  const [connectedSheet, setConnectedSheetState] = useState<{ id: string; title: string } | null>(() => {
    try { const v = localStorage.getItem(LS_RECON_SHEET_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const [sheetNames, setSheetNamesState] = useState<string[]>(() => {
    try { const v = localStorage.getItem(LS_RECON_SHEET_NAMES_KEY); return v ? JSON.parse(v) : []; } catch { return []; }
  });
  const [selectedTab, setSelectedTabState] = useState<string>(() => {
    try { return localStorage.getItem(LS_RECON_SELECTED_TAB_KEY) ?? ""; } catch { return ""; }
  });
  const [lastSync, setLastSync] = useState<{ direction: "push" | "pull"; result: string; at: Date } | null>(null);
  const [pushStatusFilter, setPushStatusFilter] = useState<string>("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const setConnectedSheet = (val: { id: string; title: string } | null) => {
    setConnectedSheetState(val);
    if (val) localStorage.setItem(LS_RECON_SHEET_KEY, JSON.stringify(val));
    else localStorage.removeItem(LS_RECON_SHEET_KEY);
  };

  const setSheetNames = (names: string[]) => {
    setSheetNamesState(names);
    localStorage.setItem(LS_RECON_SHEET_NAMES_KEY, JSON.stringify(names));
  };

  const setSelectedTab = (tab: string) => {
    setSelectedTabState(tab);
    localStorage.setItem(LS_RECON_SELECTED_TAB_KEY, tab);
  };

  const activeTab = selectedTab || sheetNames[0] || "";

  const handleSaveUrl = () => {
    const id = extractSheetId(rawInput);
    if (!id) return;
    localStorage.setItem(LS_RECON_SHEET_URL_KEY, rawInput.trim());
    setConnectedSheet({ id, title: id });
    toast({ title: "URL tersimpan", description: "Klik Verifikasi untuk cek koneksi." });
  };

  const connectMutation = useConnectBankReconSheet({
    mutation: {
      onSuccess: (data) => {
        const id = extractSheetId(rawInput);
        setConnectedSheet({ id, title: data.title });
        setSheetNames(data.sheetNames ?? []);
        if (!selectedTab && data.sheetNames?.length) setSelectedTab(data.sheetNames[0]!);
        toast({ title: `Terhubung ke "${data.title}"`, description: `${data.sheetNames?.length ?? 0} tab ditemukan` });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal terhubung ke sheet", variant: "destructive" });
      },
    },
  });

  const pullMutation = usePullBankMutationsFromSheet({
    mutation: {
      onSuccess: (data) => {
        const parts = [];
        if (data.importedCount) parts.push(`${data.importedCount} diimpor`);
        if (data.skippedCount) parts.push(`${data.skippedCount} dilewati`);
        const summary = parts.join(", ") || "Tidak ada data baru";
        setLastSync({ direction: "pull", result: summary, at: new Date() });
        toast({ title: `✅ Import dari Sheet selesai: ${summary}` });
        onImported();
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal import dari sheet", variant: "destructive" });
      },
    },
  });

  const pushMutation = usePushBankReconToSheet({
    mutation: {
      onSuccess: (data) => {
        setLastSync({ direction: "push", result: `${data.updatedRows} baris diekspor`, at: new Date() });
        toast({ title: `✅ ${data.updatedRows} mutasi berhasil dikirim ke Google Sheet` });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal push ke sheet", variant: "destructive" });
      },
    },
  });

  const queryClient = useQueryClient();

  const clearMutation = useClearBankMutations({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `🗑️ ${data.deletedCount} data mutasi berhasil dihapus` });
        setShowClearConfirm(false);
        queryClient.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
        onImported();
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal menghapus data", variant: "destructive" });
        setShowClearConfirm(false);
      },
    },
  });

  const isBusy = connectMutation.isPending || pullMutation.isPending || pushMutation.isPending || clearMutation.isPending;

  const handlePush = () => {
    if (!connectedSheet) return;
    const statusFilter = pushStatusFilter !== "all" ? [pushStatusFilter] : undefined;
    pushMutation.mutate({ data: { sheetId: connectedSheet.id, sheetName: activeTab || undefined, statusFilter } });
  };

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardContent className="p-4">
        <button
          className="w-full flex items-center justify-between gap-3 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
              <Sheet size={16} className="text-blue-700" />
            </div>
            <div>
              <div className="font-semibold text-sm">Sinkronisasi Google Sheets</div>
              <div className="text-xs text-muted-foreground">
                {connectedSheet
                  ? <span className="text-blue-700 flex items-center gap-1"><CheckCircle2 size={10} /> {connectedSheet.title}</span>
                  : "Hubungkan spreadsheet untuk import/export mutasi rekonsiliasi"}
              </div>
            </div>
          </div>
          {expanded ? <ChevronUp size={16} className="text-muted-foreground shrink-0" /> : <ChevronDown size={16} className="text-muted-foreground shrink-0" />}
        </button>

        {expanded && (
          <div className="mt-4 space-y-4 border-t pt-4">
            {/* URL Input */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Google Sheet ID atau URL</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://docs.google.com/spreadsheets/d/... atau Sheet ID"
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  className="flex-1 text-sm"
                  disabled={isBusy}
                  onKeyDown={(e) => e.key === "Enter" && rawInput.trim() && handleSaveUrl()}
                />
                <Button size="sm" className="gap-1.5 shrink-0 bg-primary hover:bg-primary/90"
                  disabled={!rawInput.trim() || isBusy} onClick={handleSaveUrl}>
                  <Save size={14} /> Simpan
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 shrink-0"
                  disabled={!rawInput.trim() || isBusy}
                  onClick={() => connectMutation.mutate({ data: { sheetId: extractSheetId(rawInput) } })}>
                  <Link size={14} />
                  {connectMutation.isPending ? "..." : "Verifikasi"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <strong>Simpan</strong> untuk menyimpan URL. <strong>Verifikasi</strong> untuk cek akses (Service Account perlu hak <em>Editor</em>).
              </p>
            </div>

            {connectedSheet && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-100/60 border border-blue-200 text-sm">
                  <CheckCircle2 size={14} className="text-blue-600 shrink-0" />
                  <span className="font-medium text-blue-800 flex-1 truncate">Terhubung ke: {connectedSheet.title}</span>
                </div>

                {sheetNames.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tab / Sheet</Label>
                    <select
                      className="w-full border rounded px-2 py-1.5 text-sm bg-white"
                      value={activeTab}
                      onChange={(e) => setSelectedTab(e.target.value)}
                      disabled={isBusy}
                    >
                      {sheetNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">Pilih tab mana yang digunakan untuk import/export.</p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Pull dari sheet */}
                  <button
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isBusy}
                    onClick={() => pullMutation.mutate({ data: { sheetId: connectedSheet.id, sheetName: activeTab || undefined } })}
                  >
                    <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center">
                      <Download size={16} className="text-white" />
                    </div>
                    <div className="text-center">
                      <div className="font-semibold text-sm text-blue-800">Tarik dari Sheet</div>
                      <div className="text-xs text-blue-600 mt-0.5">Google Sheet → Import mutasi</div>
                    </div>
                    {pullMutation.isPending && <div className="text-xs text-blue-600 animate-pulse">Mengimpor...</div>}
                  </button>

                  {/* Push ke sheet */}
                  <div className="flex flex-col gap-2 p-4 rounded-xl border-2 border-orange-200 bg-orange-50">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center">
                        <Upload size={16} className="text-white" />
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-sm text-orange-800">Push Hasil Rekonsiliasi</div>
                        <div className="text-xs text-orange-600 mt-0.5">App → Google Sheet</div>
                      </div>
                    </div>
                    <select
                      className="border rounded px-2 py-1 text-xs bg-white w-full"
                      value={pushStatusFilter}
                      onChange={(e) => setPushStatusFilter(e.target.value)}
                      disabled={isBusy}
                    >
                                      <option value="all">Semua status</option>
                      <option value="approved">Hanya Disetujui</option>
                      <option value="auto_matched">Hanya Auto Matched</option>
                      <option value="need_review">Hanya Perlu Review</option>
                      <option value="unmatched">Hanya Belum Match</option>
                      <option value="rejected">Hanya Ditolak</option>
                    </select>
                    <button
                      className="w-full py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isBusy}
                      onClick={handlePush}
                    >
                      {pushMutation.isPending ? "Mengekspor..." : "Export ke Sheet"}
                    </button>
                  </div>
                </div>

                {lastSync && (
                  <div className="text-xs text-muted-foreground p-2 rounded bg-muted/50 border">
                    {lastSync.direction === "pull" ? "⬇️ Terakhir tarik" : "⬆️ Terakhir push"}:{" "}
                    <strong>{lastSync.result}</strong> — {lastSync.at.toLocaleTimeString("id-ID")}
                  </div>
                )}

                {/* Hapus data */}
                <div className="border-t pt-3">
                  {!showClearConfirm ? (
                    <button
                      className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() => setShowClearConfirm(true)}
                    >
                      <Trash2 size={12} /> Hapus semua data mutasi yang diimpor
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                      <p className="text-xs font-semibold text-red-800">⚠️ Hapus SEMUA data mutasi bank dari database?</p>
                      <p className="text-xs text-red-600">Tindakan ini tidak dapat dibatalkan. Data rekonsiliasi yang sudah disetujui juga akan dihapus.</p>
                      <div className="flex gap-2">
                        <button
                          className="flex-1 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
                          disabled={clearMutation.isPending}
                          onClick={() => clearMutation.mutate({ data: {} })}
                        >
                          {clearMutation.isPending ? "Menghapus..." : "Ya, Hapus Semua"}
                        </button>
                        <button
                          className="flex-1 py-1 rounded border text-xs disabled:opacity-50"
                          disabled={clearMutation.isPending}
                          onClick={() => setShowClearConfirm(false)}
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_COLORS: Record<string, string> = {
  unmatched: "bg-orange-100 text-orange-800 border-orange-200",
  need_review: "bg-yellow-100 text-yellow-800 border-yellow-200",
  auto_matched: "bg-teal-100 text-teal-800 border-teal-200",
  matched: "bg-blue-100 text-blue-800 border-blue-200",
  duplicate_need_review: "bg-purple-100 text-purple-800 border-purple-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_LABELS: Record<string, string> = {
  unmatched: "Belum Match",
  need_review: "Perlu Review",
  auto_matched: "Auto Matched",
  matched: "Matched",
  duplicate_need_review: "Duplikat",
  approved: "Disetujui",
  rejected: "Ditolak",
};

const STATUS_ICONS: Record<string, string> = {
  unmatched: "○",
  need_review: "◔",
  auto_matched: "◉",
  matched: "◉",
  duplicate_need_review: "⊕",
  approved: "✓",
  rejected: "✗",
};

function formatCurrency(n: string | number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-teal-600" :
    score >= 50 ? "bg-yellow-500" :
    "bg-gray-400";
  const label =
    score >= 80 ? "Auto" :
    score >= 50 ? "Review" :
    "Rendah";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-xs font-bold ${color}`}
      title={`Skor: ${score}/100`}>
      {score} <span className="opacity-80 font-normal">{label}</span>
    </span>
  );
}

/**
 * Parse matchReason string menjadi array baris dengan poin.
 * Format yang diharapkan: "deskripsi +N; deskripsi2 +N2"
 */
function parseScoreBreakdown(reason: string | null | undefined): Array<{ label: string; pts: number | null }> {
  if (!reason) return [];
  return reason.split(";").map((part) => {
    const trimmed = part.trim();
    const ptMatch = trimmed.match(/\+(\d+)$/);
    if (ptMatch) {
      return { label: trimmed.replace(/\+\d+$/, "").trim(), pts: parseInt(ptMatch[1]!) };
    }
    return { label: trimmed, pts: null };
  }).filter((x) => x.label.length > 0);
}

function ScoreBreakdown({ reason, totalScore }: { reason: string | null | undefined; totalScore: number }) {
  const parts = parseScoreBreakdown(reason);
  if (!parts.length) {
    return <p className="text-xs text-muted-foreground">{reason}</p>;
  }
  return (
    <div className="mt-2 rounded-lg border bg-muted/30 overflow-hidden">
      <div className="px-3 py-1.5 bg-muted/50 border-b flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rincian Skor</span>
        <ScoreBadge score={totalScore} />
      </div>
      <div className="divide-y">
        {parts.map((p, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-muted-foreground">{p.label}</span>
            {p.pts !== null && (
              <span className="text-xs font-bold text-teal-700 ml-2 shrink-0">+{p.pts}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-t">
        <span className="text-xs font-semibold">Total Skor</span>
        <span className="text-sm font-black text-teal-700">{totalScore}</span>
      </div>
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" });

function resolveProofUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/api/")) return url;
  return `${API_BASE}${url}`;
}

function MatchCandidateRow({
  match,
  onApprove,
  isPending,
}: {
  match: any;
  onApprove: (matchId: number) => void;
  isPending: boolean;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [ocr, setOcr] = useState<{
    name?: string;
    amount?: number;
    date?: string;
    raw?: string;
    paymentMethod?: string | null;
    confidence?: number;
    autoUpdated?: boolean;
  } | null>(
    match.ocrName || match.ocrAmount || match.ocrDate || match.ocrData?.paymentMethodDetection
      ? {
          name: match.ocrName,
          amount: match.ocrAmount,
          date: match.ocrDate,
          raw: match.ocrRaw,
          paymentMethod: match.ocrData?.paymentMethodDetection?.paymentMethod ?? match.paymentMethod,
          confidence: match.ocrData?.paymentMethodDetection?.confidence,
        }
      : null
  );
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const { toast } = useToast();

  const proofUrl = resolveProofUrl(match.proofUrl);

  const handleScanOcr = async () => {
    if (!proofUrl) return;
    setOcrLoading(true);
    setOcrError(null);
    try {
      const resp = await fetch(`${API_BASE}/bank-reconciliation/scan-ocr`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ paymentId: match.candidateId, proofUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Gagal scan OCR");
      setOcr({
        name: data.ocrName,
        amount: data.ocrAmount,
        date: data.ocrDate,
        raw: data.ocrRaw,
        paymentMethod: data.paymentMethod,
        confidence: data.paymentMethodDetection?.confidence,
        autoUpdated: data.paymentMethodAutoUpdated,
      });
      toast({
        title: data.paymentMethodAutoUpdated
          ? `Metode otomatis diubah ke ${data.paymentMethod}`
          : "Scan OCR selesai",
      });
    } catch (e: any) {
      setOcrError(e.message);
    } finally {
      setOcrLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border">
        {/* Thumbnail bukti transfer */}
        {proofUrl ? (
          <button
            className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 border-blue-200 bg-muted hover:opacity-80 hover:border-blue-400 transition-all"
            onClick={() => setLightbox(proofUrl)}
            title="Lihat bukti transfer"
          >
            <img
              src={proofUrl}
              alt="Bukti transfer"
              className="w-full h-full object-cover"
              onError={(e) => {
                const el = e.currentTarget as HTMLImageElement;
                el.style.display = "none";
                const parent = el.parentElement;
                if (parent) parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground text-center p-1">Gambar<br/>tidak dapat<br/>dimuat</div>';
              }}
            />
          </button>
        ) : match.proofMatch ? (
          <div className="shrink-0 w-16 h-16 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted flex items-center justify-center">
            <FileText size={16} className="text-muted-foreground/50" />
          </div>
        ) : null}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">

            {match.isGroupPayment ? (
              <Badge className="bg-violet-100 text-violet-700 border-violet-200 text-xs font-semibold">
                🏷️ Group Booking · {match.groupBookingCount} sesi
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs capitalize">{match.candidateType}</Badge>
            )}
            {match.customerName ? (
              <span className="text-sm font-semibold truncate max-w-[180px]" title={match.customerName}>{match.customerName}</span>
            ) : (
              <span className="text-sm font-medium text-muted-foreground">ID #{match.candidateId}</span>
            )}

            {match.isGroupPayment && match.bookingCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100 font-medium">
                {match.bookingCount} Booking
              </span>
            )}
            {match.facilityName && match.candidateType !== "group_payment" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{match.facilityName}</span>
            )}
            <ScoreBadge score={match.matchScore} />
            {match.status === "approved" && (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Disetujui</Badge>
            )}
            {match.status === "rejected" && (
              <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Ditolak</Badge>
            )}
          </div>

          {/* Group Payment detail */}
          {match.isGroupPayment && (
            <div className="mt-1.5 p-2 rounded-lg bg-violet-50 border border-violet-100 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide">
                  Group: {match.groupRef}
                </span>
                <span className="text-xs font-bold text-violet-800">
                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(match.groupTotalAmount ?? match.bookingAmount))}
                </span>
              </div>
              <p className="text-[10px] text-violet-600">
                Total {match.groupBookingCount} booking akan dikonfirmasi sekaligus
              </p>
            </div>
          )}

          {/* Group Payment Detail */}
          {match.candidateType === "group_payment" && (
            <div className="mt-1.5 space-y-1">
              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                <span className="font-mono">{match.groupRef}</span>
                {match.groupTotal > 0 && (
                  <span className="font-semibold text-purple-700">
                    Total: {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(match.groupTotal))}
                  </span>
                )}
              </div>
              {match.childBookings?.length > 0 && (
                <div className="mt-1 rounded-md border border-purple-100 bg-purple-50/50 overflow-hidden">
                  <div className="px-2 py-1 bg-purple-100/60 text-[9px] font-semibold text-purple-700 uppercase tracking-wide">
                    Rincian Booking Gabungan
                  </div>
                  <div className="divide-y divide-purple-100">
                    {(match.childBookings as any[]).map((child: any, i: number) => (
                      <div key={i} className="px-2 py-1 flex items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-muted-foreground">{child.orderNumber}</span>
                          <span className="truncate text-muted-foreground">{child.facilityName}</span>
                          <span className="text-muted-foreground">📅 {child.bookingDate}</span>
                          <span className="text-muted-foreground">{child.startTime}–{child.endTime}</span>
                        </div>
                        <span className="font-semibold text-foreground shrink-0">
                          {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(child.amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Booking detail row (individual bookings only) */}
          {match.candidateType !== "group_payment" && (match.bookingOrderNumber || match.bookingDate || match.bookingAmount || match.bookingStatus) && (

            <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              {match.bookingOrderNumber && (
                <span className="font-mono">{match.bookingOrderNumber}</span>
              )}
              {match.bookingDate && (
                <span>📅 {match.bookingDate}</span>
              )}
              {match.bookingAmount && Number(match.bookingAmount) > 0 && (
                <span className="font-semibold text-foreground">
                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(match.bookingAmount))}
                </span>
              )}
              {match.bookingStatus && (
                <span className={`px-1 py-0.5 rounded ${match.bookingStatus === "confirmed" ? "bg-green-50 text-green-700" : match.bookingStatus === "waiting_confirmation" ? "bg-yellow-50 text-yellow-700" : "bg-muted text-muted-foreground"}`}>
                  {match.bookingStatus}
                </span>
              )}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {match.amountMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ Nominal</span>}
            {match.dateMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ Tanggal</span>}
            {match.nameMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ Nama</span>}
            {match.orderIdMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">✓ Order ID</span>}
            {match.proofMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">✓ Bukti</span>}
          </div>
          <ScoreBreakdown reason={match.matchReason} totalScore={match.matchScore} />

          {/* OCR Results */}
          {ocr && (ocr.name || ocr.amount || ocr.date) && (
            <div className="mt-2 p-2 rounded-md bg-amber-50 border border-amber-200 space-y-0.5">
              <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide mb-1">Hasil OCR Bukti Transfer</p>
              {ocr.name && (
                <div className="flex gap-1.5 items-center">
                  <span className="text-[10px] font-medium text-amber-600 w-12 shrink-0">Nama:</span>
                  <span className="text-[10px] text-amber-800 font-semibold">{ocr.name}</span>
                </div>
              )}
              {ocr.amount && (
                <div className="flex gap-1.5 items-center">
                  <span className="text-[10px] font-medium text-amber-600 w-12 shrink-0">Nominal:</span>
                  <span className="text-[10px] text-amber-800 font-semibold">
                    {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(ocr.amount))}
                  </span>
                </div>
              )}
              {ocr.date && (
                <div className="flex gap-1.5 items-center">
                  <span className="text-[10px] font-medium text-amber-600 w-12 shrink-0">Tanggal:</span>
                  <span className="text-[10px] text-amber-800 font-semibold">{ocr.date}</span>
                </div>
              )}
              {ocr.paymentMethod && (
                <div className="flex gap-1.5 items-center pt-1 border-t border-amber-200">
                  <span className="text-[10px] font-medium text-amber-600 w-24 shrink-0">Metode otomatis:</span>
                  <span className="text-[10px] text-amber-900 font-bold">
                    {ocr.paymentMethod}
                    {ocr.confidence != null ? ` (${Math.round(ocr.confidence * 100)}%)` : ""}
                  </span>
                  {ocr.autoUpdated && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-green-100 text-green-700">Diperbarui</span>
                  )}
                </div>
              )}
            </div>
          )}

          {proofUrl && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <a
                href={proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-blue-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Buka bukti ↗
              </a>
              {match.candidateType === "payment" && (
                <button
                  className="text-[10px] text-amber-600 hover:underline disabled:opacity-50 flex items-center gap-1"
                  onClick={handleScanOcr}
                  disabled={ocrLoading}
                >
                  {ocrLoading ? "Scanning..." : "🔍 Scan OCR"}
                </button>
              )}
              {ocrError && <span className="text-[10px] text-red-500">{ocrError}</span>}
            </div>
          )}
        </div>
        {match.status === "candidate" && (
          <Button size="sm" className="shrink-0 h-7 text-xs gap-1" onClick={() => onApprove(match.id)} disabled={isPending}>
            <CheckCircle2 size={12} /> Pilih
          </Button>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Dialog open onOpenChange={() => setLightbox(null)}>
          <DialogContent className="max-w-2xl p-2">
            <DialogHeader>
              <DialogTitle className="text-sm">Bukti Transfer – Payment ID #{match.candidateId}</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center bg-muted rounded-lg overflow-hidden min-h-[300px]">
              <img
                src={lightbox}
                alt="Bukti transfer"
                className="max-w-full max-h-[70vh] object-contain"
              />
            </div>
            {/* OCR Results in Lightbox */}
            {ocr && (ocr.name || ocr.amount || ocr.date) && (
              <div className="px-2 py-2 rounded-md bg-amber-50 border border-amber-200 mt-2">
                <p className="text-xs font-semibold text-amber-700 mb-1">Hasil OCR</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {ocr.name && <div><span className="text-amber-600 font-medium">Nama: </span><span className="text-amber-900">{ocr.name}</span></div>}
                  {ocr.amount && <div><span className="text-amber-600 font-medium">Nominal: </span><span className="text-amber-900">Rp {Number(ocr.amount).toLocaleString("id-ID")}</span></div>}
                  {ocr.date && <div><span className="text-amber-600 font-medium">Tanggal: </span><span className="text-amber-900">{ocr.date}</span></div>}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between pt-1">
              {match.candidateType === "payment" && !ocr && (
                <button
                  className="text-xs text-amber-600 hover:underline disabled:opacity-50"
                  onClick={() => { handleScanOcr(); }}
                  disabled={ocrLoading}
                >
                  {ocrLoading ? "Scanning OCR..." : "🔍 Scan OCR dari gambar ini"}
                </button>
              )}
              <a
                href={lightbox}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline ml-auto"
              >
                Buka di tab baru ↗
              </a>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function getSheetContext(): { sheetId?: string; sheetName?: string } {
  try {
    const raw = localStorage.getItem("recon_connected_sheet");
    const sheet = raw ? JSON.parse(raw) as { id: string; title: string } : null;
    const names = JSON.parse(localStorage.getItem("recon_sheet_names") ?? "[]") as string[];
    const selectedTab = localStorage.getItem("recon_selected_tab") ?? "";
    const sheetName = selectedTab || names[0] || undefined;
    return sheet ? { sheetId: sheet.id, sheetName } : {};
  } catch {
    return {};
  }
}

// ===== Fase 3: Tax Fields Section =====
const TAX_TYPE_OPTIONS = [
  { v: "TAX_PPN", l: "PPN" }, { v: "TAX_PPH21", l: "PPh 21" }, { v: "TAX_PPH23", l: "PPh 23" },
  { v: "TAX_PPH_FINAL", l: "PPh Final" }, { v: "TAX_PPH_BADAN", l: "PPh Badan" },
];

const TRANSACTION_TYPE_OUT_OPTIONS = [
  { v: "BANK_FEE", l: "Biaya Admin Bank" }, { v: "REFUND", l: "Refund" },
  { v: "RENT_AP", l: "Beban Sewa" }, { v: "VENDOR_PAYMENT", l: "Pembayaran Vendor" },
  { v: "OPERATIONAL", l: "Beban Operasional" }, { v: "TAX_PAYMENT", l: "Pembayaran Pajak" },
  { v: "OTHER", l: "Lainnya" },
];

function TaxFieldsSection({ mutation, onUpdated }: { mutation: any; onUpdated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(!!(mutation.transactionType || mutation.taxType));
  const [form, setForm] = useState({
    transactionType: mutation.transactionType ?? "",
    taxType: mutation.taxType ?? "",
    taxPeriod: mutation.taxPeriod ?? "",
    taxPaymentReference: mutation.taxPaymentReference ?? "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/mutations/${mutation.id}/tax-fields`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({
          transactionType: form.transactionType || null,
          taxType: form.taxType || null,
          taxPeriod: form.taxPeriod || null,
          taxPaymentReference: form.taxPaymentReference || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal simpan");
      toast({ title: "Klasifikasi disimpan" });
      onUpdated();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    setSaving(false);
  };

  const isTaxPayment = form.transactionType === "TAX_PAYMENT";

  return (
    <div className="border-t pt-3">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-medium"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Klasifikasi Pengeluaran
        {(mutation.transactionType || mutation.taxType) && (
          <span className="ml-1 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[10px] font-semibold">
            {mutation.transactionType ?? mutation.taxType}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div>
            <label className="text-muted-foreground">Jenis Transaksi</label>
            <select className="w-full border rounded px-2 py-1.5 text-xs bg-background mt-0.5"
              value={form.transactionType} onChange={e => setForm(f => ({ ...f, transactionType: e.target.value, taxType: e.target.value !== "TAX_PAYMENT" ? "" : f.taxType }))}>
              <option value="">-- pilih --</option>
              {TRANSACTION_TYPE_OUT_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          {isTaxPayment && (
            <>
              <div>
                <label className="text-muted-foreground">Jenis Pajak</label>
                <select className="w-full border rounded px-2 py-1.5 text-xs bg-background mt-0.5"
                  value={form.taxType} onChange={e => setForm(f => ({ ...f, taxType: e.target.value }))}>
                  <option value="">-- pilih --</option>
                  {TAX_TYPE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-muted-foreground">Periode Pajak (YYYY-MM)</label>
                <Input className="text-xs h-8 mt-0.5" placeholder="2025-01" value={form.taxPeriod} onChange={e => setForm(f => ({ ...f, taxPeriod: e.target.value }))} />
              </div>
              <div>
                <label className="text-muted-foreground">No. Referensi</label>
                <Input className="text-xs h-8 mt-0.5" placeholder="NTPN / SSP no." value={form.taxPaymentReference} onChange={e => setForm(f => ({ ...f, taxPaymentReference: e.target.value }))} />
              </div>
            </>
          )}
          <div className={isTaxPayment ? "sm:col-span-4" : "sm:col-span-3"}>
            <label className="text-muted-foreground invisible block">.</label>
            <Button size="sm" className="h-8 text-xs mt-0.5" onClick={handleSave} disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MutationRow({ mutation, qc }: { mutation: any; qc: any }) {
  const [expanded, setExpanded] = useState(false);
  const [batchScanning, setBatchScanning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const { toast } = useToast();

  const handleBatchScanOcr = async (matches: any[]) => {
    const targets = matches.filter(
      (m: any) => m.candidateType === "payment" && m.proofUrl && !m.ocrAmount
    );
    if (!targets.length) {
      toast({ title: "Semua bukti transfer sudah di-scan OCR" });
      return;
    }
    setBatchScanning(true);
    setBatchProgress({ done: 0, total: targets.length });
    let successCount = 0;
    for (let i = 0; i < targets.length; i++) {
      const m = targets[i];
      try {
        const resp = await fetch(`${API_BASE}/bank-reconciliation/scan-ocr`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ paymentId: m.candidateId, proofUrl: m.proofUrl }),
        });
        if (resp.ok) successCount++;
      } catch {
        // lanjut ke berikutnya
      }
      setBatchProgress({ done: i + 1, total: targets.length });
    }
    setBatchScanning(false);
    setBatchProgress(null);
    toast({ title: `Scan OCR selesai: ${successCount}/${targets.length} berhasil` });
    matchesQuery.refetch();
  };

  const matchesQuery = useGetBankMutationMatches(mutation.id, {
    query: { enabled: expanded, staleTime: 30000, queryKey: getGetBankMutationMatchesQueryKey(mutation.id) },
  });

  const approveMutation = useApproveBankMutation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Mutasi disetujui" });
        qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
        matchesQuery.refetch();
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal approve", variant: "destructive" });
      },
    },
  });

  const rejectMutation = useRejectBankMutation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Mutasi ditolak" });
        qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal reject", variant: "destructive" });
      },
    },
  });

  const isPending = approveMutation.isPending || rejectMutation.isPending;
  const [journalLines, setJournalLines] = useState<any[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [editingCOA, setEditingCOA] = useState(false);
  const [savingCOA, setSavingCOA] = useState(false);
  const [coaForm, setCoaForm] = useState({ debitAccountCode: "", debitAccountName: "", creditAccountCode: "", creditAccountName: "", correctionNote: "" });

  const COA_OPTIONS = [
    { code: "1001", name: "Kas/Bank" },
    { code: "2001", name: "Uang Muka Diterima" },
    { code: "2002", name: "Refund Payable" },
    { code: "2003", name: "Hutang Pajak" },
    { code: "4001", name: "Pendapatan Booking" },
    { code: "6001", name: "Biaya Administrasi Bank" },
    { code: "6002", name: "Beban Vendor/Pemasok" },
    { code: "6003", name: "Beban Sewa" },
    { code: "6005", name: "Beban Operasional" },
    { code: "6099", name: "Beban Lain-lain" },
  ];

  const reloadJournal = () => {
    setJournalLoading(true);
    fetch(`${API_BASE}/bank-reconciliation/mutations/${mutation.id}/journal`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setJournalLines(d.entries ?? []))
      .catch(() => {})
      .finally(() => setJournalLoading(false));
  };

  useEffect(() => {
    if (!expanded || !mutation.accountingPosted || !mutation.journalId) return;
    reloadJournal();
  }, [expanded, mutation.id, mutation.accountingPosted, mutation.journalId]);

  const startEditCOA = (line: any) => {
    setCoaForm({ debitAccountCode: line.debitAccountCode, debitAccountName: line.debitAccountName, creditAccountCode: line.creditAccountCode, creditAccountName: line.creditAccountName, correctionNote: "" });
    setEditingCOA(true);
  };

  const handleSaveCOA = async () => {
    setSavingCOA(true);
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/mutations/${mutation.id}/journal`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(coaForm),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal simpan");
      toast({ title: "✅ COA jurnal berhasil dikoreksi" });
      setEditingCOA(false);
      reloadJournal();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setSavingCOA(false);
    }
  };

  const [isPostingJournal, setIsPostingJournal] = useState(false);
  const handlePostJournal = async () => {
    setIsPostingJournal(true);
    try {
      const resp = await fetch(`${API_BASE}/bank-reconciliation/mutations/${mutation.id}/post-journal`, {
        method: "POST",
        headers: authHeaders(),
      });
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.error ?? "Gagal buat jurnal");
      toast({ title: `Jurnal dibuat: ${d.journalId ?? "OK"}` });
      qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setIsPostingJournal(false);
    }
  };
  const matches = matchesQuery.data?.matches ?? [];
  const isActionable = ["unmatched", "need_review", "auto_matched", "duplicate_need_review"].includes(mutation.status);

  return (
    <div className="border rounded-xl overflow-hidden">
      <div
        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="mt-0.5 shrink-0">
          {mutation.direction === "IN" ? (
            <ArrowDownCircle size={18} className="text-green-500" />
          ) : (
            <ArrowUpCircle size={18} className="text-red-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{mutation.transactionDate}</span>
            <Badge className={`text-[10px] border ${STATUS_COLORS[mutation.status] ?? ""}`}>
              {STATUS_LABELS[mutation.status] ?? mutation.status}
            </Badge>
            {mutation.providerName && (
              <Badge variant="outline" className="text-[10px]">{mutation.providerName}</Badge>
            )}
            {mutation.providerOrderId && (
              <Badge variant="outline" className="text-[10px] font-mono">{mutation.providerOrderId}</Badge>
            )}
            {mutation.journalId && (
              <Badge className="text-[10px] bg-green-50 text-green-700 border border-green-200 gap-1">📒 {mutation.journalId}</Badge>
            )}
            {mutation.status === "approved" && !mutation.accountingPosted && !mutation.journalId && (
              <>
                <Badge className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200">⚠ Belum Dijurnal</Badge>
                <button
                  className="text-[10px] px-2 py-0.5 rounded border border-blue-300 bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 transition-colors"
                  disabled={isPostingJournal}
                  onClick={(e) => { e.stopPropagation(); handlePostJournal(); }}
                >
                  {isPostingJournal ? "..." : "Posting Jurnal"}
                </button>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{mutation.description}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="font-mono text-xs">{mutation.mutationKey}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-bold text-sm ${mutation.direction === "IN" ? "text-green-600" : "text-red-600"}`}>
            {mutation.direction === "IN" ? "+" : "-"}{formatCurrency(mutation.amount)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {mutation.direction === "IN" ? "Masuk" : "Keluar"}
          </div>
        </div>
        <div className="shrink-0 ml-1">
          {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t p-3 bg-muted/10 space-y-3">
          {/* Warning duplikat */}
          {mutation.status === "duplicate_need_review" && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-purple-50 border border-purple-200 text-xs">
              <span className="text-purple-500 shrink-0 text-sm">⊕</span>
              <div>
                <p className="font-semibold text-purple-800">Duplikat mutation_key terdeteksi</p>
                <p className="text-purple-700 mt-0.5">Mutasi ini memiliki tanggal, nominal, dan arah yang sama dengan mutasi lain. Periksa dan setujui atau tolak yang benar, lalu jalankan Matching ulang.</p>
              </div>
            </div>
          )}
          {/* Perbandingan Nominal Mutasi vs OCR */}
          {!matchesQuery.isLoading && matches.length > 0 && (() => {
            const mutAmt = parseFloat(mutation.amount ?? "0");
            // Ambil OCR amount terbaik dari kandidat payment yang sudah di-scan
            const ocrCandidates = matches.filter((m: any) => m.ocrAmount != null);
            if (!ocrCandidates.length) return null;
            const best = ocrCandidates.reduce((a: any, b: any) =>
              Math.abs(parseFloat(a.ocrAmount) - mutAmt) <= Math.abs(parseFloat(b.ocrAmount) - mutAmt) ? a : b
            );
            const ocrAmt = parseFloat(best.ocrAmount!);
            const selisih = Math.abs(mutAmt - ocrAmt);
            const pct = mutAmt > 0 ? (selisih / mutAmt) * 100 : 100;
            const isMatch = pct <= 1;
            const isClose = pct <= 5;
            return (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                isMatch ? "bg-green-50 border-green-200" : isClose ? "bg-yellow-50 border-yellow-200" : "bg-red-50 border-red-200"
              }`}>
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-muted-foreground font-medium mb-0.5">Nominal Mutasi</p>
                    <p className={`font-bold ${mutation.direction === "IN" ? "text-green-700" : "text-red-700"}`}>
                      {formatCurrency(mutAmt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-medium mb-0.5">Nominal OCR</p>
                    <p className="font-bold text-amber-700">{formatCurrency(ocrAmt)}</p>
                    <p className="text-[10px] text-muted-foreground">Payment #{best.candidateId}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-medium mb-0.5">Selisih</p>
                    <p className={`font-bold ${isMatch ? "text-green-700" : isClose ? "text-yellow-700" : "text-red-700"}`}>
                      {selisih === 0 ? "✓ Sama persis" : `${formatCurrency(selisih)} (${pct.toFixed(1)}%)`}
                    </p>
                  </div>
                </div>
                <div className={`shrink-0 text-lg ${isMatch ? "text-green-500" : isClose ? "text-yellow-500" : "text-red-500"}`}>
                  {isMatch ? "✓" : isClose ? "≈" : "✗"}
                </div>
              </div>
            );
          })()}

          {/* Candidates */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kandidat Match</div>
              {matches.length > 0 && matches.some((m: any) => m.candidateType === "payment" && m.proofUrl) && (
                <button
                  className="text-[10px] text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => handleBatchScanOcr(matches)}
                  disabled={batchScanning}
                >
                  {batchScanning && batchProgress ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      Scanning {batchProgress.done}/{batchProgress.total}...
                    </>
                  ) : (
                    <>🔍 Scan OCR Semua</>
                  )}
                </button>
              )}
            </div>
            {matchesQuery.isLoading ? (
              <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : !matches.length ? (
              <p className="text-sm text-muted-foreground">Tidak ada kandidat match ditemukan.</p>
            ) : (
              <div className="space-y-2">
                {matches.map((m: any) => (
                  <MatchCandidateRow
                    key={m.id}
                    match={m}
                    onApprove={(matchId) => {
                      const { sheetId, sheetName } = getSheetContext();
                      approveMutation.mutate({ mutationId: mutation.id, data: { matchId, sheetId, sheetName } });
                    }}
                    isPending={isPending}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          {isActionable && (
            <div className="flex gap-2 flex-wrap border-t pt-3">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                disabled={isPending}
                title={matches.length ? "Setujui tanpa memilih kandidat manapun (override)" : undefined}
                onClick={() => {
                  const { sheetId, sheetName } = getSheetContext();
                  approveMutation.mutate({ mutationId: mutation.id, data: { sheetId, sheetName } });
                }}
              >
                <CheckCircle2 size={13} />
                {matches.length ? "Setujui (Abaikan Kandidat)" : "Setujui Tanpa Match"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50"
                disabled={isPending}
                onClick={() => {
                    const { sheetId, sheetName } = getSheetContext();
                    rejectMutation.mutate({ mutationId: mutation.id, data: { sheetId, sheetName } });
                  }}
              >
                <XCircle size={13} /> Tolak
              </Button>
            </div>
          )}

          {/* Tax Fields — untuk transaksi OUT */}
          {mutation.direction === "OUT" && (
            <TaxFieldsSection mutation={mutation} onUpdated={() => qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() })} />
          )}

          {/* Jurnal Akuntansi — tampil hanya saat approved */}
          {mutation.status === "approved" && (
            <div className="border-t pt-3 space-y-2">
              {mutation.accountingPosted && mutation.journalId ? (
                <>
                  <div className="flex items-center gap-1.5 text-xs text-green-700 font-semibold">
                    <CheckCircle2 size={13} />
                    <span>Jurnal diposting:</span>
                    <span className="font-mono bg-green-50 px-1.5 py-0.5 rounded border border-green-200">{mutation.journalId}</span>
                  </div>

                  {/* Tabel COA Debit / Kredit */}
                  {journalLoading ? (
                    <Skeleton className="h-16 rounded" />
                  ) : journalLines.length > 0 ? (
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b">
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">COA Debit</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">COA Kredit</th>
                            <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Nominal</th>
                            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Diposting oleh</th>
                            <th className="px-2 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {journalLines.map((line: any) => (
                            <tr key={line.id} className="border-b last:border-0 hover:bg-muted/10">
                              <td className="px-3 py-2">
                                <span className="font-mono text-blue-700 font-semibold">{line.debitAccountCode}</span>
                                <span className="text-muted-foreground ml-1.5">{line.debitAccountName}</span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="font-mono text-orange-700 font-semibold">{line.creditAccountCode}</span>
                                <span className="text-muted-foreground ml-1.5">{line.creditAccountName}</span>
                              </td>
                              <td className="px-3 py-2 text-right font-semibold">{formatCurrency(parseFloat(line.amount))}</td>
                              <td className="px-3 py-2 text-muted-foreground truncate max-w-[100px]">{line.postedBy ?? "—"}</td>
                              <td className="px-2 py-2 text-right">
                                {!editingCOA && (
                                  <button
                                    className="text-[10px] px-2 py-0.5 rounded border border-purple-300 bg-purple-50 text-purple-700 font-semibold hover:bg-purple-100 transition-colors"
                                    onClick={() => startEditCOA(line)}
                                  >
                                    Edit COA
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Inline Edit Form */}
                      {editingCOA && (
                        <div className="border-t bg-purple-50/60 p-3 space-y-3">
                          <p className="text-xs font-semibold text-purple-800">Koreksi COA Jurnal</p>
                          <datalist id="coa-list">
                            {COA_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                          </datalist>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Akun Debit</label>
                              <div className="flex gap-1">
                                <input
                                  list="coa-list"
                                  className="border rounded px-2 py-1 text-xs w-20 font-mono bg-white"
                                  placeholder="Kode"
                                  value={coaForm.debitAccountCode}
                                  onChange={(e) => {
                                    const found = COA_OPTIONS.find((c) => c.code === e.target.value);
                                    setCoaForm((f) => ({ ...f, debitAccountCode: e.target.value, debitAccountName: found?.name ?? f.debitAccountName }));
                                  }}
                                />
                                <input
                                  className="border rounded px-2 py-1 text-xs flex-1 bg-white"
                                  placeholder="Nama akun"
                                  value={coaForm.debitAccountName}
                                  onChange={(e) => setCoaForm((f) => ({ ...f, debitAccountName: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-orange-700 uppercase tracking-wide">Akun Kredit</label>
                              <div className="flex gap-1">
                                <input
                                  list="coa-list"
                                  className="border rounded px-2 py-1 text-xs w-20 font-mono bg-white"
                                  placeholder="Kode"
                                  value={coaForm.creditAccountCode}
                                  onChange={(e) => {
                                    const found = COA_OPTIONS.find((c) => c.code === e.target.value);
                                    setCoaForm((f) => ({ ...f, creditAccountCode: e.target.value, creditAccountName: found?.name ?? f.creditAccountName }));
                                  }}
                                />
                                <input
                                  className="border rounded px-2 py-1 text-xs flex-1 bg-white"
                                  placeholder="Nama akun"
                                  value={coaForm.creditAccountName}
                                  onChange={(e) => setCoaForm((f) => ({ ...f, creditAccountName: e.target.value }))}
                                />
                              </div>
                            </div>
                          </div>

                          <input
                            className="border rounded px-2 py-1 text-xs w-full bg-white"
                            placeholder="Catatan koreksi (opsional)"
                            value={coaForm.correctionNote}
                            onChange={(e) => setCoaForm((f) => ({ ...f, correctionNote: e.target.value }))}
                          />

                          <div className="flex gap-2">
                            <Button size="sm" className="text-xs h-7 gap-1 bg-purple-600 hover:bg-purple-700" disabled={savingCOA} onClick={handleSaveCOA}>
                              {savingCOA ? "Menyimpan..." : "Simpan Koreksi"}
                            </Button>
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setEditingCOA(false)}>Batal</Button>
                          </div>
                          <p className="text-[10px] text-purple-600">⚠ Koreksi COA dicatat di audit log. Nominal tidak berubah.</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                  disabled={isPostingJournal}
                  onClick={handlePostJournal}
                >
                  <CheckCircle2 size={13} />
                  {isPostingJournal ? "Memproses..." : "Buat Jurnal"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MONTH_NAMES: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
  "05": "Mei", "06": "Jun", "07": "Jul", "08": "Agu",
  "09": "Sep", "10": "Okt", "11": "Nov", "12": "Des",
};
function fmtMonth(m: string) {
  const [y, mo] = m.split("-");
  return `${MONTH_NAMES[mo!] ?? mo} ${y}`;
}

function ReportTab() {
  const [data, setData] = useState<{ rows: any[]; totals: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/bank-reconciliation/report`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.error) { setError(d.error); setLoading(false); return; }
        setData(d);
        setLoading(false);
      })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>;
  if (error) return <p className="text-destructive text-sm">Gagal memuat laporan: {error}</p>;
  if (!data?.totals) return null;

  const { rows, totals } = data;
  const pctApproved = totals.total > 0 ? Math.round((totals.approved / totals.total) * 100) : 0;
  const pctUnmatched = totals.total > 0 ? Math.round((totals.unmatched / totals.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Total Mutasi</p>
            <p className="text-2xl font-black mt-1">{totals.total.toLocaleString("id-ID")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              ↑ {totals.total_in ?? 0} masuk · ↓ {totals.total_out ?? 0} keluar
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Dana Masuk</p>
            <p className="text-2xl font-black mt-1 text-green-600">{formatCurrency(Number(totals.amount_in))}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Approved: {formatCurrency(Number(totals.approved_amount_in))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">✓ Disetujui</p>
            <p className="text-2xl font-black mt-1 text-blue-600">{totals.approved.toLocaleString("id-ID")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{pctApproved}% dari total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">◉ Auto Matched</p>
            <p className="text-2xl font-black mt-1 text-teal-600">{(totals.auto_matched ?? 0).toLocaleString("id-ID")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              ◔ Review: {(totals.need_review ?? 0).toLocaleString("id-ID")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">○ Belum Match</p>
            <p className="text-2xl font-black mt-1 text-orange-600">{totals.unmatched.toLocaleString("id-ID")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{pctUnmatched}% perlu tindakan</p>
          </CardContent>
        </Card>
      </div>

      {/* Pending amount alert */}
      {Number(totals.pending_amount_in) > 0 && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">Dana Masuk Belum Disetujui</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {formatCurrency(Number(totals.pending_amount_in))} masih dalam status unmatched/need_review/auto_matched/duplikat — perlu konfirmasi admin.
            </p>
          </div>
        </div>
      )}

      {/* Monthly table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide">Bulan</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide">Total</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-green-700">Masuk</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-red-700">Keluar</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-blue-700">Approved</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-rose-700">Approved Out</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-teal-700">Auto</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-yellow-700">Review</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-orange-700">Unmatched</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-emerald-700">Dijurnal</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide text-amber-700">Blm Jurnal</th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wide">% Selesai</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">Belum ada data mutasi</td></tr>
              ) : rows.map((r: any) => {
                const pct = Number(r.total) > 0 ? Math.round((Number(r.approved) / Number(r.total)) * 100) : 0;
                return (
                  <tr key={r.month} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-semibold">{fmtMonth(r.month)}</td>
                    <td className="px-3 py-3 text-right font-mono">{Number(r.total).toLocaleString("id-ID")}</td>
                    <td className="px-3 py-3 text-right text-green-700 font-medium">{formatCurrency(Number(r.amount_in))}</td>
                    <td className="px-3 py-3 text-right text-red-700 font-medium">{formatCurrency(Number(r.amount_out))}</td>
                    <td className="px-3 py-3 text-right">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                        {Number(r.approved).toLocaleString("id-ID")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {Number(r.approved_out ?? 0) > 0 ? (
                        <span className="text-rose-700 font-semibold">{Number(r.approved_out).toLocaleString("id-ID")}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {Number(r.auto_matched ?? 0) > 0 ? (
                        <span className="text-teal-700 font-semibold">{Number(r.auto_matched).toLocaleString("id-ID")}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {Number(r.need_review ?? 0) > 0 ? (
                        <span className="text-yellow-700 font-semibold">{Number(r.need_review).toLocaleString("id-ID")}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {Number(r.unmatched) > 0 ? (
                        <span className="inline-flex items-center gap-1 text-orange-700 font-semibold">
                          <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                          {Number(r.unmatched).toLocaleString("id-ID")}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {Number(r.posted ?? 0) > 0 ? (
                        <span className="text-emerald-700 font-semibold">{Number(r.posted).toLocaleString("id-ID")}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {Number(r.unposted ?? 0) > 0 ? (
                        <span className="text-amber-700 font-semibold">{Number(r.unposted).toLocaleString("id-ID")}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-orange-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`text-xs font-semibold w-8 text-right ${pct >= 80 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-orange-700"}`}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr className="border-t-2 bg-muted/30 font-semibold">
                  <td className="px-4 py-3 text-xs uppercase tracking-wide">Total</td>
                  <td className="px-3 py-3 text-right font-mono">{totals.total.toLocaleString("id-ID")}</td>
                  <td className="px-3 py-3 text-right text-green-700">{formatCurrency(Number(totals.amount_in))}</td>
                  <td className="px-3 py-3 text-right text-red-700">{formatCurrency(Number(totals.amount_out))}</td>
                  <td className="px-3 py-3 text-right">{totals.approved.toLocaleString("id-ID")}</td>
                  <td className="px-3 py-3 text-right text-rose-700">{(totals.approved_out ?? 0).toLocaleString("id-ID")}</td>
                  <td className="px-3 py-3 text-right text-teal-700">{(totals.auto_matched ?? 0).toLocaleString("id-ID")}</td>
                  <td className="px-3 py-3 text-right text-yellow-700">{(totals.need_review ?? 0).toLocaleString("id-ID")}</td>
                  <td className="px-3 py-3 text-right text-orange-700">{totals.unmatched.toLocaleString("id-ID")}</td>
                  <td className="px-3 py-3 text-right text-emerald-700">{(totals.posted ?? 0).toLocaleString("id-ID")}</td>
                  <td className="px-3 py-3 text-right text-amber-700">{(totals.unposted ?? 0).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-3 text-right text-sm">{pctApproved}%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== Audit Trail Tab =====
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  approve:             { label: "Approve", color: "bg-green-100 text-green-800" },
  reject:              { label: "Reject", color: "bg-red-100 text-red-800" },
  approve_candidate:   { label: "Approve Kandidat", color: "bg-emerald-100 text-emerald-800" },
  reject_candidate:    { label: "Reject Kandidat", color: "bg-orange-100 text-orange-800" },
  post_journal:        { label: "Posting Jurnal", color: "bg-blue-100 text-blue-800" },
  post_journal_bulk:   { label: "Bulk Posting", color: "bg-blue-100 text-blue-800" },
  edit_journal_coa:    { label: "Koreksi COA", color: "bg-purple-100 text-purple-800" },
  mark_unmatched:      { label: "Tandai Unmatched", color: "bg-yellow-100 text-yellow-800" },
  mark_duplicate:      { label: "Tandai Duplikat", color: "bg-yellow-100 text-yellow-800" },
  delete_mutations:    { label: "Hapus Mutasi", color: "bg-red-100 text-red-800" },
  close_period:        { label: "Close Periode", color: "bg-gray-100 text-gray-800" },
  reopen_period:       { label: "Reopen Periode", color: "bg-indigo-100 text-indigo-800" },
};

function AuditTrailTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [actionCounts, setActionCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterAction, setFilterAction] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const PAGE_SIZE = 50;

  const load = async (pg = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), pageSize: String(PAGE_SIZE) });
      if (filterAction !== "all") params.set("action", filterAction);
      if (search) params.set("search", search);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const r = await fetch(`${API_BASE}/bank-reconciliation/audit-trail?${params}`, { headers: authHeaders() });
      const d = await r.json();
      setRows(d.rows ?? []);
      setTotal(d.total ?? 0);
      setActionCounts(d.actionCounts ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(1); setPage(1); }, [filterAction, search, dateFrom, dateTo]);
  useEffect(() => { load(page); }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const fmtTime = (ts: string) =>
    new Date(ts).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Audit Trail Bank Rekonsiliasi</h2>
          <p className="text-xs text-muted-foreground">Semua aksi admin: approve, reject, posting jurnal, koreksi COA, closing, dll.</p>
        </div>
        <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => load(page)}>↻ Refresh</Button>
      </div>

      {/* Action summary chips */}
      {actionCounts.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {actionCounts.slice(0, 8).map((ac) => {
            const lbl = ACTION_LABELS[ac.action];
            return (
              <button
                key={ac.action}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${filterAction === ac.action ? "ring-2 ring-primary" : ""} ${lbl?.color ?? "bg-muted text-muted-foreground"}`}
                onClick={() => setFilterAction(filterAction === ac.action ? "all" : ac.action)}
              >
                {lbl?.label ?? ac.action} <span className="opacity-70">({ac.count})</span>
              </button>
            );
          })}
          {filterAction !== "all" && (
            <button className="px-2.5 py-1 rounded-full text-xs border bg-background" onClick={() => setFilterAction("all")}>✕ Reset filter</button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 text-xs h-8" placeholder="Cari aksi, IP, role..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="border rounded-md px-2 py-1.5 text-xs bg-background" value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
              <option value="all">Semua Aksi</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <Input type="date" className="text-xs h-8 w-32" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" className="text-xs h-8 w-32" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="space-y-2 p-4">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 rounded" />)}</div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Tidak ada riwayat aksi ditemukan</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2.5 text-left font-semibold">Waktu (WIB)</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Aksi</th>
                  <th className="px-3 py-2.5 text-left font-semibold">User / Role</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Entity ID</th>
                  <th className="px-3 py-2.5 text-left font-semibold">IP</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const lbl = ACTION_LABELS[row.action];
                  const isExpanded = expandedRow === row.id;
                  return (
                    <>
                      <tr key={row.id} className={`border-b hover:bg-muted/20 transition-colors ${isExpanded ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtTime(row.createdAt)}</td>
                        <td className="px-3 py-2">
                          <Badge className={`text-[10px] font-semibold ${lbl?.color ?? "bg-muted text-muted-foreground"}`}>
                            {lbl?.label ?? row.action}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.userName ?? `User #${row.userId ?? "?"}`}</span>
                          {row.userRole && <span className="ml-1 text-muted-foreground">({row.userRole})</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {row.entityId ? `#${row.entityId}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono">{row.ipAddress ?? "—"}</td>
                        <td className="px-3 py-2 text-center">
                          {(row.before || row.after) && (
                            <button
                              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${isExpanded ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                              onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                            >
                              {isExpanded ? "Tutup" : "Lihat"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (row.before || row.after) && (
                        <tr key={`${row.id}-detail`} className="bg-slate-50 border-b">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {row.before && (
                                <div>
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Before</p>
                                  <pre className="text-[10px] bg-red-50 border border-red-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                                    {JSON.stringify(row.before, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {row.after && (
                                <div>
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">After</p>
                                  <pre className="text-[10px] bg-green-50 border border-green-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                                    {JSON.stringify(row.after, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{total.toLocaleString("id-ID")} total aksi</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
            <span className="px-3 py-1 border rounded text-xs">{page} / {totalPages}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Fase 5: Exception Dashboard Tab =====
function ExceptionDashboardTab() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [auditData, setAuditData] = useState<any>(null);
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [activeException, setActiveException] = useState<"needReview" | "unmatched" | "duplicate" | "approvedUnposted" | "closedViolations">("needReview");

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, balRes] = await Promise.all([
        fetch(`${API_BASE}/bank-reconciliation/exception-dashboard`, { headers: authHeaders() }),
        fetch(`${API_BASE}/bank-reconciliation/balances`, { headers: authHeaders() }),
      ]);
      const dashData = await dashRes.json();
      const balData = await balRes.json();
      setData(dashData);
      setBalances(balData.balances ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const runAudit = async () => {
    setAuditLoading(true);
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/audit`, { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal audit");
      setAuditData(d);
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    setAuditLoading(false);
  };

  useEffect(() => { load(); }, []);

  const kpi = data?.kpi;
  const exc = data?.exceptions;

  const KPI_CARDS = kpi ? [
    { label: "Total Mutasi", value: kpi.totalMutations, color: "text-foreground", bg: "" },
    { label: "Approved", value: kpi.totalApproved, color: "text-green-700", bg: "bg-green-50" },
    { label: "Need Review", value: kpi.totalNeedReview, color: "text-orange-700", bg: "bg-orange-50" },
    { label: "Unmatched", value: kpi.totalUnmatched, color: "text-red-700", bg: "bg-red-50" },
    { label: "Duplikat", value: kpi.totalDuplicate, color: "text-yellow-700", bg: "bg-yellow-50" },
    { label: "Belum Jurnal", value: kpi.totalUnpostedJournal, color: kpi.totalUnpostedJournal > 0 ? "text-red-700" : "text-green-700", bg: kpi.totalUnpostedJournal > 0 ? "bg-red-50" : "bg-green-50" },
    { label: "Outstanding IN", value: formatCurrency(kpi.outstandingDifference), color: "text-blue-700", bg: "bg-blue-50" },
  ] : [];

  const EXCEPTION_TABS = [
    { key: "needReview", label: "Need Review", count: kpi?.totalNeedReview ?? 0, color: "text-orange-700" },
    { key: "unmatched", label: "Unmatched", count: kpi?.totalUnmatched ?? 0, color: "text-red-700" },
    { key: "duplicate", label: "Duplikat", count: kpi?.totalDuplicate ?? 0, color: "text-yellow-700" },
    { key: "approvedUnposted", label: "Belum Jurnal", count: kpi?.totalUnpostedJournal ?? 0, color: "text-red-700" },
    { key: "closedViolations", label: "Closed Violations", count: exc?.closedPeriodViolations?.length ?? 0, color: "text-purple-700" },
  ] as const;

  const currentList: any[] = exc ? (
    activeException === "needReview" ? exc.needReview :
    activeException === "unmatched" ? exc.unmatched :
    activeException === "duplicate" ? exc.duplicate :
    activeException === "approvedUnposted" ? exc.approvedUnposted :
    exc.closedPeriodViolations
  ) : [];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div>
        <h2 className="font-bold text-lg mb-3">Exception Dashboard</h2>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {KPI_CARDS.map((c) => (
              <Card key={c.label} className={`${c.bg} border`}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className={`text-xl font-black ${c.color}`}>{typeof c.value === "number" ? c.value.toLocaleString("id-ID") : c.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Bank Balance Ledger */}
      {balances.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="font-semibold text-sm mb-3">Saldo Rekening Bank</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 text-left">Rekening</th>
                    <th className="px-3 py-2 text-right">Saldo Berjalan</th>
                    <th className="px-3 py-2 text-right">Terakhir Rekonsiliasi</th>
                    <th className="px-3 py-2 text-center">Update Terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b: any) => (
                    <tr key={b.id} className="border-b hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono font-semibold">{b.bankAccountId}</td>
                      <td className={`px-3 py-2 text-right font-bold ${parseFloat(b.currentBalance) >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {formatCurrency(parseFloat(b.currentBalance))}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{b.lastReconciledBalance ? formatCurrency(parseFloat(b.lastReconciledBalance)) : "—"}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">{b.updatedAt ? new Date(b.updatedAt).toLocaleDateString("id-ID") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exception Lists */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-sm">Daftar Exception</p>
          <Button size="sm" variant="outline" onClick={load} className="text-xs h-7">↻ Refresh</Button>
        </div>

        <div className="flex gap-1 flex-wrap mb-3">
          {EXCEPTION_TABS.map(t => (
            <button key={t.key}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${activeException === t.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
              onClick={() => setActiveException(t.key)}
            >
              {t.label}
              {t.count > 0 && <span className={`ml-1.5 ${activeException === t.key ? "" : t.color}`}>{t.count}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 rounded" />)}</div>
        ) : !currentList.length ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">✓ Tidak ada exception pada kategori ini</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2.5 text-left">ID</th>
                    <th className="px-3 py-2.5 text-left">Tanggal</th>
                    <th className="px-3 py-2.5 text-left">Keterangan</th>
                    <th className="px-3 py-2.5 text-center">Arah</th>
                    <th className="px-3 py-2.5 text-right">Jumlah</th>
                    <th className="px-3 py-2.5 text-left">Rekening</th>
                  </tr>
                </thead>
                <tbody>
                  {currentList.map((m: any) => (
                    <tr key={m.id} className="border-b hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-muted-foreground">#{m.id}</td>
                      <td className="px-3 py-2">{m.transactionDate}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{m.description}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge className={m.direction === "IN" ? "bg-green-100 text-green-700 text-[10px]" : "bg-red-100 text-red-700 text-[10px]"}>{m.direction}</Badge>
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${m.direction === "IN" ? "text-green-700" : "text-red-700"}`}>
                        {formatCurrency(parseFloat(m.amount))}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground font-mono">{m.bankAccountId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Audit Section */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">Final Audit — Production Readiness</p>
              <p className="text-xs text-muted-foreground">Validasi integritas data: duplikat jurnal, invoice overpaid, closing dengan selisih, dll.</p>
            </div>
            <Button size="sm" onClick={runAudit} disabled={auditLoading}>{auditLoading ? "Mengaudit..." : "Jalankan Audit"}</Button>
          </div>

          {auditData && (
            <div className="space-y-3 mt-2">
              {/* Summary */}
              <div className={`p-3 rounded-lg border ${auditData.summary.productionReady ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{auditData.summary.productionReady ? "✅" : "❌"}</span>
                  <span className={`font-bold text-sm ${auditData.summary.productionReady ? "text-green-800" : "text-red-800"}`}>
                    {auditData.summary.productionReady ? "Production Ready" : "Ada Temuan Critical — Perlu Diperbaiki"}
                  </span>
                  <div className="ml-auto flex gap-2 text-xs">
                    {auditData.summary.critical > 0 && <span className="text-red-700 font-semibold">🔴 {auditData.summary.critical} Critical</span>}
                    {auditData.summary.warning > 0 && <span className="text-orange-700 font-semibold">🟡 {auditData.summary.warning} Warning</span>}
                    {auditData.summary.info > 0 && <span className="text-blue-700">🔵 {auditData.summary.info} Info</span>}
                  </div>
                </div>
              </div>

              {/* Findings */}
              <div className="space-y-2">
                {auditData.findings.map((f: any, i: number) => (
                  <div key={i} className={`p-3 rounded border text-xs ${f.severity === "critical" ? "bg-red-50 border-red-200" : f.severity === "warning" ? "bg-yellow-50 border-yellow-200" : "bg-blue-50 border-blue-200"}`}>
                    <div className="flex items-center gap-2">
                      <span>{f.severity === "critical" ? "🔴" : f.severity === "warning" ? "🟡" : "🔵"}</span>
                      <span className="font-semibold">{f.category}</span>
                      <span className={f.severity === "critical" ? "text-red-700" : f.severity === "warning" ? "text-orange-700" : "text-blue-700"}>
                        ({f.count})
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{f.message}</p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">Audit dijalankan: {new Date(auditData.auditTimestamp).toLocaleString("id-ID")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ===== Fase 4: Closing Bank Tab =====
function ClosingBankTab() {
  const { toast } = useToast();
  const [closings, setClosings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ periodYear: new Date().getFullYear(), periodMonth: new Date().getMonth() + 1, bankAccountId: "", openingBalance: 0, statementEndingBalance: 0, notes: "" });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/closing`, { headers: authHeaders() });
      const d = await r.json();
      setClosings(d.closings ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCompute = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/closing/compute`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ ...formData, openingBalance: Number(formData.openingBalance), statementEndingBalance: Number(formData.statementEndingBalance) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal compute closing");
      toast({ title: "Closing dihitung" });
      setShowForm(false);
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    setSubmitting(false);
  };

  const handleClose = async (id: number) => {
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/closing/${id}/close`, { method: "POST", headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal tutup");
      toast({ title: "Periode berhasil ditutup" });
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
  };

  const handleReopen = async (id: number) => {
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/closing/${id}/reopen`, { method: "POST", headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal buka kembali");
      toast({ title: "Periode dibuka kembali" });
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
  };

  const MONTH_ID = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Closing Bank Bulanan</h2>
        <Button size="sm" onClick={() => setShowForm(true)}>+ Hitung Closing Baru</Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="font-semibold text-sm">Hitung Closing Periode</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div><label className="text-xs text-muted-foreground">Tahun</label>
                <Input type="number" value={formData.periodYear} onChange={e => setFormData(f => ({ ...f, periodYear: Number(e.target.value) }))} /></div>
              <div><label className="text-xs text-muted-foreground">Bulan (1–12)</label>
                <Input type="number" min={1} max={12} value={formData.periodMonth} onChange={e => setFormData(f => ({ ...f, periodMonth: Number(e.target.value) }))} /></div>
              <div><label className="text-xs text-muted-foreground">No. Rekening (opsional)</label>
                <Input value={formData.bankAccountId} onChange={e => setFormData(f => ({ ...f, bankAccountId: e.target.value }))} placeholder="semua rekening" /></div>
              <div><label className="text-xs text-muted-foreground">Saldo Awal</label>
                <Input type="number" value={formData.openingBalance} onChange={e => setFormData(f => ({ ...f, openingBalance: Number(e.target.value) }))} /></div>
              <div><label className="text-xs text-muted-foreground">Saldo Akhir (Statement)</label>
                <Input type="number" value={formData.statementEndingBalance} onChange={e => setFormData(f => ({ ...f, statementEndingBalance: Number(e.target.value) }))} /></div>
              <div><label className="text-xs text-muted-foreground">Catatan</label>
                <Input value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCompute} disabled={submitting}>{submitting ? "Menghitung..." : "Hitung"}</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : !closings.length ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Belum ada closing. Klik "+ Hitung Closing Baru" untuk memulai.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Periode</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase">Saldo Awal</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-green-700">Total Masuk</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-red-700">Total Keluar</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase">Saldo Sistem</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase">Saldo Statement</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase">Selisih</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Status</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold uppercase">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {closings.map((c: any) => {
                  const diff = parseFloat(c.difference ?? "0");
                  const isBalanced = Math.abs(diff) <= 0.01;
                  return (
                    <tr key={c.id} className="border-b hover:bg-muted/20">
                      <td className="px-4 py-3 font-semibold">{MONTH_ID[c.periodMonth]} {c.periodYear}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs">{formatCurrency(c.openingBalance)}</td>
                      <td className="px-3 py-3 text-right text-green-700 font-medium">{formatCurrency(c.totalIn)}</td>
                      <td className="px-3 py-3 text-right text-red-700 font-medium">{formatCurrency(c.totalOut)}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs">{formatCurrency(c.systemEndingBalance)}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs">{formatCurrency(c.statementEndingBalance)}</td>
                      <td className={`px-3 py-3 text-right font-bold text-xs ${isBalanced ? "text-green-700" : "text-red-600"}`}>
                        {isBalanced ? "✓ 0" : formatCurrency(diff)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Badge className={c.status === "closed" ? "bg-green-100 text-green-700 border-green-200" : isBalanced ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-orange-100 text-orange-700 border-orange-200"}>
                          {c.status === "closed" ? "✓ Ditutup" : isBalanced ? "Seimbang" : "Belum Seimbang"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {c.status !== "closed" ? (
                          <Button size="sm" className="text-xs h-7" disabled={!isBalanced} onClick={() => handleClose(c.id)}>Tutup</Button>
                        ) : (
                          <Button size="sm" variant="outline" className="text-xs h-7 text-amber-600 border-amber-200" onClick={() => handleReopen(c.id)}>Buka</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ===== Fase 2: Aturan COA Tab =====
function AturanCOATab() {
  const { toast } = useToast();
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ transactionType: "", direction: "IN", debitCoaId: "", debitCoaName: "", creditCoaId: "", creditCoaName: "", bankAccountId: "" });
  const [submitting, setSubmitting] = useState(false);

  const TRANSACTION_TYPES = [
    { v: "payment", l: "Payment (booking masuk)" }, { v: "order", l: "Order (booking masuk)" },
    { v: "invoice", l: "Invoice / Piutang" }, { v: "other_in", l: "Lainnya (Masuk)" },
    { v: "BANK_FEE", l: "Biaya Admin Bank" }, { v: "REFUND", l: "Refund ke Customer" },
    { v: "RENT_AP", l: "Beban Sewa" }, { v: "VENDOR_PAYMENT", l: "Pembayaran Vendor" },
    { v: "OPERATIONAL", l: "Beban Operasional" },
    { v: "TAX_PPN", l: "Pajak PPN" }, { v: "TAX_PPH21", l: "Pajak PPh 21" },
    { v: "TAX_PPH23", l: "Pajak PPh 23" }, { v: "TAX_PPH_FINAL", l: "Pajak PPh Final" },
    { v: "TAX_PPH_BADAN", l: "Pajak PPh Badan" }, { v: "TAX_PAYMENT", l: "Pembayaran Pajak (Umum)" },
    { v: "OTHER", l: "Lainnya (Keluar)" },
  ];

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/account-rules`, { headers: authHeaders() });
      const d = await r.json();
      setRules(d.rules ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => setForm({ transactionType: "", direction: "IN", debitCoaId: "", debitCoaName: "", creditCoaId: "", creditCoaName: "", bankAccountId: "" });

  const handleSubmit = async () => {
    if (!form.transactionType || !form.debitCoaId || !form.creditCoaId) {
      toast({ title: "Isi semua field wajib", variant: "destructive" }); return;
    }
    setSubmitting(true);
    try {
      const url = editingId ? `${API_BASE}/bank-reconciliation/account-rules/${editingId}` : `${API_BASE}/bank-reconciliation/account-rules`;
      const method = editingId ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal simpan aturan");
      toast({ title: editingId ? "Aturan diperbarui" : "Aturan ditambahkan" });
      setShowForm(false); setEditingId(null); resetForm(); load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    setSubmitting(false);
  };

  const handleEdit = (rule: any) => {
    setForm({ transactionType: rule.transactionType, direction: rule.direction, debitCoaId: rule.debitCoaId, debitCoaName: rule.debitCoaName, creditCoaId: rule.creditCoaId, creditCoaName: rule.creditCoaName, bankAccountId: rule.bankAccountId ?? "" });
    setEditingId(rule.id);
    setShowForm(true);
  };

  const handleToggleActive = async (rule: any) => {
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/account-rules/${rule.id}`, {
        method: "PUT", headers: authHeaders(),
        body: JSON.stringify({ ...rule, isActive: !rule.isActive }),
      });
      if (!r.ok) throw new Error("Gagal update");
      load();
    } catch (e: any) { toast({ title: (e as any).message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg">Aturan COA (Chart of Accounts)</h2>
          <p className="text-xs text-muted-foreground">Mapping akun jurnal per jenis transaksi. Digunakan saat posting jurnal; fallback ke ACCOUNT_MAP default jika tidak ada aturan.</p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setEditingId(null); setShowForm(true); }}>+ Tambah Aturan</Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="font-semibold text-sm">{editingId ? "Edit Aturan" : "Tambah Aturan COA"}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Jenis Transaksi *</label>
                <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={form.transactionType} onChange={e => setForm(f => ({ ...f, transactionType: e.target.value }))}>
                  <option value="">-- pilih --</option>
                  {TRANSACTION_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Arah *</label>
                <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
                  <option value="IN">IN (Masuk)</option>
                  <option value="OUT">OUT (Keluar)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Kode Akun Debit *</label>
                <Input placeholder="e.g. 1001" value={form.debitCoaId} onChange={e => setForm(f => ({ ...f, debitCoaId: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Nama Akun Debit *</label>
                <Input placeholder="e.g. Kas/Bank" value={form.debitCoaName} onChange={e => setForm(f => ({ ...f, debitCoaName: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">No. Rekening (opsional)</label>
                <Input placeholder="spesifik rekening bank" value={form.bankAccountId} onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Kode Akun Kredit *</label>
                <Input placeholder="e.g. 4001" value={form.creditCoaId} onChange={e => setForm(f => ({ ...f, creditCoaId: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Nama Akun Kredit *</label>
                <Input placeholder="e.g. Pendapatan Booking" value={form.creditCoaName} onChange={e => setForm(f => ({ ...f, creditCoaName: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSubmit} disabled={submitting}>{submitting ? "Menyimpan..." : editingId ? "Perbarui" : "Simpan"}</Button>
              <Button size="sm" variant="outline" onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}>Batal</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 rounded" />)}</div>
      ) : !rules.length ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Belum ada aturan COA. Aturan default ACCOUNT_MAP akan digunakan.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2.5 text-left font-semibold">Jenis Transaksi</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Arah</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Debit</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Kredit</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Rekening</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Aktif</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r: any) => (
                  <tr key={r.id} className={`border-b hover:bg-muted/20 ${!r.isActive ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2 font-mono">{r.transactionType}</td>
                    <td className="px-3 py-2">
                      <Badge className={r.direction === "IN" ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}>
                        {r.direction}
                      </Badge>
                    </td>
                    <td className="px-3 py-2"><span className="font-mono">{r.debitCoaId}</span> — {r.debitCoaName}</td>
                    <td className="px-3 py-2"><span className="font-mono">{r.creditCoaId}</span> — {r.creditCoaName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.bankAccountId ?? "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => handleToggleActive(r)} className={`text-xs font-semibold ${r.isActive ? "text-green-600" : "text-muted-foreground"}`}>
                        {r.isActive ? "✓" : "✗"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2 mr-1" onClick={() => handleEdit(r)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function AdminBankReconciliation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<"dashboard" | "audit_trail" | "mutasi" | "laporan" | "closing" | "coa_rules">("dashboard");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDirection, setFilterDirection] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [bulkPosting, setBulkPosting] = useState(false);

  const handleBulkPostJournal = async () => {
    setBulkPosting(true);
    try {
      const r = await fetch(`${API_BASE}/bank-reconciliation/mutations/post-journal-bulk`, {
        method: "POST", headers: authHeaders(),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal bulk posting");
      toast({ title: `✅ ${d.posted} jurnal diposting${d.skipped ? `, ${d.skipped} dilewati (periode terkunci)` : ""}${d.errors ? `, ${d.errors} gagal` : ""}` });
      qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setBulkPosting(false);
    }
  };

  const listParams = {
    status: filterStatus !== "all" ? filterStatus : undefined,
    direction: filterDirection !== "all" ? filterDirection : undefined,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize: 30,
  };
  const { data, isLoading } = useListBankMutations(
    listParams,
    { query: { staleTime: 10000, queryKey: getListBankMutationsQueryKey(listParams) } }
  );

  const runMatchingMutation = useRunBankMatching({
    mutation: {
      onSuccess: (result: any) => {
        toast({
          title: "Matching selesai",
          description: `${result.autoMatched ?? result.autoApproved ?? 0} auto matched · ${result.needsReview ?? 0} perlu review · ${result.unmatched} unmatched · ${result.duplicates} duplikat`,
        });
        qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal jalankan matching", variant: "destructive" });
      },
    },
  });

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch("/api/bank-reconciliation/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImportResult(data);
      setShowImportDialog(true);
      qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
    } catch (err: any) {
      toast({ title: err?.message ?? "Gagal import file", variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const mutations = data?.mutations ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 30);

  // Gunakan statusCounts dari API (seluruh dataset, bukan hanya halaman saat ini)
  const stats: Record<string, number> = data?.statusCounts ?? {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Banknote size={24} className="text-primary" /> Rekonsiliasi Bank
          </h1>
          <p className="text-muted-foreground">Cocokkan mutasi rekening dengan transaksi di sistem</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {activeTab === "mutasi" && (<>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => runMatchingMutation.mutate({ data: {} })}
              disabled={runMatchingMutation.isPending}
            >
              <Zap size={14} />
              {runMatchingMutation.isPending ? "Memproses..." : "Jalankan Matching"}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileImport} />
            <Button size="sm" className="gap-2" onClick={() => fileRef.current?.click()} disabled={importing}>
              <Upload size={14} />
              {importing ? "Mengimpor..." : "Import Excel / CSV"}
            </Button>
          </>)}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit flex-wrap">
        {(["dashboard", "audit_trail", "mutasi", "laporan", "closing", "coa_rules"] as const).map((t) => (
          <button
            key={t}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab(t)}
          >
            {t === "dashboard" ? "🔍 Dashboard" : t === "audit_trail" ? "📋 Audit Trail" : t === "mutasi" ? "Mutasi" : t === "laporan" ? "Laporan" : t === "closing" ? "Closing Bank" : "Aturan COA"}
          </button>
        ))}
      </div>

      {/* Dashboard tab */}
      {activeTab === "dashboard" && <ExceptionDashboardTab />}

      {/* Audit Trail tab */}
      {activeTab === "audit_trail" && <AuditTrailTab />}

      {/* Laporan tab */}
      {activeTab === "laporan" && <ReportTab />}

      {/* Closing Bank tab */}
      {activeTab === "closing" && <ClosingBankTab />}

      {/* Aturan COA tab */}
      {activeTab === "coa_rules" && <AturanCOATab />}

      {/* Mutasi tab content */}
      <div className={activeTab === "mutasi" ? "space-y-6" : "hidden"}>

      {/* Stats bar */}
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
        {(["unmatched", "need_review", "auto_matched", "duplicate_need_review", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            className={`p-2.5 rounded-xl border text-left transition-colors ${filterStatus === s ? "ring-2 ring-primary bg-muted/40" : "hover:bg-muted/30"}`}
            onClick={() => { setFilterStatus(filterStatus === s ? "all" : s); setPage(1); }}
          >
            <div className="text-lg font-black">{stats[s] ?? 0}</div>
            <div className={`text-[10px] font-semibold mt-0.5 ${STATUS_COLORS[s]?.includes("green") ? "text-green-700" : STATUS_COLORS[s]?.includes("teal") ? "text-teal-700" : STATUS_COLORS[s]?.includes("yellow") ? "text-yellow-700" : STATUS_COLORS[s]?.includes("orange") ? "text-orange-700" : STATUS_COLORS[s]?.includes("purple") ? "text-purple-700" : STATUS_COLORS[s]?.includes("red") ? "text-red-700" : "text-muted-foreground"}`}>
              {STATUS_ICONS[s]} {STATUS_LABELS[s]}
            </div>
          </button>
        ))}
        <button
          className={`p-2.5 rounded-xl border text-left transition-colors ${filterStatus === "all" ? "ring-2 ring-primary bg-muted/40" : "hover:bg-muted/30"}`}
          onClick={() => { setFilterStatus("all"); setPage(1); }}
        >
          <div className="text-lg font-black">{(Object.values(stats) as number[]).reduce((a, b) => a + b, 0)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">☰ Semua</div>
        </button>
      </div>

      {/* Google Sheets Sync */}
      <SheetSyncPanel onImported={() => qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() })} />

      {/* Filter row */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9 text-sm" placeholder="Cari keterangan, provider..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <select
              className="border rounded-md px-3 py-2 text-sm bg-background"
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            >
              <option value="all">Semua Status</option>
              <option value="unmatched">○ Belum Match</option>
              <option value="need_review">◔ Perlu Review</option>
              <option value="auto_matched">◉ Auto Matched</option>
              <option value="duplicate_need_review">⊕ Duplikat</option>
              <option value="approved">✓ Disetujui</option>
              <option value="approved_unposted">⚠ Belum Dijurnal</option>
              <option value="rejected">✗ Ditolak</option>
            </select>
            <select
              className="border rounded-md px-3 py-2 text-sm bg-background"
              value={filterDirection}
              onChange={(e) => { setFilterDirection(e.target.value); setPage(1); }}
            >
              <option value="all">Semua Arah</option>
              <option value="IN">Masuk (CR)</option>
              <option value="OUT">Keluar (DB)</option>
            </select>
            <div className="flex gap-2">
              <Input type="date" className="text-sm w-36" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} placeholder="Dari" />
              <Input type="date" className="text-sm w-36" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} placeholder="Sampai" />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs text-blue-700 border-blue-300 hover:bg-blue-50 whitespace-nowrap"
              disabled={bulkPosting}
              onClick={handleBulkPostJournal}
            >
              <CheckCircle2 size={13} />
              {bulkPosting ? "Memproses..." : "Posting Semua Jurnal"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Mutations list */}
      <div className="space-y-2">
        {isLoading ? (
          [...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
        ) : !mutations.length ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileText size={32} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Belum ada mutasi rekening</p>
              <p className="text-sm">Import file Excel/CSV mutasi bank untuk mulai rekonsiliasi</p>
            </CardContent>
          </Card>
        ) : (
          mutations.map((m: any) => <MutationRow key={m.id} mutation={m} qc={qc} />)
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Total {total} mutasi</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Sebelumnya</Button>
            <span className="flex items-center text-sm px-3">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Berikutnya</Button>
          </div>
        </div>
      )}

      {/* Import result dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-500" /> Import Berhasil
            </DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-xl font-black">{importResult.inserted}</div>
                  <div className="text-xs text-muted-foreground">Baris diimpor</div>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-xl font-black">{importResult.skipped}</div>
                  <div className="text-xs text-muted-foreground">Dilewati / duplikat</div>
                </div>
              </div>
              {importResult.matching && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-xs space-y-1">
                  <div className="font-semibold text-green-800">Hasil Auto-Matching</div>
                  <div>✅ Auto-approve: <strong>{importResult.matching.autoApproved}</strong></div>
                  <div>🔍 Perlu review: <strong>{importResult.matching.needsReview}</strong></div>
                  <div>❓ Unmatched: <strong>{importResult.matching.unmatched}</strong></div>
                  {importResult.matching.duplicates > 0 && (
                    <div>⚠️ Duplikat: <strong>{importResult.matching.duplicates}</strong></div>
                  )}
                </div>
              )}
            </div>
          )}
          <Button onClick={() => setShowImportDialog(false)}>Tutup</Button>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
