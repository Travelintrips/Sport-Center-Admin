import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCheckAvailabilityQueryKey } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";

export function useRealtimeAvailability(facilityId: number, date: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!facilityId || !date) return;

    const invalidate = () => {
      queryClient.invalidateQueries({
        queryKey: getCheckAvailabilityQueryKey({ facilityId, date }),
      });
    };

    if (supabase) {
      const channel = supabase.channel(`availability-${facilityId}-${date}`);
      channel
        .on("broadcast", { event: "availability_changed" }, invalidate)
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      const interval = setInterval(invalidate, 30000);
      return () => clearInterval(interval);
    }
  }, [facilityId, date, queryClient]);
}
