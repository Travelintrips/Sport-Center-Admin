import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Printer, MessageCircle, Mail, ArrowLeft,
  RefreshCw, ExternalLink, CheckCircle, AlertCircle,
  Clock, XCircle,
} from "lucide-react";
import { getToken } from "@/lib/auth";

interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  dpp: number;
  dppNilaiLain: number;
  ppnRate: number;
  ppnAmount: number;
  grandTotal: number;
  centerName: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
}

function rp(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: any; cls: string }> = {
    confirmed:           { label: "Confirmed",           icon: CheckCircle,  cls: "bg-green-100 text-green-700 border-green-200" },
    completed:           { label: "Selesai",             icon: CheckCircle,  cls: "bg-green-100 text-green-700 border-green-200" },
    pending_payment:     { label: "Menunggu Pembayaran", icon: Clock,        cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    waiting_confirmation:{ label: "Verifikasi",          icon: Clock,        cls: "bg-blue-100 text-blue-700 border-blue-200" },
    paid:                { label: "Lunas",               icon: CheckCircle,  cls: "bg-green-100 text-green-700 border-green-200" },
    cancelled:           { label: "Dibatalkan",          icon: XCircle,      cls: "bg-red-100 text-red-700 border-red-200" },
    expired:             { label: "Kadaluarsa",          icon: XCircle,      cls: "bg-gray-100 text-gray-600 border-gray-200" },
  };
  const s = map[status] ?? { label: status, icon: AlertCircle, cls: "bg-gray-100 text-gray-600 border-gray-200" };
  const Icon = s.icon;
  return (
    <Badge className={`gap-1 text-xs font-semibold border ${s.cls}`}>
      <Icon size={11} />
      {s.label}
    </Badge>
  );
}

