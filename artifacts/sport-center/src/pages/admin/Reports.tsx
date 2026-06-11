import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Download, DollarSign, CalendarDays, CheckCircle, Users } from "lucide-react";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

const COLORS = ["#F97316", "#3B82F6", "#22C55E", "#EF4444", "#8B5CF6", "#F59E0B", "#14B8A6"];

function currency(n: number) { return `Rp ${n.toLocaleString("id-ID")}`; }

export default function AdminReports() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [groupBy, setGroupBy] = useState("month");
  const [facilityId, setFacilityId] = useState("all");

  const { data: facilities = [] } = useQuery({
    queryKey: ["facilities"],
    queryFn: () => fetch(`${API}/facilities`).then(r => r.json()),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["reports", startDate, endDate, groupBy, facilityId],
    queryFn: () => fetch(`${API}/admin/reports?startDate=${startDate}&endDate=${endDate}&groupBy=${groupBy}${facilityId !== "all" ? `&facilityId=${facilityId}` : ""}`, { headers: authHeaders() }).then(r => r.json()),
    staleTime: 30000,
  });

  function handleExport() {
    const url = `${API}/admin/reports/export?startDate=${startDate}&endDate=${endDate}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "report.csv");
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const summary = data?.summary ?? {};
  const membershipSummary = data?.membershipSummary ?? {};
  const revenueData = data?.revenueByPeriod ?? [];
  const facilityData = data?.revenueByFacility ?? [];
  const statusData = (data?.revenueByStatus ?? []).filter((s: any) => s.count > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-2"><TrendingUp size={28} /> Laporan Keuangan</h1>
          <p className="text-muted-foreground mt-1">Analisis revenue dan performa booking</p>
        </div>
        <Button variant="outline" onClick={handleExport} className="gap-2"><Download size={16} /> Export CSV</Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3 flex-wrap items-end">
            <div className="space-y-1">
              <Label>Dari Tanggal</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label>Sampai Tanggal</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label>Kelompokkan Per</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Hari</SelectItem>
                  <SelectItem value="week">Minggu</SelectItem>
                  <SelectItem value="month">Bulan</SelectItem>
                  <SelectItem value="year">Tahun</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Fasilitas</Label>
              <Select value={facilityId} onValueChange={setFacilityId}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  {facilities.map((f: any) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Memuat laporan...</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <DollarSign className="text-primary" size={24} />
                  <div>
                    <div className="text-2xl font-black">{currency(summary.totalRevenue ?? 0)}</div>
                    <div className="text-xs text-muted-foreground">Total Revenue</div>
                    {(summary.membershipRevenue ?? 0) > 0 && (
                      <div className="text-[10px] text-purple-500 mt-0.5">
                        termasuk member Rp {(summary.membershipRevenue ?? 0).toLocaleString("id-ID")}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CalendarDays className="text-blue-500" size={24} />
                  <div>
                    <div className="text-2xl font-black">{summary.totalBookings ?? 0}</div>
                    <div className="text-xs text-muted-foreground">Total Booking</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle className="text-green-500" size={24} />
                  <div>
                    <div className="text-2xl font-black">{summary.completedBookings ?? 0}</div>
                    <div className="text-xs text-muted-foreground">Booking Selesai</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <DollarSign className="text-orange-500" size={24} />
                  <div>
                    <div className="text-2xl font-black">{currency(summary.avgTicketSize ?? 0)}</div>
                    <div className="text-xs text-muted-foreground">Avg Ticket Booking</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Membership summary */}
          {(membershipSummary.totalMemberships ?? 0) > 0 && (
            <Card className="border-purple-200 dark:border-purple-800">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center gap-2 mb-4">
                  <Users size={16} className="text-purple-500" />
                  <span className="text-sm font-bold text-purple-700 dark:text-purple-300">Ringkasan Member Gym</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 p-3">
                    <div className="text-xl font-black text-purple-700 dark:text-purple-300">{currency(membershipSummary.membershipRevenue ?? 0)}</div>
                    <div className="text-[10px] text-purple-500 font-semibold uppercase mt-0.5">Revenue Member</div>
                  </div>
                  <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
                    <div className="text-xl font-black text-green-700 dark:text-green-300">{membershipSummary.activeMemberships ?? 0}</div>
                    <div className="text-[10px] text-green-500 font-semibold uppercase mt-0.5">Aktif</div>
                  </div>
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
                    <div className="text-xl font-black text-amber-700 dark:text-amber-300">{membershipSummary.pendingMemberships ?? 0}</div>
                    <div className="text-[10px] text-amber-500 font-semibold uppercase mt-0.5">Menunggu Konfirmasi</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                    <div className="text-xl font-black text-slate-700 dark:text-slate-300">{membershipSummary.expiredMemberships ?? 0}</div>
                    <div className="text-[10px] text-slate-500 font-semibold uppercase mt-0.5">Expired</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Revenue chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                Tren Revenue
                <span className="flex items-center gap-3 text-xs font-normal text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-[#F97316]" /> Booking</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-[#a855f7]" /> Member Gym</span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {revenueData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Tidak ada data</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `${(v/1000000).toFixed(1)}jt`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any, name: string) => [currency(Number(v)), name === "membershipRevenue" ? "Member Gym" : "Booking"]} />
                    <Bar dataKey="revenue" stackId="rev" fill="#F97316" name="Booking" radius={[0,0,0,0]} />
                    <Bar dataKey="membershipRevenue" stackId="rev" fill="#a855f7" name="Member Gym" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            {/* By facility */}
            <Card>
              <CardHeader><CardTitle>Revenue per Fasilitas</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={facilityData.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v) => `${(v/1000000).toFixed(1)}jt`} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="facilityName" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip formatter={(v: any) => currency(v)} />
                    <Bar dataKey="revenue" fill="#F97316" name="Revenue" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* By status */}
            <Card>
              <CardHeader><CardTitle>Booking per Status</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={statusData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={90} label={({ status, count }) => `${status}: ${count}`} labelLine={false}>
                      {statusData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Facility table */}
          <Card>
            <CardHeader><CardTitle>Detail per Fasilitas</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-semibold">Fasilitas</th>
                      <th className="text-left py-2 font-semibold">Kategori</th>
                      <th className="text-right py-2 font-semibold">Booking</th>
                      <th className="text-right py-2 font-semibold">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facilityData.map((f: any) => (
                      <tr key={f.facilityId} className="border-b hover:bg-muted/30">
                        <td className="py-2">{f.facilityName}</td>
                        <td className="py-2 text-muted-foreground">{f.category}</td>
                        <td className="py-2 text-right">{f.bookings}</td>
                        <td className="py-2 text-right font-semibold">{currency(f.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
