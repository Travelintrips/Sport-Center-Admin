import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListMemberships } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Activity, ArrowRight, Download, Fingerprint, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { getToken } from "@/lib/auth";

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
  const queryClient = useQueryClient();
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
        <p className="text-sm text-muted-foreground mt-1">Pantau check-in Gym dari data Sport Center yang sudah berjalan. Koneksi mesin X904 belum aktif.</p>
      </div>
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3"><Fingerprint className="h-6 w-6 text-primary" aria-hidden="true" /><h2 className="font-semibold">Solution X904</h2><span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">Integrasi perangkat belum aktif</span></div>
        <p className="text-sm text-muted-foreground">Status online/offline perangkat tidak dapat ditentukan sebelum protokol ADMS dan layanan Gym terisolasi diuji. Data di bawah adalah check-in SC, bukan hasil pembacaan mesin X904.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Member Gym aktif (SC)</p><p className="text-2xl font-bold mt-1">{membersLoading ? "Memuat..." : membersError ? "Tidak tersedia" : activeMembers ?? "—"}</p></section>
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Check-in SC pada tanggal dipilih</p><p className="text-2xl font-bold mt-1">{isLoading ? "Memuat..." : isError ? "Tidak tersedia" : rows.length}</p></section>
        <section className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Koneksi mesin X904</p><p className="text-lg font-semibold mt-1">Belum dikonfigurasi</p><p className="text-xs text-muted-foreground">Tidak mengasumsikan online atau offline</p></section>
      </div>
      <section className="rounded-xl border bg-card p-5 space-y-4">
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
      </section>
      <div className="rounded-xl border bg-card p-5 flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Keamanan dan isolasi</h2><p className="text-sm text-muted-foreground mt-2 max-w-2xl">Halaman hanya membaca endpoint SC yang sudah ada. Tidak mengirim perintah ke X904, membuat absensi palsu, atau mengubah booking, invoice, pembayaran dan data membership.</p></div>
        <Link href="/admin/memberships" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Buka Member Gym <ArrowRight size={16} /></Link>
      </div>
    </div>
  );
}
