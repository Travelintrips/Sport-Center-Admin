import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function getProjectRef(key: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(key.split(".")[1], "base64").toString(),
    );
    return payload.ref ?? null;
  } catch {
    return null;
  }
}

const PROJECT_REF = getProjectRef(SERVICE_KEY);
const STORAGE_URL = PROJECT_REF ? `https://${PROJECT_REF}.supabase.co` : "";

export const BUCKETS = {
  facility: "facility-images",
  proof: "payment-proofs",
} as const;

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!SERVICE_KEY || !STORAGE_URL) {
    throw new Error(
      "Supabase Storage is not configured: SUPABASE_SERVICE_ROLE_KEY missing or invalid",
    );
  }
  if (!client) {
    client = createClient(STORAGE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function isStorageConfigured(): boolean {
  return Boolean(SERVICE_KEY && STORAGE_URL);
}

export async function uploadToStorage(
  bucket: string,
  objectPath: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const supabase = getClient();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(objectPath, body, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
}

export function parseStorageUrl(
  url: string,
): { bucket: string; objectPath: string } | null {
  const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], objectPath: decodeURIComponent(m[2]) };
}

export async function deleteFromStorage(url: string): Promise<void> {
  if (!url || !isStorageConfigured()) return;
  const parsed = parseStorageUrl(url);
  if (!parsed) return;
  try {
    const supabase = getClient();
    await supabase.storage.from(parsed.bucket).remove([parsed.objectPath]);
  } catch {
    // non-fatal
  }
}
