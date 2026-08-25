import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Clock, Plus } from "lucide-react";
import { useLang } from "@/lib/i18n";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";

function addHours(time: string, hours: number): string {
  const [h] = time.split(":").map(Number);
  return `${String(h + hours).padStart(2, "0")}:00`;
}

function formatRupiah(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: number;
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  onSuccess?: () => void;
}

export default function ExtendBookingDialog({
  open, onOpenChange, bookingId, orderNumber, facilityName, bookingDate, startTime, endTime, onSuccess,
}: Props) {
  const { t } = useLang();
  const { toast } = useToast();
  const [extraHours, setExtraHours] = useState("1");
  const [reason, setReason] = useState("");

  const { data: options, isLoading: optionsLoading } = useQuery({
    queryKey: ["extend-options", bookingId],
    queryFn: () => fetch(`${API}/bookings/${bookingId}/extend-options`).then(r => r.json()),
    enabled: open && !!bookingId,
  });

  const availableHours: number[] = options?.availableHours ?? [];
  const pricePerHour: number = options?.facilityPricePerHour ?? 0;

  useEffect(() => {
    if (availableHours.length > 0 && !availableHours.includes(parseInt(extraHours))) {
      setExtraHours(String(availableHours[0]));
    }
  }, [availableHours]);

  const extra = parseInt(extraHours);
  const newEndTime = addHours(endTime, extra);
  const additionalPrice = pricePerHour * extra;

  const mutation = useMutation({
    mutationFn: () =>
      fetch(`${API}/bookings/${bookingId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extraHours: extra, reason: reason || undefined }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Gagal mengirim permintaan");
        return data;
      }),
    onSuccess: () => {
      toast({
        title: t("Permintaan perpanjangan terkirim!", "Extension request submitted!"),
        description: t("Admin akan meninjau permintaan Anda segera.", "Admin will review your request shortly."),
      });
      onOpenChange(false);
      setExtraHours("1");
      setReason("");
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: t("Gagal", "Failed"), description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock size={20} className="text-primary" />
            {t("Tambah Waktu Booking", "Extend Booking Time")}
          </DialogTitle>
          <DialogDescription>
            {t("Ajukan perpanjangan durasi untuk booking", "Request time extension for booking")} <strong>{orderNumber}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Jadwal saat ini */}
          <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("Jadwal Saat Ini", "Current Schedule")}</p>
            <p className="font-medium">{facilityName}</p>
            <p className="text-muted-foreground">{bookingDate} · {startTime.substring(0, 5)}–{endTime.substring(0, 5)}</p>
          </div>

          {optionsLoading ? (
            <p className="text-sm text-muted-foreground text-center py-2">{t("Mengecek ketersediaan...", "Checking availability...")}</p>
          ) : availableHours.length === 0 ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 text-center">
              {t("Tidak ada slot tersedia untuk perpanjangan.", "No slots available for extension.")}
            </div>
          ) : (
            <>
              {/* Tambah waktu */}
              <div className="space-y-1.5">
                <Label>{t("Tambah Durasi", "Extra Duration")}</Label>
                <Select value={extraHours} onValueChange={setExtraHours}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableHours.map((n) => (
                      <SelectItem key={n} value={String(n)}>+ {n} {t("jam", "hour(s)")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Preview jadwal baru */}
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm space-y-1.5">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide">{t("Jadwal Setelah Diperpanjang", "Extended Schedule")}</p>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground line-through">{endTime.substring(0, 5)}</span>
                  <span className="text-primary font-bold">→ {newEndTime.substring(0, 5)}</span>
                </div>
                <div className="flex items-center gap-1 text-orange-600 font-semibold">
                  <Plus size={14} />
                  <span>{t("Biaya tambahan", "Additional charge")}: {formatRupiah(additionalPrice)}</span>
                </div>
              </div>

              {/* Alasan */}
              <div className="space-y-1.5">
                <Label>{t("Alasan (opsional)", "Reason (optional)")}</Label>
                <Textarea
                  placeholder={t("Ceritakan alasan perpanjangan...", "Tell us why you need more time...")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                />
              </div>
            </>
          )}

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              {t("Batal", "Cancel")}
            </Button>
            {availableHours.length > 0 && (
              <Button className="flex-1 bg-primary hover:bg-primary/90" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? t("Mengirim...", "Submitting...") : t("Kirim Permintaan", "Submit Request")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
