import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

export async function broadcastAvailabilityChange(facilityId: number, date: string) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.channel(`availability-${facilityId}-${date}`).send({
      type: "broadcast",
      event: "slot_changed",
      payload: { facilityId, date, ts: Date.now() },
    });
  } catch {
    // non-fatal
  }
}
