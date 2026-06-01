import { useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, CheckCircle2, XCircle, AlertCircle, ChevronLeft, Upload, ExternalLink } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

async function fetchBookingDetail(orderNumber: string) {
  const token = getToken();
  const res = await fetch(`/api/tenant/bookings/${orderNumber}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Not found");
  return res.json();
}

async function submitPayment(data: { tenantBookingId: number; proofImageUrl: string; amount: number; notes?: string }) {
  const token = getToken();
  const res = await fetch(`/api/tenant/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
  return res.json();
}

const STATUS_CONFIG: Record<string, { label: string; labelEn: string; badge: string; icon: typeof Clock }> = {
  pending:   { label: "Menunggu Review",  labelEn: "Pending Review",  badge: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Clock },
  approved:  { label: "Disetujui",        labelEn: "Approved",        badge: "bg-green-100 text-green-700 border-green-200",  icon: CheckCircle2 },
  rejected:  { label: "Ditolak",          labelEn: "Rejected",        badge: "bg-red-100 text-red-700 border-red-200",        icon: XCircle },
  active:    { label: "Aktif",            labelEn: "Active",          badge: "bg-blue-100 text-blue-700 border-blue-200",     icon: CheckCircle2 },
  expired:   { label: "Kadaluarsa",       labelEn: "Expired",         badge: "bg-gray-100 text-gray-600 border-gray-200",    icon: AlertCircle },
};

const PAYMENT_CONFIG: Record<string, { label: string; labelEn: string; badge: string }> = {
  pending:   { label: "Belum Bayar",      labelEn: "Unpaid",           badge: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  uploaded:  { label: "Bukti Dikirim",    labelEn: "Proof Uploaded",   badge: "bg-blue-100 text-blue-700 border-blue-200" },
  verified:  { label: "Pembayaran OK",    labelEn: "Payment Verified", badge: "bg-green-100 text-green-700 border-green-200" },
  rejected:  { label: "Pembayaran Tolak", labelEn: "Payment Rejected", badge: "bg-red-100 text-red-700 border-red-200" },
};

export default function TenantBookingDetail() {
  const { t } = useLang();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, params] = useRoute("/tenant/bookings/:orderNumber");
  const orderNumber = params?.orderNumber ?? "";
  const { data: user } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });

  const [proofUrl, setProofUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);

  const { data: booking, isLoading, error } = useQuery({
    queryKey: ["tenant-booking", orderNumber],
    queryFn: () => fetchBookingDetail(orderNumber),
    enabled: !!orderNumber && user?.role === "tenant",
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: submitPayment,
    onSuccess: () => {
      toast({ title: t("Berhasil!", "Success!"), description: t("Bukti pembayaran terkirim.", "Payment proof submitted.") });
      qc.invalidateQueries({ queryKey: ["tenant-booking", orderNumber] });
      qc.invalidateQueries({ queryKey: ["tenant-bookings"] });
      setShowForm(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!user || user.role !== "tenant") {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <Button asChild><Link href="/login">{t("Login", "Login")}</Link></Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 md:px-8 py-10 max-w-2xl">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <p className="text-muted-foreground mb-4">{t("Booking tidak ditemukan.", "Booking not found.")}</p>
        <Button asChild variant="outline"><Link href="/tenant/bookings"><ChevronLeft size={14} className="mr-1" /> {t("Kembali", "Back")}</Link></Button>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[booking.status] ?? STATUS_CONFIG.pending;
  const pcfg = PAYMENT_CONFIG[booking.paymentStatus] ?? PAYMENT_CONFIG.pending;
  const canPay = booking.status === "approved" && !["uploaded", "verified"].includes(booking.paymentStatus);

  const handleSubmitPayment = () => {
    if (!proofUrl || !amount) { toast({ title: t("Wajib isi", "Required"), description: t("URL bukti dan jumlah wajib diisi.", "Proof URL and amount required."), variant: "destructive" }); return; }
    mutation.mutate({ tenantBookingId: booking.id, proofImageUrl: proofUrl, amount: Number(amount), notes: notes || undefined });
  };

  return (
    <div className="container mx-auto px-4 md:px-8 py-10 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link href="/tenant/bookings"><ChevronLeft size={14} /> {t("Kembali", "Back")}</Link>
        </Button>
      </div>

      <Card className="border-border/60 mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{t("No. Booking", "Booking No.")}</div>
              <CardTitle className="text-2xl font-black">{booking.orderNumber}</CardTitle>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Badge variant="outline" className={`font-bold ${cfg.badge}`}>{t(cfg.label, cfg.labelEn)}</Badge>
              <Badge variant="outline" className={`font-bold text-[10px] ${pcfg.badge}`}>{t(pcfg.label, pcfg.labelEn)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">{t("Tipe Booking", "Booking Type")}</div>
              <div className="font-bold capitalize">{booking.bookingType.replace("_", " ")}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">{t("Area Diminta", "Requested Area")}</div>
              <div className="font-semibold">{booking.requestedArea || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">{t("Tanggal Mulai", "Start Date")}</div>
              <div className="font-bold">{booking.startDate}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">{t("Tanggal Selesai", "End Date")}</div>
              <div className="font-bold">{booking.endDate}</div>
            </div>
            {booking.durationMonths && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">{t("Durasi", "Duration")}</div>
                <div className="font-bold">{booking.durationMonths} {t("bulan", "months")}</div>
              </div>
            )}
            {Number(booking.price) > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">{t("Harga", "Price")}</div>
                <div className="font-black text-primary text-lg">Rp {Number(booking.price).toLocaleString("id-ID")}</div>
              </div>
            )}
          </div>

          {booking.description && (
            <div className="bg-muted/40 rounded-xl p-4 text-sm">
              <div className="text-xs text-muted-foreground mb-1">{t("Deskripsi", "Description")}</div>
              <p>{booking.description}</p>
            </div>
          )}

          {booking.adminNotes && (
            <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl p-4 text-sm border border-blue-100 dark:border-blue-900">
              <div className="text-xs font-bold text-blue-600 mb-1">{t("Catatan Admin", "Admin Notes")}</div>
              <p>{booking.adminNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payments */}
      {booking.payments?.length > 0 && (
        <Card className="border-border/60 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-black">{t("Riwayat Pembayaran", "Payment History")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {booking.payments.map((p: any) => {
                const ps = PAYMENT_CONFIG[p.status] ?? PAYMENT_CONFIG.pending;
                return (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-muted/40 rounded-xl text-sm">
                    <div>
                      <div className="font-bold">Rp {Number(p.amount).toLocaleString("id-ID")}</div>
                      {p.notes && <div className="text-xs text-muted-foreground mt-0.5">{p.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      {p.proofImageUrl && (
                        <a href={p.proofImageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                          <ExternalLink size={11} /> {t("Bukti", "Proof")}
                        </a>
                      )}
                      <Badge variant="outline" className={`text-[10px] font-bold ${ps.badge}`}>{t(ps.label, ps.labelEn)}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload payment */}
      {canPay && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5">
            {!showForm ? (
              <div className="text-center py-2">
                <p className="text-sm text-muted-foreground mb-4">
                  {t("Booking Anda disetujui! Upload bukti pembayaran untuk melanjutkan.", "Your booking is approved! Upload payment proof to proceed.")}
                </p>
                <Button onClick={() => setShowForm(true)} className="rounded-full px-6 font-bold">
                  <Upload size={14} className="mr-2" /> {t("Upload Bukti Bayar", "Upload Payment Proof")}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className="font-black text-sm">{t("Upload Bukti Pembayaran", "Upload Payment Proof")}</h3>
                <div>
                  <Label className="text-xs">{t("URL Bukti Pembayaran", "Payment Proof URL")} *</Label>
                  <Input value={proofUrl} onChange={e => setProofUrl(e.target.value)} placeholder="https://..." className="mt-1.5" />
                </div>
                <div>
                  <Label className="text-xs">{t("Jumlah Dibayar (Rp)", "Amount Paid (Rp)")} *</Label>
                  <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={String(booking.price)} className="mt-1.5" />
                </div>
                <div>
                  <Label className="text-xs">{t("Catatan (opsional)", "Notes (optional)")}</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("Bank, referensi, dll", "Bank, reference, etc")} className="mt-1.5" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSubmitPayment} disabled={mutation.isPending} className="rounded-full px-5 font-bold">
                    {mutation.isPending ? t("Mengirim...", "Sending...") : t("Kirim Bukti", "Submit Proof")}
                  </Button>
                  <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-full px-5">{t("Batal", "Cancel")}</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
