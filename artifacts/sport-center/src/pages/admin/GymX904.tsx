import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListMemberships } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Activity, ArrowRight, Download, Fingerprint, RefreshCw, Search, ShieldCheck, Users, Link2, DoorOpen, ScrollText, LayoutDashboard, Cpu } from "lucide-react";
import { getToken } from "@/lib/auth";
import GymX904UserControl from "./GymX904UserControl";

interface IntegrationStatus { stored_logs?:number|null; processed_events?:number|null; pending_events?:number|null; processingLedgerReady?:boolean; receiver: string; hardware: string; synchronizing: boolean; legacyGymService: string; note: string; eventIngestConfigured?: boolean; eventReadEnabled?: boolean; eventStorageReady?: boolean; trustedAdmsIngestAt?: string | null; storedEventCount?: number | null; lastStoredEventAt?: string | null; connectionTestedAt?: string | null; lastDurableSyncAt?: string | null; }
interface LanStatus { synchronized: boolean; users: number; logs: number; deviceLogs?: number; lastCompleteAt?: string; }
interface LanUser { user_pin: string; display_name: string; device_uid: number; device_role: number; last_seen_at: string; }
interface LanUsersResult { source: string; users: LanUser[]; }
interface LanLog { event_id: string; user_pin: string; device_time: string; received_at: string; }
interface LanLogsResult { source: string; events: LanLog[]; }

interface AdmsDiagnostic { lastRejectedAttendanceAt?: string | null; rejectedUntrustedAttendance?: number; rejectedUnparseableAttendance?: number; attendanceStorageFailures?: number; refusedRequests?: {unsupported:number;unknownSerial:number}; rejectedReasons?: {invalid_url:number;serial_invalid:number;unsupported:number}; rejectedOperations?: Record<string,number>; rejectedTables?: Record<string,number>; rejectedPostShapes?: Record<string,number>; recentContacts?: Array<{kind:string;receivedAt:string;sourceTag:string;method:string;clientHint?:string;sourceTagIsAuthentication?:boolean}>; releaseFingerprint?: string; enabled: boolean; hardwareVerified: boolean; ingesting: boolean; lastContact: null | {kind:string;receivedAt:string;method:string;contentType:string;bytes:number}; lastAttlogShape?: null | {receivedAt:string;rows:number;columnCounts:number[];bodyBytes:number;parseable:boolean}; }
interface AdmsAuditEvent { id:string; received_at:string; kind:string; outcome:string; method:string; client_hint:string; body_bytes:number; row_count:number; connector_authorized:boolean; device_identity_verified:boolean; attlog_parseable:boolean|null; attlog_min_columns:number|null; }
interface AdmsAuditResult { ready:boolean; hardwareVerified:false; sourceIdentity:"unverified"; eventCount:number; events:AdmsAuditEvent[]; }
interface DeviceMapping { device_serial:string; user_pin:string; membership_id:number|null; status:string; review_reason:string|null; verified_at:string|null; }
interface DeviceEvent { event_id: string; user_pin: string; device_time: string; attendance_status: number; verification_type: number; received_at: string; }
interface DeviceEventResult { enabled: boolean; events: DeviceEvent[]; }
interface ObservedPin { user_pin: string; event_count: number; last_device_time: string | null; last_received_at: string | null; }
interface ObservedPinResult { source: string; users: ObservedPin[]; }
type GymTab = "dashboard" | "device" | "users" | "rules" | "events" | "members" | "mapping" | "access" | "audit";

