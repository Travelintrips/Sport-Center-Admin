import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock } from "lucide-react";
import { useLang } from "@/lib/i18n";

const API = import.meta.env.VITE_API_BASE_URL ?? "/api";

const HOURS = Array.from({ length: 17 }, (_, i) => {
  const h = i + 6;
  return `${String(h).padStart(2, "0")}:00`;
});

function addHours(time: string, hours: number): string {
  const [h] = time.split(":").map(Number);
  const end = h + hours;
  return `${String(end).padStart(2, "0")}:00`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: number;
  orderNumber: string;
  currentDate: string;
  currentStart: string;
  currentEnd: string;
  facilityName: string;
  onSuccess?: () => void;
}

export default function RescheduleDialog({
  open, onOpenChange, bookingId, orderNumber, currentDate, currentStart, currentEnd, facilityName, onSuccess,
}: Props) {
  const { t } = useLang();
  const { toast } = useToast();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  const [newDate, setNewDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("1");
  const [reason, setReason] = useState("");

  const endTime = startTime ? addHours(startTime, parseInt(duration)) : "";
  const endHour = endTime ? parseInt(endTime.split(":")[0]) : 0;
  const isValidEnd = endHour <= 23;

  const mutation = useMutation({
    mutationFn: () =>
      fetch(`${API}/bookings/${bookingId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newDate, newStartTime: startTime, newEndTime: endTime, reason: reason || undefined }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Gagal mengirim permintaan");
        return data;
      }),
    onSuccess: () => {
      toast({ title: t("Permintaan reschedule terkirim!", "Reschedule request submitted!"), description: t("Admin akan meninjau permintaan Anda segera.", "Admin will review your request shortly.") });
      onOpenChange(false);
      setNewDate(""); setStartTime(""); setDuration("1"); setReason("");
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: t("Gagal", "Failed"), description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = !!newDate && !!startTime && isValidEnd && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock size={20} className="text-primary" />
            {t("Minta Reschedule", "Request Reschedule")}
          </DialogTitle>
          <DialogDescription>
            {t("Ajukan perubahan jadwal untuk booking", "Request a schedule change for booking")} <strong>{orderNumber}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Jadwal saat ini */}
          <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("Jadwal Saat Ini", "Current Schedule")}</p>
            <p className="font-medium">{facilityName}</p>
            <p className="text-muted-foreground">{currentDate} · {currentStart.substring(0, 5)}–{currentEnd.substring(0, 5)}</p>
          </div>

          {/* Tanggal baru */}
          <div className="space-y-1.5">
            <Label>{t("Tanggal Baru", "New Date")}</Label>
            <Input type="date" min={minDate} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>

          {/* Jam mulai */}
          <div className="space-y-1.5">
            <Label>{t("Jam Mulai", "Start Time")}</Label>
            <Select value={startTime} onValueChange={setStartTime}>
              <SelectTrigger>
                <SelectValue placeholder={t("Pilih jam mulai", "Select start time")} />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={h}>{h}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Durasi */}
          <div className="space-y-1.5">
            <Label>{t("Durasi", "Duration")}</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} {t("jam", "hour(s)")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {startTime && endTime && (
              <p className="text-xs text-muted-foreground">
                {t("Selesai pukul", "Ends at")} <span className="font-semibold text-foreground">{endTime}</span>
              </p>
            )}
          </div>

          {/* Alasan */}
          <div className="space-y-1.5">
            <Label>{t("Alasan (opsional)", "Reason (optional)")}</Label>
            <Textarea
              placeholder={t("Ceritakan alasan reschedule...", "Tell us why you need to reschedule...")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              {t("Batal", "Cancel")}
            </Button>
            <Button className="flex-1 bg-primary hover:bg-primary/90" onClick={() => mutation.mutate()} disabled={!canSubmit}>
              {mutation.isPending ? t("Mengirim...", "Submitting...") : t("Kirim Permintaan", "Submit Request")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
