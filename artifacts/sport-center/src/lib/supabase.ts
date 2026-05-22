import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;
let _config: { supabaseUrl: string; supabaseAnonKey: string } | null = null;

export async function getPublicConfig() {
  if (_config) return _config;
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const res = await fetch(`${base}/api/config/public`);
  if (!res.ok) throw new Error("Failed to load public config");
  _config = await res.json();
  return _config!;
}

export async function getSupabaseClient(): Promise<SupabaseClient> {
  if (_client) return _client;
  const { supabaseUrl, supabaseAnonKey } = await getPublicConfig();
  _client = createClient(supabaseUrl, supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return _client;
}
