import { useState } from "react";
import { useListBookings, useUpdateBooking, useUpdatePayment, getListBookingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Download, Search, Eye, ChevronDown } from "lucide-react";

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

export default function AdminBookings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [adminNotes, setAdminNotes] = useState("");

  const { data: bookings, isLoading } = useListBookings();
  const updateBookingMutation = useUpdateBooking({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Booking updated" });
        setSelectedBooking(null);
      },
      onError: () => toast({ title: "Error updating booking", variant: "destructive" }),
    }
  });

  const updatePaymentMutation = useUpdatePayment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
        toast({ title: "Payment updated" });
        setSelectedBooking(null);
      },
      onError: () => toast({ title: "Error updating payment", variant: "destructive" }),
    }
  });

  const filtered = (bookings ?? []).filter((b) => {
    const matchStatus = statusFilter === "all" || b.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || b.customerName.toLowerCase().includes(q) || b.orderNumber.toLowerCase().includes(q) || b.facilityName.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const handleStatusUpdate = (bookingId: number, status: string) => {
    updateBookingMutation.mutate({ id: bookingId, data: { status: status as any, adminNotes } });
  };

  const handlePaymentConfirm = (paymentId: number, status: "confirmed" | "rejected") => {
    updatePaymentMutation.mutate({ id: paymentId, data: { status } });
  };

  const handleExport = () => {
    const url = "/api/admin/bookings/export";
    const a = document.createElement("a");
    const token = localStorage.getItem("sport_center_token");
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        a.href = URL.createObjectURL(blob);
        a.download = "bookings.csv";
        a.click();
      });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black">Bookings</h1>
          <p className="text-muted-foreground">Manage all facility bookings</p>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download size={16} className="mr-2" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-48">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by name, order, facility..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Order</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Customer</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Facility</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Date & Time</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Total</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Status</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{b.orderNumber}</td>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{b.customerName}</div>
                        <div className="text-xs text-muted-foreground">{b.customerPhone}</div>
                      </td>
                      <td className="py-3 pr-4 font-medium">{b.facilityName}</td>
                      <td className="py-3 pr-4 text-xs">
                        <div>{b.bookingDate}</div>
                        <div className="text-muted-foreground">{b.startTime} – {b.endTime}</div>
                      </td>
                      <td className="py-3 pr-4 font-semibold">{formatCurrency(b.totalPrice)}</td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          style={{ background: STATUS_COLORS[b.status] + "20", color: STATUS_COLORS[b.status] }}
                        >
                          {STATUS_LABELS[b.status] ?? b.status}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setSelectedBooking(b); setAdminNotes(b.adminNotes ?? ""); }}
                        >
                          <Eye size={15} className="mr-1" /> View
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No bookings found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selectedBooking} onOpenChange={(v) => !v && setSelectedBooking(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Booking Detail</DialogTitle>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Order:</span> <span className="font-mono font-semibold">{selectedBooking.orderNumber}</span></div>
                <div><span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant="secondary" style={{ background: STATUS_COLORS[selectedBooking.status] + "20", color: STATUS_COLORS[selectedBooking.status] }}>
                    {STATUS_LABELS[selectedBooking.status]}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground">Customer:</span> {selectedBooking.customerName}</div>
                <div><span className="text-muted-foreground">Phone:</span> {selectedBooking.customerPhone}</div>
                <div><span className="text-muted-foreground">Email:</span> {selectedBooking.customerEmail}</div>
                <div><span className="text-muted-foreground">Facility:</span> {selectedBooking.facilityName}</div>
                <div><span className="text-muted-foreground">Date:</span> {selectedBooking.bookingDate}</div>
                <div><span className="text-muted-foreground">Time:</span> {selectedBooking.startTime} – {selectedBooking.endTime}</div>
                <div><span className="text-muted-foreground">Duration:</span> {selectedBooking.durationHours}h</div>
                <div><span className="text-muted-foreground">Total:</span> <span className="font-bold">{formatCurrency(selectedBooking.totalPrice)}</span></div>
              </div>

              {selectedBooking.notes && (
                <div className="text-sm bg-muted/40 rounded-md p-3">
                  <div className="text-muted-foreground mb-1">Customer Notes:</div>
                  <div>{selectedBooking.notes}</div>
                </div>
              )}

              {selectedBooking.payment && (
                <div className="text-sm bg-blue-50 dark:bg-blue-950/20 rounded-md p-3 border border-blue-200 dark:border-blue-900">
                  <div className="font-semibold mb-2">Payment</div>
                  <div>Status: <Badge variant="secondary">{selectedBooking.payment.status}</Badge></div>
                  {selectedBooking.payment.proofUrl && (
                    <a href={selectedBooking.payment.proofUrl} target="_blank" rel="noreferrer" className="text-primary underline text-xs mt-1 block">
                      View Proof
                    </a>
                  )}
                  {selectedBooking.payment.status === "pending" && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handlePaymentConfirm(selectedBooking.payment.id, "confirmed")}>
                        Confirm Payment
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handlePaymentConfirm(selectedBooking.payment.id, "rejected")}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>Admin Notes</Label>
                <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Add internal notes..." rows={2} />
              </div>

              <div className="space-y-2">
                <Label>Update Status</Label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={selectedBooking.status === v ? "default" : "outline"}
                      onClick={() => handleStatusUpdate(selectedBooking.id, v)}
                      disabled={updateBookingMutation.isPending}
                    >
                      {l}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedBooking(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
