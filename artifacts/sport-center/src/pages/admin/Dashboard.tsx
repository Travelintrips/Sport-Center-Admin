import { useGetDashboard, useListBookings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { CalendarDays, DollarSign, Clock, TrendingUp } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "#f59e0b",
  paid: "#3b82f6",
  confirmed: "#10b981",
  cancelled: "#ef4444",
  completed: "#6366f1",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  paid: "Paid",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

export default function AdminDashboard() {
  const { data, isLoading } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your sport center</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      </div>
    );
  }

  const stats = [
    { label: "Total Bookings", value: data?.totalBookings ?? 0, icon: CalendarDays, format: (v: number) => v.toString() },
    { label: "Total Revenue", value: data?.totalRevenue ?? 0, icon: DollarSign, format: formatCurrency },
    { label: "Today's Bookings", value: data?.todayBookings ?? 0, icon: TrendingUp, format: (v: number) => v.toString() },
    { label: "Pending Payment", value: data?.pendingBookings ?? 0, icon: Clock, format: (v: number) => v.toString() },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your sport center operations</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Icon size={20} />
                  </div>
                </div>
                <div className="text-2xl font-black">{stat.format(stat.value)}</div>
                <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Booking by status pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Bookings by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data?.bookingsByStatus?.filter(s => s.count > 0)}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${STATUS_LABELS[name] ?? name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {data?.bookingsByStatus?.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, name) => [v, STATUS_LABELS[name as string] ?? name]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Revenue by month */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Monthly Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [formatCurrency(Number(v)), "Revenue"]} />
                  <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top facilities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Top Facilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.topFacilities} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="facilityName" type="category" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip formatter={(v) => [v, "Bookings"]} />
                  <Bar dataKey="bookingCount" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent bookings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold">Recent Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data?.recentBookings?.slice(0, 5).map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.customerName}</div>
                    <div className="text-xs text-muted-foreground truncate">{b.facilityName} — {b.bookingDate}</div>
                  </div>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-xs"
                    style={{ background: STATUS_COLORS[b.status] + "20", color: STATUS_COLORS[b.status] }}
                  >
                    {STATUS_LABELS[b.status] ?? b.status}
                  </Badge>
                </div>
              ))}
              {!data?.recentBookings?.length && (
                <p className="text-sm text-muted-foreground text-center py-4">No bookings yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
