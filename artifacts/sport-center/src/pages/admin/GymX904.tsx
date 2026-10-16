import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListMemberships } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Activity, ArrowRight, Download, Fingerprint, RefreshCw, Search, ShieldCheck, Users, Link2, DoorOpen, ScrollText, LayoutDashboard, Cpu } from "lucide-react";
import { getToken } from "@/lib/auth";

interface IntegrationStatus { vmscHeartbeatAt?: string | null; vmscHeartbeatVerified?: boolean; vmscSource?: string | null; stored_logs?:number|null; processed_events?:number|null; pending_events?:number|null; processingLedgerReady?:boolean; receiver: string; hardware: string; synchronizing: boolean; legacyGymService: string; note: string; eventIngestConfigured?: boolean; eventReadEnabled?: boolean; eventStorageReady?: boolean; trustedAdmsIngestAt?: string | null; storedEventCount?: number | null; lastStoredEventAt?: string | null; }
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
  const [tab, setTab] = useState<GymTab>("dashboard");
  const queryClient = useQueryClient();
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
    { id: "rules", label: "Rule Akses Mesin", icon: ShieldCheck },
    { id: "events", label: "Riwayat Akses Mesin", icon: Fingerprint },
    { id: "members", label: "Member Gym", icon: Users },
    { id: "mapping", label: "Sinkronisasi Member", icon: Link2 },
    { id: "access", label: "Hak Akses Pintu", icon: DoorOpen },
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Absensi Gym X904</h1>
        <p className="text-sm text-muted-foreground mt-1">Pantau check-in Gym Sport Center dan status komunikasi mesin X904. Koneksi mesin X904 belum aktif sebagai integrasi absensi; status perangkat ditentukan dari bukti koneksi, bukan keberhasilan tes server.</p>
      </div>
      <nav aria-label="Menu Gym X904" className="flex flex-wrap gap-2 rounded-xl border bg-card p-3">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${tab === id ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>
            <Icon size={16} />{label}
          </button>
        ))}
      </nav>
      {(tab === "dashboard" || tab === "device") && <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3"><Fingerprint className="h-6 w-6 text-primary" aria-hidden="true" /><h2 className="font-semibold">Solution X904</h2><span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">{integration?.synchronizing ? "Sedang sinkronisasi" : admsDiagnostic?.enabled ? "Receiver diagnostik aktif — mesin belum terverifikasi" : "Server ADMS belum siap"}</span></div>
        <p className="text-sm text-muted-foreground">Receiver diagnostik dapat menerima handshake, tetapi tidak membuktikan X904 fisik online. Data check-in SC tidak dianggap sebagai absensi mesin.</p>
        <div className="text-sm" role="status">
          <strong>Kontak ADMS terakhir:</strong> {admsDiagnosticError ? "Diagnostik tidak dapat dibaca" : admsDiagnostic?.lastContact ? `${admsDiagnostic.lastContact.kind} pada ${new Date(admsDiagnostic.lastContact.receivedAt).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"})} WIB — sumber belum terautentikasi` : "Belum ada kontak yang terdeteksi pada proses server ini"}
        </div>
      </div>}
      {(tab === "dashboard" || tab === "device") && <section className="rounded-xl border bg-card p-4 space-y-2">
        <h2 className="font-semibold">Sinkronisasi LAN X904 (baca saja)</h2>
        {lanStatus?.lastCompleteAt && <p className="text-sm" role="status">{Number.isFinite(Date.parse(lanStatus.lastCompleteAt)) && Date.now() - Date.parse(lanStatus.lastCompleteAt) < 10 * 60 * 1000 && Date.now() >= Date.parse(lanStatus.lastCompleteAt) ? "Snapshot LAN terbaru (kurang dari 10 menit). Ini bukan bukti X904 online." : "Snapshot LAN lama: sinkronisasi otomatis belum terbukti aktif. Periksa konektor sebelum mengandalkan data terbaru."}</p>}
        {lanStatusError ? <p role="status">Backend konektor LAN belum tersedia atau belum dikonfigurasi.</p> :
          lanStatus?.synchronized ? <>
            <p className="text-sm">Snapshot berhasil disimpan: <strong>{lanStatus.users} pengguna dan {lanStatus.logs} log</strong> (dari {lanStatus.deviceLogs ?? "?"} log di perangkat).</p>
            <p className="text-xs text-muted-foreground">Sinkronisasi terakhir: {lanStatus.lastCompleteAt ? new Date(lanStatus.lastCompleteAt).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"}) + " WIB" : "Belum diketahui"}. Data tersimpan tidak membuktikan perangkat masih online saat ini.</p>
          </> : <p className="text-sm text-muted-foreground">Belum ada snapshot LAN terautentikasi yang selesai disimpan di database.</p>}
      </section>}
      {(tab === "dashboard" || tab === "device") && <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Member Gym aktif (SC)</p><p className="text-2xl font-bold mt-1">{membersLoading ? "Memuat..." : membersError ? "Tidak tersedia" : activeMembers ?? "—"}</p></section>
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Check-in SC pada tanggal dipilih</p><p className="text-2xl font-bold mt-1">{isLoading ? "Memuat..." : isError ? "Tidak tersedia" : rows.length}</p></section>
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Status Mini PC VMSC</p><p className="text-lg font-semibold mt-1">{integrationError ? "Status tidak tersedia" : integration?.vmscHeartbeatVerified === true && integration?.vmscSource === "VMSC" && integration?.vmscHeartbeatAt && Number.isFinite(Date.parse(integration.vmscHeartbeatAt)) ? (Date.now() >= Date.parse(integration.vmscHeartbeatAt) && Date.now() - Date.parse(integration.vmscHeartbeatAt) < 5 * 60 * 1000 ? "Online" : "Offline") : "Belum terpantau"}</p><p className="text-xs text-muted-foreground">{integration?.vmscHeartbeatVerified === true && integration?.vmscSource === "VMSC" && integration?.vmscHeartbeatAt && Number.isFinite(Date.parse(integration.vmscHeartbeatAt)) ? `Heartbeat terakhir: ${new Date(integration.vmscHeartbeatAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB. Status mesin X904 diperiksa terpisah.` : "Menunggu heartbeat VMSC terautentikasi. Diagnostik X904 tersedia di tab Audit & Diagnostik."}</p></section>
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
        <h2 className="font-semibold">Log mesin dari ALMANO (baca saja)</h2>
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
        <h2 className="font-semibold">User yang terdaftar langsung pada Solution X904 (LAN)</h2>
        <p className="text-xs text-muted-foreground">Hanya snapshot terautentikasi yang selesai disimpan. Status aktivasi akun dan template biometrik tidak dibaca. PIN mesin belum otomatis dipetakan ke member Gym.</p>
        {lanUsersError ? <p role="alert" className="text-sm">Daftar LAN belum tersedia atau backend belum aktif.</p> :
          lanUsersLoading ? <p className="text-sm">Memuat pengguna dari snapshot LAN...</p> :
          <div className="overflow-x-auto"><table className="w-full text-sm text-left">
            <thead><tr className="border-b"><th className="p-2">PIN mesin</th><th className="p-2">Nama</th><th className="p-2">UID</th><th className="p-2">Peran perangkat</th><th className="p-2">Terakhir terbaca</th></tr></thead>
            <tbody>{(lanUsers?.users ?? []).map((u) => <tr key={u.user_pin} className="border-b">
              <td className="p-2">{u.user_pin}</td><td className="p-2">{u.display_name || "—"}</td><td className="p-2">{u.device_uid}</td>
              <td className="p-2">{u.device_role}</td><td className="p-2">{new Date(u.last_seen_at).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"})} WIB</td>
            </tr>)}</tbody>
          </table>{(lanUsers?.users ?? []).length === 0 && <p className="p-3 text-sm">Belum ada roster terverifikasi tersimpan.</p>}</div>}
      </section>}
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
      {tab === "mapping" && <section className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">Pencocokan member dan PIN perangkat</h2><p className="text-sm text-muted-foreground">Mapping database DEV (read-only): {mappingError ? "Tidak tersedia" : mappingLoading ? "Memuat..." : `${mappingRows.filter(r=>r.status==="verified").length} verified, ${mappingRows.filter(r=>r.status==="review_required").length} review_required, ${mappingRows.filter(r=>r.status==="inactive").length} inactive`}. Data ini bukan bukti pengguna mesin online.</p><Link href="/admin/memberships" className="text-primary underline text-sm">Lihat member dari Sport Center</Link></section>}
      {tab === "access" && <section className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">Hak akses pintu Gym</h2><p className="text-sm text-muted-foreground">Kontrol pintu dan pendaftaran kartu masih dikelola pada mesin X904. Belum ada perintah membuka pintu atau mengubah hak akses dari portal ini sampai koneksi dan protokol diverifikasi.</p></section>}
      {tab === "audit" && <section className="rounded-xl border bg-card p-5 space-y-2"><h2 className="font-semibold">Audit sumber data</h2><p className="text-sm">Riwayat SC: {isError ? "Tidak tersedia" : isLoading ? "Memuat..." : `${rows.length} check-in (SC manual)`}</p><p className="text-sm">Log mesin: {deviceError ? "Gagal dibaca" : !deviceData?.enabled ? "Pembacaan belum aktif" : `${deviceRows.length} event X904 pada tanggal terpilih`}</p><p className="text-sm">Koneksi mesin: {integration?.hardware === "stored-adms-unverified" ? "Log ADMS tersimpan; mesin belum terverifikasi" : integration?.hardware === "unverified" ? "Belum terverifikasi" : integration?.hardware ?? "Status tidak diketahui"}</p><p className="text-xs text-muted-foreground">Kedua sumber tidak digabungkan tanpa pemetaan identitas terverifikasi.</p></section>}
      <div className="rounded-xl border bg-card p-5 flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Keamanan dan isolasi</h2><p className="text-sm text-muted-foreground mt-2 max-w-2xl">Halaman hanya membaca endpoint SC yang sudah ada. Tidak mengirim perintah ke X904, membuat absensi palsu, atau mengubah booking, invoice, pembayaran dan data membership.</p></div>
        <Link href="/admin/memberships" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Buka Member Gym <ArrowRight size={16} /></Link>
      </div>
    </div>
  );
}
