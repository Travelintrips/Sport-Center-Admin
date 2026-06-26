import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

// ─── Dev/Prod Storage Isolation ────────────────────────────────────────────
// Development: SUPABASE_SERVICE_ROLE_KEY_DEV (isolated dev Supabase project)
// Production:  SUPABASE_SERVICE_ROLE_KEY (prod Supabase project)
//
// Guard:
//   Dev + no _DEV key + ALLOW_DEV_ON_PROD_STORAGE=true → warning, use prod key
//   Dev + no _DEV key + no override                    → FATAL, process.exit(1)

const IS_DEV = process.env.NODE_ENV === "development";
export const allowDevOnProdStorage = process.env.ALLOW_DEV_ON_PROD_STORAGE === "true";

function getProjectRef(key: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString());
    return payload.ref ?? null;
  } catch {
    return null;
  }
}

let SERVICE_KEY: string;
export let storageProjectSource: string;
export let isDevUsingProdStorage = false;

if (IS_DEV) {
  const devKey = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? "";
  if (devKey) {
    SERVICE_KEY = devKey;
    const ref = getProjectRef(devKey) ?? "unknown";
    storageProjectSource = `SUPABASE_SERVICE_ROLE_KEY_DEV (dev — isolated, ref=${ref})`;
  } else if (allowDevOnProdStorage) {
    const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    SERVICE_KEY = prodKey;
    isDevUsingProdStorage = true;
    const ref = getProjectRef(prodKey) ?? "unknown";
    storageProjectSource = `SUPABASE_SERVICE_ROLE_KEY (PROD — EMERGENCY OVERRIDE, ref=${ref})`;
    console.warn(
      "\n╔══════════════════════════════════════════════════════════╗\n" +
      "║  ⚠️  STORAGE DANGER: DEV IS UPLOADING TO PRODUCTION      ║\n" +
      "║  ALLOW_DEV_ON_PROD_STORAGE=true is active.               ║\n" +
      "║  Every file upload from dev hits the prod Supabase.      ║\n" +
      "║  Remove this override and set SUPABASE_SERVICE_ROLE_KEY_DEV. ║\n" +
      "╚══════════════════════════════════════════════════════════╝\n"
    );
  } else {
    console.error(
      "\n╔══════════════════════════════════════════════════════════╗\n" +
      "║  FATAL: Storage isolation not configured for dev          ║\n" +
      "║                                                            ║\n" +
      "║  NODE_ENV=development but SUPABASE_SERVICE_ROLE_KEY_DEV   ║\n" +
      "║  is not set. Dev uploads would hit production storage.    ║\n" +
      "║                                                            ║\n" +
      "║  Fix:                                                      ║\n" +
      "║    Set SUPABASE_SERVICE_ROLE_KEY_DEV to an isolated dev    ║\n" +
      "║    Supabase project service role key.                     ║\n" +
      "║                                                            ║\n" +
      "║  Emergency override (discouraged):                        ║\n" +
      "║    Set ALLOW_DEV_ON_PROD_STORAGE=true to allow dev        ║\n" +
      "║    uploads to production (EMERGENCY USE ONLY).            ║\n" +
      "╚══════════════════════════════════════════════════════════╝\n"
    );
    process.exit(1);
  }
} else {
  const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!prodKey) {
    console.error(
      "\n╔══════════════════════════════════════════════════════════════════╗\n" +
      "║  FATAL: SUPABASE_SERVICE_ROLE_KEY is not set in production.     ║\n" +
      "║                                                                  ║\n" +
      "║  File uploads (payment proofs, facility images, QRIS) will      ║\n" +
      "║  fail without this key. Set it in the production environment.   ║\n" +
      "╚══════════════════════════════════════════════════════════════════╝\n"
    );
    process.exit(1);
  }
  SERVICE_KEY = prodKey;
  // Do NOT log project ref in production — keep it out of logs
  storageProjectSource = "SUPABASE_SERVICE_ROLE_KEY (production)";
}

const PROJECT_REF = getProjectRef(SERVICE_KEY);
const STORAGE_URL = PROJECT_REF ? `https://${PROJECT_REF}.supabase.co` : "";

export const BUCKETS = {
  facility: "facility-images",
  proof: "payment-proofs",
  invoiceTemplates: "invoice-templates",
  documentTemplates: "document-templates",
} as const;

// In-memory bucket health for diagnostic endpoint
export const bucketStatus: Record<string, { ok: boolean; checkedAt: string | null; error: string | null }> = {
  [BUCKETS.facility]: { ok: false, checkedAt: null, error: null },
  [BUCKETS.proof]: { ok: false, checkedAt: null, error: null },
  [BUCKETS.invoiceTemplates]: { ok: false, checkedAt: null, error: null },
  [BUCKETS.documentTemplates]: { ok: false, checkedAt: null, error: null },
};

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!SERVICE_KEY || !STORAGE_URL) {
    throw new Error(
      "Supabase Storage is not configured: service role key missing or invalid"
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
 * In production: logs error only, never auto-creates.
 * In development: auto-creates missing buckets (in the dev Supabase project).
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
            console.info(`[Storage] ✓ Bucket "${bucket}" exists/created (dev).`);
            bucketStatus[bucket] = { ok: true, checkedAt: now, error: null };
          }
        }
      } else {
        const source = IS_DEV ? "dev" : "prod";
        console.info(`[Storage] ✓ Bucket "${bucket}" exists (public=${data.public}, env=${source}).`);
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
