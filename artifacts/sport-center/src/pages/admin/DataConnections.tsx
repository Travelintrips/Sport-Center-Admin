import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  RefreshCw, Database, HardDrive, Radio, Server, MessageSquare, 
  ShieldCheck, Globe, CheckCircle2, AlertTriangle, XCircle, 
  Activity, Info, Clock, ChevronDown, ChevronUp
} from "lucide-react";
import { format } from "date-fns";
import { id } from "date-fns/locale";

type ConnectionStatus = "healthy" | "warning" | "error" | "changed" | "unavailable" | "unchecked";

interface ConnectionResult {
  key: string;
  name: string;
  type: string;
  status: ConnectionStatus;
  environment: string;
  projectRef: string | null;
  configSource: string | null;
  responseTimeMs: number | null;
  message: string;
  riskNote: string | null;
  lastChecked: string;
  details?: Record<string, unknown>;
}

interface HealthResponse {
  success: boolean;
  environment: string;
  checkedAt: string;
  summary: { total: number; healthy: number; warning: number; error: number; changed: number; unavailable: number };
  connections: ConnectionResult[];
}

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/admin/system/connections/health", {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: string; icon: React.ElementType; bg: string }> = {
  healthy:     { label: "Healthy",     color: "text-green-600",  icon: CheckCircle2,   bg: "bg-green-50 border-green-200" },
  warning:     { label: "Warning",     color: "text-amber-600",  icon: AlertTriangle,  bg: "bg-amber-50 border-amber-200" },
  error:       { label: "Error",       color: "text-red-600",    icon: XCircle,        bg: "bg-red-50 border-red-200" },
  changed:     { label: "Changed",     color: "text-orange-600", icon: AlertTriangle,  bg: "bg-orange-50 border-orange-200" },
  unavailable: { label: "Unavailable", color: "text-slate-500",  icon: XCircle,        bg: "bg-slate-50 border-slate-200" },
  unchecked:   { label: "Unchecked",   color: "text-slate-400",  icon: Activity,       bg: "bg-slate-50 border-slate-100" },
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  database:           Database,
  storage:            HardDrive,
  realtime:           Radio,
  "frontend-realtime": Globe,
  api:                Server,
  messaging:          MessageSquare,
  auth:               ShieldCheck,
};

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "healthy", label: "Healthy" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
  { value: "unavailable", label: "Unavailable" },
];

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unchecked;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.color}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function SummaryCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <Card className="border shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
        <div>
          <div className="text-2xl font-black">{value}</div>
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionRow({ conn }: { conn: ConnectionResult }) {
  const [expanded, setExpanded] = useState(false);
  const TypeIcon = TYPE_ICONS[conn.type] ?? Server;

  return (
    <>
      <tr className="border-b hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <TypeIcon size={14} className="text-muted-foreground" />
            </div>
            <div>
              <div className="font-semibold text-sm">{conn.name}</div>
              <div className="text-xs text-muted-foreground">{conn.type}</div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3"><StatusBadge status={conn.status} /></td>
        <td className="px-4 py-3">
          <Badge variant="outline" className="text-xs font-mono">
            {conn.environment}
          </Badge>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
          {conn.projectRef ? (
            <span className="bg-muted px-2 py-0.5 rounded">{conn.projectRef}</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="text-xs text-muted-foreground max-w-[200px] truncate" title={conn.message}>
            {conn.message}
          </div>
          {conn.riskNote && (
            <div className="text-xs text-amber-600 font-medium mt-0.5">{conn.riskNote}</div>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {conn.responseTimeMs !== null ? `${conn.responseTimeMs}ms` : "—"}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {conn.lastChecked ? format(new Date(conn.lastChecked), "HH:mm:ss", { locale: id }) : "—"}
        </td>
        <td className="px-4 py-3">
          {conn.details && Object.keys(conn.details).length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Detail
            </button>
          )}
        </td>
      </tr>
      {expanded && conn.details && (
        <tr className="bg-muted/20">
          <td colSpan={8} className="px-4 py-3">
            <div className="text-xs space-y-1">
              <div className="font-semibold text-muted-foreground mb-2 uppercase tracking-wider text-[10px]">Detail Koneksi</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {conn.configSource && (
                  <div className="bg-white dark:bg-slate-800 rounded p-2 border">
                    <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Config Source</div>
                    <div className="font-mono text-xs">{conn.configSource}</div>
                  </div>
                )}
                {Object.entries(conn.details).map(([k, v]) => (
                  <div key={k} className="bg-white dark:bg-slate-800 rounded p-2 border">
                    <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">{k}</div>
                    <div className="font-mono text-xs">
                      {Array.isArray(v) ? v.join(", ") || "—" : String(v ?? "—")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function DataConnections() {
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery<HealthResponse>({
    queryKey: ["system-connections-health"],
    queryFn: fetchHealth,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const filtered = (data?.connections ?? []).filter(
    (c) => statusFilter === "all" || c.status === statusFilter
  );

  const hasAlerts = (data?.summary.error ?? 0) + (data?.summary.changed ?? 0) > 0;
  const hasWarnings = (data?.summary.warning ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Data Connection Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor semua koneksi data — database, storage, realtime, API, dan layanan eksternal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock size={12} />
              Cek terakhir: {format(new Date(dataUpdatedAt), "HH:mm:ss")}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            Check Now
          </Button>
        </div>
      </div>

      {/* Alert Banner */}
      {hasAlerts && !isLoading && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-bold text-sm">
              {data!.summary.error} koneksi error
              {data!.summary.changed > 0 ? `, ${data!.summary.changed} berubah` : ""}
            </div>
            <div className="text-xs mt-0.5">
              {data!.connections
                .filter((c) => c.status === "error" || c.status === "changed")
                .map((c) => `${c.name}: ${c.message}`)
                .join(" · ")}
            </div>
          </div>
        </div>
      )}

      {hasWarnings && !hasAlerts && !isLoading && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-bold text-sm">{data!.summary.warning} koneksi dengan warning</div>
            <div className="text-xs mt-0.5">
              {data!.connections
                .filter((c) => c.status === "warning")
                .map((c) => c.name)
                .join(", ")}
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Total" value={data?.summary.total ?? 0} icon={Activity} color="bg-slate-500" />
        <SummaryCard label="Healthy" value={data?.summary.healthy ?? 0} icon={CheckCircle2} color="bg-green-500" />
        <SummaryCard label="Warning" value={data?.summary.warning ?? 0} icon={AlertTriangle} color="bg-amber-500" />
        <SummaryCard label="Error" value={data?.summary.error ?? 0} icon={XCircle} color="bg-red-500" />
        <SummaryCard label="Changed" value={data?.summary.changed ?? 0} icon={AlertTriangle} color="bg-orange-500" />
        <SummaryCard label="Unavailable" value={data?.summary.unavailable ?? 0} icon={XCircle} color="bg-slate-400" />
      </div>

      {/* Environment Info */}
      {data && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info size={12} />
          <span>Environment: <span className="font-semibold">{data.environment}</span></span>
          <span>·</span>
          <span>Dicek: <span className="font-mono">{format(new Date(data.checkedAt), "dd MMM yyyy HH:mm:ss", { locale: id })}</span></span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              statusFilter === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            {opt.label}
            {opt.value !== "all" && data && (
              <span className="ml-1 opacity-70">
                ({data.connections.filter((c) => c.status === opt.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Connections Table */}
      <Card className="border shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-bold">Daftar Koneksi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <XCircle size={40} className="text-red-400" />
              <div className="font-bold text-red-600">Gagal memuat health check</div>
              <div className="text-sm text-muted-foreground">{String(error)}</div>
              <Button size="sm" onClick={() => refetch()} className="mt-2">Coba Lagi</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Tidak ada koneksi dengan status "{statusFilter}"
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Koneksi</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Env</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project Ref</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pesan</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Response</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Check</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((conn) => (
                    <ConnectionRow key={conn.key} conn={conn} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Note */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border text-xs text-muted-foreground">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-green-600" />
        <div>
          <span className="font-semibold text-foreground">Keamanan:</span> Halaman ini tidak menampilkan secret values, full URL, service role key, atau password.
          Hanya project ref, host, schema, dan status koneksi yang ditampilkan. Data sensitif di-mask secara otomatis oleh backend.
        </div>
      </div>
    </div>
  );
}
