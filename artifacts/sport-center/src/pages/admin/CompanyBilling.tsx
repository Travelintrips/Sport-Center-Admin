import { useState } from "react";
import {
  useListCompanyInvoices, useGenerateCompanyInvoice, useUpdateCompanyInvoice,
  useListCustomers,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Building2, Plus, CheckCircle, FileText, AlertCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListCompanyInvoicesQueryKey } from "@workspace/api-client-react";

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function getMonthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("id-ID", { year: "numeric", month: "long" });
    opts.push({ value, label });
  }
  return opts;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid")
    return <Badge className="bg-green-100 text-green-700 border-green-200 gap-1"><CheckCircle size={10} /> Lunas</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 gap-1"><AlertCircle size={10} /> Belum Lunas</Badge>;
}

function GenerateInvoiceDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [periodMonth, setPeriodMonth] = useState(getMonthOptions()[1].value);
  const [notes, setNotes] = useState("");
  const generateMutation = useGenerateCompanyInvoice();
  const { data: companies } = useListCustomers({ accountType: "company" });

  const handleGenerate = async () => {
    if (!companyId) { toast({ title: "Pilih perusahaan", variant: "destructive" }); return; }
    try {
      await generateMutation.mutateAsync({
        data: { companyCustomerId: parseInt(companyId), periodMonth, notes: notes || undefined },
      });
      toast({ title: "Invoice berhasil dibuat" });
      qc.invalidateQueries({ queryKey: getListCompanyInvoicesQueryKey() });
      onClose();
    } catch (e: any) {
      toast({ title: e?.message ?? "Gagal membuat invoice", variant: "destructive" });
    }
  };

  const monthOptions = getMonthOptions();

  return (
    <DialogContent className="max-w-sm">
      <DialogHeader><DialogTitle>Generate Invoice Bulanan</DialogTitle></DialogHeader>
      <div className="space-y-4 pt-2">
        <div className="space-y-1">
          <Label>Perusahaan *</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="Pilih perusahaan..." /></SelectTrigger>
            <SelectContent>
              {companies?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.companyName ?? c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Periode Bulan *</Label>
          <Select value={periodMonth} onValueChange={setPeriodMonth}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Catatan (opsional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan tambahan..." rows={2} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleGenerate} disabled={generateMutation.isPending} className="gap-2">
            <FileText size={14} /> Generate Invoice
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

function InvoiceDetail({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMutation = useUpdateCompanyInvoice();

  const handleMarkPaid = async () => {
    try {
      await updateMutation.mutateAsync({ id: invoice.id, data: { status: "paid" } });
      toast({ title: "Invoice ditandai sebagai lunas" });
      qc.invalidateQueries({ queryKey: getListCompanyInvoicesQueryKey() });
      onClose();
    } catch {
      toast({ title: "Gagal memperbarui invoice", variant: "destructive" });
    }
  };

  const periodLabel = (() => {
    const [year, month] = invoice.periodMonth.split("-");
    return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("id-ID", { year: "numeric", month: "long" });
  })();

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Detail Invoice</DialogTitle></DialogHeader>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-black text-xl">{invoice.invoiceNumber}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
              <Building2 size={12} /> {invoice.companyName}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">{periodLabel}</div>
          </div>
          <StatusBadge status={invoice.status} />
        </div>

        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (sebelum PPN)</span><span className="font-semibold">{formatCurrency(invoice.totalAmount)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">PPN 11%</span><span className="font-semibold">{formatCurrency(invoice.ppnAmount)}</span></div>
          <div className="flex justify-between border-t pt-2 font-black text-base"><span>Total</span><span className="text-primary">{formatCurrency(invoice.grandTotal)}</span></div>
        </div>

        {invoice.notes && <div className="text-sm text-muted-foreground bg-muted/40 rounded p-3">{invoice.notes}</div>}

        {invoice.paidAt && (
          <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 rounded-lg p-3 border border-green-200">
            <CheckCircle size={14} />
            Dibayar pada {new Date(invoice.paidAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
          </div>
        )}

        {invoice.bookings && invoice.bookings.length > 0 && (
          <div>
            <h4 className="font-semibold mb-2 text-sm">Booking Terkait ({invoice.bookings.length})</h4>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {invoice.bookings.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded">
                  <div>
                    <div className="font-medium text-xs">{b.facilityName}</div>
                    <div className="text-xs text-muted-foreground">{b.bookingDate} · {b.startTime}–{b.endTime}</div>
                  </div>
                  <span className="font-semibold text-xs">{formatCurrency(b.totalPrice)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {invoice.status === "unpaid" && (
          <div className="flex justify-end pt-1">
            <Button onClick={handleMarkPaid} disabled={updateMutation.isPending} className="gap-2 bg-green-600 hover:bg-green-700">
              <CheckCircle size={14} /> Tandai Lunas
            </Button>
          </div>
        )}
      </div>
    </DialogContent>
  );
}

export default function AdminCompanyBilling() {
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  const { data: companies } = useListCustomers({ accountType: "company" });
  const { data: invoices, isLoading, refetch } = useListCompanyInvoices({
    companyCustomerId: filterCompany !== "all" ? parseInt(filterCompany) : undefined,
    status: filterStatus !== "all" ? filterStatus as "unpaid" | "paid" : undefined,
  });

  const totalUnpaid = invoices?.filter((i) => i.status === "unpaid").reduce((s, i) => s + i.grandTotal, 0) ?? 0;
  const totalPaid = invoices?.filter((i) => i.status === "paid").reduce((s, i) => s + i.grandTotal, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Tagihan Perusahaan</h1>
          <p className="text-muted-foreground">Invoice bulanan untuk customer perusahaan</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw size={16} /></Button>
          <Button onClick={() => setShowGenerate(true)} className="gap-2"><Plus size={16} /> Generate Invoice</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center text-yellow-600"><AlertCircle size={20} /></div>
            <div>
              <div className="text-xs text-muted-foreground">Belum Lunas</div>
              <div className="font-black text-lg">{formatCurrency(totalUnpaid)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-green-600"><CheckCircle size={20} /></div>
            <div>
              <div className="text-xs text-muted-foreground">Sudah Lunas</div>
              <div className="font-black text-lg">{formatCurrency(totalPaid)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><FileText size={20} /></div>
            <div>
              <div className="text-xs text-muted-foreground">Total Invoice</div>
              <div className="font-black text-lg">{invoices?.length ?? 0}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daftar Invoice</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex flex-wrap gap-3 mb-4">
            <Select value={filterCompany} onValueChange={setFilterCompany}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Semua perusahaan" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Perusahaan</SelectItem>
                {companies?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.companyName ?? c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="unpaid">Belum Lunas</SelectItem>
                <SelectItem value="paid">Lunas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">No. Invoice</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Perusahaan</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Periode</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Subtotal</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Total + PPN</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Status</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices?.map((inv) => {
                    const [year, month] = inv.periodMonth.split("-");
                    const periodLabel = new Date(parseInt(year), parseInt(month) - 1, 1)
                      .toLocaleDateString("id-ID", { year: "numeric", month: "short" });
                    return (
                      <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 pr-4"><span className="font-mono text-xs font-semibold">{inv.invoiceNumber}</span></td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <Building2 size={12} className="text-orange-500 shrink-0" />
                            <span className="font-medium">{inv.companyName}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{periodLabel}</td>
                        <td className="py-3 pr-4">{formatCurrency(inv.totalAmount)}</td>
                        <td className="py-3 pr-4 font-semibold">{formatCurrency(inv.grandTotal)}</td>
                        <td className="py-3 pr-4"><StatusBadge status={inv.status} /></td>
                        <td className="py-3">
                          <Button size="sm" variant="ghost" onClick={() => setSelectedInvoice(inv)} className="gap-1">
                            <FileText size={14} /> Detail
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!invoices?.length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada invoice</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showGenerate} onOpenChange={(v) => !v && setShowGenerate(false)}>
        {showGenerate && <GenerateInvoiceDialog onClose={() => setShowGenerate(false)} />}
      </Dialog>

      <Dialog open={!!selectedInvoice} onOpenChange={(v) => !v && setSelectedInvoice(null)}>
        {selectedInvoice && <InvoiceDetail invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
      </Dialog>
    </div>
  );
}
