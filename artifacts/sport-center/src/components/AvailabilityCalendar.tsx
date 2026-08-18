import { useRealtimeAvailability } from "@/hooks/useRealtimeAvailability";
import { Skeleton } from "@/components/ui/skeleton";

interface Slot {
  time: string;
  available: boolean;
  reason: string | null | undefined;
}

interface Props {
  facilityId: number;
  date: string;
  slots: Slot[] | undefined;
  isLoading: boolean;
  isError: boolean;
  selectedTime: string;
  duration: number;
  onSelectTime: (time: string) => void;
}

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minToTime(m: number) {
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "00")}`;
}

export default function AvailabilityCalendar({
  facilityId,
  date,
  slots,
  isLoading,
  isError,
  selectedTime,
  duration,
  onSelectTime,
}: Props) {
  useRealtimeAvailability(facilityId, date);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center text-red-600 py-8 border border-red-200 rounded-lg text-sm bg-red-50">
        Gagal memuat slot. Silakan pilih tanggal lagi atau coba beberapa saat
        kemudian.
      </div>
    );
  }

  if (!slots || slots.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8 border border-dashed rounded-lg text-sm">
        Tidak ada slot tersedia untuk tanggal ini
      </div>
    );
  }

  const selectedMin = selectedTime ? timeToMin(selectedTime) : -1;
  const selectionEndMin = selectedMin >= 0 ? selectedMin + duration * 60 : -1;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {slots.length} slot · {slots.filter((s) => s.available).length} tersedia
        </span>
      </div>

      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {slots.map((slot) => {
          const slotMin = timeToMin(slot.time);
          const slotEndTime = minToTime(slotMin + 60);

          const isInRange =
            selectedMin >= 0 &&
            slotMin >= selectedMin &&
            slotMin < selectionEndMin;

          let stateClass = "";
          if (!slot.available) {
            stateClass = "bg-red-50 border-red-200 text-red-400 cursor-not-allowed opacity-70";
          } else if (isInRange) {
            stateClass = "bg-primary/10 border-primary text-primary cursor-pointer";
          } else {
            stateClass = "bg-green-50 border-green-200 text-green-700 hover:bg-primary/5 hover:border-primary/40 cursor-pointer";
          }

          return (
            <button
              key={slot.time}
              disabled={!slot.available}
              onClick={() => slot.available && onSelectTime(slot.time)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${stateClass}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    !slot.available ? "bg-red-400" : isInRange ? "bg-primary" : "bg-green-500"
                  }`}
                />
                <span>
                  {slot.time.substring(0, 5)} – {slotEndTime.substring(0, 5)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {slot.time === selectedTime && (
                  <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">
                    START
                  </span>
                )}
                {!slot.available && (
                  <span className="text-xs text-red-400">{slot.reason || "Booked"}</span>
                )}
                {slot.available && !isInRange && (
                  <span className="text-xs text-green-600">Tersedia</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedTime && (
        <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg text-sm">
          <div className="font-semibold text-primary">Sesi dipilih</div>
          <div className="text-muted-foreground">
            {selectedTime.substring(0, 5)} –{" "}
            {minToTime(selectedMin + duration * 60).substring(0, 5)}{" "}
            ({duration} {duration === 1 ? "jam" : "jam"})
          </div>
        </div>
      )}
    </div>
  );
}
