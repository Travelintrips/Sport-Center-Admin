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
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export default function BookingDetail() {
  const [, params] = useRoute("/booking/:orderNumber");
  const orderNumber = params?.orderNumber || "";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: booking, isLoading } = useGetBookingByOrder(orderNumber, {
    query: { enabled: !!orderNumber, queryKey: getGetBookingByOrderQueryKey(orderNumber) },
  });
  const { data: settings } = useGetSettings();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<"idle" | "uploading" | "done">("idle");
  const [notes, setNotes] = useState("");

  const submitPayment = useCreatePayment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Bukti pembayaran dikirim!", description: "Admin akan memverifikasi pembayaran Anda segera." });
        queryClient.invalidateQueries({ queryKey: getGetBookingByOrderQueryKey(orderNumber) });
        clearFile();
      },
      onError: (error: any) => {
        toast({ title: "Gagal mengirim", description: error?.message || "Terjadi kesalahan", variant: "destructive" });
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
      toast({ title: "Format tidak didukung", description: "Gunakan JPG, PNG, WebP, atau PDF", variant: "destructive" });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking || !selectedFile) return;

    try {
      setUploadProgress("uploading");
      const formData = new FormData();
      formData.append("proof", selectedFile);
      const token = localStorage.getItem("sport_center_token");
      const resp = await fetch(`${BASE}/api/payments/proof-upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || "Upload gagal");
      }
      const { url } = await resp.json();
      setUploadProgress("done");

      submitPayment.mutate({
        data: { bookingId: booking.id, amount: booking.totalPrice, proofUrl: url, notes: notes || undefined },
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
        <h2 className="text-2xl font-bold mb-2">Booking Tidak Ditemukan</h2>
        <p className="text-muted-foreground">Order {orderNumber} tidak ada.</p>
      </div>
    );

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "pending_payment":
        return { color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: Clock, label: "Menunggu Pembayaran" };
      case "paid":
        return { color: "bg-blue-100 text-blue-800 border-blue-300", icon: CheckCircle2, label: "Sedang Diverifikasi" };
      case "confirmed":
        return { color: "bg-green-100 text-green-800 border-green-300", icon: CheckCircle2, label: "Dikonfirmasi" };
      case "completed":
        return { color: "bg-slate-100 text-slate-800 border-slate-300", icon: CheckCircle2, label: "Selesai" };
      case "cancelled":
        return { color: "bg-red-100 text-red-800 border-red-300", icon: AlertCircle, label: "Dibatalkan" };
      default:
        return { color: "bg-gray-100 text-gray-800 border-gray-300", icon: Clock, label: status };
    }
  };

  const statusConfig = getStatusConfig(booking.status);
  const StatusIcon = statusConfig.icon;
  const isPending = uploadProgress === "uploading" || submitPayment.isPending;

  return (
    <div className="container mx-auto px-4 py-8 md:py-12 max-w-4xl">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border mb-6 ${statusConfig.color}`}>
          <StatusIcon size={20} />
          <span className="font-bold">{statusConfig.label}</span>
        </div>
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-2">
          Order {booking.orderNumber}
        </h1>
        <p className="text-muted-foreground text-lg">
          {booking.status === "pending_payment"
            ? "Selesaikan pembayaran untuk mengamankan booking ini."
            : "Terima kasih atas pemesanan Anda!"}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Booking Details */}
        <Card className="border-border">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <CardTitle>Detail Booking</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Pelanggan</div>
              <div className="font-semibold">{booking.customerName}</div>
              <div className="text-sm text-muted-foreground">
                {booking.customerPhone} · {booking.customerEmail}
              </div>
            </div>
            <div className="h-px bg-border" />
            <div>
              <div className="text-sm text-muted-foreground mb-1">Fasilitas</div>
              <div className="font-semibold text-lg">{booking.facilityName}</div>
              <div className="text-sm text-primary font-medium">{booking.facilityCategory}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Tanggal</div>
                <div className="font-semibold">
                  {format(new Date(booking.bookingDate), "d MMM yyyy")}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Waktu</div>
                <div className="font-semibold">
                  {booking.startTime.substring(0, 5)} – {booking.endTime.substring(0, 5)}
                </div>
              </div>
            </div>
            <div className="h-px bg-border" />
            <div className="flex justify-between items-center text-xl font-black">
              <div>Total</div>
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
                  Instruksi Pembayaran
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                <p className="text-sm text-muted-foreground">
                  Transfer tepat{" "}
                  <strong className="text-foreground text-base">
                    Rp {booking.totalPrice.toLocaleString("id-ID")}
                  </strong>{" "}
                  ke rekening berikut:
                </p>

                {/* Bank account */}
                <div className="bg-muted rounded-lg p-4 relative group">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    {settings?.bankName || "BCA"}
                  </div>
                  <div className="text-2xl font-mono tracking-wider mb-1">
                    {settings?.bankAccount || "1234567890"}
                  </div>
                  <div className="text-sm font-medium">
                    a.n {settings?.bankAccountName || "SportCenter Official"}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2 opacity-50 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyToClipboard(settings?.bankAccount || "1234567890")}
                  >
                    <Copy size={16} />
                  </Button>
                </div>

                {/* Upload proof form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Upload Bukti Transfer *</label>

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
                          Drag & drop atau klik untuk upload
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          JPG, PNG, WebP, PDF — maks 10 MB
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

                  {/* Progress bar */}
                  {uploadProgress === "uploading" && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Mengupload ke Supabase Storage…</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full animate-[progress_1.5s_ease-in-out_infinite]" style={{ width: "60%" }} />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      Catatan (opsional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Misal: Transfer dari BCA a.n Budi..."
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
                        {uploadProgress === "uploading" ? "Mengupload..." : "Mengirim..."}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <CheckCircle2 size={18} /> Saya Sudah Bayar
                      </span>
                    )}
                  </Button>
                </form>
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
                <h3 className="font-bold text-lg text-blue-900 mb-1">Pembayaran Sedang Diverifikasi</h3>
                <p className="text-sm text-blue-700">
                  Bukti transfer Anda sudah diterima. Admin akan mengonfirmasi dalam 1×24 jam.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Confirmed state */}
          {(booking.status === "confirmed" || booking.status === "completed") && (
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={26} className="text-green-600" />
                </div>
                <h3 className="font-bold text-lg text-green-900 mb-1">Booking Dikonfirmasi!</h3>
                <p className="text-sm text-green-700">
                  Pembayaran Anda sudah diverifikasi. Sampai jumpa di lapangan!
                </p>
              </CardContent>
            </Card>
          )}

          {/* Contact */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Butuh Bantuan?</CardTitle>
              <CardDescription>Hubungi admin via WhatsApp untuk respons cepat</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                asChild
                variant="outline"
                className="w-full border-[#25D366] text-[#25D366] hover:bg-[#25D366] hover:text-white"
              >
                <a href={getWhatsAppLink()} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2" size={18} /> Chat dengan Admin
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
