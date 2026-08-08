import { useState, useRef, useCallback } from "react";
import QRCode from "react-qr-code";
import { useRoute } from "wouter";
import {
  useGetBookingByOrder,
  getGetBookingByOrderQueryKey,
  useGetSettings,
  useCreatePayment,
  useGetReviews,
  useCreateReview,
  usePayBookingDp,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Copy,
  MessageCircle,
  Upload,
  X,
  AlertCircle,
  ImageIcon,
  FileCheck2,
  Building2,
  QrCode,
  ChevronRight,
  Star,
  CalendarClock,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import RescheduleDialog from "@/components/RescheduleDialog";
import ExtendBookingDialog from "@/components/ExtendBookingDialog";
import { useLang } from "@/lib/i18n";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
// QRIS lama masih tersimpan sebagai aset publik. Gunakan sebagai fallback ketika
// konfigurasi qris_image_url di database lokal belum ikut tersinkron.
const DEFAULT_QRIS_IMAGE = `${BASE}/uploads/qris-263226c1-c51d-4353-9165-cedaba32adb4.jpeg`;

type PaymentMethod = "transfer" | "qris";

export default function BookingDetail() {
  const [, params] = useRoute("/booking/:orderNumber");
  const orderNumber = params?.orderNumber || "";
  const { toast } = useToast();
  const { t } = useLang();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: booking, isLoading } = useGetBookingByOrder(orderNumber, {
    query: { enabled: !!orderNumber, queryKey: getGetBookingByOrderQueryKey(orderNumber) },
  });
  const { data: settings } = useGetSettings();
  const { data: existingReviews } = useGetReviews(undefined, {
    query: { enabled: !!booking?.id, queryKey: ["getReviews"] },
  });
  const existingReview = existingReviews?.find((r) => r.bookingId === booking?.id);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [dpMode, setDpMode] = useState(false);
  const [dpInputAmount, setDpInputAmount] = useState("");
  const [showReschedule, setShowReschedule] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<"idle" | "uploading" | "done">("idle");
  const [notes, setNotes] = useState("");
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [hoverRating, setHoverRating] = useState(0);

  const payDp = usePayBookingDp({
    mutation: {
      onSuccess: () => {
        toast({ title: t("DP berhasil dicatat!", "DP recorded!"), description: t("Admin akan mengkonfirmasi pembayaran Anda.", "Admin will confirm your payment.") });
        queryClient.invalidateQueries({ queryKey: getGetBookingByOrderQueryKey(orderNumber) });
        setDpMode(false);
        setDpInputAmount("");
      },
      onError: (error: any) => {
        toast({ title: t("Gagal mencatat DP", "Failed to record DP"), description: error?.message || t("Terjadi kesalahan", "An error occurred"), variant: "destructive" });
      },
    },
  });

  const submitPayment = useCreatePayment({
    mutation: {
      onSuccess: () => {
        toast({ title: t("Bukti pembayaran dikirim!", "Payment proof submitted!"), description: t("Admin akan memverifikasi pembayaran Anda segera.", "Admin will verify your payment shortly.") });
        queryClient.invalidateQueries({ queryKey: getGetBookingByOrderQueryKey(orderNumber) });
        clearFile();
      },
      onError: (error: any) => {
        toast({ title: t("Gagal mengirim", "Failed to submit"), description: error?.message || t("Terjadi kesalahan", "An error occurred"), variant: "destructive" });
        setUploadProgress("idle");
      },
    },
  });

  const submitReview = useCreateReview({
    mutation: {
      onSuccess: () => {
        toast({ title: t("Terima kasih atas ulasan Anda!", "Thank you for your review!"), description: t("Ulasan Anda telah berhasil dikirim.", "Your review has been submitted.") });
        queryClient.invalidateQueries({ queryKey: ["getReviews"] });
      },
      onError: (error: any) => {
        toast({ title: t("Gagal mengirim ulasan", "Failed to submit review"), description: error?.message || t("Terjadi kesalahan", "An error occurred"), variant: "destructive" });
      },
    },
  });

  const handleReviewSubmit = () => {
    if (!booking || reviewRating === 0) return;
    submitReview.mutate({ data: { bookingId: booking.id, rating: reviewRating, comment: reviewComment || undefined, reviewerName: booking.customerName } });
  };

  const setFile = (file: File) => {
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreviewUrl(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const clearFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadProgress("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFile(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /image\/(jpeg|png|webp)|application\/pdf/.test(file.type)) {
      setFile(file);
    } else {
      toast({ title: t("Format tidak didukung", "Unsupported format"), description: t("Gunakan JPG, PNG, WebP, atau PDF", "Use JPG, PNG, WebP, or PDF"), variant: "destructive" });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking || !selectedFile) return;

    // Deteksi payment_type dan amount yang tepat berdasarkan state booking
    const bPayments = ((booking as any).payments as any[]) ?? [];
    const isDpMode =
      !!(booking as any).isDpPaid && Number((booking as any).downPayment || 0) > 0;
    let detectedType = "full_payment";
    let detectedAmount: number = booking.totalPrice;

    if (isDpMode) {
      const hasDpActive = bPayments.some(
        (p: any) =>
          p.paymentType === "dp" && (p.status === "pending" || p.status === "confirmed"),
      );
      if (!hasDpActive) {
        detectedType = "dp";
        detectedAmount = Number((booking as any).downPayment || 0);
      } else {
        detectedType = "pelunasan";
        detectedAmount =
          (booking as any).remainingAmount ??
          Math.max(
            0,
            booking.totalPrice - Number((booking as any).downPayment || 0),
          );
      }
    }

    try {
      setUploadProgress("uploading");

      const formData = new FormData();
      formData.append("proof", selectedFile);

      const uploadResp = await fetch(`${BASE}/api/payments/proof-upload`, {
        method: "POST",
        body: formData,
      });

      if (!uploadResp.ok) {
        const err = await uploadResp.json().catch(() => ({}));
        throw new Error(err.error || "Upload gagal");
      }

      const { url, objectPath } = await uploadResp.json();
      setUploadProgress("done");

      submitPayment.mutate({
        data: {
          bookingId: booking.id,
          amount: detectedAmount,
          proofUrl: url ?? objectPath,
          paymentMethod: paymentMethod === "qris" ? "QRIS" : "Transfer Bank",
          notes: notes || undefined,
          paymentType: detectedType as any,
        },
      });
    } catch (err: any) {
      toast({ title: t("Upload gagal", "Upload failed"), description: err.message, variant: "destructive" });
      setUploadProgress("idle");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: t("Disalin ke clipboard", "Copied to clipboard") });
  };

  const getWhatsAppLink = () => {
    if (!settings?.whatsapp || !booking) return "#";
    let phone = settings.whatsapp;
    if (phone.startsWith("0")) phone = "62" + phone.substring(1);
    const message = `Halo SportCenter, saya ingin konfirmasi pembayaran:\nNomor Order: *${booking.orderNumber}*\nNama: ${booking.customerName}\nFasilitas: ${booking.facilityName}\nTanggal: ${booking.bookingDate}\nJam: ${booking.startTime.substring(0, 5)} - ${booking.endTime.substring(0, 5)}\n\nMohon verifikasi pembayaran saya.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  if (isLoading)
    return (
      <div className="container py-20 flex justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );

  if (!booking)
    return (
      <div className="container py-20 text-center">
        <h2 className="text-2xl font-bold mb-2">{t("Booking Tidak Ditemukan", "Booking Not Found")}</h2>
        <p className="text-muted-foreground">{t("Order", "Order")} {orderNumber} {t("tidak ada.", "does not exist.")}</p>
      </div>
    );

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "pending_payment":
        return { color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: Clock, label: t("Menunggu Pembayaran", "Awaiting Payment") };
      case "paid":
        return { color: "bg-blue-100 text-blue-800 border-blue-300", icon: CheckCircle2, label: t("Sedang Diverifikasi", "Being Verified") };
      case "confirmed":
      case "completed":
        return { color: "bg-green-100 text-green-800 border-green-300", icon: CheckCircle2, label: t("Booking Dikonfirmasi", "Booking Confirmed") };
      case "waiting_confirmation":
        return { color: "bg-orange-100 text-orange-800 border-orange-300", icon: Clock, label: t("Menunggu Konfirmasi Admin", "Awaiting Admin Confirmation") };
      case "cancelled":
        return { color: "bg-red-100 text-red-800 border-red-300", icon: AlertCircle, label: t("Dibatalkan", "Cancelled") };
      case "rejected":
        return { color: "bg-red-100 text-red-800 border-red-300", icon: AlertCircle, label: t("Pembayaran Ditolak", "Payment Rejected") };
      case "expired":
        return { color: "bg-gray-100 text-gray-700 border-gray-300", icon: AlertCircle, label: t("Booking Expired", "Booking Expired") };
      case "refunded":
        return { color: "bg-purple-100 text-purple-800 border-purple-300", icon: AlertCircle, label: t("Dana Dikembalikan", "Refunded") };
      default:
        return { color: "bg-gray-100 text-gray-800 border-gray-300", icon: Clock, label: status };
    }
  };

  const statusConfig = getStatusConfig(booking.status);
  const StatusIcon = statusConfig.icon;
  const isPending = uploadProgress === "uploading" || submitPayment.isPending;

  const hasBankInfo = settings?.bankAccount && settings?.bankName;
  const qrisImageUrl = (settings as any)?.qrisImageUrl || DEFAULT_QRIS_IMAGE;
  const hasQris = Boolean(qrisImageUrl);

  return (
    <div className="container mx-auto px-4 py-8 md:py-12 max-w-4xl">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border mb-6 ${statusConfig.color}`}>
          <StatusIcon size={20} />
          <span className="font-bold">{statusConfig.label}</span>
        </div>
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-2">
          {t("Order", "Order")} {booking.orderNumber}
        </h1>
        <p className="text-muted-foreground text-lg">
          {booking.status === "pending_payment"
            ? t("Selesaikan pembayaran untuk mengamankan booking ini.", "Complete payment to secure this booking.")
            : t("Terima kasih atas pemesanan Anda!", "Thank you for your order!")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Booking Details */}
        <Card className="border-border">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <CardTitle>{t("Detail Booking", "Booking Details")}</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1">{t("Pelanggan", "Customer")}</div>
              <div className="font-semibold">{booking.customerName}</div>
              <div className="text-sm text-muted-foreground">
                {booking.customerPhone} · {booking.customerEmail}
              </div>
            </div>
            <div className="h-px bg-border" />
            <div>
              <div className="text-sm text-muted-foreground mb-1">{t("Fasilitas", "Facility")}</div>
              <div className="font-semibold text-lg">{booking.facilityName}</div>
              <div className="text-sm text-primary font-medium">{booking.facilityCategory}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground mb-1">{t("Tanggal", "Date")}</div>
                <div className="font-semibold">
                  {format(new Date(booking.bookingDate), "d MMM yyyy")}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">{t("Waktu", "Time")}</div>
                <div className="font-semibold">
                  {booking.startTime.substring(0, 5)} – {booking.endTime.substring(0, 5)}
                </div>
              </div>
            </div>
            <div className="h-px bg-border" />
            {(booking as any).groupInfo ? (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <div>{t("Harga sesi ini", "This session price")}</div>
                  <div>Rp {booking.totalPrice.toLocaleString("id-ID")}</div>
                </div>
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <div>{t("Jumlah sesi", "Total sessions")}</div>
                  <div>{(booking as any).groupInfo.groupSessionCount} {t("sesi", "sessions")}</div>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between items-center text-xl font-black">
                  <div className="flex flex-col gap-0.5">
                    <span>{t("Total Semua Sesi", "All Sessions Total")}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Ref: {(booking as any).groupInfo.groupRef}
                    </span>
                  </div>
                  <div className="text-primary">
                    Rp {(booking as any).groupInfo.groupTotalPayment.toLocaleString("id-ID")}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center text-xl font-black">
                <div>{t("Grand Total", "Grand Total")}</div>
                <div className="text-primary">
                  Rp {booking.totalPrice.toLocaleString("id-ID")}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AP2 Verification Status */}
        {(booking as any).customerType === "angkasa_pura" && (
          <Card className={`border-2 mt-4 ${
            (booking as any).verificationStatus === "verified"
              ? "border-green-200 bg-green-50/50"
              : (booking as any).verificationStatus === "rejected"
              ? "border-red-200 bg-red-50/50"
              : "border-orange-200 bg-orange-50/50"
          }`}>
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                {(booking as any).verificationStatus === "verified" ? (
                  <ShieldCheck size={22} className="text-green-600 mt-0.5 shrink-0" />
                ) : (booking as any).verificationStatus === "rejected" ? (
                  <ShieldX size={22} className="text-red-600 mt-0.5 shrink-0" />
                ) : (
                  <ShieldAlert size={22} className="text-orange-500 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">
                    {(booking as any).verificationStatus === "verified"
                      ? t("ID Card Karyawan AP2 Terverifikasi", "AP2 Employee ID Card Verified")
                      : (booking as any).verificationStatus === "rejected"
                      ? t("Verifikasi ID Card Ditolak", "ID Card Verification Rejected")
                      : t("Verifikasi ID Card Diperlukan", "ID Card Verification Required")}
                  </div>
                  <div className={`text-xs mt-0.5 ${
                    (booking as any).verificationStatus === "verified" ? "text-green-700"
                    : (booking as any).verificationStatus === "rejected" ? "text-red-700"
                    : "text-orange-700"
                  }`}>
                    {(booking as any).verificationStatus === "verified"
                      ? t("Diskon karyawan Angkasa Pura telah diterapkan.", "Angkasa Pura employee discount has been applied.")
                      : (booking as any).verificationStatus === "rejected"
                      ? t("ID Card tidak valid. Hubungi admin untuk bantuan.", "ID Card invalid. Contact admin for assistance.")
                      : t("Booking Anda sebagai karyawan AP2 perlu diverifikasi untuk mendapatkan diskon.", "Your booking as an AP2 employee needs verification to receive the discount.")}
                  </div>
                  {(booking as any).verificationStatus === "pending" && (
                    <Link href={`/verify-id?order=${booking.orderNumber}`}>
                      <Button size="sm" variant="outline" className="mt-3 text-xs h-8 border-orange-300 text-orange-700 hover:bg-orange-100 gap-1.5">
                        <ShieldCheck size={13} />
                        {t("Verifikasi ID Card Sekarang", "Verify ID Card Now")}
                        <ExternalLink size={11} />
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payment Section */}
        <div className="space-y-6">
          {booking.status === "pending_payment" && (
            <Card className="border-primary/30 shadow-md">
              <CardHeader className="bg-primary/5 pb-4 border-b border-primary/10">
                <CardTitle className="flex items-center gap-2 text-primary">
                  <CreditCard size={20} />
                  {t("Instruksi Pembayaran", "Payment Instructions")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                {/* DP Info Banner */}
                {(booking as any).isDpPaid && (() => {
                  const bPayments = ((booking as any).payments as any[]) ?? [];
                  const dpConfirmed = bPayments.some((p: any) => p.paymentType === "dp" && p.status === "confirmed");
                  const dpPending = bPayments.some((p: any) => p.paymentType === "dp" && p.status === "pending");
                  const pelunasanPending = bPayments.some((p: any) => p.paymentType === "pelunasan" && p.status === "pending");
                  const remaining = (booking as any).remainingAmount ?? Math.max(0, Number(booking.totalPrice) - Number((booking as any).downPayment || 0));

                  if (dpConfirmed && pelunasanPending) {
                    return (
                      <div className="flex items-start gap-3 p-3.5 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                          <Clock size={16} className="text-blue-600 dark:text-blue-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-blue-800 dark:text-blue-200">{t("Bukti Pelunasan Diterima", "Pelunasan Proof Received")}</div>
                          <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">{t("Admin sedang memverifikasi pelunasan Anda.", "Admin is verifying your payment.")}</div>
                        </div>
                      </div>
                    );
                  }

                  if (dpConfirmed) {
                    return (
                      <div className="flex items-start gap-3 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-emerald-800 dark:text-emerald-200">{t("DP Dikonfirmasi ✓", "DP Confirmed ✓")}</div>
                          <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 space-y-0.5">
                            <div>{t("DP", "DP")}: <span className="font-bold">Rp {Number((booking as any).downPayment || 0).toLocaleString("id-ID")}</span></div>
                            <div>{t("Sisa Pelunasan", "Remaining")}: <span className="font-bold text-primary">Rp {remaining.toLocaleString("id-ID")}</span></div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (dpPending) {
                    return (
                      <div className="flex items-start gap-3 p-3.5 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                          <Clock size={16} className="text-amber-600 dark:text-amber-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-amber-800 dark:text-amber-200">{t("Bukti DP Menunggu Konfirmasi", "DP Proof Awaiting Confirmation")}</div>
                          <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{t("Admin sedang memverifikasi bukti DP Anda.", "Admin is verifying your DP proof.")}</div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="flex items-start gap-3 p-3.5 rounded-xl border border-violet-200 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800">
                      <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                        <CreditCard size={16} className="text-violet-600 dark:text-violet-300" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-violet-800 dark:text-violet-200">{t("DP Sudah Dicatat", "Down Payment Recorded")}</div>
                        <div className="text-xs text-violet-600 dark:text-violet-400 mt-0.5 space-y-0.5">
                          <div>{t("DP", "DP")}: <span className="font-bold">Rp {Number((booking as any).downPayment || 0).toLocaleString("id-ID")}</span></div>
                          <div>{t("Sisa Pembayaran", "Remaining")}: <span className="font-bold">Rp {remaining.toLocaleString("id-ID")}</span></div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* DP Toggle (only if isDpPaid is false) */}
                {!(booking as any).isDpPaid && !dpMode && !paymentMethod && (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/10">
                    <div className="text-sm text-muted-foreground">{t("Ingin bayar sebagian (DP)?", "Want to pay partially (DP)?")}</div>
                    <button
                      type="button"
                      onClick={() => setDpMode(true)}
                      className="text-xs font-semibold text-violet-600 dark:text-violet-300 hover:underline shrink-0 ml-2"
                    >
                      {t("Bayar DP →", "Pay DP →")}
                    </button>
                  </div>
                )}

                {/* DP Input Mode */}
                {dpMode && !(booking as any).isDpPaid && (
                  <div className="space-y-3 p-4 rounded-xl border border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm text-violet-800 dark:text-violet-200">{t("Bayar Down Payment", "Pay Down Payment")}</div>
                      <button type="button" onClick={() => { setDpMode(false); setDpInputAmount(""); }} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground font-medium">{t("Jumlah DP (Rp)", "DP Amount (Rp)")}</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={dpInputAmount ? Number(dpInputAmount).toLocaleString("id-ID") : ""}
                        onChange={(e) => setDpInputAmount(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="Contoh: 150.000"
                        className="w-full px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-700 bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                    </div>
                    {dpInputAmount && Number(dpInputAmount) > 0 && (
                      <div className="text-xs space-y-1 text-muted-foreground">
                        <div className="flex justify-between"><span>{t("DP Dibayar", "DP Paid")}:</span><span className="font-bold text-violet-700 dark:text-violet-300">Rp {Number(dpInputAmount).toLocaleString("id-ID")}</span></div>
                        <div className="flex justify-between"><span>{t("Sisa", "Remaining")}:</span><span className="font-bold">Rp {Math.max(0, Number(booking.totalPrice) - Number(dpInputAmount)).toLocaleString("id-ID")}</span></div>
                      </div>
                    )}
                    <Button
                      size="sm"
                      className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                      disabled={!dpInputAmount || Number(dpInputAmount) <= 0 || payDp.isPending}
                      onClick={() => {
                        if (!booking?.id || !dpInputAmount) return;
                        payDp.mutate({ id: booking.id, data: { downPaymentAmount: Number(dpInputAmount) } });
                      }}
                    >
                      {payDp.isPending ? t("Menyimpan...", "Saving...") : t("Konfirmasi DP", "Confirm DP")}
                    </Button>
                    <p className="text-[11px] text-muted-foreground text-center">{t("Setelah konfirmasi DP, upload bukti transfer sejumlah DP di bawah ini.", "After confirming DP, upload transfer proof for the DP amount below.")}</p>
                  </div>
                )}

                {(() => {
                  const remaining =
                    (booking as any).remainingAmount ??
                    Math.max(0, Number(booking.totalPrice) - Number((booking as any).downPayment || 0));
                  const isDpFullyPaid = (booking as any).isDpPaid && remaining <= 0;

                  if (isDpFullyPaid) {
                    return (
                      <div className="flex items-start gap-3 p-4 rounded-xl border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800">
                        <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
                          <FileCheck2 size={16} className="text-green-600 dark:text-green-300" />
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-green-800 dark:text-green-200">
                            {t("Pembayaran Lunas via DP", "Fully Paid via Down Payment")}
                          </div>
                          <div className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                            {t("DP Anda sudah melunasi seluruh tagihan. Tidak perlu upload bukti lagi — menunggu konfirmasi admin.", "Your DP has covered the full amount. No further upload needed — awaiting admin confirmation.")}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <>
                      <div className="text-sm font-semibold text-foreground">
                        {(booking as any).isDpPaid ? (
                          <>
                            {t("Lunasi sisa", "Pay remaining balance")}{" "}
                            <span className="text-primary text-base">
                              Rp {remaining.toLocaleString("id-ID")}
                            </span>{" "}
                            <span className="text-xs text-muted-foreground font-normal">
                              {t("(upload bukti pelunasan)", "(upload payment proof)")}
                            </span>{" "}
                            {t("via:", "via:")}
                          </>
                        ) : (
                          <>
                            {t("Bayar", "Pay")}{" "}
                            <span className="text-primary text-base">
                              Rp {(booking as any).groupInfo
                                ? (booking as any).groupInfo.groupTotalPayment.toLocaleString("id-ID")
                                : booking.totalPrice.toLocaleString("id-ID")}
                            </span>{" "}
                            {(booking as any).groupInfo && (
                              <span className="text-xs text-muted-foreground font-normal">
                                ({(booking as any).groupInfo.groupSessionCount} {t("sesi", "sessions")} × Rp {booking.totalPrice.toLocaleString("id-ID")})
                              </span>
                            )}{" "}
                            {t("via:", "via:")}
                          </>
                        )}
                      </div>

                      {/* Payment Method Selector */}
                      {!paymentMethod && (
                  <div className="grid grid-cols-2 gap-3">
                    {hasBankInfo && (
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("transfer")}
                        className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                          <Building2 size={22} className="text-blue-600" />
                        </div>
                        <div className="text-center">
                          <div className="font-semibold text-sm">{t("Transfer Bank", "Bank Transfer")}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {settings?.bankName}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                      </button>
                    )}
                    {hasQris && (
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("qris")}
                        className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center group-hover:bg-orange-200 transition-colors">
                          <QrCode size={22} className="text-orange-600" />
                        </div>
                        <div className="text-center">
                          <div className="font-semibold text-sm">QRIS</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{t("Scan & Pay", "Scan & Pay")}</div>
                        </div>
                        <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                      </button>
                    )}
                    {!hasBankInfo && !hasQris && (
                      <div className="col-span-2 text-center py-4 text-sm text-muted-foreground">
                        {t("Hubungi admin untuk info pembayaran.", "Contact admin for payment information.")}
                      </div>
                    )}
                  </div>
                )}

                {/* Transfer Bank */}
                {paymentMethod === "transfer" && (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => { setPaymentMethod(null); clearFile(); }}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      ← {t("Pilih metode lain", "Choose another method")}
                    </button>

                    <div className="bg-muted rounded-xl p-4 relative group">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        {settings?.bankName}
                      </div>
                      <div className="text-2xl font-mono tracking-wider mb-1">
                        {settings?.bankAccount}
                      </div>
                      <div className="text-sm font-medium">
                        {t("a.n", "a/n")} {settings?.bankAccountName}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="absolute top-2 right-2 opacity-50 group-hover:opacity-100 transition-opacity"
                        onClick={() => copyToClipboard(settings?.bankAccount ?? "")}
                      >
                        <Copy size={16} />
                      </Button>
                    </div>

                    <UploadProofForm
                      selectedFile={selectedFile}
                      previewUrl={previewUrl}
                      isDragging={isDragging}
                      setIsDragging={setIsDragging}
                      onDrop={onDrop}
                      onFileChange={onFileChange}
                      clearFile={clearFile}
                      fileInputRef={fileInputRef}
                      notes={notes}
                      setNotes={setNotes}
                      handleSubmit={handleSubmit}
                      isPending={isPending}
                      uploadProgress={uploadProgress}
                    />
                  </div>
                )}

                {/* QRIS */}
                {paymentMethod === "qris" && (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => { setPaymentMethod(null); clearFile(); }}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      ← {t("Pilih metode lain", "Choose another method")}
                    </button>

                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {t("Scan QR Code Berikut", "Scan the QR Code Below")}
                      </div>
                      <div className="p-4 flex justify-center">
                        <img
                          src={qrisImageUrl}
                          alt="QRIS Payment Code"
                          className="max-w-xs w-full rounded-lg border border-border"
                        />
                      </div>
                      <div className="px-4 pb-3 text-center text-sm text-muted-foreground">
                        {t("Scan dengan aplikasi e-wallet / m-banking apapun", "Scan with any e-wallet / m-banking app")}
                      </div>
                    </div>

                    <UploadProofForm
                      selectedFile={selectedFile}
                      previewUrl={previewUrl}
                      isDragging={isDragging}
                      setIsDragging={setIsDragging}
                      onDrop={onDrop}
                      onFileChange={onFileChange}
                      clearFile={clearFile}
                      fileInputRef={fileInputRef}
                      notes={notes}
                      setNotes={setNotes}
                      handleSubmit={handleSubmit}
                      isPending={isPending}
                      uploadProgress={uploadProgress}
                    />
                  </div>
                )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Paid / verifying state */}
          {booking.status === "paid" && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                  <Clock size={26} className="text-blue-600" />
                </div>
                <h3 className="font-bold text-lg text-blue-900 mb-1">{t("Pembayaran Sedang Diverifikasi", "Payment Being Verified")}</h3>
                <p className="text-sm text-blue-700">
                  {t("Bukti transfer Anda sudah diterima. Admin akan mengonfirmasi dalam 1×24 jam.", "Your transfer proof has been received. Admin will confirm within 1×24 hours.")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Waiting confirmation state */}
          {booking.status === "waiting_confirmation" && (
            <Card className="border-orange-200 bg-orange-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-3">
                  <Clock size={26} className="text-orange-600" />
                </div>
                <h3 className="font-bold text-lg text-orange-900 mb-1">{t("Bukti Pembayaran Diterima", "Payment Proof Received")}</h3>
                <p className="text-sm text-orange-700">
                  {t("Admin sedang memverifikasi pembayaran Anda. Biasanya memakan waktu 1–2 jam kerja.", "Admin is verifying your payment. Usually takes 1–2 business hours.")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Expired state */}
          {booking.status === "expired" && (
            <Card className="border-gray-200 bg-gray-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle size={26} className="text-gray-500" />
                </div>
                <h3 className="font-bold text-lg text-gray-800 mb-1">{t("Booking Expired", "Booking Expired")}</h3>
                <p className="text-sm text-gray-600">
                  {t("Batas waktu pembayaran terlewat. Silakan buat booking baru.", "Payment deadline has passed. Please create a new booking.")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Rejected state */}
          {booking.status === "rejected" && (
            <Card className="border-red-200 bg-red-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle size={26} className="text-red-600" />
                </div>
                <h3 className="font-bold text-lg text-red-900 mb-1">{t("Pembayaran Ditolak", "Payment Rejected")}</h3>
                <p className="text-sm text-red-700">
                  {t("Bukti pembayaran tidak valid. Silakan upload ulang atau hubungi admin.", "Payment proof is invalid. Please re-upload or contact admin.")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Confirmed / completed state */}
          {(booking.status === "confirmed" || booking.status === "completed") && (
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={26} className="text-green-600" />
                </div>
                <h3 className="font-bold text-lg text-green-900 mb-1">{t("Booking Dikonfirmasi!", "Booking Confirmed!")}</h3>
                <p className="text-sm text-green-700 mb-4">
                  {t("Pembayaran Anda sudah diverifikasi. Sampai jumpa di lapangan!", "Your payment has been verified. See you on the court!")}
                </p>
                {/* QR Code for check-in */}
                <div className="border-t border-green-200 pt-4">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-3">{t("QR Code Check-In", "Check-In QR Code")}</p>
                  <div className="flex justify-center">
                    <div className="bg-white p-3 rounded-xl border border-green-200 inline-block">
                      <QRCode value={booking.orderNumber} size={140} />
                    </div>
                  </div>
                  <p className="text-xs text-green-600 mt-2">{t("Tunjukkan kode ini kepada petugas saat tiba", "Show this code to staff upon arrival")}</p>
                </div>

                {/* Reschedule + Tambah Waktu — only for confirmed */}
                {booking.status === "confirmed" && (
                  <div className="border-t border-green-200 pt-4 mt-2 space-y-2">
                    <Button
                      variant="outline"
                      className="w-full border-orange-300 text-orange-600 hover:bg-orange-50 gap-2"
                      onClick={() => setShowExtend(true)}
                    >
                      <Clock size={16} /> {t("Tambah Waktu", "Extend Time")}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full border-orange-300 text-orange-600 hover:bg-orange-50 gap-2"
                      onClick={() => setShowReschedule(true)}
                    >
                      <CalendarClock size={16} /> {t("Minta Reschedule", "Request Reschedule")}
                    </Button>
                  </div>
                )}

                {/* Review Section — only for completed bookings */}
                {booking.status === "completed" && (
                  <div className="border-t border-green-200 pt-4 mt-2">
                    <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-3">{t("Ulasan Anda", "Your Review")}</p>
                    {existingReview ? (
                      <div className="bg-white rounded-xl border border-green-200 p-4 text-left">
                        <div className="flex gap-0.5 mb-2">
                          {[1,2,3,4,5].map((s) => (
                            <Star key={s} className={`w-5 h-5 ${s <= existingReview.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
                          ))}
                        </div>
                        {existingReview.comment && <p className="text-sm text-gray-700 italic">"{existingReview.comment}"</p>}
                        <p className="text-xs text-green-600 mt-1">{t("Sudah diulas", "Already reviewed")} ✓</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl border border-green-200 p-4 text-left space-y-3">
                        <div className="flex gap-1 justify-center">
                          {[1,2,3,4,5].map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setReviewRating(s)}
                              onMouseEnter={() => setHoverRating(s)}
                              onMouseLeave={() => setHoverRating(0)}
                              className="focus:outline-none"
                            >
                              <Star className={`w-8 h-8 transition-colors ${s <= (hoverRating || reviewRating) ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
                            </button>
                          ))}
                        </div>
                        <textarea
                          className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-green-400"
                          rows={2}
                          placeholder={t("Ceritakan pengalaman Anda... (opsional)", "Share your experience... (optional)")}
                          value={reviewComment}
                          onChange={(e) => setReviewComment(e.target.value)}
                        />
                        <Button
                          size="sm"
                          className="w-full bg-green-600 hover:bg-green-700 text-white"
                          disabled={reviewRating === 0 || submitReview.isPending}
                          onClick={handleReviewSubmit}
                        >
                          {submitReview.isPending ? t("Mengirim...", "Submitting...") : t("Kirim Ulasan", "Submit Review")}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Refunded state */}
          {booking.status === "refunded" && (
            <Card className="border-purple-200 bg-purple-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle size={26} className="text-purple-600" />
                </div>
                <h3 className="font-bold text-lg text-purple-900 mb-1">{t("Dana Telah Dikembalikan", "Funds Have Been Refunded")}</h3>
                <p className="text-sm text-purple-700">
                  {t("Pembayaran Anda telah dikembalikan oleh admin. Silakan hubungi kami jika ada pertanyaan.", "Your payment has been refunded by admin. Please contact us if you have any questions.")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Cancelled state */}
          {booking.status === "cancelled" && (
            <Card className="border-red-200 bg-red-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle size={26} className="text-red-600" />
                </div>
                <h3 className="font-bold text-lg text-red-900 mb-1">{t("Booking Dibatalkan", "Booking Cancelled")}</h3>
                <p className="text-sm text-red-700">
                  {t("Booking ini telah dibatalkan. Hubungi admin jika Anda memerlukan bantuan.", "This booking has been cancelled. Contact admin if you need assistance.")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("Butuh Bantuan?", "Need Help?")}</CardTitle>
              <CardDescription>{t("Hubungi admin via WhatsApp untuk respons cepat", "Contact admin via WhatsApp for a quick response")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                asChild
                variant="outline"
                className="w-full border-[#25D366] text-[#25D366] hover:bg-[#25D366] hover:text-white"
              >
                <a href={getWhatsAppLink()} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2" size={18} /> {t("Chat dengan Admin", "Chat with Admin")}
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {booking && (
        <RescheduleDialog
          open={showReschedule}
          onOpenChange={setShowReschedule}
          bookingId={booking.id}
          orderNumber={booking.orderNumber}
          currentDate={booking.bookingDate}
          currentStart={booking.startTime}
          currentEnd={booking.endTime}
          facilityName={booking.facilityName}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: getGetBookingByOrderQueryKey(orderNumber) })}
        />
      )}
      {booking && (
        <ExtendBookingDialog
          open={showExtend}
          onOpenChange={setShowExtend}
          bookingId={booking.id}
          orderNumber={booking.orderNumber}
          facilityName={booking.facilityName}
          bookingDate={booking.bookingDate}
          startTime={booking.startTime}
          endTime={booking.endTime}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: getGetBookingByOrderQueryKey(orderNumber) })}
        />
      )}
    </div>
  );
}

/* ─── Upload Proof Form sub-component ──────────────────────────── */

function UploadProofForm({
  selectedFile,
  previewUrl,
  isDragging,
  setIsDragging,
  onDrop,
  onFileChange,
  clearFile,
  fileInputRef,
  notes,
  setNotes,
  handleSubmit,
  isPending,
  uploadProgress,
}: {
  selectedFile: File | null;
  previewUrl: string | null;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clearFile: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  notes: string;
  setNotes: (v: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  uploadProgress: "idle" | "uploading" | "done";
}) {
  const { t } = useLang();
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-semibold">{t("Upload Bukti Pembayaran *", "Upload Payment Proof *")}</label>

        {!selectedFile ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <Upload size={28} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">
              {t("Drag & drop atau klik untuk upload", "Drag & drop or click to upload")}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t("JPG, PNG, WebP, PDF — maks 10 MB", "JPG, PNG, WebP, PDF — max 10 MB")}
            </p>
          </div>
        ) : (
          <div className="relative rounded-xl overflow-hidden border border-primary/30 bg-muted/20">
            {previewUrl && selectedFile.type.startsWith("image/") ? (
              <img
                src={previewUrl}
                alt="Bukti pembayaran"
                className="w-full max-h-56 object-contain bg-checkered"
              />
            ) : (
              <div className="flex items-center gap-3 p-4">
                <FileCheck2 size={32} className="text-primary shrink-0" />
                <div>
                  <div className="font-medium text-sm">{selectedFile.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(0)} KB
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={clearFile}
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors"
            >
              <X size={14} />
            </button>
            <div className="px-3 py-2 border-t border-primary/20 flex items-center gap-2 bg-primary/5">
              <ImageIcon size={13} className="text-primary" />
              <span className="text-xs text-primary font-medium truncate">
                {selectedFile.name}
              </span>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      {uploadProgress === "uploading" && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t("Mengupload file...", "Uploading file...")}</div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "70%" }} />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">
          {t("Catatan (opsional)", "Notes (optional)")}
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("Misal: Transfer dari BCA a.n Budi...", "e.g. Transfer from BCA a/n Budi...")}
          rows={2}
          className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={isPending || !selectedFile}
        size="lg"
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            {uploadProgress === "uploading" ? t("Mengupload...", "Uploading...") : t("Mengirim...", "Submitting...")}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <CheckCircle2 size={18} /> {t("Saya Sudah Bayar", "I Have Paid")}
          </span>
        )}
      </Button>
    </form>
  );
}
