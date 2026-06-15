import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

const realtimeEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _realtimeLogged = false;
let _client: SupabaseClient | null = null;

function logRealtimeStatus() {
  if (_realtimeLogged) return;
  _realtimeLogged = true;
  if (realtimeEnabled) {
    console.info("[Realtime] Supabase Realtime enabled — availability broadcasts active.");
  } else {
    console.warn(
      "[Realtime] Supabase Realtime is DISABLED (SUPABASE_URL or SUPABASE_ANON_KEY not set). " +
      "broadcastAvailabilityChange calls are no-ops. Set both env vars to enable real-time availability updates."
    );
  }
}

function getRealtimeClient(): SupabaseClient | null {
  if (!realtimeEnabled) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws as any },
    });
  }
  return _client;
}

export async function broadcastAvailabilityChange(facilityId: number, date: string): Promise<void> {
  logRealtimeStatus();
  if (!realtimeEnabled) return;

  const client = getRealtimeClient();
  if (!client) return;

  try {
    const channel = client.channel(`availability-${facilityId}-${date}`);
    await channel.send({
      type: "broadcast",
      event: "availability_changed",
      payload: { facilityId, date, updatedAt: new Date().toISOString() },
    });
  } catch (err: any) {
    // Non-fatal — booking must never fail because of realtime
    console.error("[Realtime] broadcastAvailabilityChange failed (non-fatal):", err?.message);
  }
}

export { realtimeEnabled };
