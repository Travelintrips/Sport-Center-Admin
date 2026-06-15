import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

// ─── Dev/Prod Realtime Isolation ────────────────────────────────────────────
// Development: SUPABASE_URL_DEV + SUPABASE_ANON_KEY_DEV
// Production:  SUPABASE_URL    + SUPABASE_ANON_KEY
//
// If dev env vars are not set → realtime is no-op (not a fatal error).
// Missing dev realtime is clearly reported in the diagnostic endpoint.

const IS_DEV = process.env.NODE_ENV === "development";

let SUPABASE_URL: string;
let SUPABASE_ANON_KEY: string;
export let realtimeProjectSource: string;
export let isRealtimeNoop = false;

if (IS_DEV) {
  const devUrl = process.env.SUPABASE_URL_DEV ?? "";
  const devAnon = process.env.SUPABASE_ANON_KEY_DEV ?? "";
  if (devUrl && devAnon) {
    SUPABASE_URL = devUrl;
    SUPABASE_ANON_KEY = devAnon;
    const ref = devUrl.match(/\/\/([^.]+)/)?.[1] ?? "unknown";
    realtimeProjectSource = `SUPABASE_URL_DEV (dev — isolated, ref=${ref})`;
  } else {
    // Dev realtime env not set → no-op, not a fatal error
    SUPABASE_URL = "";
    SUPABASE_ANON_KEY = "";
    isRealtimeNoop = true;
    realtimeProjectSource = "no-op (SUPABASE_URL_DEV or SUPABASE_ANON_KEY_DEV not set)";
    console.warn(
      "[Realtime] Dev realtime env not configured (SUPABASE_URL_DEV / SUPABASE_ANON_KEY_DEV). " +
      "Availability broadcasts are no-ops. Set these vars to enable realtime in dev."
    );
  }
} else {
  SUPABASE_URL = process.env.SUPABASE_URL ?? "";
  SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
      "[Realtime] SUPABASE_URL or SUPABASE_ANON_KEY not set in production. " +
      "Availability broadcasts will be no-ops. Set both vars to enable realtime."
    );
    isRealtimeNoop = true;
    realtimeProjectSource = "no-op (SUPABASE_URL or SUPABASE_ANON_KEY missing in production)";
  } else {
    // Do NOT log project ref in production — keep it out of logs
    realtimeProjectSource = "SUPABASE_URL (production)";
  }
}

export const realtimeEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _realtimeLogged = false;
let _client: SupabaseClient | null = null;

function logRealtimeStatus() {
  if (_realtimeLogged) return;
  _realtimeLogged = true;
  if (realtimeEnabled) {
    console.info(`[Realtime] Supabase Realtime enabled — source: ${realtimeProjectSource}`);
  } else {
    console.warn(
      `[Realtime] Supabase Realtime is DISABLED (no-op). Source: ${realtimeProjectSource}. ` +
      "broadcastAvailabilityChange calls are no-ops."
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
    console.error("[Realtime] broadcastAvailabilityChange failed (non-fatal):", err?.message);
  }
}
