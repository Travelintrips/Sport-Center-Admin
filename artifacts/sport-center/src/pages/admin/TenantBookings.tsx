import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import {
  Search, Building2, CheckCircle2, XCircle, Clock, Eye, AlertCircle,
  ZoomIn, X, ImageOff,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API = "/api";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` });

const MONTHS_ID = ["","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function formatPeriod(b: any) {
  if (b.periodStartMonth && b.periodStartYear && b.periodEndMonth && b.periodEndYear) {
    const sm = MONTHS_ID[b.periodStartMonth] ?? b.periodStartMonth;
    const em = MONTHS_ID[b.periodEndMonth] ?? b.periodEndMonth;
    return `${sm} ${b.periodStartYear} – ${em} ${b.periodEndYear}`;
  }
  return b.startDate ? `${b.startDate} – ${b.endDate}` : "-";
}

function formatRp(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

async function fetchTenantBookings(status?: string) {
  const url = status && status !== "all"
    ? `${API}/admin/tenant-bookings?status=${status}`
    : `${API}/admin/tenant-bookings`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function updateBooking(id: number, data: any) {
  const res = await fetch(`${API}/admin/tenant-bookings/${id}`, {
    method: "PUT", headers: headers(), body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function verifyPayment(id: number, notes?: string) {
  const res = await fetch(`${API}/admin/tenant-payments/${id}/verify`, {
    method: "PUT", headers: headers(), body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function rejectPayment(id: number, notes?: string) {
  const res = await fetch(`${API}/admin/tenant-payments/${id}/reject`, {
    method: "PUT", headers: headers(), body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

const STATUS_CFG: Record<string, { label: string; badge: string; icon: typeof Clock }> = {
  pending:  { label: "Pending",     badge: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Clock },
  approved: { label: "Disetujui",   badge: "bg-green-100 text-green-700 border-green-200",   icon: CheckCircle2 },
  rejected: { label: "Ditolak",     badge: "bg-red-100 text-red-700 border-red-200",          icon: XCircle },
  active:   { label: "Aktif",       badge: "bg-blue-100 text-blue-700 border-blue-200",       icon: CheckCircle2 },
  expired:  { label: "Kadaluarsa",  badge: "bg-gray-100 text-gray-600 border-gray-200",      icon: AlertCircle },
};

const PAY_CFG: Record<string, { label: string; badge: string }> = {
  pending:  { label: "Belum Bayar",   badge: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  uploaded: { label: "Bukti Dikirim", badge: "bg-blue-100 text-blue-700 border-blue-200" },
  verified: { label: "Terverifikasi", badge: "bg-green-100 text-green-700 border-green-200" },
  rejected: { label: "Ditolak",       badge: "bg-red-100 text-red-700 border-red-200" },
};

// ── Proof thumbnail (small, clickable) ───────────────────────────────────────
function ProofThumb({ url, onClick }: { url: string; onClick: () => void }) {
  const [err, setErr] = useState(false);
  if (err) return (
    <button onClick={onClick} className="w-10 h-10 rounded-lg border border-border/60 bg-muted/40 flex items-center justify-center hover:bg-muted transition-colors" title="Lihat bukti">
      <ImageOff size={13} className="text-muted-foreground" />
    </button>
  );
  return (
    <button onClick={onClick} className="relative w-10 h-10 rounded-lg overflow-hidden border border-border/60 hover:ring-2 hover:ring-primary/50 transition-all group shrink-0" title="Klik untuk lihat bukti">
      <img src={url} alt="Bukti" className="w-full h-full object-cover" onError={() => setErr(true)} />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn size={12} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}

// ── Proof lightbox dialog ─────────────────────────────────────────────────────
interface LightboxProps {
  url: string;
  payment: any;
  onClose: () => void;
  onVerify: (id: number, notes: string) => void;
  onReject: (id: number, notes: string) => void;
  isPending: boolean;
}

function ProofLightbox({ url, payment, onClose, onVerify, onReject, isPending }: LightboxProps) {
  const [notes, setNotes] = useState("");
  const canAct = payment.status === "uploaded" || payment.status === "pending";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/30">
          <div>
            <div className="font-black text-sm">Bukti Pembayaran</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {formatRp(Number(payment.amount))}
              {payment.notes && <span className="ml-2">· {payment.notes}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-[10px] font-bold ${PAY_CFG[payment.status]?.badge ?? ""}`}>
              {PAY_CFG[payment.status]?.label ?? payment.status}
            </Badge>
            <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="bg-black/90 flex items-center justify-center" style={{ minHeight: 320, maxHeight: 480 }}>
          <img
            src={url}
            alt="Bukti Pembayaran"
            className="max-w-full max-h-[480px] object-contain"
            style={{ display: "block" }}
          />
        </div>

        {/* Actions */}
        {canAct && (
          <div className="px-5 py-4 border-t space-y-3 bg-background">
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Catatan verifikasi (opsional)..."
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button
                className="flex-1 rounded-full font-bold bg-green-600 hover:bg-green-700"
                disabled={isPending}
                onClick={() => onVerify(payment.id, notes)}
              >
                <CheckCircle2 size={14} className="mr-1.5" /> Konfirmasi Pembayaran
              </Button>
              <Button
                variant="destructive"
                className="flex-1 rounded-full font-bold"
                disabled={isPending}
                onClick={() => onReject(payment.id, notes)}
              >
                <XCircle size={14} className="mr-1.5" /> Tolak
              </Button>
            </div>
          </div>
        )}

        {!canAct && payment.status === "verified" && (
          <div className="px-5 py-3 border-t bg-green-50 dark:bg-green-950/30 text-center text-sm font-semibold text-green-700">
            ✓ Pembayaran telah dikonfirmasi
          </div>
        )}
        {!canAct && payment.status === "rejected" && (
          <div className="px-5 py-3 border-t bg-red-50 dark:bg-red-950/30 text-center text-sm font-semibold text-red-600">
            ✗ Pembayaran ditolak
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminTenantBookings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const [priceInput, setPriceInput] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [payNotes, setPayNotes] = useState("");

  // lightbox state: { url, payment }
  const [lightbox, setLightbox] = useState<{ url: string; payment: any } | null>(null);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["admin-tenant-bookings", statusFilter],
    queryFn: () => fetchTenantBookings(statusFilter),
    refetchInterval: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateBooking(id, data),
    onSuccess: () => {
      toast({ title: "Berhasil diperbarui" });
      qc.invalidateQueries({ queryKey: ["admin-tenant-bookings"] });
      setSelected(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) => verifyPayment(id, notes),
    onSuccess: () => {
      toast({ title: "Pembayaran dikonfirmasi" });
      qc.invalidateQueries({ queryKey: ["admin-tenant-bookings"] });
      setLightbox(null);
      setSelected(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rejectPayMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) => rejectPayment(id, notes),
    onSuccess: () => {
      toast({ title: "Pembayaran ditolak" });
      qc.invalidateQueries({ queryKey: ["admin-tenant-bookings"] });
      setLightbox(null);
      setSelected(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = (bookings as any[]).filter(b =>
    b.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
    b.businessName?.toLowerCase().includes(search.toLowerCase()) ||
    b.ownerName?.toLowerCase().includes(search.toLowerCase())
  );

  const openDetail = (b: any) => {
    setSelected(b);
    setPriceInput(String(b.price ?? 0));
    setAdminNotes(b.adminNotes || "");
    setPayNotes("");
  };

  const handleApprove = () => {
    if (!selected) return;
    updateMutation.mutate({ id: selected.id, data: { status: "approved", price: Number(priceInput), adminNotes } });
  };
  const handleRejectBooking = () => {
    if (!selected) return;
    updateMutation.mutate({ id: selected.id, data: { status: "rejected", adminNotes } });
  };
  const handleActivate = () => {
    if (!selected) return;
    updateMutation.mutate({ id: selected.id, data: { status: "active" } });
  };

  const openProof = (payment: any) => {
    if (!payment.proofImageUrl) return;
    setLightbox({ url: payment.proofImageUrl, payment });
  };

  const pendingPayable = (b: any) => {
    const p = (b.payments as any[])?.find(p => p.proofImageUrl && (p.status === "uploaded" || p.status === "pending"));
    return p ?? null;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black">Pemesanan Tenan</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Kelola semua pengajuan sewa area tenan</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari no. pemesanan, bisnis..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Disetujui</SelectItem>
            <SelectItem value="rejected">Ditolak</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="expired">Kadaluarsa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Building2 size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{search ? "Tidak ada hasil." : "Belum ada pemesanan tenan."}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {filtered.map((b: any) => {
                const cfg = STATUS_CFG[b.status] ?? STATUS_CFG.pending;
                const pcfg = PAY_CFG[b.paymentStatus] ?? PAY_CFG.pending;
                const periodType = b.paymentPeriodType === "yearly" ? "Tahunan" : "Bulanan";
                const pendPay = pendingPayable(b);

                return (
                  <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <cfg.icon size={17} className="text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-black text-sm">{b.orderNumber}</div>
                        <div className="text-xs text-muted-foreground truncate">{b.businessName} · {periodType}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatPeriod(b)}
                          {b.totalMonths ? ` · ${b.totalMonths} bln` : ""}
                          {b.requestedArea ? ` · ${b.requestedArea}` : ""}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      {Number(b.price) > 0 && (
                        <span className="text-xs font-bold text-primary">{formatRp(Number(b.price))}</span>
                      )}
                      <Badge variant="outline" className={`text-[10px] font-bold ${cfg.badge}`}>{cfg.label}</Badge>
                      <Badge variant="outline" className={`text-[10px] font-bold ${pcfg.badge}`}>{pcfg.label}</Badge>

                      {/* Proof thumbnail — shown directly in row */}
                      {pendPay && (
                        <ProofThumb url={pendPay.proofImageUrl} onClick={() => openProof(pendPay)} />
                      )}

                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl" onClick={() => openDetail(b)}>
                        <Eye size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Detail / Action Dialog ── */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black">{selected?.orderNumber}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-5 mt-1">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Tenan", selected.businessName],
                  ["Pemilik", selected.ownerName],
                  ["Tipe Area", selected.bookingType?.replace("_", " ")],
                  ["Tipe Pembayaran", selected.paymentPeriodType === "yearly" ? "Tahunan" : "Bulanan"],
                  ["Periode", formatPeriod(selected)],
                  ["Total Bulan", selected.totalMonths ? `${selected.totalMonths} bulan` : "-"],
                  ["Area", selected.requestedArea || "-"],
                ].map(([k, v]) => (
                  <div key={k} className={k === "Periode" ? "col-span-2" : ""}>
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className="font-semibold capitalize">{v}</div>
                  </div>
                ))}
              </div>

              {selected.description && (
                <div className="bg-muted/40 rounded-xl p-3 text-sm">
                  <div className="text-xs text-muted-foreground mb-1">Deskripsi</div>
                  {selected.description}
                </div>
              )}

              {/* Admin actions: approve / reject booking */}
              {["pending", "approved"].includes(selected.status) && (
                <div className="space-y-3 border-t pt-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Tindakan Admin</div>
                  <div>
                    <Label className="text-xs">Harga Sewa (Rp)</Label>
                    <Input type="number" value={priceInput} onChange={e => setPriceInput(e.target.value)} className="mt-1.5" />
                  </div>
                  <div>
                    <Label className="text-xs">Catatan Admin</Label>
                    <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={2} className="mt-1.5 resize-none" />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={handleApprove} disabled={updateMutation.isPending} size="sm" className="rounded-full px-4 bg-green-600 hover:bg-green-700 font-bold">
                      <CheckCircle2 size={13} className="mr-1.5" /> Setujui
                    </Button>
                    <Button onClick={handleRejectBooking} disabled={updateMutation.isPending} size="sm" variant="destructive" className="rounded-full px-4 font-bold">
                      <XCircle size={13} className="mr-1.5" /> Tolak
                    </Button>
                    {selected.status === "approved" && (
                      <Button onClick={handleActivate} disabled={updateMutation.isPending} size="sm" className="rounded-full px-4 font-bold">
                        Aktifkan
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Payment history with thumbnails */}
              {selected.payments?.length > 0 && (
                <div className="border-t pt-4 space-y-3">
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Riwayat Pembayaran</div>
                  {selected.payments.map((p: any) => {
                    const ps = PAY_CFG[p.status] ?? PAY_CFG.pending;
                    const canAct = p.status === "uploaded" || p.status === "pending";
                    return (
                      <div key={p.id} className="bg-muted/40 rounded-xl p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-black text-sm">{formatRp(Number(p.amount))}</span>
                          <Badge variant="outline" className={`text-[10px] font-bold ${ps.badge}`}>{ps.label}</Badge>
                        </div>

                        {/* Proof: thumbnail + open lightbox */}
                        {p.proofImageUrl && (
                          <button
                            onClick={() => openProof(p)}
                            className="flex items-center gap-2.5 group w-full text-left"
                          >
                            <div className="relative w-16 h-12 rounded-lg overflow-hidden border border-border/60 shrink-0">
                              <img src={p.proofImageUrl} alt="Bukti" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                                <ZoomIn size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </div>
                            <span className="text-xs text-primary group-hover:underline">
                              {canAct ? "Klik untuk lihat & konfirmasi bukti" : "Lihat bukti pembayaran"}
                            </span>
                          </button>
                        )}

                        {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}

                        {/* Inline quick action (fallback if no proof image) */}
                        {canAct && !p.proofImageUrl && (
                          <div className="flex gap-2 pt-1">
                            <Input value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Catatan..." className="h-8 text-xs flex-1" />
                            <Button size="sm" className="h-8 rounded-lg bg-green-600 hover:bg-green-700 font-bold px-3"
                              disabled={verifyMutation.isPending}
                              onClick={() => verifyMutation.mutate({ id: p.id, notes: payNotes || undefined })}>
                              ✓
                            </Button>
                            <Button size="sm" variant="destructive" className="h-8 rounded-lg font-bold px-3"
                              disabled={rejectPayMutation.isPending}
                              onClick={() => rejectPayMutation.mutate({ id: p.id, notes: payNotes || undefined })}>
                              ✗
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Proof Lightbox ── */}
      {lightbox && (
        <ProofLightbox
          url={lightbox.url}
          payment={lightbox.payment}
          onClose={() => setLightbox(null)}
          onVerify={(id, notes) => verifyMutation.mutate({ id, notes: notes || undefined })}
          onReject={(id, notes) => rejectPayMutation.mutate({ id, notes: notes || undefined })}
          isPending={verifyMutation.isPending || rejectPayMutation.isPending}
        />
      )}
    </div>
  );
}
