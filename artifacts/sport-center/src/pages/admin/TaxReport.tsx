import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Receipt, Download, FileText, FileSpreadsheet, Printer,
  TrendingUp, ChevronDown, ChevronUp,
} from "lucide-react";
import * as XLSX from "xlsx";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

function currency(n: number) {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function fmt(masaPajak: string) {
  const [y, m] = masaPajak.split("-");
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];
  return `${months[Number(m) - 1]} ${y}`;
}

const PAYMENT_STATUSES = [
  { value: "all", label: "Semua Status" },
  { value: "confirmed", label: "Dikonfirmasi" },
  { value: "completed", label: "Selesai" },
  { value: "waiting_confirmation", label: "Menunggu Konfirmasi" },
  { value: "pending_payment", label: "Belum Bayar" },
  { value: "cancelled", label: "Dibatalkan" },
];

const CUSTOMER_TYPES = [
  { value: "all", label: "Semua Tipe" },
  { value: "umum", label: "Umum" },
  { value: "angkasa_pura", label: "Angkasa Pura" },
];

export default function AdminTaxReport() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [facilityId, setFacilityId] = useState("all");
  const [customerType, setCustomerType] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [companyOnly, setCompanyOnly] = useState(false);
  const [expandedMasa, setExpandedMasa] = useState<string | null>(null);

  const printRef = useRef<HTMLDivElement>(null);

  const { data: facilities = [] } = useQuery({
    queryKey: ["facilities"],
    queryFn: () => fetch(`${API}/facilities`).then((r) => r.json()),
  });

  const params = new URLSearchParams({
    startDate, endDate,
    ...(facilityId !== "all" && { facilityId }),
    ...(customerType !== "all" && { customerType }),
    ...(paymentStatus !== "all" && { paymentStatus }),
    ...(companyOnly && { company: "true" }),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["tax-report-v2", startDate, endDate, facilityId, customerType, paymentStatus, companyOnly],
    queryFn: () =>
      fetch(`${API}/admin/tax-report?${params}`, { headers: authHeaders() }).then((r) => r.json()),
    staleTime: 30000,
  });

  const summary = data?.summary ?? {};
  const byPeriod: any[] = data?.byPeriod ?? [];
  const sptMasa: any[] = data?.sptMasa ?? [];
  const transactions: any[] = data?.transactions ?? [];

  // ── Export helpers ───────────────────────────────────────────────────

  function exportCSV() {
    const url = `${API}/admin/tax-report/export/csv?${params}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "");
    // attach auth header via fetch
    fetch(url, { headers: authHeaders() })
      .then((r) => r.blob())
      .then((blob) => {
        const burl = URL.createObjectURL(blob);
        a.href = burl;
        a.download = `laporan-ppn-${startDate}-${endDate}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(burl);
      });
  }

  function exportSptCSV() {
    const url = `${API}/admin/tax-report/export/spt-masa?${params}`;
    fetch(url, { headers: authHeaders() })
      .then((r) => r.blob())
      .then((blob) => {
        const burl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = burl;
        a.download = `spt-masa-ppn-${startDate}-${endDate}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(burl);
      });
  }

  function exportExcel() {
    if (!transactions.length) return;

    const wb = XLSX.utils.book_new();

    // Sheet 1: Detail Transaksi
    const detailRows = transactions.map((t: any, i: number) => ({
      "No": i + 1,
      "Nomor Invoice": t.referenceNumber,
      "Tipe": t.referenceType,
      "Customer": t.customerName ?? "",
      "Fasilitas": t.facilityName ?? "",
      "Tipe Customer": t.customerType ?? "",
      "Tipe Pembayar": t.payerType ?? "personal",
      "Status Pembayaran": t.paymentStatus ?? "",
      "Kode Pajak": t.taxCode,
      "Tarif PPN (%)": t.taxRate,
      "DPP (Rp)": t.dpp,
      "PPN (Rp)": t.taxAmount,
      "Grand Total (Rp)": t.grandTotal,
      "Tanggal Transaksi": t.transactionDate,
      "Status Pajak": t.status,
      "Tipe Transaksi": t.transactionType,
      "NPWP/Keterangan": t.payerType === "company" ? "Perusahaan" : "Retail/Non-NPWP",
    }));
    const ws1 = XLSX.utils.json_to_sheet(detailRows);
    ws1["!cols"] = [
      { wch: 5 }, { wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 20 },
      { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 12 },
      { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
      { wch: 14 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, "Detail Transaksi PPN");

    // Sheet 2: Rekap per Periode
    const periodeRows = byPeriod.map((p: any) => ({
      "Periode": p.period,
      "Jumlah Transaksi": p.count,
      "DPP (Rp)": p.dpp,
      "PPN 11% (Rp)": p.taxAmount,
      "Grand Total (Rp)": p.grandTotal,
    }));
    const ws2 = XLSX.utils.json_to_sheet(periodeRows);
    ws2["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Rekap Per Periode");

    // Sheet 3: SPT Masa PPN
    const sptRows: any[] = [];
    for (const masa of sptMasa) {
      for (const item of masa.items) {
        sptRows.push({
          "Masa Pajak": masa.masaPajak,
          "Nomor Invoice": item.nomorInvoice,
          "Tanggal": item.tanggalPajak,
          "Customer": item.customer,
          "NPWP": item.npwp ?? "",
          "Keterangan": item.npwpKeterangan,
          "DPP (Rp)": item.dpp,
          "PPN Keluaran (Rp)": item.ppnKeluaran,
          "Kode Pajak": item.taxCode,
        });
      }
    }
    const ws3 = XLSX.utils.json_to_sheet(sptRows);
    ws3["!cols"] = [
      { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 24 },
      { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws3, "SPT Masa PPN");

    // Ringkasan
    const ringkasanRows = [
      { "Keterangan": "Total DPP", "Nilai (Rp)": summary.totalDpp ?? 0 },
      { "Keterangan": "Total PPN Keluaran (11%)", "Nilai (Rp)": summary.totalTaxAmount ?? 0 },
      { "Keterangan": "Grand Total", "Nilai (Rp)": summary.totalGrandTotal ?? 0 },
      { "Keterangan": "Jumlah Transaksi", "Nilai (Rp)": summary.totalTransactions ?? 0 },
      { "Keterangan": "Periode", "Nilai (Rp)": `${startDate} s/d ${endDate}` },
    ];
    const ws4 = XLSX.utils.json_to_sheet(ringkasanRows);
    ws4["!cols"] = [{ wch: 30 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws4, "Ringkasan");

    XLSX.writeFile(wb, `laporan-ppn-${startDate}-${endDate}.xlsx`);
  }

  function exportPDF() {
    window.print();
  }

  const statusBadge = (status: string, type: string) => {
    if (status === "reversed")
      return <Badge variant="destructive" className="text-xs">Dibatalkan</Badge>;
    if (type === "reversal")
      return <Badge variant="secondary" className="text-xs">Reversal</Badge>;
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">Terutang</Badge>;
  };

  const paymentBadge = (status: string) => {
    const map: Record<string, string> = {
      confirmed: "bg-green-100 text-green-700",
      completed: "bg-blue-100 text-blue-700",
      waiting_confirmation: "bg-amber-100 text-amber-700",
      pending_payment: "bg-slate-100 text-slate-600",
      cancelled: "bg-red-100 text-red-700",
    };
    const label: Record<string, string> = {
      confirmed: "Dikonfirmasi",
      completed: "Selesai",
      waiting_confirmation: "Menunggu",
      pending_payment: "Belum Bayar",
      cancelled: "Dibatalkan",
    };
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
        {label[status] ?? status}
      </span>
    );
  };

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #tax-print-area, #tax-print-area * { visibility: visible !important; }
          #tax-print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3 no-print">
          <div>
            <h1 className="text-3xl font-black flex items-center gap-2">
              <Receipt size={28} className="text-orange-500" /> Laporan Pajak PPN
            </h1>
            <p className="text-muted-foreground mt-1">
              Rekap PPN Keluaran Sport Center · Semua transaksi PPN 11%
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
              <FileText size={15} /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={!transactions.length} className="gap-1.5">
              <FileSpreadsheet size={15} /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1.5">
              <Printer size={15} /> Print/PDF
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="no-print">
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3 flex-wrap items-end">
              <div className="space-y-1">
                <Label>Dari Tanggal</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label>Sampai Tanggal</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label>Fasilitas</Label>
                <Select value={facilityId} onValueChange={setFacilityId}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Fasilitas</SelectItem>
                    {(facilities as any[]).map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Tipe Customer</Label>
                <Select value={customerType} onValueChange={setCustomerType}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_TYPES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status Pembayaran</Label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Perusahaan</Label>
                <Button
                  variant={companyOnly ? "default" : "outline"}
                  size="sm"
                  className="h-9 px-3"
                  onClick={() => setCompanyOnly(!companyOnly)}
                >
                  {companyOnly ? "Hanya Perusahaan ✓" : "Semua Pembayar"}
                </Button>
              </div>
              <Button size="sm" onClick={() => refetch()} className="h-9">Terapkan</Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">
            <Receipt size={40} className="mx-auto mb-3 opacity-20 animate-pulse" />
            <p>Memuat laporan pajak...</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div id="tax-print-area">
              <div className="hidden print:block mb-6">
                <h2 className="text-2xl font-black">Laporan Pajak PPN — Sport Center</h2>
                <p className="text-sm text-muted-foreground mt-1">Periode: {startDate} s/d {endDate} · Dicetak: {new Date().toLocaleDateString("id-ID")}</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card>
                  <CardContent className="pt-5 pb-5">
                    <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Total DPP</div>
                    <div className="text-xl font-black">{currency(summary.totalDpp ?? 0)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">Dasar Pengenaan Pajak</div>
                  </CardContent>
                </Card>
                <Card className="border-orange-200 bg-orange-50/50 dark:bg-orange-950/20">
                  <CardContent className="pt-5 pb-5">
                    <div className="text-xs text-orange-600 mb-1 font-medium uppercase tracking-wide">PPN Keluaran 11%</div>
                    <div className="text-xl font-black text-orange-600">{currency(summary.totalTaxAmount ?? 0)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">Total PPN Terutang</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-5">
                    <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Grand Total</div>
                    <div className="text-xl font-black">{currency(summary.totalGrandTotal ?? 0)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">DPP + PPN</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-5">
                    <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Total Transaksi</div>
                    <div className="text-xl font-black">{summary.totalTransactions ?? 0}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">Transaksi Aktif PPN</div>
                  </CardContent>
                </Card>
              </div>

              {/* Chart */}
              {byPeriod.length > 0 && (
                <Card className="mb-6 no-print">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp size={16} className="text-orange-500" /> Tren PPN per Periode
                      <span className="flex items-center gap-3 text-xs font-normal text-muted-foreground ml-2">
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-slate-300" /> DPP</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-orange-400" /> PPN 11%</span>
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={byPeriod}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(1)}jt`} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: any, name: string) => [currency(Number(v)), name === "dpp" ? "DPP" : "PPN 11%"]} />
                        <Bar dataKey="dpp" fill="#CBD5E1" name="DPP" stackId="a" />
                        <Bar dataKey="taxAmount" fill="#F97316" name="PPN 11%" stackId="a" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Tabs */}
              <Tabs defaultValue="detail">
                <TabsList className="mb-3 no-print">
                  <TabsTrigger value="detail" className="gap-1.5">
                    <FileText size={13} /> Detail Transaksi
                  </TabsTrigger>
                  <TabsTrigger value="rekap" className="gap-1.5">
                    <TrendingUp size={13} /> Rekap per Periode
                  </TabsTrigger>
                  <TabsTrigger value="spt" className="gap-1.5">
                    <Receipt size={13} /> SPT Masa PPN
                  </TabsTrigger>
                </TabsList>

                {/* ── Detail Transaksi Tab ── */}
                <TabsContent value="detail" className="mt-0">
                  <Card>
                    <CardHeader className="pb-2 flex-row items-center justify-between no-print">
                      <CardTitle className="text-base">Detail Transaksi PPN</CardTitle>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={exportCSV} className="gap-1 h-8 text-xs">
                          <Download size={13} /> CSV
                        </Button>
                        <Button variant="ghost" size="sm" onClick={exportExcel} disabled={!transactions.length} className="gap-1 h-8 text-xs">
                          <Download size={13} /> Excel
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {transactions.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                          <Receipt size={36} className="mx-auto mb-3 opacity-20" />
                          <p className="font-medium">Tidak ada transaksi pajak</p>
                          <p className="text-sm mt-1">Coba ubah filter atau rentang tanggal</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm min-w-[900px]">
                            <thead>
                              <tr className="border-b text-xs text-muted-foreground">
                                <th className="text-left py-2 pr-3 font-semibold">Invoice</th>
                                <th className="text-left py-2 pr-3 font-semibold">Customer</th>
                                <th className="text-left py-2 pr-3 font-semibold">Fasilitas</th>
                                <th className="text-left py-2 pr-3 font-semibold">Tgl Transaksi</th>
                                <th className="text-left py-2 pr-3 font-semibold">Kode Pajak</th>
                                <th className="text-left py-2 pr-3 font-semibold">Status Pajak</th>
                                <th className="text-left py-2 pr-3 font-semibold">Pembayaran</th>
                                <th className="text-right py-2 pr-3 font-semibold">DPP</th>
                                <th className="text-right py-2 pr-3 font-semibold">PPN 11%</th>
                                <th className="text-right py-2 font-semibold">Grand Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {transactions.map((t: any) => (
                                <tr
                                  key={t.id}
                                  className={`border-b hover:bg-muted/20 ${t.transactionType === "reversal" || t.status === "reversed" ? "opacity-50" : ""}`}
                                >
                                  <td className="py-2 pr-3">
                                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{t.referenceNumber}</span>
                                  </td>
                                  <td className="py-2 pr-3">
                                    <div className="font-medium text-xs leading-tight">{t.customerName ?? "-"}</div>
                                    {t.payerType === "company" && (
                                      <div className="text-[10px] text-blue-500 mt-0.5">Perusahaan</div>
                                    )}
                                  </td>
                                  <td className="py-2 pr-3 text-xs text-muted-foreground">{t.facilityName ?? "-"}</td>
                                  <td className="py-2 pr-3 text-xs tabular-nums">{t.transactionDate}</td>
                                  <td className="py-2 pr-3">
                                    <span className="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold">
                                      {t.taxCode}
                                    </span>
                                  </td>
                                  <td className="py-2 pr-3">{statusBadge(t.status, t.transactionType)}</td>
                                  <td className="py-2 pr-3">{paymentBadge(t.paymentStatus ?? "")}</td>
                                  <td className={`py-2 pr-3 text-right tabular-nums text-xs ${t.transactionType === "reversal" ? "line-through text-red-400" : ""}`}>
                                    {currency(Math.abs(t.dpp))}
                                  </td>
                                  <td className={`py-2 pr-3 text-right tabular-nums text-xs font-semibold ${t.transactionType === "reversal" ? "line-through text-red-400" : "text-orange-600"}`}>
                                    {currency(Math.abs(t.taxAmount))}
                                  </td>
                                  <td className={`py-2 text-right tabular-nums text-xs font-bold ${t.transactionType === "reversal" ? "line-through text-red-400" : ""}`}>
                                    {currency(Math.abs(t.grandTotal))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 font-bold bg-muted/30">
                                <td colSpan={7} className="py-2 pr-3 text-sm">TOTAL</td>
                                <td className="py-2 pr-3 text-right text-sm">{currency(summary.totalDpp ?? 0)}</td>
                                <td className="py-2 pr-3 text-right text-sm text-orange-600">{currency(summary.totalTaxAmount ?? 0)}</td>
                                <td className="py-2 text-right text-sm">{currency(summary.totalGrandTotal ?? 0)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ── Rekap Per Periode Tab ── */}
                <TabsContent value="rekap" className="mt-0">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Rekapitulasi PPN per Periode</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {byPeriod.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">Tidak ada data</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-xs text-muted-foreground">
                                <th className="text-left py-2 font-semibold">Periode</th>
                                <th className="text-right py-2 font-semibold">Transaksi</th>
                                <th className="text-right py-2 font-semibold">DPP</th>
                                <th className="text-right py-2 font-semibold">PPN 11%</th>
                                <th className="text-right py-2 font-semibold">Grand Total</th>
                                <th className="text-right py-2 font-semibold">% PPN</th>
                              </tr>
                            </thead>
                            <tbody>
                              {byPeriod.map((p: any) => (
                                <tr key={p.period} className="border-b hover:bg-muted/20">
                                  <td className="py-2 font-medium">{p.period}</td>
                                  <td className="py-2 text-right tabular-nums">{p.count}</td>
                                  <td className="py-2 text-right tabular-nums">{currency(p.dpp)}</td>
                                  <td className="py-2 text-right tabular-nums font-semibold text-orange-600">{currency(p.taxAmount)}</td>
                                  <td className="py-2 text-right tabular-nums font-bold">{currency(p.grandTotal)}</td>
                                  <td className="py-2 text-right text-muted-foreground text-xs">
                                    {p.grandTotal > 0 ? `${((p.taxAmount / p.grandTotal) * 100).toFixed(1)}%` : "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 font-bold bg-muted/30">
                                <td className="py-2">TOTAL</td>
                                <td className="py-2 text-right">{summary.totalTransactions ?? 0}</td>
                                <td className="py-2 text-right">{currency(summary.totalDpp ?? 0)}</td>
                                <td className="py-2 text-right text-orange-600">{currency(summary.totalTaxAmount ?? 0)}</td>
                                <td className="py-2 text-right">{currency(summary.totalGrandTotal ?? 0)}</td>
                                <td className="py-2 text-right text-muted-foreground text-xs">
                                  {(summary.totalGrandTotal ?? 0) > 0
                                    ? `${(((summary.totalTaxAmount ?? 0) / (summary.totalGrandTotal ?? 1)) * 100).toFixed(1)}%`
                                    : "-"}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ── SPT Masa PPN Tab ── */}
                <TabsContent value="spt" className="mt-0 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Rekap PPN Keluaran untuk pelaporan SPT Masa PPN. Semua transaksi Sport Center dikategorikan sebagai{" "}
                        <strong>PPN 11%</strong> (bukan PBJT).
                      </p>
                    </div>
                    <div className="flex gap-2 no-print shrink-0">
                      <Button variant="outline" size="sm" onClick={exportSptCSV} className="gap-1.5 h-8 text-xs">
                        <Download size={13} /> CSV SPT
                      </Button>
                      <Button variant="outline" size="sm" onClick={exportExcel} disabled={!transactions.length} className="gap-1.5 h-8 text-xs">
                        <Download size={13} /> Excel SPT
                      </Button>
                    </div>
                  </div>

                  {sptMasa.length === 0 ? (
                    <Card>
                      <CardContent className="py-16 text-center text-muted-foreground">
                        <Receipt size={36} className="mx-auto mb-3 opacity-20" />
                        <p className="font-medium">Belum ada data SPT</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      {/* SPT Summary table */}
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">Ringkasan SPT Masa PPN per Masa Pajak</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-xs text-muted-foreground">
                                  <th className="text-left py-2 font-semibold">Masa Pajak</th>
                                  <th className="text-right py-2 font-semibold">Jml Faktur</th>
                                  <th className="text-right py-2 font-semibold">DPP</th>
                                  <th className="text-right py-2 font-semibold">PPN Keluaran</th>
                                  <th className="text-right py-2 font-semibold no-print">Detail</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sptMasa.map((masa: any) => (
                                  <>
                                    <tr key={masa.masaPajak} className="border-b hover:bg-muted/20">
                                      <td className="py-2.5 font-semibold">{fmt(masa.masaPajak)}</td>
                                      <td className="py-2.5 text-right tabular-nums">{masa.count}</td>
                                      <td className="py-2.5 text-right tabular-nums">{currency(masa.dpp)}</td>
                                      <td className="py-2.5 text-right tabular-nums font-semibold text-orange-600">
                                        {currency(masa.ppnKeluaran)}
                                      </td>
                                      <td className="py-2.5 text-right no-print">
                                        <button
                                          className="text-xs text-primary hover:underline flex items-center gap-1 ml-auto"
                                          onClick={() => setExpandedMasa(expandedMasa === masa.masaPajak ? null : masa.masaPajak)}
                                        >
                                          {expandedMasa === masa.masaPajak ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                          {expandedMasa === masa.masaPajak ? "Tutup" : "Lihat"}
                                        </button>
                                      </td>
                                    </tr>
                                    {expandedMasa === masa.masaPajak && (
                                      <tr key={`${masa.masaPajak}-detail`} className="bg-muted/30 no-print">
                                        <td colSpan={5} className="py-0">
                                          <div className="px-4 py-3">
                                            <table className="w-full text-xs">
                                              <thead>
                                                <tr className="text-muted-foreground border-b">
                                                  <th className="text-left py-1.5 font-medium">Nomor Invoice</th>
                                                  <th className="text-left py-1.5 font-medium">Tanggal</th>
                                                  <th className="text-left py-1.5 font-medium">Customer</th>
                                                  <th className="text-left py-1.5 font-medium">NPWP / Keterangan</th>
                                                  <th className="text-left py-1.5 font-medium">Kode Pajak</th>
                                                  <th className="text-right py-1.5 font-medium">DPP</th>
                                                  <th className="text-right py-1.5 font-medium">PPN Keluaran</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {masa.items.map((item: any, idx: number) => (
                                                  <tr key={idx} className="border-b border-dashed border-border/50">
                                                    <td className="py-1.5 font-mono">{item.nomorInvoice}</td>
                                                    <td className="py-1.5 tabular-nums">{item.tanggalPajak}</td>
                                                    <td className="py-1.5">{item.customer}</td>
                                                    <td className="py-1.5">
                                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                        item.npwpKeterangan === "Perusahaan"
                                                          ? "bg-blue-100 text-blue-700"
                                                          : "bg-slate-100 text-slate-600"
                                                      }`}>
                                                        {item.npwp ? item.npwp : item.npwpKeterangan}
                                                      </span>
                                                    </td>
                                                    <td className="py-1.5">
                                                      <span className="bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-bold text-[10px]">
                                                        {item.taxCode}
                                                      </span>
                                                    </td>
                                                    <td className="py-1.5 text-right tabular-nums">{currency(item.dpp)}</td>
                                                    <td className="py-1.5 text-right tabular-nums font-semibold text-orange-600">
                                                      {currency(item.ppnKeluaran)}
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 font-bold bg-muted/30">
                                  <td className="py-2">TOTAL</td>
                                  <td className="py-2 text-right">{summary.totalTransactions ?? 0}</td>
                                  <td className="py-2 text-right">{currency(summary.totalDpp ?? 0)}</td>
                                  <td className="py-2 text-right text-orange-600">{currency(summary.totalTaxAmount ?? 0)}</td>
                                  <td className="no-print" />
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Note */}
                      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
                        <strong>Catatan:</strong> Seluruh transaksi penyewaan fasilitas Sport Center dikategorikan sebagai
                        PPN Keluaran 11% (bukan PBJT). Transaksi perorangan tanpa NPWP ditandai sebagai{" "}
                        <em>"Retail/Non-NPWP"</em>. Rekap ini dapat digunakan sebagai dasar pengisian SPT Masa PPN.
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </div>
    </>
  );
}
