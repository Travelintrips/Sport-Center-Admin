import { useState, useRef } from "react";
import { useListBankMutations, useGetBankMutationMatches, useApproveBankMutation, useRejectBankMutation, useRunBankMatching } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListBankMutationsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Upload, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Search,
  ChevronDown, ChevronUp, Banknote, ArrowDownCircle, ArrowUpCircle,
  Filter, FileText, Zap,
} from "lucide-react";

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
  const color = score >= 95 ? "bg-green-500" : score >= 80 ? "bg-yellow-500" : "bg-gray-400";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-xs font-bold ${color}`}>
      {score}
    </span>
  );
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
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs capitalize">{match.candidateType}</Badge>
          <span className="text-sm font-medium">ID #{match.candidateId}</span>
          <ScoreBadge score={match.matchScore} />
          {match.status === "approved" && (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Disetujui</Badge>
          )}
          {match.status === "rejected" && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Ditolak</Badge>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {match.amountMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ Nominal</span>}
          {match.dateMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ Tanggal</span>}
          {match.nameMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">✓ Nama</span>}
          {match.orderIdMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">✓ Order ID</span>}
          {match.proofMatch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">✓ Bukti</span>}
        </div>
        {match.matchReason && (
          <p className="text-xs text-muted-foreground mt-1 truncate">{match.matchReason}</p>
        )}
      </div>
      {match.status === "candidate" && (
        <Button size="sm" className="shrink-0 h-7 text-xs gap-1" onClick={() => onApprove(match.id)} disabled={isPending}>
          <CheckCircle2 size={12} /> Pilih
        </Button>
      )}
    </div>
  );
}

function MutationRow({ mutation, qc }: { mutation: any; qc: any }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const matchesQuery = useGetBankMutationMatches(mutation.id, {
    query: { enabled: expanded, staleTime: 30000 },
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
  const matches = matchesQuery.data?.matches ?? [];
  const isActionable = ["unmatched", "matched", "duplicate_need_review"].includes(mutation.status);

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
          {/* Candidates */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Kandidat Match</div>
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
                    onApprove={(matchId) =>
                      approveMutation.mutate({ mutationId: mutation.id, data: { matchId } })
                    }
                    isPending={isPending}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          {isActionable && (
            <div className="flex gap-2 flex-wrap border-t pt-3">
              {!matches.length && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  disabled={isPending}
                  onClick={() => approveMutation.mutate({ mutationId: mutation.id, data: {} })}
                >
                  <CheckCircle2 size={13} /> Setujui Tanpa Match
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50"
                disabled={isPending}
                onClick={() => rejectMutation.mutate({ mutationId: mutation.id })}
              >
                <XCircle size={13} /> Tolak
              </Button>
            </div>
          )}
        </div>
      )}
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
    { query: { staleTime: 10000 } }
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
  );
}
