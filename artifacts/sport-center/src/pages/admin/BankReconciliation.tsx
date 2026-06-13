import { useState, useRef } from "react";
import {
  useListBankMutations, useRunBankMatching,
  useConnectBankReconSheet, usePullBankMutationsFromSheet, usePushBankReconToSheet,
  useClearBankMutations,
  useGetBankMutationCandidates, useApproveBankMutationCandidate,
  useMarkBankMutationUnmatched, useMarkBankMutationDuplicate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListBankMutationsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Upload, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Search,
  ChevronDown, ChevronUp, Banknote, ArrowDownCircle, ArrowUpCircle,
  FileText, Zap, Sheet as SheetIcon, Download, Link, Save, Trash2,
  User, Building2, CreditCard, ExternalLink, Hash, Calendar,
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
              <SheetIcon size={16} className="text-blue-700" />
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
                    onClick={() => pullMutation.mutate({ data: { sheetId: connectedSheet.id } })}
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
                      <option value="unmatched">Hanya Belum Match</option>
                      <option value="matched">Hanya Matched</option>
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
  unmatched: "bg-yellow-100 text-yellow-800 border-yellow-200",
  matched: "bg-blue-100 text-blue-800 border-blue-200",
  duplicate_need_review: "bg-orange-100 text-orange-800 border-orange-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_LABELS: Record<string, string> = {
  unmatched: "Belum Match",
  matched: "Matched",
  duplicate_need_review: "Duplikat – Review",
  approved: "Disetujui",
  rejected: "Ditolak",
};

function formatCurrency(n: string | number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 95 ? "bg-green-500" : score >= 80 ? "bg-yellow-500" : score >= 60 ? "bg-orange-400" : "bg-gray-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-white text-xs font-bold ${color}`}>
      {score}pt
    </span>
  );
}

function EnrichedCandidateCard({
  candidate,
  isPending,
  onApprove,
}: {
  candidate: any;
  isPending: boolean;
  onApprove: (candidateId: number, candidateType: string) => void;
}) {
  const isApproved = candidate.status === "approved";
  const isRejected = candidate.status === "rejected";

  const BREAKDOWN = [
    { key: "amountMatch", label: "Nominal", active: candidate.amountMatch, color: "green" },
    { key: "dateMatch", label: "Tanggal", active: candidate.dateMatch, color: "green" },
    { key: "nameMatch", label: "Nama", active: candidate.nameMatch, color: "green" },
    { key: "orderIdMatch", label: "Order ID", active: candidate.orderIdMatch, color: "blue" },
    { key: "proofMatch", label: "Bukti", active: candidate.proofMatch, color: "purple" },
    { key: "statusValidMatch", label: "Status Valid", active: candidate.statusValidMatch, color: "teal" },
    { key: "toleranceUsed", label: "Toleransi", active: candidate.toleranceUsed, color: "orange" },
  ];

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${isApproved ? "border-green-300 bg-green-50/40" : isRejected ? "border-dashed opacity-60" : "hover:shadow-sm"}`}>
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant="outline" className="text-[10px] capitalize shrink-0">{candidate.candidateType}</Badge>
          <ScoreBadge score={candidate.matchScore} />
          {isApproved && <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">✓ Disetujui</Badge>}
          {isRejected && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Ditolak</Badge>}
          {!isApproved && !isRejected && <span className="text-[10px] text-muted-foreground">Kandidat #{candidate.candidateId}</span>}
        </div>
        {!isApproved && !isRejected && (
          <Button
            size="sm"
            className="h-7 text-xs gap-1 shrink-0 bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onApprove(candidate.candidateId, candidate.candidateType)}
            disabled={isPending}
          >
            <CheckCircle2 size={12} /> Setujui
          </Button>
        )}
      </div>

      {/* Enriched details */}
      <div className="px-3 pb-3 space-y-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {candidate.customerName && (
            <div className="flex items-center gap-1.5 min-w-0">
              <User size={11} className="text-muted-foreground shrink-0" />
              <span className="font-semibold truncate">{candidate.customerName}</span>
            </div>
          )}
          {candidate.facilityName && (
            <div className="flex items-center gap-1.5 min-w-0">
              <Building2 size={11} className="text-muted-foreground shrink-0" />
              <span className="truncate text-muted-foreground">{candidate.facilityName}</span>
            </div>
          )}
          {candidate.bookingOrderNumber && (
            <div className="flex items-center gap-1.5">
              <Hash size={11} className="text-muted-foreground shrink-0" />
              <span className="font-mono text-[11px]">{candidate.bookingOrderNumber}</span>
            </div>
          )}
          {candidate.bookingDate && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar size={11} className="shrink-0" />
              <span>{candidate.bookingDate}</span>
            </div>
          )}
          {candidate.bookingAmount && (
            <div className="flex items-center gap-1.5">
              <CreditCard size={11} className="text-muted-foreground shrink-0" />
              <span className="font-bold text-foreground">{formatCurrency(candidate.bookingAmount)}</span>
            </div>
          )}
          {candidate.bookingStatus && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-medium">{candidate.bookingStatus}</span>
            </div>
          )}
          {candidate.paymentDate && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="text-[10px]">Tgl bayar: {candidate.paymentDate}</span>
            </div>
          )}
          {candidate.paymentProofUrl && (
            <div className="flex items-center gap-1.5 col-span-2">
              <a href={candidate.paymentProofUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5">
                <ExternalLink size={10} /> Lihat bukti transfer
              </a>
            </div>
          )}
        </div>

        {/* Score breakdown */}
        <div className="flex flex-wrap gap-1 pt-1.5 border-t border-dashed">
          {BREAKDOWN.map(({ key, label, active }) => (
            <span
              key={key}
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                active
                  ? "bg-green-100 text-green-700"
                  : "bg-muted/60 text-muted-foreground"
              }`}
            >
              {active ? "✓" : "✗"} {label}
            </span>
          ))}
        </div>

        {candidate.matchReason && (
          <p className="text-[10px] text-muted-foreground italic leading-relaxed">{candidate.matchReason}</p>
        )}
      </div>
    </div>
  );
}

