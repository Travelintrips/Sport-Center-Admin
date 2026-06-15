import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

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

// NOTE: SUPABASE_STORAGE_BUCKET env var is set but NOT used — buckets are
// addressed explicitly via the BUCKETS constant below. It is kept for
// backward-compat and documented as DEPRECATED in docs/supabase-env-audit.md.
export const BUCKETS = {
  facility: "facility-images",
  proof: "payment-proofs",
} as const;

// In-memory bucket health for diagnostic endpoint
export const bucketStatus: Record<string, { ok: boolean; checkedAt: string | null; error: string | null }> = {
  [BUCKETS.facility]: { ok: false, checkedAt: null, error: null },
  [BUCKETS.proof]: { ok: false, checkedAt: null, error: null },
};

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
      realtime: { transport: ws as any },
    });
  }
  return client;
}

export function isStorageConfigured(): boolean {
  return Boolean(SERVICE_KEY && STORAGE_URL);
}

/**
 * Validate that required buckets exist at startup.
 * Logs clearly but does NOT auto-create in production without explicit intent.
 * In development it will attempt to create missing buckets.
 */
export async function validateBuckets(): Promise<void> {
  if (!isStorageConfigured()) {
    console.warn("[Storage] Supabase Storage not configured — skipping bucket validation.");
    return;
  }

  const isProd = process.env.NODE_ENV === "production";
  const supabase = getClient();

  for (const bucket of Object.values(BUCKETS)) {
    const now = new Date().toISOString();
    try {
      const { data, error } = await supabase.storage.getBucket(bucket);
      if (error || !data) {
        if (isProd) {
          console.error(
            `[Storage] ❌ Bucket "${bucket}" not found in production. ` +
            `Create it manually in Supabase Dashboard → Storage. Error: ${error?.message}`
          );
          bucketStatus[bucket] = { ok: false, checkedAt: now, error: error?.message ?? "Not found" };
        } else {
          // Dev: auto-create with public access
          const { error: createErr } = await supabase.storage.createBucket(bucket, {
            public: true,
            allowedMimeTypes: bucket === BUCKETS.facility
              ? ["image/jpeg", "image/png", "image/webp"]
              : ["image/jpeg", "image/png", "image/webp", "application/pdf"],
            fileSizeLimit: bucket === BUCKETS.facility ? 5 * 1024 * 1024 : 10 * 1024 * 1024,
          });
          if (createErr && !createErr.message.includes("already exists")) {
            console.error(`[Storage] ❌ Failed to create bucket "${bucket}": ${createErr.message}`);
            bucketStatus[bucket] = { ok: false, checkedAt: now, error: createErr.message };
          } else {
            console.info(`[Storage] ✓ Bucket "${bucket}" created (dev).`);
            bucketStatus[bucket] = { ok: true, checkedAt: now, error: null };
          }
        }
      } else {
        console.info(`[Storage] ✓ Bucket "${bucket}" exists (public=${data.public}).`);
        bucketStatus[bucket] = { ok: true, checkedAt: now, error: null };
      }
    } catch (err: any) {
      console.error(`[Storage] ❌ Error checking bucket "${bucket}": ${err?.message}`);
      bucketStatus[bucket] = { ok: false, checkedAt: now, error: err?.message };
    }
  }
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
