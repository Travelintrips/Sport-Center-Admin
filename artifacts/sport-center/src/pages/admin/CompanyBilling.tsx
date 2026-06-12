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
import {
  Building2, Plus, CheckCircle, FileText, AlertCircle, RefreshCw, Eye,
  User, Phone, Mail, MapPin, Download, MessageSquare, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { getListCompanyInvoicesQueryKey } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";

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

function periodLabel(periodMonth: string) {
  const [year, month] = periodMonth.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("id-ID", { year: "numeric", month: "long" });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid")
    return <Badge className="bg-green-100 text-green-700 border-green-200 gap-1"><CheckCircle size={10} /> Lunas</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 gap-1"><AlertCircle size={10} /> Belum Lunas</Badge>;
}

function printInvoicePdf(invoice: any) {
  const items: any[] = invoice.items ?? [];
  const periodStr = periodLabel(invoice.periodMonth);

  const rows = items.map((item: any, i: number) => `
    <tr style="border-bottom:1px solid #e5e7eb; ${i % 2 === 1 ? "background:#f9fafb;" : ""}">
      <td style="padding:7px 8px; font-size:12px;">${item.customerName ?? "-"}</td>
      <td style="padding:7px 8px; font-size:12px;">${item.customerPhone ?? "-"}</td>
      <td style="padding:7px 8px; font-size:12px;">${item.facilityName ?? "-"}</td>
      <td style="padding:7px 8px; font-size:12px;">${item.bookingDate ?? "-"}</td>
      <td style="padding:7px 8px; font-size:12px;">${item.startTime ?? "-"}–${item.endTime ?? "-"}</td>
      <td style="padding:7px 8px; font-size:12px; text-align:center;">${item.durationHours ?? 0} jam</td>
      <td style="padding:7px 8px; font-size:12px; text-align:right;">${formatCurrency(item.subtotal ?? 0)}</td>
      <td style="padding:7px 8px; font-size:12px; text-align:right;">${formatCurrency(item.taxAmount ?? 0)}</td>
      <td style="padding:7px 8px; font-size:12px; text-align:right; font-weight:600;">${formatCurrency(item.totalAmount ?? 0)}</td>
      <td style="padding:7px 8px; font-size:11px; color:#6b7280; font-family:monospace;">${item.orderNumber ?? "-"}</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8"/>
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    @media print { body { margin: 0; } .no-print { display:none !important; } }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 32px; color: #111; }
    h1 { margin:0; font-size:22px; color:#ea580c; }
    h2 { margin:0; font-size:15px; font-weight:700; }
    table { width:100%; border-collapse:collapse; margin-top:16px; }
    th { background:#ea580c; color:#fff; padding:8px 8px; font-size:12px; text-align:left; }
    .total-row td { font-weight:700; background:#fff7ed; border-top:2px solid #ea580c; }
    .grand-row td { font-weight:900; font-size:14px; background:#ea580c; color:#fff; }
    .info-box { background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:14px; margin-bottom:16px; }
    .flex { display:flex; justify-content:space-between; align-items:flex-start; }
    .badge-unpaid { background:#fef9c3; color:#a16207; padding:4px 12px; border-radius:99px; font-size:12px; font-weight:600; }
    .badge-paid { background:#dcfce7; color:#15803d; padding:4px 12px; border-radius:99px; font-size:12px; font-weight:600; }
  </style>
</head>
<body>
  <div class="flex">
    <div>
      <h1>Sport Center Soekarno-Hatta</h1>
      <div style="color:#6b7280; font-size:13px; margin-top:4px;">Kawasan Bandara Soekarno-Hatta, Tangerang</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px; font-weight:900; color:#ea580c;">${invoice.invoiceNumber}</div>
      <div style="font-size:13px; color:#6b7280;">Tanggal: ${new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" })}</div>
      <div class="${invoice.status === "paid" ? "badge-paid" : "badge-unpaid"}" style="margin-top:6px; display:inline-block;">${invoice.status === "paid" ? "✓ LUNAS" : "BELUM LUNAS"}</div>
    </div>
  </div>

  <hr style="margin:20px 0; border:none; border-top:2px solid #ea580c;"/>

  <div class="flex" style="gap:20px;">
    <div class="info-box" style="flex:1;">
      <div style="font-size:11px; color:#9ca3af; font-weight:700; text-transform:uppercase; letter-spacing:.05em; margin-bottom:8px;">Tagihan Kepada</div>
      <div style="font-weight:700; font-size:14px;">${invoice.companyName}</div>
      ${invoice.picName ? `<div style="font-size:13px; color:#374151; margin-top:4px;">PIC: ${invoice.picName}</div>` : ""}
      ${invoice.picPhone ? `<div style="font-size:13px; color:#374151;">Telp: ${invoice.picPhone}</div>` : ""}
      ${invoice.picEmail ? `<div style="font-size:13px; color:#374151;">Email: ${invoice.picEmail}</div>` : ""}
      ${invoice.billingAddress ? `<div style="font-size:13px; color:#374151;">${invoice.billingAddress}</div>` : ""}
    </div>
    <div class="info-box" style="flex:1;">
      <div style="font-size:11px; color:#9ca3af; font-weight:700; text-transform:uppercase; letter-spacing:.05em; margin-bottom:8px;">Periode Tagihan</div>
      <div style="font-weight:700; font-size:14px;">${periodStr}</div>
      <div style="font-size:13px; color:#374151; margin-top:8px;">Total Pemakaian: <strong>${items.length} sesi</strong></div>
    </div>
  </div>

  <h2 style="margin:20px 0 8px; font-size:14px;">Detail Pemakaian</h2>
  <table>
    <thead>
      <tr>
        <th>Customer</th>
        <th>No. WA</th>
        <th>Fasilitas</th>
        <th>Tanggal</th>
        <th>Jam</th>
        <th style="text-align:center;">Durasi</th>
        <th style="text-align:right;">Subtotal</th>
        <th style="text-align:right;">PPN 11%</th>
        <th style="text-align:right;">Total</th>
        <th>No. Booking</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="10" style="text-align:center;padding:20px;color:#9ca3af;">Tidak ada data</td></tr>`}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="6" style="padding:10px 8px; font-size:13px;">DPP (Subtotal)</td>
        <td colspan="3" style="padding:10px 8px; text-align:right; font-size:13px;">${formatCurrency(invoice.totalAmount)}</td>
        <td></td>
      </tr>
      <tr class="total-row">
        <td colspan="6" style="padding:8px 8px; font-size:13px;">PPN 11%</td>
        <td colspan="3" style="padding:8px 8px; text-align:right; font-size:13px;">${formatCurrency(invoice.ppnAmount)}</td>
        <td></td>
      </tr>
      <tr class="grand-row">
        <td colspan="6" style="padding:10px 8px; font-size:14px;">GRAND TOTAL</td>
        <td colspan="3" style="padding:10px 8px; text-align:right; font-size:16px;">${formatCurrency(invoice.grandTotal)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  ${invoice.notes ? `<div style="margin-top:20px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:12px; font-size:13px;"><strong>Catatan:</strong> ${invoice.notes}</div>` : ""}
  ${invoice.paidAt ? `<div style="margin-top:16px; color:#15803d; font-size:13px;">✓ Dibayar pada ${new Date(invoice.paidAt).toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" })}</div>` : ""}

  <hr style="margin:32px 0 16px; border:none; border-top:1px solid #e5e7eb;"/>
  <div style="font-size:11px; color:#9ca3af; text-align:center;">
    Dokumen ini dicetak secara otomatis dari sistem Sport Center Soekarno-Hatta
  </div>

  <script>window.onload = function(){ window.print(); };</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

function GenerateInvoiceDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [periodMonth, setPeriodMonth] = useState(getMonthOptions()[0].value);
  const [notes, setNotes] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const generateMutation = useGenerateCompanyInvoice();
  const { data: companies } = useListCustomers({ accountType: "company" });

  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ["invoice-preview", companyId, periodMonth],
    queryFn: async () => {
      if (!companyId) return null;
      const token = getToken();
      const res = await fetch(
        `/api/company-invoices/preview?companyCustomerId=${companyId}&periodMonth=${periodMonth}`,
        { headers: { Authorization: `Bearer ${token ?? ""}` } }
      );
      if (!res.ok) throw new Error("Gagal memuat preview");
      return res.json();
    },
    enabled: !!companyId,
  });

  const subtotal = preview?.subtotal ?? 0;
  const ppnAmount = preview?.ppnAmount ?? 0;
  const grandTotal = preview?.grandTotal ?? subtotal;
  const existingInvoice = preview?.existingInvoice;

  const handleGenerate = async () => {
    if (!companyId) { toast({ title: "Pilih perusahaan", variant: "destructive" }); return; }
    if (!existingInvoice && preview?.bookingCount === 0) {
      toast({ title: "Tidak ada booking untuk ditagihkan pada periode ini", variant: "destructive" });
      return;
    }
    try {
      const result = await generateMutation.mutateAsync({
        data: { companyCustomerId: parseInt(companyId), periodMonth, notes: notes || undefined },
      });
      const msg = (result as any)?.message;
      toast({ title: msg ?? "Invoice berhasil dibuat" });
      qc.invalidateQueries({ queryKey: getListCompanyInvoicesQueryKey() });
      onClose();
    } catch (e: any) {
      const errMsg = e?.message ?? "Gagal membuat invoice";
      toast({ title: errMsg, variant: "destructive" });
    }
  };

  const monthOptions = getMonthOptions();

  const canGenerate = !!companyId && (
    existingInvoice
      ? existingInvoice.status !== "paid" && (preview?.bookingCount ?? 0) > 0
      : (preview?.bookingCount ?? 0) > 0
  );

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Generate Invoice Bulanan</DialogTitle></DialogHeader>
      <div className="space-y-4 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <Label>Perusahaan *</Label>
            <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setShowPreview(false); }}>
              <SelectTrigger><SelectValue placeholder="Pilih perusahaan..." /></SelectTrigger>
              <SelectContent>
                {companies?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {(c as any).companyName ?? c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Periode Bulan *</Label>
            <Select value={periodMonth} onValueChange={setPeriodMonth}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Warning: existing invoice */}
        {companyId && !previewLoading && existingInvoice && (
          <div className={`rounded-lg border p-3 flex items-start gap-2.5 text-sm ${
            existingInvoice.status === "paid"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}>
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <div>
              {existingInvoice.status === "paid"
                ? <><strong>Invoice sudah ada dan lunas:</strong> {existingInvoice.invoiceNumber}. Tidak dapat menambahkan booking baru.</>
                : <><strong>Invoice sudah ada:</strong> {existingInvoice.invoiceNumber} (Belum Lunas). {(preview?.bookingCount ?? 0) > 0 ? `${preview?.bookingCount} booking baru akan ditambahkan ke invoice ini.` : "Tidak ada booking baru."}</>
              }
            </div>
          </div>
        )}

        {/* Preview unbilled bookings */}
        {companyId && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-sm font-semibold transition-colors"
            >
              <span className="flex items-center gap-2">
                <Eye size={13} className="text-primary" />
                Preview Booking Belum Ditagih
                {previewLoading && <span className="text-xs text-muted-foreground">(memuat...)</span>}
                {preview && !previewLoading && (
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs px-1.5 py-0">
                    {preview.bookingCount} booking
                  </Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{showPreview ? "▲" : "▼"}</span>
            </button>
            {showPreview && preview && (
              <div className="p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {preview.bookings?.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">Tidak ada booking unbilled pada periode ini</p>
                )}
                {preview.bookings?.map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between text-xs p-1.5 bg-slate-50 dark:bg-slate-800 rounded">
                    <div>
                      <div className="font-medium">{b.facilityName}</div>
                      <div className="text-muted-foreground">{b.bookingDate} · {b.startTime}–{b.endTime} · {b.durationHours}jam · {b.customerName}</div>
                    </div>
                    <span className="font-semibold shrink-0 ml-2">{formatCurrency(b.totalPrice)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {companyId && preview && (preview.bookingCount ?? 0) > 0 && (
          <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">DPP (Harga Netto)</span><span className="font-semibold">{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">PPN 11%</span><span>{formatCurrency(ppnAmount)}</span></div>
            <div className="flex justify-between border-t pt-1 font-black"><span>Grand Total Invoice</span><span className="text-primary">{formatCurrency(grandTotal)}</span></div>
          </div>
        )}

        <div className="space-y-1">
          <Label>Catatan (opsional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan tambahan..." rows={2} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || !canGenerate}
            className="gap-2"
          >
            <FileText size={14} />
            {generateMutation.isPending
              ? "Memproses..."
              : existingInvoice && existingInvoice.status !== "paid"
                ? "Tambah ke Invoice Existing"
                : "Generate Invoice"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

function InvoiceDetail({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const updateMutation = useUpdateCompanyInvoice();
  const [sendingWa, setSendingWa] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["company-invoice-detail", invoiceId],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/api/company-invoices/${invoiceId}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error("Gagal memuat invoice");
      return res.json();
    },
  });

  const handleMarkPaid = async () => {
    try {
      await updateMutation.mutateAsync({ id: invoiceId, data: { status: "paid" } });
      toast({ title: "Invoice ditandai sebagai lunas" });
      qc.invalidateQueries({ queryKey: getListCompanyInvoicesQueryKey() });
      qc.invalidateQueries({ queryKey: ["company-invoice-detail", invoiceId] });
      onClose();
    } catch {
      toast({ title: "Gagal memperbarui invoice", variant: "destructive" });
    }
  };

  const handleSendWa = async () => {
    setSendingWa(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/company-invoices/${invoiceId}/send-wa`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal kirim WA");
      toast({ title: data.message ?? "WA berhasil dikirim" });
    } catch (e: any) {
      toast({ title: e?.message ?? "Gagal kirim WA", variant: "destructive" });
    } finally {
      setSendingWa(false);
    }
  };

  if (isLoading) {
    return (
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Detail Invoice</DialogTitle></DialogHeader>
        <div className="space-y-3 p-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      </DialogContent>
    );
  }

  if (!invoice) return null;

  const items: any[] = invoice.items ?? [];

  return (
    <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Detail Invoice</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-black text-2xl">{invoice.invoiceNumber}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
              <Building2 size={12} /> {invoice.companyName}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">{periodLabel(invoice.periodMonth)}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={invoice.status} />
            <Button size="sm" variant="outline" onClick={() => printInvoicePdf(invoice)} className="gap-1.5">
              <Download size={13} /> PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSendWa}
              disabled={sendingWa}
              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
            >
              <MessageSquare size={13} /> {sendingWa ? "Mengirim..." : "Kirim WA"}
            </Button>
            {invoice.status === "unpaid" && (
              <Button
                size="sm"
                onClick={handleMarkPaid}
                disabled={updateMutation.isPending}
                className="gap-1.5 bg-green-600 hover:bg-green-700"
              >
                <CheckCircle size={13} /> Tandai Lunas
              </Button>
            )}
          </div>
        </div>

        {/* PIC info */}
        {(invoice.picName || invoice.picPhone || invoice.picEmail || invoice.billingAddress) && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5 text-xs">
            <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Informasi PIC</div>
            {invoice.picName && <div className="flex items-center gap-2"><User size={11} className="text-muted-foreground" /><span>{invoice.picName}</span></div>}
            {invoice.picPhone && <div className="flex items-center gap-2"><Phone size={11} className="text-muted-foreground" /><span>{invoice.picPhone}</span></div>}
            {invoice.picEmail && <div className="flex items-center gap-2"><Mail size={11} className="text-muted-foreground" /><span>{invoice.picEmail}</span></div>}
            {invoice.billingAddress && <div className="flex items-center gap-2"><MapPin size={11} className="text-muted-foreground" /><span>{invoice.billingAddress}</span></div>}
          </div>
        )}

        {/* Line items table */}
        <div>
          <h4 className="font-semibold mb-2 text-sm">Detail Pemakaian ({items.length} sesi)</h4>
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">Tidak ada data pemakaian</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 border-b">
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Customer</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">No. WA</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Fasilitas</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Tanggal</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Jam</th>
                    <th className="text-center p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Durasi</th>
                    <th className="text-right p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Subtotal</th>
                    <th className="text-right p-2.5 font-semibold text-muted-foreground whitespace-nowrap">PPN 11%</th>
                    <th className="text-right p-2.5 font-semibold text-muted-foreground whitespace-nowrap">Total</th>
                    <th className="text-left p-2.5 font-semibold text-muted-foreground whitespace-nowrap">No. Booking</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item: any, i: number) => (
                    <tr key={item.id ?? i} className="hover:bg-muted/20 transition-colors">
                      <td className="p-2.5 whitespace-nowrap font-medium">{item.customerName ?? "-"}</td>
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground">{item.customerPhone ?? "-"}</td>
                      <td className="p-2.5 whitespace-nowrap">{item.facilityName ?? "-"}</td>
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground">{item.bookingDate ?? "-"}</td>
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground">{item.startTime ?? "-"}–{item.endTime ?? "-"}</td>
                      <td className="p-2.5 text-center whitespace-nowrap">{item.durationHours ?? 0} jam</td>
                      <td className="p-2.5 text-right whitespace-nowrap">{formatCurrency(item.subtotal ?? 0)}</td>
                      <td className="p-2.5 text-right whitespace-nowrap text-muted-foreground">{formatCurrency(item.taxAmount ?? 0)}</td>
                      <td className="p-2.5 text-right whitespace-nowrap font-semibold">{formatCurrency(item.totalAmount ?? 0)}</td>
                      <td className="p-2.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground">{item.orderNumber ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">DPP (Subtotal)</span><span className="font-semibold">{formatCurrency(invoice.totalAmount)}</span></div>
          {invoice.ppnAmount > 0 && (
            <div className="flex justify-between"><span className="text-muted-foreground">PPN 11%</span><span className="font-semibold">{formatCurrency(invoice.ppnAmount)}</span></div>
          )}
          <div className="flex justify-between border-t pt-2 font-black text-base"><span>Grand Total</span><span className="text-primary">{formatCurrency(invoice.grandTotal)}</span></div>
        </div>

        {invoice.notes && <div className="text-sm text-muted-foreground bg-muted/40 rounded p-3">{invoice.notes}</div>}

        {invoice.paidAt && (
          <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
            <CheckCircle size={14} />
            Dibayar pada {new Date(invoice.paidAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
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
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

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
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">PPN 11%</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Grand Total</th>
                    <th className="pb-3 pr-4 font-semibold text-muted-foreground">Status</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices?.map((inv) => {
                    const [year, month] = inv.periodMonth.split("-");
                    const label = new Date(parseInt(year), parseInt(month) - 1, 1)
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
                        <td className="py-3 pr-4 text-muted-foreground">{label}</td>
                        <td className="py-3 pr-4">{formatCurrency(inv.totalAmount)}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{formatCurrency(inv.ppnAmount)}</td>
                        <td className="py-3 pr-4 font-semibold">{formatCurrency(inv.grandTotal)}</td>
                        <td className="py-3 pr-4"><StatusBadge status={inv.status} /></td>
                        <td className="py-3">
                          <Button size="sm" variant="ghost" onClick={() => setSelectedInvoiceId(inv.id)} className="gap-1">
                            <FileText size={14} /> Detail
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!invoices?.length && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada invoice</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showGenerate} onOpenChange={(v) => !v && setShowGenerate(false)}>
        {showGenerate && <GenerateInvoiceDialog onClose={() => setShowGenerate(false)} />}
      </Dialog>

      <Dialog open={!!selectedInvoiceId} onOpenChange={(v) => !v && setSelectedInvoiceId(null)}>
        {selectedInvoiceId && <InvoiceDetail invoiceId={selectedInvoiceId} onClose={() => setSelectedInvoiceId(null)} />}
      </Dialog>
    </div>
  );
}
