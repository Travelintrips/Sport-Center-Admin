import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, CalendarPlus, CheckCircle2, Loader2, Info } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useMutation } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const PRICE_PER_MONTH = 3_000_000;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

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

function formatRupiah(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

export default function TenantBookingForm() {
  const { t } = useLang();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey(), staleTime: 60_000 } });

  const [bookingType, setBookingType] = useState("booth");
  const [startMonth, setStartMonth] = useState(String(CURRENT_MONTH));
  const [startYear, setStartYear] = useState(String(CURRENT_YEAR));
  const [durationMonths, setDurationMonths] = useState("1");
  const [requestedArea, setRequestedArea] = useState("");
  const [description, setDescription] = useState("");
  const [success, setSuccess] = useState<{ orderNumber: string } | null>(null);

  const duration = Math.max(1, parseInt(durationMonths) || 1);
  const totalPrice = PRICE_PER_MONTH * duration;

  // Compute end month/year
  const startM = parseInt(startMonth);
  const startY = parseInt(startYear);
  const endTotalMonths = (startY * 12 + startM - 1) + (duration - 1);
  const endMonth = (endTotalMonths % 12) + 1;
  const endYear = Math.floor(endTotalMonths / 12);

  const mutation = useMutation({
    mutationFn: submitBooking,
    onSuccess: (data) => setSuccess({ orderNumber: data.orderNumber }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!user || user.role !== "tenant") {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <p className="text-muted-foreground mb-4">{t("Silakan daftar atau login sebagai Tenant untuk mengajukan booking.", "Please register or login as Tenant to submit a booking.")}</p>
        <div className="flex gap-3 justify-center">
          <Button asChild><Link href="/tenant/register">{t("Daftar Tenant", "Register as Tenant")}</Link></Button>
          <Button asChild variant="outline"><Link href="/login">{t("Login", "Login")}</Link></Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="container mx-auto px-4 py-24 text-center max-w-md">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={40} className="text-green-600" />
        </div>
        <h2 className="text-2xl font-black mb-2">{t("Pengajuan Terkirim!", "Booking Submitted!")}</h2>
        <p className="text-muted-foreground mb-1">{t("No. Booking:", "Booking No.")} <span className="font-black text-primary">{success.orderNumber}</span></p>
        <p className="text-sm text-muted-foreground mb-8">
          {t("Tim kami akan meninjau dan menghubungi Anda dalam 1-3 hari kerja.", "Our team will review and contact you within 1-3 business days.")}
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
    if (!bookingType || !startMonth || !startYear) {
      toast({ title: t("Wajib isi", "Required"), description: t("Tipe dan periode sewa wajib diisi.", "Area type and rental period are required."), variant: "destructive" });
      return;
    }
    mutation.mutate({
      bookingType,
      paymentPeriodType: "monthly",
      periodStartMonth: parseInt(startMonth),
      periodStartYear: parseInt(startYear),
      periodEndMonth: endMonth,
      periodEndYear: endYear,
      requestedArea: requestedArea || undefined,
      description: description || undefined,
    });
  };

  const years = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2];

  return (
    <div className="container mx-auto px-4 md:px-8 py-10 max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link href="/tenant/dashboard"><ChevronLeft size={14} /> {t("Kembali", "Back")}</Link>
        </Button>
      </div>

      <div className="mb-8">
        <div className="text-xs font-bold uppercase tracking-widest text-primary mb-1">{t("Tenant Portal", "Tenant Portal")}</div>
        <h1 className="text-3xl font-black">{t("Ajukan Booking Sewa", "Submit Rental Booking")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("Pilih jenis area dan periode sewa Anda.", "Select your area type and rental period.")}
        </p>
      </div>

      {/* Pricing info */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
        <Info size={16} className="text-primary mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-black text-primary">{formatRupiah(PRICE_PER_MONTH)} / bulan <span className="font-normal text-muted-foreground">{t("(include PPN 11%)", "(incl. 11% VAT)")}</span></p>
          <p className="text-muted-foreground text-xs mt-0.5">{t("Harga tetap untuk semua jenis area.", "Fixed price for all area types.")}</p>
        </div>
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
              <Label>{t("Jenis Area", "Area Type")} *</Label>
              <Select value={bookingType} onValueChange={setBookingType}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="booth">{t("Booth / Kios", "Booth / Kiosk")}</SelectItem>
                  <SelectItem value="event_space">{t("Ruang Event", "Event Space")}</SelectItem>
                  <SelectItem value="advertising_space">{t("Ruang Iklan", "Advertising Space")}</SelectItem>
                  <SelectItem value="renewal">{t("Perpanjangan Kontrak", "Contract Renewal")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Period */}
            <div>
              <Label>{t("Mulai Sewa", "Rental Start")} *</Label>
              <div className="grid grid-cols-2 gap-3 mt-1.5">
                <Select value={startMonth} onValueChange={setStartMonth}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS_SHORT.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={startYear} onValueChange={setStartYear}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>{t("Durasi Sewa (bulan)", "Rental Duration (months)")} *</Label>
              <Select value={durationMonths} onValueChange={setDurationMonths}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 6, 12].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} {t("bulan", "month(s)")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Total price preview */}
            <div className="bg-muted/50 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="text-xs text-muted-foreground">{t("Periode Sewa", "Rental Period")}</p>
                <p className="text-sm font-black">
                  {MONTHS_SHORT[parseInt(startMonth) - 1]} {startYear} — {MONTHS_SHORT[endMonth - 1]} {endYear}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{duration} {t("bulan", "months")}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{t("Estimasi Total", "Estimated Total")}</p>
                <p className="text-xl font-black text-primary">{formatRupiah(totalPrice)}</p>
                <p className="text-xs text-muted-foreground">{t("inc. PPN", "incl. VAT")}</p>
              </div>
            </div>

            <div>
              <Label>{t("Area yang Diminati", "Preferred Area")}</Label>
              <Input value={requestedArea} onChange={e => setRequestedArea(e.target.value)} placeholder={t("misal: Area A, Lantai 1, dll", "e.g. Area A, Floor 1, etc")} className="mt-1.5" />
            </div>

            <div>
              <Label>{t("Deskripsi Bisnis & Kebutuhan", "Business Description & Requirements")}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)}
                placeholder={t("Jelaskan jenis usaha, kebutuhan listrik, ukuran yang diinginkan, dll.", "Describe your business type, electrical needs, desired size, etc.")}
                rows={4} className="mt-1.5 resize-none" />
            </div>

            <Button type="submit" disabled={mutation.isPending} className="w-full rounded-full font-bold py-5 shadow-md shadow-primary/20">
              {mutation.isPending
                ? <><Loader2 size={16} className="animate-spin mr-2" /> {t("Mengirim...", "Submitting...")}</>
                : t("Kirim Pengajuan Sewa →", "Submit Rental Request →")}
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