export default function InvoiceView() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [htmlLoading, setHtmlLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingWa, setSendingWa] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  const token = getToken();

  const fetchData = useCallback(async () => {
    if (!orderNumber) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/booking/${orderNumber}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Gagal memuat invoice");
      }
      setInvoiceData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [orderNumber, token]);

  const fetchHtml = useCallback(async () => {
    if (!orderNumber) return;
    setHtmlLoading(true);
    try {
      const res = await fetch(`/api/invoices/booking/${orderNumber}/html`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (res.ok) {
        setHtmlContent(await res.text());
      }
    } catch {
      // non-fatal — preview will be blank
    } finally {
      setHtmlLoading(false);
    }
  }, [orderNumber, token]);

  useEffect(() => {
    fetchData();
    fetchHtml();
  }, [fetchData, fetchHtml]);

  // Open PDF in new tab with auto-print
  const handlePrint = () => {
    const url = `/api/invoices/booking/${orderNumber}/pdf`;
    const win = window.open("about:blank", "_blank");
    if (!win) { toast({ title: "Popup diblokir", description: "Izinkan popup di browser Anda", variant: "destructive" }); return; }

    fetch(url, { headers: { Authorization: `Bearer ${token ?? ""}` } })
      .then(r => r.text())
      .then(html => {
        win.document.open();
        win.document.write(html);
        win.document.close();
      });
  };

  // Open preview in new tab (no auto-print)
  const handleOpenNew = () => {
    const url = `/api/invoices/booking/${orderNumber}/html`;
    const win = window.open("about:blank", "_blank");
    if (!win) { toast({ title: "Popup diblokir", description: "Izinkan popup di browser Anda", variant: "destructive" }); return; }

    fetch(url, { headers: { Authorization: `Bearer ${token ?? ""}` } })
      .then(r => r.text())
      .then(html => {
        win.document.open();
        win.document.write(html);
        win.document.close();
      });
  };

  const handleSendWa = async () => {
    setSendingWa(true);
    try {
      const res = await fetch(`/api/invoices/booking/${orderNumber}/send-wa`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengirim WA");
      toast({ title: "WA terkirim", description: `Invoice dikirim ke ${invoiceData?.customerPhone}` });
    } catch (e: any) {
      toast({ title: "Gagal kirim WA", description: e.message, variant: "destructive" });
    } finally {
      setSendingWa(false);
    }
  };

  const handleSendEmail = async () => {
    setSendingEmail(true);
    try {
      const res = await fetch(`/api/invoices/booking/${orderNumber}/send-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengirim email");
      toast({ title: "Email terkirim", description: `Invoice dikirim ke ${invoiceData?.customerEmail}` });
    } catch (e: any) {
      toast({ title: "Gagal kirim email", description: e.message, variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Toolbar ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-3 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/bookings")} className="gap-2">
            <ArrowLeft size={16} />
            Kembali
          </Button>
          <div className="h-5 w-px bg-gray-200" />
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-orange-500" />
            <div>
              <div className="font-bold text-sm text-gray-900">
                {loading ? <Skeleton className="h-4 w-36" /> : invoiceData?.invoiceNumber ?? orderNumber}
              </div>
              <div className="text-xs text-gray-500">{orderNumber}</div>
            </div>
          </div>
          {!loading && invoiceData && (
            <StatusBadge status={invoiceData.status} />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchData(); fetchHtml(); }}
            className="gap-2 text-gray-600"
          >
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenNew}
            className="gap-2 text-gray-600"
          >
            <ExternalLink size={14} />
            Buka Tab Baru
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="gap-2 text-gray-700 border-gray-300"
          >
            <Printer size={14} />
            Cetak / PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendEmail}
            disabled={sendingEmail || loading}
            className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
          >
            <Mail size={14} />
            {sendingEmail ? "Mengirim…" : "Kirim Email"}
          </Button>
          <Button
            size="sm"
            onClick={handleSendWa}
            disabled={sendingWa || loading}
            className="gap-2 bg-green-600 hover:bg-green-700 text-white"
          >
            <MessageCircle size={14} />
            {sendingWa ? "Mengirim…" : "Kirim WhatsApp"}
          </Button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex gap-0 h-[calc(100vh-57px)]">

        {/* ── Left: Summary Panel ── */}
        <div className="w-64 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          <div className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Ringkasan</div>

            {loading ? (
              <div className="space-y-3">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : error ? (
              <div className="text-red-500 text-sm">{error}</div>
            ) : invoiceData ? (
              <div className="space-y-4">
                {/* Customer */}
                <div>
                  <div className="text-xs text-gray-400 mb-1">Pelanggan</div>
                  <div className="font-semibold text-sm text-gray-900">{invoiceData.customerName}</div>
                  <div className="text-xs text-gray-500">{invoiceData.customerPhone}</div>
                  <div className="text-xs text-gray-500 truncate">{invoiceData.customerEmail}</div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Booking */}
                <div>
                  <div className="text-xs text-gray-400 mb-1">Detail Booking</div>
                  <div className="text-sm font-medium text-gray-900">{invoiceData.facilityName}</div>
                  <div className="text-xs text-gray-500">{invoiceData.bookingDate}</div>
                  <div className="text-xs text-gray-500">{invoiceData.startTime} – {invoiceData.endTime} ({invoiceData.durationHours} jam)</div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Pricing */}
                <div>
                  <div className="text-xs text-gray-400 mb-2">Rincian Harga</div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-gray-600">
                      <span>DPP</span>
                      <span className="font-mono">{rp(invoiceData.dpp)}</span>
                    </div>
                    {invoiceData.dppNilaiLain > 0 && (
                      <div className="flex justify-between text-gray-400">
                        <span className="italic">DPP Nilai Lain</span>
                        <span className="font-mono">{rp(invoiceData.dppNilaiLain)}</span>
                      </div>
                    )}
                    {invoiceData.ppnRate > 0 && (
                      <div className="flex justify-between text-amber-700">
                        <span>PPN {invoiceData.ppnRate}%</span>
                        <span className="font-mono">{rp(invoiceData.ppnAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-sm text-gray-900 bg-orange-50 -mx-1 px-1 py-1 rounded border border-orange-100">
                      <span>TOTAL</span>
                      <span className="font-mono text-orange-600">{rp(invoiceData.grandTotal)}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Payment */}
                <div>
                  <div className="text-xs text-gray-400 mb-1">Pembayaran</div>
                  <div className="text-sm font-semibold text-blue-700">{invoiceData.bankName}</div>
                  <div className="text-xs font-mono text-gray-700">{invoiceData.bankAccount}</div>
                  <div className="text-xs text-gray-500">{invoiceData.bankAccountName}</div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Invoice meta */}
                <div>
                  <div className="text-xs text-gray-400 mb-1">Info Invoice</div>
                  <div className="text-xs text-gray-600 font-mono break-all">{invoiceData.invoiceNumber}</div>
                  <div className="text-xs text-gray-400 mt-1">Template: invoice_template_sport_center_v1</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Right: Invoice Preview ── */}
        <div className="flex-1 bg-gray-100 overflow-auto flex flex-col items-center py-6 px-4">
          {error ? (
            <div className="bg-white rounded-xl border border-red-200 p-8 text-center max-w-md">
              <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
              <div className="font-bold text-gray-800 mb-1">Invoice tidak ditemukan</div>
              <div className="text-sm text-gray-500">{error}</div>
              <Button variant="outline" className="mt-4" onClick={() => navigate("/admin/bookings")}>
                <ArrowLeft size={14} className="mr-2" />
                Kembali ke Booking
              </Button>
            </div>
          ) : htmlLoading ? (
            <div className="w-full max-w-[820px] bg-white rounded-xl shadow-md p-8 space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : htmlContent ? (
            <div className="w-full max-w-[820px] shadow-xl rounded-xl overflow-hidden ring-1 ring-gray-200">
              <iframe
                srcDoc={htmlContent}
                title={`Invoice ${orderNumber}`}
                className="w-full bg-white"
                style={{ height: "1200px", border: "none" }}
                sandbox="allow-same-origin allow-scripts"
              />
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center max-w-md">
              <FileText size={40} className="text-gray-300 mx-auto mb-3" />
              <div className="text-gray-500 text-sm">Preview tidak tersedia</div>
            </div>
          )}

          {/* Print hint */}
          {!htmlLoading && htmlContent && (
            <div className="mt-3 text-xs text-gray-400 text-center">
              Klik <strong>Cetak / PDF</strong> untuk menyimpan sebagai PDF via dialog cetak browser
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
