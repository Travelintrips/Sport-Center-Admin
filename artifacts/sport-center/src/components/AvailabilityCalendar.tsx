import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCheckAvailabilityQueryKey } from "@workspace/api-client-react";
import { getSupabaseClient } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import { Wifi, WifiOff } from "lucide-react";

interface Slot {
  time: string;
  available: boolean;
  reason: string | null;
}

interface Props {
  facilityId: number;
  date: string;
  slots: Slot[] | undefined;
  isLoading: boolean;
  selectedTime: string;
  duration: number;
  onSelectTime: (time: string) => void;
}

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minToTime(m: number) {
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}

export default function AvailabilityCalendar({
  facilityId,
  date,
  slots,
  isLoading,
  selectedTime,
  duration,
  onSelectTime,
}: Props) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<Awaited<ReturnType<typeof getSupabaseClient>>["channel"]> | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  useEffect(() => {
    if (!facilityId || !date) return;

    let mounted = true;

    (async () => {
      try {
        const supabase = await getSupabaseClient();
        if (!mounted) return;

        if (channelRef.current) {
          await supabase.removeChannel(channelRef.current);
        }

        const channelName = `availability-${facilityId}-${date}`;
        const channel = supabase.channel(channelName, {
          config: { broadcast: { self: false } },
        });

        channel
          .on("broadcast", { event: "slot_changed" }, () => {
            queryClient.invalidateQueries({
              queryKey: getCheckAvailabilityQueryKey({ facilityId, date }),
            });
          })
          .subscribe((status) => {
            if (!mounted) return;
            if (status === "SUBSCRIBED") setRealtimeStatus("connected");
            else if (status === "CLOSED" || status === "CHANNEL_ERROR") setRealtimeStatus("disconnected");
          });

        channelRef.current = channel;
      } catch {
        if (mounted) setRealtimeStatus("disconnected");
      }
    })();

    return () => {
      mounted = false;
      if (channelRef.current) {
        getSupabaseClient().then((s) => s.removeChannel(channelRef.current!));
        channelRef.current = null;
      }
      setRealtimeStatus("connecting");
    };
  }, [facilityId, date, queryClient]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!slots || slots.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8 border border-dashed rounded-lg text-sm">
        No time slots available for this date
      </div>
    );
  }

  const selectedMin = selectedTime ? timeToMin(selectedTime) : -1;
  const selectionEndMin = selectedMin >= 0 ? selectedMin + duration * 60 : -1;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {slots.length} slots · {slots.filter((s) => s.available).length} available
        </span>
        <span
          className={`flex items-center gap-1 text-xs font-medium ${
            realtimeStatus === "connected"
              ? "text-green-600"
              : realtimeStatus === "disconnected"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {realtimeStatus === "connected" ? (
            <><Wifi size={12} /> Live</>
          ) : realtimeStatus === "disconnected" ? (
            <><WifiOff size={12} /> Offline</>
          ) : (
            <><Wifi size={12} className="animate-pulse" /> Connecting…</>
          )}
        </span>
      </div>

      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {slots.map((slot) => {
          const slotMin = timeToMin(slot.time);
          const slotEndMin = slotMin + 60;
          const slotEndTime = minToTime(slotEndMin);

          const isStart = slot.time === selectedTime;
          const isInRange =
            selectedMin >= 0 &&
            slotMin >= selectedMin &&
            slotMin < selectionEndMin;

          let stateClass = "";
          if (!slot.available) {
            stateClass = "bg-red-50 border-red-200 text-red-400 cursor-not-allowed opacity-70";
          } else if (isInRange) {
            stateClass =
              "bg-primary/10 border-primary text-primary cursor-pointer";
          } else {
            stateClass =
              "bg-green-50 border-green-200 text-green-700 hover:bg-primary/5 hover:border-primary/40 cursor-pointer";
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
                    !slot.available
                      ? "bg-red-400"
                      : isInRange
                      ? "bg-primary"
                      : "bg-green-500"
                  }`}
                />
                <span>
                  {slot.time.substring(0, 5)} – {slotEndTime.substring(0, 5)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isStart && (
                  <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">
                    START
                  </span>
                )}
                {!slot.available && (
                  <span className="text-xs text-red-400">{slot.reason || "Booked"}</span>
                )}
                {slot.available && !isInRange && (
                  <span className="text-xs text-green-600">Available</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedTime && (
        <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg text-sm">
          <div className="font-semibold text-primary">Selected session</div>
          <div className="text-muted-foreground">
            {selectedTime.substring(0, 5)} –{" "}
            {minToTime(selectedMin + duration * 60).substring(0, 5)}{" "}
            ({duration} {duration === 1 ? "hour" : "hours"})
          </div>
        </div>
      )}
    </div>
  );
}
