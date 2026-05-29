import { useState, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import {
  useGetBookingByOrder,
  getGetBookingByOrderQueryKey,
  useGetSettings,
  useCreatePayment,
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
} from "lucide-react";
import { useLang } from "@/lib/i18n";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

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

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<"idle" | "uploading" | "done">("idle");
  const [notes, setNotes] = useState("");

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

      const { objectPath } = await uploadResp.json();
      setUploadProgress("done");

      submitPayment.mutate({
        data: {
          bookingId: booking.id,
          amount: booking.totalPrice,
          proofUrl: `${BASE}/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`,
          notes: notes || undefined,
        },
      });
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
      setUploadProgress("idle");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Disalin ke clipboard" });
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
      case "cancelled":
        return { color: "bg-red-100 text-red-800 border-red-300", icon: AlertCircle, label: t("Dibatalkan", "Cancelled") };
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
  const hasQris = !!(settings as any)?.qrisImageUrl;

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
            <div className="flex justify-between items-center text-xl font-black">
              <div>{t("Total", "Total")}</div>
              <div className="text-primary">
                Rp {booking.totalPrice.toLocaleString("id-ID")}
              </div>
            </div>
          </CardContent>
        </Card>

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
                <div className="text-sm font-semibold text-foreground">
                  {t("Bayar", "Pay")}{" "}
                  <span className="text-primary text-base">
                    Rp {booking.totalPrice.toLocaleString("id-ID")}
                  </span>{" "}
                  {t("via:", "via:")}
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
                          src={(settings as any)?.qrisImageUrl}
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

          {/* Confirmed / completed state */}
          {(booking.status === "confirmed" || booking.status === "completed") && (
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={26} className="text-green-600" />
                </div>
                <h3 className="font-bold text-lg text-green-900 mb-1">{t("Booking Dikonfirmasi!", "Booking Confirmed!")}</h3>
                <p className="text-sm text-green-700">
                  {t("Pembayaran Anda sudah diverifikasi. Sampai jumpa di lapangan!", "Your payment has been verified. See you on the court!")}
                </p>
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
