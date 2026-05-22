import { useState } from "react";
import { useListCustomers, useGetCustomer, useListBookings, getListCustomersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, User, Eye } from "lucide-react";

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "#f59e0b", paid: "#3b82f6", confirmed: "#10b981", cancelled: "#ef4444", completed: "#6366f1",
};
const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending", paid: "Paid", confirmed: "Confirmed", cancelled: "Cancelled", completed: "Completed",
};

function CustomerDetail({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const { data: customer, isLoading: custLoading } = useGetCustomer(customerId);
  const { data: bookings, isLoading: bookLoading } = useListBookings({ customerId });

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Customer Detail</DialogTitle>
      </DialogHeader>
      {custLoading ? <Skeleton className="h-32" /> : customer && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-black">
              {customer.name.charAt(0)}
            </div>
            <div>
              <h3 className="font-bold text-lg">{customer.name}</h3>
              <div className="text-sm text-muted-foreground">{customer.email}</div>
              {customer.phone && <div className="text-sm text-muted-foreground">{customer.phone}</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-black">{customer.totalBookings}</div>
                <div className="text-xs text-muted-foreground">Total Bookings</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-lg font-black">{formatCurrency(customer.totalSpent)}</div>
                <div className="text-xs text-muted-foreground">Total Spent</div>
              </CardContent>
            </Card>
          </div>
          {bookLoading ? <Skeleton className="h-32" /> : (
            <div>
              <h4 className="font-semibold mb-2">Recent Bookings</h4>
              <div className="space-y-2">
                {bookings?.slice(0, 5).map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded-md">
                    <div>
                      <div className="font-medium">{b.facilityName}</div>
                      <div className="text-xs text-muted-foreground">{b.bookingDate} · {b.startTime}–{b.endTime}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatCurrency(b.totalPrice)}</div>
                      <Badge variant="secondary" className="text-xs" style={{ background: STATUS_COLORS[b.status] + "20", color: STATUS_COLORS[b.status] }}>
                        {STATUS_LABELS[b.status]}
                      </Badge>
                    </div>
                  </div>
                ))}
                {!bookings?.length && <div className="text-sm text-muted-foreground text-center py-4">No bookings</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  );
}

export default function AdminCustomers() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: customers, isLoading } = useListCustomers({ search: search || undefined });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black">Customers</h1>
        <p className="text-muted-foreground">View and manage registered customers</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name or email..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Customer</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Phone</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Bookings</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Total Spent</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {customers?.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                            {c.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-muted-foreground">{c.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{c.phone ?? "–"}</td>
                      <td className="py-3 pr-4 font-semibold">{c.totalBookings}</td>
                      <td className="py-3 pr-4 font-semibold">{formatCurrency(c.totalSpent)}</td>
                      <td className="py-3">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedId(c.id)}>
                          <Eye size={14} className="mr-1" /> View
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!customers?.length && (
                    <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No customers found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={selectedId !== null} onOpenChange={(v) => !v && setSelectedId(null)}>
        {selectedId && <CustomerDetail customerId={selectedId} onClose={() => setSelectedId(null)} />}
      </Dialog>
    </div>
  );
}
