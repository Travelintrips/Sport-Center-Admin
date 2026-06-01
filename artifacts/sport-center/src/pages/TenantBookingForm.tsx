import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, CalendarPlus, CheckCircle2 } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useMutation } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

async function submitBooking(data: any) {
  const token = getToken();
  const res = await fetch(`/api/tenant/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
  return res.json();
}

export default function TenantBookingForm() {
  const { t } = useLang();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });

  const [bookingType, setBookingType] = useState("booth");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [requestedArea, setRequestedArea] = useState("");
  const [description, setDescription] = useState("");
  const [success, setSuccess] = useState<{ orderNumber: string } | null>(null);

  const mutation = useMutation({
    mutationFn: submitBooking,
    onSuccess: (data) => {
      setSuccess({ orderNumber: data.orderNumber });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!user || user.role !== "tenant") {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <p className="text-muted-foreground mb-4">{t("Login sebagai Tenant untuk mengajukan booking.", "Login as Tenant to submit a booking.")}</p>
        <Button asChild><Link href="/login">{t("Login", "Login")}</Link></Button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="container mx-auto px-4 py-24 text-center max-w-md">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={40} className="text-green-600" />
        </div>
        <h2 className="text-2xl font-black mb-2">{t("Booking Terkirim!", "Booking Submitted!")}</h2>
        <p className="text-muted-foreground mb-2">{t("No. Booking:", "Booking No.")} <span className="font-black text-primary">{success.orderNumber}</span></p>
        <p className="text-sm text-muted-foreground mb-8">
          {t("Tim kami akan meninjau pengajuan Anda dan menghubungi untuk konfirmasi harga.", "Our team will review your request and contact you to confirm the price.")}
        </p>
        <div className="flex gap-3 justify-center">
          <Button asChild className="rounded-full px-6 font-bold">
            <Link href={`/tenant/bookings/${success.orderNumber}`}>{t("Lihat Detail", "View Detail")}</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full px-6">
            <Link href="/tenant/bookings">{t("Semua Booking", "All Bookings")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingType || !startDate || !endDate) {
      toast({ title: t("Wajib isi", "Required"), description: t("Tipe, tanggal mulai, dan tanggal selesai wajib diisi.", "Type, start date, and end date are required."), variant: "destructive" });
      return;
    }
    mutation.mutate({
      bookingType,
      startDate,
      endDate,
      durationMonths: durationMonths ? Number(durationMonths) : undefined,
      requestedArea: requestedArea || undefined,
      description: description || undefined,
    });
  };

  return (
    <div className="container mx-auto px-4 md:px-8 py-10 max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link href="/tenant/dashboard"><ChevronLeft size={14} /> {t("Kembali", "Back")}</Link>
        </Button>
      </div>

      <div className="mb-8">
        <div className="text-xs font-bold uppercase tracking-widest text-primary mb-1">{t("Tenant Portal", "Tenant Portal")}</div>
        <h1 className="text-3xl font-black">{t("Ajukan Booking Baru", "Submit New Booking")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("Isi form di bawah untuk mengajukan permintaan sewa area.", "Fill the form below to submit a rental area request.")}
        </p>
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-black flex items-center gap-2">
            <CalendarPlus size={15} className="text-primary" /> {t("Detail Pengajuan", "Request Details")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label>{t("Tipe Area", "Area Type")} *</Label>
              <Select value={bookingType} onValueChange={setBookingType}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="booth">{t("Booth / Kios", "Booth / Kiosk")}</SelectItem>
                  <SelectItem value="event_space">{t("Ruang Event", "Event Space")}</SelectItem>
                  <SelectItem value="advertising_space">{t("Ruang Iklan", "Advertising Space")}</SelectItem>
                  <SelectItem value="renewal">{t("Perpanjangan", "Renewal")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("Tanggal Mulai", "Start Date")} *</Label>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1.5" required />
              </div>
              <div>
                <Label>{t("Tanggal Selesai", "End Date")} *</Label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1.5" required />
              </div>
            </div>

            <div>
              <Label>{t("Durasi (bulan, opsional)", "Duration (months, optional)")}</Label>
              <Input type="number" min="1" value={durationMonths} onChange={e => setDurationMonths(e.target.value)} placeholder="6" className="mt-1.5" />
            </div>

            <div>
              <Label>{t("Area yang Diminta", "Requested Area")}</Label>
              <Input value={requestedArea} onChange={e => setRequestedArea(e.target.value)} placeholder={t("misal: Area A, Lantai 1, dll", "e.g. Area A, Floor 1, etc")} className="mt-1.5" />
            </div>

            <div>
              <Label>{t("Deskripsi & Kebutuhan", "Description & Requirements")}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)}
                placeholder={t("Jelaskan jenis usaha, kebutuhan listrik, ukuran yang diinginkan, dll.", "Describe your business type, electrical needs, desired size, etc.")}
                rows={4} className="mt-1.5 resize-none" />
            </div>

            <Button type="submit" disabled={mutation.isPending} className="w-full rounded-full font-bold py-5 shadow-md shadow-primary/20">
              {mutation.isPending ? t("Mengirim...", "Submitting...") : t("Kirim Pengajuan", "Submit Request")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center mt-4">
        {t("Admin akan meninjau dan menghubungi Anda dalam 1-3 hari kerja.", "Admin will review and contact you within 1-3 business days.")}
      </p>
    </div>
  );
}