function MutationDetailSheet({
  mutationId,
  onClose,
  qc,
}: {
  mutationId: number | null;
  onClose: () => void;
  qc: any;
}) {
  const { toast } = useToast();

  const candidatesQuery = useGetBankMutationCandidates(mutationId ?? 0);

  const mutation = (candidatesQuery.data as any)?.mutation ?? null;
  const candidates: any[] = (candidatesQuery.data as any)?.candidates ?? [];

  const approveCandidate = useApproveBankMutationCandidate({
    mutation: {
      onSuccess: () => {
        toast({ title: "✅ Kandidat disetujui" });
        qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
        candidatesQuery.refetch();
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal menyetujui", variant: "destructive" });
      },
    },
  });

  const markUnmatched = useMarkBankMutationUnmatched({
    mutation: {
      onSuccess: () => {
        toast({ title: "Ditandai sebagai unmatched" });
        qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal", variant: "destructive" });
      },
    },
  });

  const markDuplicate = useMarkBankMutationDuplicate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Ditandai sebagai duplikat" });
        qc.invalidateQueries({ queryKey: getListBankMutationsQueryKey() });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Gagal", variant: "destructive" });
      },
    },
  });

  const isPending = approveCandidate.isPending || markUnmatched.isPending || markDuplicate.isPending;
  const isLoading = candidatesQuery.isLoading;
  const isActionable = mutation ? ["unmatched", "matched", "duplicate_need_review"].includes(mutation.status) : false;

  return (
    <Sheet open={mutationId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0 gap-0" side="right">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : mutation ? (
          <>
            {/* Header */}
            <SheetHeader className="px-5 py-4 border-b bg-muted/20 shrink-0">
              <SheetTitle className="flex items-center gap-2.5">
                {mutation.direction === "IN"
                  ? <ArrowDownCircle size={20} className="text-green-500 shrink-0" />
                  : <ArrowUpCircle size={20} className="text-red-500 shrink-0" />
                }
                <span className={`text-xl font-black ${mutation.direction === "IN" ? "text-green-600" : "text-red-600"}`}>
                  {mutation.direction === "IN" ? "+" : "-"}{formatCurrency(mutation.amount)}
                </span>
                <span className="text-sm font-normal text-muted-foreground">{mutation.direction === "IN" ? "Masuk" : "Keluar"}</span>
              </SheetTitle>
              <div className="flex flex-wrap gap-2 items-center mt-0.5">
                <Badge className={`text-[10px] border ${STATUS_COLORS[mutation.status] ?? ""}`}>
                  {STATUS_LABELS[mutation.status] ?? mutation.status}
                </Badge>
                <span className="text-xs text-muted-foreground font-medium">{mutation.transactionDate}</span>
                {mutation.providerName && (
                  <Badge variant="outline" className="text-[10px]">{mutation.providerName}</Badge>
                )}
                {mutation.providerOrderId && (
                  <Badge variant="outline" className="text-[10px] font-mono">{mutation.providerOrderId}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{mutation.description}</p>
              {mutation.mutationKey && (
                <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{mutation.mutationKey}</p>
              )}
            </SheetHeader>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm uppercase tracking-wide text-muted-foreground">
                  Kandidat Match{candidates.length > 0 && ` (${candidates.length})`}
                </h3>
                {candidatesQuery.isRefetching && (
                  <RefreshCw size={12} className="animate-spin text-muted-foreground" />
                )}
              </div>

              {!candidates.length ? (
                <div className="text-center py-10 border rounded-xl border-dashed text-muted-foreground">
                  <Search size={32} className="mx-auto mb-2 opacity-25" />
                  <p className="text-sm font-medium">Tidak ada kandidat match</p>
                  <p className="text-xs mt-1">Jalankan matching ulang atau tandai manual di bawah</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {candidates.map((c: any) => (
                    <EnrichedCandidateCard
                      key={c.id}
                      candidate={c}
                      isPending={isPending}
                      onApprove={(candidateId, candidateType) =>
                        approveCandidate.mutate({
                          id: mutationId as number,
                          data: { candidateType: candidateType as any, candidateId },
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer global actions */}
            {isActionable && (
              <SheetFooter className="px-5 py-3.5 border-t bg-muted/10 shrink-0 flex-row gap-2 flex-wrap justify-start">
                <p className="w-full text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">Aksi Global</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  disabled={isPending}
                  onClick={() => markUnmatched.mutate({ id: mutationId as number })}
                >
                  <AlertTriangle size={13} className="text-yellow-500" />
                  Tandai Unmatched
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  disabled={isPending}
                  onClick={() => markDuplicate.mutate({ id: mutationId as number })}
                >
                  <XCircle size={13} className="text-orange-500" />
                  Tandai Duplikat
                </Button>
              </SheetFooter>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Mutasi tidak ditemukan
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MutationRow({ mutation, onOpenDetail }: { mutation: any; onOpenDetail: (id: number) => void }) {
  return (
    <div
      className="border rounded-xl flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/30 hover:shadow-sm transition-all"
      onClick={() => onOpenDetail(mutation.id)}
    >
      <div className="mt-0.5 shrink-0">
        {mutation.direction === "IN"
          ? <ArrowDownCircle size={18} className="text-green-500" />
          : <ArrowUpCircle size={18} className="text-red-500" />
        }
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
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 truncate">{mutation.description}</p>
        <p className="text-[10px] text-muted-foreground/50 font-mono mt-0.5 truncate">{mutation.mutationKey}</p>
      </div>
      <div className="text-right shrink-0 ml-1">
        <div className={`font-bold text-sm ${mutation.direction === "IN" ? "text-green-600" : "text-red-600"}`}>
          {mutation.direction === "IN" ? "+" : "-"}{formatCurrency(mutation.amount)}
        </div>
        <div className="text-[10px] text-muted-foreground">{mutation.direction === "IN" ? "Masuk" : "Keluar"}</div>
      </div>
      <ChevronDown size={14} className="text-muted-foreground mt-1 shrink-0" />
    </div>
  );
}

export default function AdminBankReconciliation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDirection, setFilterDirection] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [selectedMutationId, setSelectedMutationId] = useState<number | null>(null);

  const { data, isLoading } = useListBankMutations(
    {
      status: filterStatus !== "all" ? filterStatus : undefined,
      direction: filterDirection !== "all" ? filterDirection : undefined,
      search: search || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize: 30,
    },
  );

  const runMatchingMutation = useRunBankMatching({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: "Matching selesai",
          description: `${result.autoApproved} auto-approve · ${result.needsReview} perlu review · ${result.unmatched} unmatched · ${result.duplicates} duplikat`,
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

  const stats = mutations.reduce(
    (acc, m: any) => {
      acc[m.status] = (acc[m.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

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
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(["unmatched", "matched", "duplicate_need_review", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            className={`p-3 rounded-xl border text-left transition-colors ${filterStatus === s ? "ring-2 ring-primary" : "hover:bg-muted/40"}`}
            onClick={() => { setFilterStatus(filterStatus === s ? "all" : s); setPage(1); }}
          >
            <div className="text-xl font-black">{stats[s] ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{STATUS_LABELS[s]}</div>
          </button>
        ))}
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
              <option value="unmatched">Belum Match</option>
              <option value="matched">Matched</option>
              <option value="duplicate_need_review">Duplikat</option>
              <option value="approved">Disetujui</option>
              <option value="rejected">Ditolak</option>
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
          mutations.map((m: any) => <MutationRow key={m.id} mutation={m} onOpenDetail={setSelectedMutationId} />)
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

      {/* Mutation Detail Sheet */}
      <MutationDetailSheet
        mutationId={selectedMutationId}
        onClose={() => setSelectedMutationId(null)}
        qc={qc}
      />

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
  );
}