interface Checkin {
  id: number;
  membershipId: number;
  checkinDate: string;
  checkedInAt: string;
  notes: string | null;
  memberName: string | null;
  memberPhone: string | null;
}

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const localDate = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const formatTime = (raw: string) => {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
};
const csvCell = (value: unknown) => '"' + String(value ?? "").replace(/"/g, '""') + '"';

export default function GymX904() {
  const [date, setDate] = useState(localDate);
  const [search, setSearch] = useState("");
  const [machineUserSearch, setMachineUserSearch] = useState("");
  const [machineRoleFilter, setMachineRoleFilter] = useState("all");
  const [tab, setTab] = useState<GymTab>("dashboard");
  const [selectedMachineUser,setSelectedMachineUser] = useState<{user:LanUser;action:"UPDATE_USER"|"DELETE_USER";request:number}|null>(null);
  const queryClient = useQueryClient();
  const {data:userCommandCapabilities}=useQuery<{allowed:boolean;enabled:boolean;manualAccessAllEnabled?:boolean;operations:Array<"CREATE_USER"|"UPDATE_USER"|"DELETE_USER"|"SUSPEND_USER"|"ACTIVATE_USER">}>({
    queryKey:["gym-x904-user-capabilities"],
    queryFn:async()=>{
      const token=getToken();if(!token)throw new Error("Sesi admin tidak tersedia");
      const response=await fetch(`${API}/admin/gym-x904/user-command/capabilities`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
      if(!response.ok)throw new Error("Hak kontrol X904 tidak tersedia");
      return response.json();
    },enabled:tab==="users",retry:false,staleTime:30000
  });
  const {data:verifiedAccess,refetch:refetchVerifiedAccess}=useQuery<{source:string;users:Array<{user_pin:string;device_uid:number;device_group:number;completed_at:string}>}>({
    queryKey:["gym-x904-manual-access-status"],
    queryFn:async()=>{
      const token=getToken();if(!token)throw new Error("Sesi admin tidak tersedia");
      const response=await fetch(API+"/admin/gym-x904/manual-access-status",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
      if(!response.ok)throw new Error("Status akses terverifikasi tidak tersedia");
      return response.json();
    },enabled:tab==="users"&&!!userCommandCapabilities?.allowed,retry:false,refetchInterval:15000
  });
  const accessFor=(user:LanUser)=>verifiedAccess?.users.find(x=>x.user_pin===user.user_pin&&x.device_uid===user.device_uid);
  const {data:machineAccess,isError:machineAccessError}=useQuery<{
    available:boolean;source:string;observedAt:string|null;machineCount:number|null;appCount:number;
    missingInMachine?:number;unmatchedIdentity?:number;
    users:Array<{user_pin:string;display_name:string;device_group:number;enabled:boolean;device_role:number;device_uid:number|null;identityMatched:boolean}>
  }>({
    queryKey:["gym-x904-live-access-status"],
    queryFn:async()=>{
      const token=getToken();if(!token)throw new Error("Sesi admin tidak tersedia");
      const response=await fetch(API+"/admin/gym-x904/live-access-status",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
      if(!response.ok)throw new Error("Snapshot mesin belum tersedia");
      return response.json();
    },
    enabled:tab==="users"&&!!userCommandCapabilities?.allowed,retry:false,refetchInterval:15000
  });
  const machineSnapshotFresh=!!machineAccess?.observedAt &&
    Date.now()-new Date(machineAccess.observedAt).getTime()>=0 &&
    Date.now()-new Date(machineAccess.observedAt).getTime()<300000;
  const machineFor=(user:LanUser)=>machineAccess?.users.find(x=>x.user_pin===user.user_pin);
  const manualAccessAllEnabled=userCommandCapabilities?.manualAccessAllEnabled===true;

  const [accessNotice,setAccessNotice]=useState("");
  const [accessBusyPin,setAccessBusyPin]=useState<string|null>(null);
  async function changeManualAccess(user:LanUser,op:"SUSPEND_USER"|"ACTIVATE_USER") {
    if(accessBusyPin || !userCommandCapabilities?.enabled || !userCommandCapabilities.operations.includes(op) || user.device_role!==0)return;
    if(!window.confirm((op==="SUSPEND_USER"?"Suspend":"Aktifkan")+" PIN "+user.user_pin+"?"))return;
    setAccessBusyPin(user.user_pin);setAccessNotice("Menunggu konfirmasi mesin untuk PIN "+user.user_pin);
    try { const token=getToken();if(!token)throw new Error("Sesi admin tidak tersedia");
      const response=await fetch(API+"/admin/gym-x904/user-command",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({commandType:op,userPin:user.user_pin,expectedUid:user.device_uid,expectedName:user.display_name,expectedSerial:"TDBD234200545",confirmPin:user.user_pin,idempotencyKey:crypto.randomUUID().replace(/-/g,"")})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Perintah ditolak");setAccessNotice("Perintah PIN "+user.user_pin+" masuk antrean; menunggu ACK dan pembacaan ulang mesin."); void refetchVerifiedAccess();
    }catch(e){setAccessNotice(e instanceof Error?e.message:"Perintah gagal");}finally{setAccessBusyPin(null);}
  }
  const [commandMessage, setCommandMessage] = useState("");
  const { data: readCommand, refetch: refetchReadCommand } = useQuery<{command: null | {command_id:string;state:string;created_at:string;completed_at:string|null;result:Record<string,unknown>|null;error_code:string|null}}>({
    queryKey: ["gym-x904-read-command"],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch(`${API}/admin/gym-x904/read-command`, {headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
      if (!response.ok) throw new Error("Status perintah tidak tersedia");
      return response.json();
    },
    refetchInterval: 15000,
  });
  const requestReadStatus = async () => {
    const token = getToken();
    if (!token) {setCommandMessage("Sesi admin tidak tersedia");return;}
    setCommandMessage("Mengirim permintaan status...");
    try {
      const response = await fetch(`${API}/admin/gym-x904/read-command`, {method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:"{}"});
      if (!response.ok) throw new Error(response.status===409?"Permintaan sebelumnya masih menunggu ACK":"Gagal mengirim perintah");
      setCommandMessage("GET_STATUS masuk antrean. Menunggu ACK VMSC.");
      await refetchReadCommand();
    } catch(e) {setCommandMessage(e instanceof Error?e.message:"Permintaan gagal");}
  };
  const { data: integration, isError: integrationError } = useQuery<IntegrationStatus>({
    queryKey: ["gym-x904-integration"],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch(`${API}/admin/gym-x904/integration`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("Status integrasi tidak dapat dibaca");
      return response.json();
    },
    refetchInterval: 30000,
  });
  const heartbeatAt = integration?.connectionTestedAt;
  const heartbeatAge = heartbeatAt ? Date.now() - new Date(heartbeatAt).getTime() : null;
  const heartbeatHealthy = heartbeatAge !== null && Number.isFinite(heartbeatAge) && heartbeatAge >= 0 && heartbeatAge < 300000;
  const command = readCommand?.command;
  const ackAge = command?.state === "queued" ? Date.now() - new Date(command.created_at).getTime() : null;
  const ackDelayed = ackAge !== null && Number.isFinite(ackAge) && ackAge > 180000;
  const { data: admsDiagnostic, isError: admsDiagnosticError } = useQuery<AdmsDiagnostic>({
    queryKey: ["gym-x904-adms-diagnostic"],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch("/api/admin/gym-x904/adms-diagnostic", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("Diagnostik ADMS tidak dapat dibaca");
      return response.json();
    },
    enabled: tab === "device" || tab === "audit" || tab === "dashboard",
    refetchInterval: 10000,
    retry: 1,
  });
  const { data: admsAudit, isError: admsAuditError } = useQuery<AdmsAuditResult>({
    queryKey: ["gym-x904-adms-durable-audit"],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch("/api/admin/gym-x904/adms-audit", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("Audit permanen ADMS tidak tersedia");
      return response.json();
    },
    enabled: tab === "device" || tab === "audit",
    refetchInterval: 15000,
    retry: 1,
  });
  const { data: memberships, isLoading: membersLoading, isError: membersError } = useListMemberships({});
  const { data, isLoading, isError, isFetching, error, refetch } = useQuery<Checkin[]>({
    queryKey: ["gym-checkins", date],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia. Silakan login kembali.");
      const response = await fetch(`${API}/memberships/checkins?date=${encodeURIComponent(date)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Tidak dapat memuat absensi (${response.status})`);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error("Format data absensi tidak valid");
      return rows as Checkin[];
    },
    refetchInterval: 30000,
    retry: 1,
  });
  const { data: deviceData, isError: deviceError, isLoading: deviceLoading, refetch: refetchDevice } = useQuery<DeviceEventResult>({
    queryKey: ["gym-x904-device-events", date],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch(`${API}/admin/gym-x904/device-events?date=${encodeURIComponent(date)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("Log perangkat X904 tidak dapat dibaca");
      return response.json();
    },
    enabled: tab === "events" || tab === "dashboard" || tab === "audit",
    refetchInterval: 30000,
    retry: 1,
  });
  const { data: observedPins, isLoading: observedLoading, isError: observedError } = useQuery<ObservedPinResult>({
    queryKey: ["gym-x904-observed-pins"],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch(`${API}/admin/gym-x904/observed-pins`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("Data PIN pada log X904 belum dapat dibaca");
      return response.json();
    },
    enabled: tab === "users" || tab === "mapping" || tab === "audit",
    refetchInterval: 30000,
    retry: 1,
  });
  const { data: lanStatus, isError: lanStatusError } = useQuery<LanStatus>({
    queryKey: ["gym-x904-lan-status"],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch(`${API}/admin/gym-x904/lan-status`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("Status konektor LAN tidak tersedia");
      return response.json();
    },
    refetchInterval: 30000,
    retry: 1,
  });
  const { data: lanUsers, isError: lanUsersError, isLoading: lanUsersLoading } = useQuery<LanUsersResult>({
    queryKey: ["gym-x904-lan-users"],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch(`${API}/admin/gym-x904/lan-users`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("Daftar user mesin LAN tidak tersedia");
      return response.json();
    },
    enabled: tab === "users" || tab === "mapping" || tab === "audit",
    refetchInterval: 30000,
    retry: 1,
  });
  const { data: lanLogs, isError: lanLogsError, isLoading: lanLogsLoading } = useQuery<LanLogsResult>({
    queryKey: ["gym-x904-lan-logs", date],
    queryFn: async () => {
      const token = getToken();
      if (!token) throw new Error("Sesi admin tidak tersedia");
      const response = await fetch(`${API}/admin/gym-x904/lan-logs?date=${encodeURIComponent(date)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
      });
      if (!response.ok) throw new Error("Riwayat mesin LAN tidak tersedia");
      return response.json();
    },
    enabled: tab === "events" || tab === "audit",
    refetchInterval: 30000,
    retry: 1,
  });
  const {data: mappingData, isError: mappingError, isLoading: mappingLoading} = useQuery<{rows:DeviceMapping[],source:string}>({
    queryKey:["gym-x904-member-mapping"],
    queryFn:async () => {
      const token=getToken();
      if(!token) throw new Error("Sesi admin tidak tersedia");
      const res=await fetch(`${API}/admin/gym-x904/member-mapping`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
      if(!res.ok) throw new Error("Mapping tidak tersedia");
      return res.json();
    },
    enabled:tab==="users" || tab==="mapping" || tab==="audit",
    refetchInterval:30000,
  });
  const mappingRows=mappingData?.rows ?? [];
  const observedRows = Array.isArray(observedPins?.users) ? observedPins.users : [];
  const deviceRows = deviceData?.enabled && Array.isArray(deviceData.events) ? deviceData.events : [];
  const tabs: { id: GymTab; label: string; icon: typeof Activity }[] = [
    { id: "dashboard", label: "Dashboard Gym", icon: LayoutDashboard },
    { id: "device", label: "Monitoring X904", icon: Cpu },
    { id: "users", label: "User Mesin X904", icon: Users },
    { id: "events", label: "Riwayat Log X904", icon: Fingerprint },
    { id: "members", label: "Member Gym", icon: Users },
    { id: "mapping", label: "Pemetaan Member", icon: Link2 },
    { id: "audit", label: "Audit & Diagnostik", icon: ScrollText },
  ];
  const rows = Array.isArray(data) ? data : [];
  const filtered = useMemo(() => rows.filter((row) =>
    [row.memberName, row.memberPhone, row.membershipId].some((v) =>
      String(v ?? "").toLowerCase().includes(search.toLowerCase().trim())
    )
  ), [rows, search]);
  const activeMembers = Array.isArray(memberships) ? memberships.filter((m) => m.status === "active").length : null;

  const exportCsv = () => {
    const lines = [
      ["Tanggal", "Jam WIB", "ID Member", "Nama", "Telepon", "Sumber"].map(csvCell).join(","),
      ...filtered.map((row) => [row.checkinDate, formatTime(row.checkedInAt), row.membershipId, row.memberName, row.memberPhone, "Check-in SC (bukan X904)"].map(csvCell).join(","))
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `absensi-gym-sc-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="relative overflow-hidden rounded-3xl border border-slate-700/30 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-6 py-7 text-white shadow-xl shadow-slate-900/10 md:px-9 md:py-9">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-indigo-400/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-1/4 h-36 w-36 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100"><Fingerprint size={13} /> Gym Intelligence · Solution X904</span>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Pusat Kendali Gym</h1>
            <p className="max-w-xl text-sm leading-relaxed text-slate-300 md:text-base">Pantau member, aktivitas gym, dan sinkronisasi perangkat dalam satu workspace yang mudah digunakan.</p>
            <p className="text-xs text-slate-400">Monitoring perangkat dan absensi resmi dipisahkan untuk menjaga keakuratan data.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-[11px] font-medium text-slate-300">Member aktif</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{membersLoading ? "—" : membersError ? "—" : activeMembers ?? "—"}</p>
              <p className="mt-1 text-[11px] text-slate-400">Data Sport Center</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-[11px] font-medium text-slate-300">Log tersimpan</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{lanStatusError ? "—" : lanStatus?.logs?.toLocaleString("id-ID") ?? "—"}</p>
              <p className="mt-1 text-[11px] text-slate-400">Snapshot LAN</p>
            </div>
            <div className="col-span-2 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm sm:col-span-1">
              <p className="text-[11px] font-medium text-slate-300">Gateway utama</p>
              <p className="mt-1 flex items-center gap-2 text-xl font-bold"><span className="h-2 w-2 rounded-full bg-cyan-400" />VMSC</p>
              <p className="mt-1 text-[11px] text-slate-400">Status aktual di panel monitoring</p>
            </div>
          </div>
        </div>
      </header>
      <nav aria-label="Menu Gym X904" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${tab === id ? "border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/20" : "border-transparent bg-slate-50 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"}`}>
            <Icon size={16} />{label}
          </button>
        ))}
      </nav>
      {(tab === "dashboard" || tab === "device" || tab === "audit") && <section aria-label="Komunikasi dua arah X904" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><Activity size={22} aria-hidden="true" /></span>
            <div className="space-y-1">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-50">Komunikasi dua arah X904 <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">Baca saja</span></h2>
              <p className="text-sm text-muted-foreground">Permintaan status melalui Supabase → VMSC, tanpa mengubah data pengguna atau mesin.</p>
            </div>
          </div>
          <button type="button" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500" onClick={() => {void requestReadStatus();}}><RefreshCw size={16} aria-hidden="true" /> Cek Status Mesin</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Heartbeat VMSC</p>
            <p className={`mt-2 text-lg font-semibold ${integrationError || !heartbeatHealthy ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>{integrationError ? "Tidak tersedia" : heartbeatHealthy ? "Aktif" : "Terlambat / tidak tersedia"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{heartbeatAt ? `Terakhir ${formatTime(heartbeatAt)} WIB` : "Belum ada heartbeat terverifikasi"}</p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4 dark:border-sky-900 dark:bg-sky-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Sinkronisasi database</p>
            <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">{integrationError ? "Tidak tersedia" : integration?.lastDurableSyncAt ? `Terakhir ${formatTime(integration.lastDurableSyncAt)} WIB` : "Belum tersedia"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{integration?.lastDurableSyncAt ? "Snapshot database tersimpan" : "Belum ada konfirmasi penyimpanan"}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">ACK status mesin</p>
            <p className={`mt-2 text-lg font-semibold ${ackDelayed || command?.state === "failed" ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-slate-50"}`}>{ackDelayed ? "Terlambat lebih dari 3 menit" : command?.state === "completed" ? "Selesai" : command?.state === "queued" ? "Menunggu VMSC" : command?.state === "failed" ? "Gagal" : "Belum ada permintaan"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{command?.completed_at ? `Diterima ${formatTime(command.completed_at)} WIB` : command?.state === "queued" ? "Menunggu jawaban gateway" : "Perintah baca status saja"}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">{command?.state === "completed" ? "Permintaan status terakhir selesai diproses VMSC." : commandMessage || (command?.state === "queued" ? "GET_STATUS masuk antrean. Menunggu ACK VMSC." : "Belum ada permintaan baru.")}</p>
        <p className="mt-2 text-xs text-muted-foreground">Heartbeat bukan bukti pengiriman data. Waktu sinkronisasi menunjukkan penyimpanan terakhir, bukan koneksi mesin saat ini.</p>
        {command?.result && <details className="mt-3 rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Detail jawaban terakhir VMSC</summary><pre className="mt-3 overflow-x-auto text-xs">{JSON.stringify(command.result,null,2)}</pre></details>}
      </section>}
      {tab === "audit" && <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3"><Fingerprint className="h-6 w-6 text-primary" aria-hidden="true" /><h2 className="font-semibold">Solution X904</h2><span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">{integration?.synchronizing ? "Sedang sinkronisasi" : admsDiagnostic?.enabled ? "Receiver diagnostik aktif — mesin belum terverifikasi" : "Server ADMS belum siap"}</span></div>
        <p className="text-sm text-muted-foreground">Receiver diagnostik dapat menerima handshake, tetapi tidak membuktikan X904 fisik online. Data check-in SC tidak dianggap sebagai absensi mesin.</p>
        <div className="text-sm" role="status">
          <strong>Kontak ADMS terakhir:</strong> {admsDiagnosticError ? "Diagnostik tidak dapat dibaca" : admsDiagnostic?.lastContact ? `${admsDiagnostic.lastContact.kind} pada ${new Date(admsDiagnostic.lastContact.receivedAt).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"})} WIB — sumber belum terautentikasi` : "Belum ada kontak yang terdeteksi pada proses server ini"}
        </div>
      </div>}
      {(tab === "dashboard" || tab === "device") && <section className="rounded-xl border bg-card p-4 space-y-2">
        <h2 className="font-semibold">Sinkronisasi LAN via VMSC (gateway utama, baca saja)</h2>
        {lanStatus?.lastCompleteAt && <p className="text-sm" role="status">{Number.isFinite(Date.parse(lanStatus.lastCompleteAt)) && Date.now() - Date.parse(lanStatus.lastCompleteAt) < 10 * 60 * 1000 && Date.now() >= Date.parse(lanStatus.lastCompleteAt) ? "Snapshot LAN terbaru (kurang dari 10 menit). Ini bukan bukti X904 online." : "Snapshot terakhir lebih dari 10 menit lalu. Sinkronisasi log terjadwal setiap 30 menit; status online dilihat dari heartbeat VMSC."}</p>}
        {lanStatusError ? <p role="status">Backend konektor LAN belum tersedia atau belum dikonfigurasi.</p> :
          lanStatus?.synchronized ? <>
            <p className="text-sm">Snapshot berhasil disimpan: <strong>{lanStatus.users} pengguna dan {lanStatus.logs} log</strong> (dari {lanStatus.deviceLogs ?? "?"} log di perangkat).</p>
            <p className="text-xs text-muted-foreground">Sinkronisasi terakhir: {lanStatus.lastCompleteAt ? new Date(lanStatus.lastCompleteAt).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"}) + " WIB" : "Belum diketahui"}. Data tersimpan tidak membuktikan perangkat masih online saat ini.</p>
          </> : <p className="text-sm text-muted-foreground">Belum ada snapshot LAN terautentikasi yang selesai disimpan di database.</p>}
      </section>}
      {(tab === "dashboard" || tab === "device") && <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Member Gym aktif (SC)</p><p className="text-2xl font-bold mt-1">{membersLoading ? "Memuat..." : membersError ? "Tidak tersedia" : activeMembers ?? "—"}</p></section>
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Check-in SC pada tanggal dipilih</p><p className="text-2xl font-bold mt-1">{isLoading ? "Memuat..." : isError ? "Tidak tersedia" : rows.length}</p></section>
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Koneksi mesin X904</p><p className="text-lg font-semibold mt-1">{integrationError ? "Status tidak tersedia" : integration?.hardware === "connector-attested" ? "Gateway VMSC online (heartbeat)" : integration?.hardware === "trusted-adms-data-received" ? "Data ADMS tepercaya telah tersimpan" : integration?.hardware === "stored-adms-unverified" ? "Log ADMS tersimpan; mesin belum terverifikasi" : integration?.hardware === "unverified" ? "Belum terverifikasi melalui ADMS" : "Status mesin belum diketahui"}</p><p className="text-xs text-muted-foreground">{(integration?.hardware === "connector-attested" || integration?.hardware === "trusted-adms-data-received" || integration?.hardware === "stored-adms-unverified") ? integration.note : admsDiagnostic?.enabled ? "Receiver ADMS terpisah dari heartbeat VMSC; periksa status gateway pada panel koneksi." : "Server ADMS belum siap atau belum terbaca."}</p></section>
      </div>}
      {(tab === "dashboard" || tab === "device") && <section className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-label="Ledger X904">
        {([["Total log X904",integration?.stored_logs],["Diproses (ledger)",integration?.processed_events],["Tertunda (anti-join)",integration?.pending_events]] as const).map(([label,value])=><div key={label} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{integrationError || value == null ? "Tidak tersedia" : value}</p></div>)}
      </section>}
      {(tab === "dashboard" || tab === "members") && <section className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Riwayat check-in Sport Center</h2><p className="text-xs text-muted-foreground">Sumber: endpoint membership SC, baca saja. Penyegaran otomatis setiap 30 detik.</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={isFetching} onClick={() => { void queryClient.invalidateQueries({ queryKey: ["gym-checkins", date] }); void refetch(); }} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><RefreshCw size={15} />{isFetching ? "Memuat..." : "Refresh"}</button>
            <button type="button" disabled={isError || isLoading || filtered.length === 0} onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><Download size={15} />Ekspor CSV</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm flex flex-col gap-1">Tanggal<input aria-label="Tanggal absensi" className="rounded-lg border bg-background px-3 py-2" type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value || localDate())} /></label>
          <label className="text-sm flex flex-col gap-1 flex-1 min-w-48">Cari nama, telepon, atau ID member<div className="flex items-center gap-2 rounded-lg border px-3"><Search size={16} className="text-muted-foreground" /><input className="w-full bg-transparent py-2 outline-none" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari absensi..." /></div></label>
        </div>
        {isError ? <p role="alert" className="text-sm text-red-700">Gagal mengambil data: {error instanceof Error ? error.message : "Silakan coba kembali"}. Tidak menampilkan angka nol untuk data yang gagal dimuat.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-4">Nama</th><th className="py-3 pr-4">ID Member</th><th className="py-3 pr-4">Telepon</th><th className="py-3 pr-4">Jam (WIB)</th><th className="py-3">Sumber</th></tr></thead>
              <tbody>{filtered.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="py-3 pr-4">{row.memberName || "—"}</td><td className="py-3 pr-4">{row.membershipId}</td><td className="py-3 pr-4">{row.memberPhone || "—"}</td><td className="py-3 pr-4">{formatTime(row.checkedInAt)}</td><td className="py-3">SC manual</td></tr>)}</tbody>
            </table>
            {!isLoading && !filtered.length && <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada check-in SC yang cocok pada tanggal ini.</p>}
            {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Memuat data absensi...</p>}
          </div>
        )}
      </section>}
      {tab === "events" && <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="font-semibold">Riwayat Log Mesin X904 — Sinkronisasi melalui VMSC (baca saja)</h2>
        <p className="text-xs text-muted-foreground">Waktu lokal mesin; jenis verifikasi tidak tersedia melalui pembacaan TCP. Tidak otomatis dihitung sebagai check-in member Sport Center.</p>
        {lanLogsError ? <p role="alert" className="text-sm">Log LAN belum tersedia atau backend belum aktif.</p> :
          lanLogsLoading ? <p className="text-sm">Memuat catatan LAN...</p> :
          <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="border-b"><th className="p-2">Waktu mesin</th><th className="p-2">PIN</th><th className="p-2">Diterima database</th></tr></thead>
          <tbody>{(lanLogs?.events ?? []).map((e) => <tr key={e.event_id} className="border-b">
            <td className="p-2">{e.device_time}</td><td className="p-2">{e.user_pin}</td>
            <td className="p-2">{new Date(e.received_at).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"})} WIB</td>
          </tr>)}</tbody></table>{(lanLogs?.events ?? []).length === 0 && <p className="p-3 text-sm">Belum ada log LAN yang tersimpan pada tanggal ini.</p>}</div>}
      </section>}
      {tab === "events" && <section className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold">Riwayat akses asli mesin X904</h2><p className="text-xs text-muted-foreground">Hanya event yang diterima dari perangkat. Bukan check-in manual Sport Center.</p></div>
          <button type="button" className="rounded-lg border px-3 py-2 text-sm hover:bg-muted" onClick={() => void refetchDevice()}><RefreshCw size={14} className="inline mr-2" />Refresh</button>
        </div>
        <input aria-label="Tanggal log mesin" type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value || localDate())} className="rounded-lg border bg-background px-3 py-2 text-sm" />
        {deviceError ? <p role="alert" className="text-sm text-red-700">Log mesin tidak tersedia. Jangan menganggapnya sebagai nol akses.</p> :
          !deviceData?.enabled ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Pembacaan log X904 belum diaktifkan. Tidak ada data mesin yang dapat ditampilkan atau diverifikasi.</p> :
          <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="border-b"><th className="p-2">Waktu perangkat</th><th className="p-2">PIN pengguna mesin</th><th className="p-2">Kode status</th><th className="p-2">Jenis verifikasi</th><th className="p-2">Diterima server</th></tr></thead><tbody>{deviceRows.map((event) => <tr key={event.event_id} className="border-b"><td className="p-2">{event.device_time}</td><td className="p-2">{event.user_pin}</td><td className="p-2">{event.attendance_status}</td><td className="p-2">{event.verification_type}</td><td className="p-2">{event.received_at}</td></tr>)}</tbody></table>{deviceLoading ? "Memuat log mesin..." : deviceRows.length === 0 ? <p className="py-6 text-center text-muted-foreground">Belum ada event X904 yang tercatat pada tanggal ini.</p> : null}</div>}
      </section>}
      {tab === "members" && <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="font-semibold">Daftar keanggotaan Sport Center</h2>
        <p className="text-sm text-muted-foreground">Data berasal dari sistem member SC, tidak dianggap sebagai data pengguna mesin.</p>
        {membersError ? <p role="alert">Data member tidak tersedia.</p> : membersLoading ? <p>Memuat member...</p> : <p className="text-sm">Member aktif: <strong>{activeMembers ?? "—"}</strong>. <Link href="/admin/memberships" className="text-primary underline">Buka pengelolaan Member Gym</Link></p>}
      </section>}
      {tab === "device" && <section className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">Diagnostik koneksi</h2><p className="text-sm">Penerima event: {integration?.receiver ?? "Belum diketahui"}</p><p className="text-sm">Perangkat: {integration?.hardware ?? "Belum diketahui"}</p><p className="text-sm text-muted-foreground">{integration?.note ?? "Belum ada bukti koneksi dari mesin."}</p></section>}
      {(tab === "device" || tab === "audit") && <section className="rounded-xl border bg-card p-5 space-y-2">
        <h2 className="font-semibold">Komunikasi ADMS dari server</h2>
        <p className="text-xs text-muted-foreground">Versi backend yang merespons: {admsDiagnostic?.releaseFingerprint ?? "Versi lama / belum tersedia"}</p>
        <p className="text-sm">Receiver diagnostik: {admsDiagnosticError ? "Tidak dapat dibaca" : admsDiagnostic?.enabled ? "Aktif (uji terbatas)" : "Belum aktif"}</p>
        <p className="text-sm">Permintaan terakhir yang tercatat di proses server: {admsDiagnostic?.lastContact ? `${admsDiagnostic.lastContact.kind} — ${admsDiagnostic.lastContact.receivedAt}` : "Belum tercatat"}</p>
        <p className="text-xs text-muted-foreground">Permintaan ADMS ditolak sejak proses server dimulai: format tidak didukung {admsDiagnostic?.refusedRequests?.unsupported ?? "—"}, serial tidak cocok {admsDiagnostic?.refusedRequests?.unknownSerial ?? "—"}. Angka ini bukan bukti koneksi mesin.</p>
        <p className="text-xs text-muted-foreground">Alasan permintaan tidak didukung: format URL invalid {admsDiagnostic?.rejectedReasons?.invalid_url ?? "—"}, serial tidak valid {admsDiagnostic?.rejectedReasons?.serial_invalid ?? "—"}, operasi tidak dikenali {admsDiagnostic?.rejectedReasons?.unsupported ?? "—"}. Data hanya hitungan sementara tanpa isi permintaan.</p>
        <p className="text-xs text-muted-foreground">Kategori request ditolak: {Object.entries(admsDiagnostic?.rejectedOperations ?? {}).map(([category,count]) => `${category}: ${count}`).join(" · ") || "Belum ada"}. Kategori tidak berisi URL atau identitas pengirim.</p>
        <p className="text-xs text-muted-foreground">Jenis POST yang ditolak: {Object.entries(admsDiagnostic?.rejectedTables ?? {}).map(([category,count]) => `${category}: ${count}`).join(" · ") || "Belum ada"}. Nama tabel hanya kategori aman, bukan isi kiriman.</p>
        <p className="text-xs text-muted-foreground">Bentuk POST yang ditolak (tanpa menyimpan isi): {Object.entries(admsDiagnostic?.rejectedPostShapes ?? {}).map(([category,count]) => `${category}: ${count}`).join(" · ") || "Belum ada"}.</p>
        <div className="text-sm space-y-1"><p className="font-medium">Riwayat komunikasi (maks. 40 permintaan, sementara)</p>{admsDiagnostic?.recentContacts?.length ? admsDiagnostic.recentContacts.slice(0,10).map((entry, index) => <p key={`${entry.receivedAt}-${index}`} className="text-xs">{entry.receivedAt} · {entry.method} · {entry.kind} · sumber anonim {entry.sourceTag} · klien: {entry.clientHint ?? "belum diketahui"} (tidak terautentikasi)</p>) : <p className="text-xs text-muted-foreground">Belum ada permintaan tercatat pada proses ini.</p>}</div>
        <div className="rounded-lg border p-3 space-y-2">
          <p className="font-medium text-sm">Audit ADMS permanen (Supabase PROD, maksimal 40 aktivitas terakhir)</p>
          <p className="text-xs text-muted-foreground">Hanya waktu, jenis protokol, status, ukuran dan kategori klien. Tidak menyimpan PIN, IP, serial, payload, kartu maupun data biometrik. Klaim serial tidak membuktikan identitas mesin; permintaan pengujian juga tercatat.</p>
          {admsAuditError ? <p role="alert" className="text-xs text-red-700">Audit database tidak dapat dibaca. Jangan menganggapnya sebagai tidak ada koneksi.</p> :
            !admsAudit?.ready ? <p className="text-xs text-muted-foreground">Menunggu audit database...</p> :
            admsAudit.events.length === 0 ? <p className="text-xs text-muted-foreground">Belum ada aktivitas ADMS yang tersimpan.</p> :
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="border-b text-left"><th className="p-2">Diterima WIB</th><th className="p-2">Protokol</th><th className="p-2">Hasil</th><th className="p-2">Kelas klien</th><th className="p-2">Identitas fisik</th><th className="p-2">Format ATTLOG</th></tr></thead>
              <tbody>{admsAudit.events.map(item => <tr key={item.id} className="border-b">
                <td className="p-2">{new Date(item.received_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}</td>
                <td className="p-2">{item.method} {item.kind}</td><td className="p-2">{item.outcome}</td>
                <td className="p-2">{item.client_hint}</td><td className="p-2">{item.device_identity_verified ? "Terverifikasi" : "Belum diverifikasi"}</td>
                <td className="p-2">{item.kind !== "attendance" ? "—" : item.attlog_parseable == null ? "Belum dianalisis" : `${item.attlog_parseable ? "Valid" : "Tidak valid"} · min. ${item.attlog_min_columns ?? "?"} kolom`}</td>
              </tr>)}</tbody>
            </table></div>}
        </div>
        <p className="text-sm">Struktur kiriman ATTLOG terakhir: {admsDiagnostic?.lastAttlogShape ? `${admsDiagnostic.lastAttlogShape.rows} baris, jumlah kolom ${admsDiagnostic.lastAttlogShape.columnCounts.join(", ") || "tidak diketahui"} (tanpa identitas)` : "Belum ada kiriman ATTLOG yang dapat diperiksa"}</p>
        <p className="text-xs text-muted-foreground">Catatan bersifat sementara per proses server. Permintaan pengujian juga dapat tercatat; data ini bukan bukti mesin fisik online. Tidak ada data biometrik yang ditampilkan.</p>
      </section>}
      {(tab === "users" || tab === "rules" || tab === "mapping" || tab === "access" || tab === "audit" || tab === "device") && <section aria-label="Status integrasi data X904" className="rounded-xl border bg-card p-4 space-y-2">
        <h2 className="font-semibold">Status sumber data mesin</h2>
        <p className="text-sm">Integrasi langsung ADMS: <strong>Menunggu bukti impor log terautentikasi dan tersimpan</strong></p>
        <p className="text-sm">Impor ADMS terautentikasi terakhir: <strong>{integration?.trustedAdmsIngestAt ? new Date(integration.trustedAdmsIngestAt).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"}) + " WIB" : "Belum ada bukti impor terautentikasi pada proses server ini"}</strong></p>
        <p className="text-sm">Log tersimpan di database X904: <strong>{integration?.storedEventCount == null ? "Belum dapat diperiksa" : integration.storedEventCount.toLocaleString("id-ID") + " event"}</strong></p>
        <p className="text-sm">Terakhir diterima database: <strong>{integration?.lastStoredEventAt ? new Date(integration.lastStoredEventAt).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"}) + " WIB" : "Belum ada bukti tersimpan"}</strong></p>
        <p className="text-sm">ATTLOG ditolak (belum diautentikasi): <strong>{admsDiagnostic?.rejectedUntrustedAttendance ?? "Belum ada data diagnostik"}</strong></p>
        <p className="text-sm">ATTLOG gagal dibaca: <strong>{admsDiagnostic?.rejectedUnparseableAttendance ?? "Belum ada data diagnostik"}</strong></p>
        <p className="text-sm">Kegagalan penyimpanan ATTLOG: <strong>{admsDiagnostic?.attendanceStorageFailures ?? "Belum ada data diagnostik"}</strong></p>
        <p className="text-sm">Penolakan terakhir: <strong>{admsDiagnostic?.lastRejectedAttendanceAt ? new Date(admsDiagnostic.lastRejectedAttendanceAt).toLocaleString("id-ID", {timeZone: "Asia/Jakarta"}) + " WIB" : "Belum tercatat pada proses ini"}</strong></p>
        <p className="text-sm">Database log mesin: <strong>{integrationError || integration?.eventStorageReady === undefined ? "Tidak dapat diperiksa" : integration.eventStorageReady ? "Tabel tersedia" : "Tabel belum tersedia"}</strong></p>
        <p className="text-sm">Penerima event server: <strong>{integrationError ? "Tidak dapat diperiksa" : integration?.eventIngestConfigured ? "Dikonfigurasi (belum membuktikan mesin online)" : "Belum dikonfigurasi"}</strong></p>
        <p className="text-sm">Pembacaan log API: <strong>{integrationError ? "Tidak dapat diperiksa" : integration?.eventReadEnabled ? "Diaktifkan" : "Belum diaktifkan"}</strong></p>
        <p className="text-sm text-muted-foreground">Menu ini tidak menampilkan data contoh sebagai data mesin. Data pengguna, kartu, dan aturan hanya dapat tampil setelah pembacaan read-only, validasi identitas perangkat, dan sinkronisasi yang berhasil.</p>
        <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ["gym-x904-integration"] })} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"><RefreshCw size={14} /> Periksa status lagi</button>
      </section>}      {tab === "users" && <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold">User yang terdaftar langsung pada Solution X904 (LAN)</h2>{accessNotice&&<p role="status" className="text-sm">{accessNotice}</p>}<p className="text-xs text-muted-foreground">Suspend otomatis belum diaktifkan. Status akses belum tersedia dalam snapshot LAN; perubahan manual hanya boleh dinyatakan berhasil setelah ACK dan pembacaan ulang grup X904.</p>
        <p className="text-xs text-muted-foreground">Hanya snapshot terautentikasi yang selesai disimpan. Status aktivasi akun dan template biometrik tidak dibaca. PIN mesin belum otomatis dipetakan ke member Gym.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">Cari nama atau PIN mesin
            <input aria-label="Cari nama atau PIN mesin" className="rounded-lg border bg-background px-3 py-2" value={machineUserSearch} onChange={e=>setMachineUserSearch(e.target.value)} placeholder="Cari pengguna..." />
          </label>
          <label className="flex flex-col gap-1 text-sm">Filter peran
            <select aria-label="Filter peran mesin" className="rounded-lg border bg-background px-3 py-2" value={machineRoleFilter} onChange={e=>setMachineRoleFilter(e.target.value)}>
              <option value="all">Semua pengguna</option><option value="regular">Pengguna biasa</option><option value="admin">Administrator mesin</option>
            </select>
          </label>
          <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={()=>{setMachineUserSearch("");setMachineRoleFilter("all")}}>Reset filter</button>
        </div>
        {lanUsersError ? <p role="alert" className="text-sm">Daftar LAN belum tersedia atau backend belum aktif.</p> :
          lanUsersLoading ? <p className="text-sm">Memuat pengguna dari snapshot LAN...</p> :
          <div className="overflow-x-auto"><table className="w-full text-sm text-left">
            <thead><tr className="border-b"><th className="p-2">PIN mesin</th><th className="p-2">Nama</th><th className="p-2">UID</th><th className="p-2">Peran perangkat</th><th className="p-2">Terakhir terbaca</th><th className="p-2">Status akses</th>{userCommandCapabilities?.allowed&&<th className="p-2">Tindakan</th>}</tr></thead>
            <tbody>{(lanUsers?.users ?? []).filter(u=>(!machineUserSearch.trim() || String(u.display_name ?? "").toLowerCase().includes(machineUserSearch.trim().toLowerCase()) || String(u.user_pin).includes(machineUserSearch.trim())) && (machineRoleFilter==="all" || (machineRoleFilter==="regular" ? u.device_role===0 : u.device_role!==0))).map((u) => <tr key={u.user_pin} className="border-b">
              <td className="p-2">{u.user_pin}</td><td className="p-2">{u.display_name || "—"}</td><td className="p-2">{u.device_uid}</td>
              <td className="p-2">{u.device_role}</td><td className="p-2">{new Date(u.last_seen_at).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"})} WIB</td><td className="p-2 text-muted-foreground">{(()=>{const m=machineFor(u);if(machineAccessError)return "Status mesin tidak tersedia";if(!machineAccess?.available)return "Belum ada snapshot SDK";if(!machineSnapshotFresh)return "Snapshot mesin kedaluwarsa";if(!m)return "Tidak ditemukan di mesin";if(!m.identityMatched)return "Identitas mesin tidak cocok";return (m.device_group===1?"Grup 1":m.device_group===2?"Grup 2":"Grup "+m.device_group)+" · "+(m.enabled?"Enabled":"Disabled")+" (SDK)";})()}</td>
              {userCommandCapabilities?.allowed&&<td className="p-2"><div className="flex gap-2">
                {(() => {const m=machineFor(u);const testUser=u.user_pin==="200"&&u.device_uid===337&&u.display_name==="TEST SUSPEND X904";const verified=!!m&&m.identityMatched&&m.device_uid===u.device_uid&&m.device_role===0&&u.device_role===0&&/^[A-Za-z0-9 ._-]{2,24}$/.test(u.display_name)&&machineSnapshotFresh;const op=verified&&m.device_group===1&&m.enabled?"SUSPEND_USER":verified&&m.device_group===2&&!m.enabled?"ACTIVATE_USER":null;const permitted=manualAccessAllEnabled||testUser;const reason=!machineSnapshotFresh?"Snapshot mesin kedaluwarsa":!m?"PIN tidak ditemukan pada mesin":!m.identityMatched||m.device_uid!==u.device_uid?"Identitas mesin tidak cocok":u.device_role!==0||m.device_role!==0?"Akun administrator perangkat tidak dapat diubah":!/^[A-Za-z0-9 ._-]{2,24}$/.test(u.display_name)?"Nama mesin perlu dilengkapi sebelum mengubah akses":!op?"Status grup dan aktif/nonaktif mesin tidak konsisten":!permitted?"Kontrol manual semua pengguna belum diaktifkan pada server":!userCommandCapabilities.operations?.includes(op)?"Kontrol manual belum tersedia":"Ubah akses mesin";
                  return <button type="button" title={reason}
                    disabled={!op||!permitted||!userCommandCapabilities.enabled||!userCommandCapabilities.operations?.includes(op)||!!accessBusyPin}
                    onClick={()=>{if(op)void changeManualAccess(u,op);}}
                    className="rounded-md border px-3 py-1 text-xs disabled:opacity-40">{op==="ACTIVATE_USER"?"Aktifkan":"Suspend"}</button>})()}
                {userCommandCapabilities.operations?.includes("UPDATE_USER")&&<button type="button" disabled={!userCommandCapabilities.enabled||u.device_role!==0} onClick={()=>setSelectedMachineUser({user:u,action:"UPDATE_USER",request:Date.now()})} className="rounded-md border px-3 py-1 text-xs disabled:opacity-40">Edit</button>}
                {userCommandCapabilities.operations?.includes("DELETE_USER")&&<button type="button" disabled={!userCommandCapabilities.enabled||u.device_role!==0} onClick={()=>setSelectedMachineUser({user:u,action:"DELETE_USER",request:Date.now()})} className="rounded-md border px-3 py-1 text-xs disabled:opacity-40">Hapus</button>}
              </div></td>}
            </tr>)}</tbody>
          </table>{(lanUsers?.users ?? []).length === 0 && <p className="p-3 text-sm">Belum ada roster terverifikasi tersimpan.</p>}</div>}
      </section>}
      {tab === "users" && <><div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={()=>void queryClient.invalidateQueries({queryKey:["gym-x904-lan-users"]})} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><RefreshCw size={14}/> Muat ulang daftar tersimpan</button>
        <span className="text-xs text-muted-foreground">Memuat data database, bukan memerintahkan mesin untuk sinkronisasi baru.</span>
      </div><GymX904UserControl key={selectedMachineUser?`${selectedMachineUser.user.device_uid}-${selectedMachineUser.action}-${selectedMachineUser.request}`:"default"} users={lanUsers?.users ?? []} initialSelection={selectedMachineUser?{user:selectedMachineUser.user,action:selectedMachineUser.action}:undefined}/></>}
      {tab === "users" && <section className="rounded-xl border bg-card p-5 space-y-4">
        <div><h2 className="font-semibold flex items-center gap-2"><Users size={18} />PIN yang tercatat pada log ADMS X904</h2>
        <p className="text-sm text-muted-foreground mt-1">Data nyata dari log yang sudah tersimpan di database, bukan daftar lengkap user terdaftar, bukan bukti identitas mesin. Nama, kartu, dan status enrollment memerlukan pembacaan master user dari perangkat.</p></div>
        {observedError ? <p role="alert" className="text-sm">Data log X904 belum dapat dibaca dari database PROD.</p> :
        observedLoading ? <p className="text-sm">Memuat data log X904...</p> :
        <div className="overflow-x-auto"><table className="min-w-[720px] w-full text-sm text-left">
          <thead className="border-b"><tr><th className="p-3">PIN / User ID pada log</th><th className="p-3">Jumlah event</th><th className="p-3">Waktu event terakhir</th><th className="p-3">Terakhir diterima server</th><th className="p-3">Status</th></tr></thead>
          <tbody>{observedRows.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Belum ada PIN dari log ADMS tersimpan</td></tr> :
            observedRows.map((u) => <tr key={u.user_pin} className="border-b"><td className="p-3 font-mono">{u.user_pin}</td><td className="p-3">{u.event_count}</td><td className="p-3">{u.last_device_time ?? "—"} (waktu mesin)</td><td className="p-3">{u.last_received_at ? new Date(u.last_received_at).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"}) + " WIB" : "—"}</td><td className="p-3">Tercatat di log; enrollment belum diverifikasi</td></tr>)}</tbody>
        </table></div>}
      </section>}
      {tab === "rules" && <section className="rounded-xl border bg-card p-5 space-y-4">
        <div><h2 className="font-semibold flex items-center gap-2"><ShieldCheck size={18} />Rule akses yang tersimpan di mesin</h2>
        <p className="text-sm text-muted-foreground mt-1">Grup akses, jadwal akses, dan izin pintu hanya boleh ditampilkan setelah dibaca langsung dari perangkat. Pembacaan bersifat read-only.</p></div>
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Aturan mesin belum dapat dibaca. Rule lokal X904 yang sedang berlaku tidak diubah oleh halaman ini.
        </div>
        <div className="overflow-x-auto"><table className="min-w-[660px] w-full text-sm text-left">
          <thead className="border-b"><tr><th className="p-3">User / Grup mesin</th><th className="p-3">Zona waktu / jadwal</th><th className="p-3">Akses pintu</th><th className="p-3">Sumber verifikasi</th></tr></thead>
          <tbody><tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Menunggu pembacaan rule X904</td></tr></tbody>
        </table></div>
      </section>}
      {tab === "mapping" && <section className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">Pencocokan member dan PIN perangkat</h2><p className="text-sm text-muted-foreground">Status pemetaan PIN dan membership (baca saja): {mappingError ? "Tidak tersedia" : mappingLoading ? "Memuat..." : `${mappingRows.filter(r=>r.status==="verified").length} verified, ${mappingRows.filter(r=>r.status==="review_required").length} review_required, ${mappingRows.filter(r=>r.status==="inactive").length} inactive`}. Data ini bukan bukti pengguna mesin online.</p><Link href="/admin/memberships" className="text-primary underline text-sm">Lihat member dari Sport Center</Link></section>}
      {tab === "access" && <section className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">Hak akses pintu Gym</h2><p className="text-sm text-muted-foreground">Kontrol pintu dan pendaftaran kartu masih dikelola pada mesin X904. Belum ada perintah membuka pintu atau mengubah hak akses dari portal ini sampai koneksi dan protokol diverifikasi.</p></section>}
      {tab === "audit" && <section className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">Audit sumber data</h2><p className="text-sm">Riwayat SC: {isError ? "Tidak tersedia" : isLoading ? "Memuat..." : `${rows.length} check-in (SC manual)`}</p><p className="text-sm">Log mesin: {deviceError ? "Gagal dibaca" : !deviceData?.enabled ? "Pembacaan belum aktif" : `${deviceRows.length} event X904 pada tanggal terpilih`}</p><p className="text-sm">Koneksi mesin: {integration?.hardware === "stored-adms-unverified" ? "Log ADMS tersimpan; mesin belum terverifikasi" : integration?.hardware === "unverified" ? "Belum terverifikasi" : integration?.hardware ?? "Status tidak diketahui"}</p><p className="text-xs text-muted-foreground">Kedua sumber tidak digabungkan tanpa pemetaan identitas terverifikasi.</p></section>}
      <div className="rounded-xl border bg-card p-5 flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Keamanan dan isolasi</h2><p className="text-sm text-muted-foreground mt-2 max-w-2xl">Halaman hanya membaca endpoint SC yang sudah ada. Tidak mengirim perintah ke X904, membuat absensi palsu, atau mengubah booking, invoice, pembayaran dan data membership.</p></div>
        <Link href="/admin/memberships" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Buka Member Gym <ArrowRight size={16} /></Link>
      </div>
    </div>
  );
}