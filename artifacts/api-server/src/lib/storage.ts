/**
 * Unified storage adapter.
 *
 * Priority:
 *   1. Replit Object Storage  — only when running inside Replit (REPL_ID env present)
 *   2. Supabase Storage       — primary for production (GAE) and Replit fallback
 *   3. No local filesystem fallback — uploads fail explicitly if both remote
 *      providers are unavailable.
 *
 * Production (NODE_ENV=production, GAE) behaviour:
 *   - Replit Object Storage is NEVER attempted (no sidecar at 127.0.0.1:1106)
 *   - Supabase Storage is used exclusively
 *   - Local FS fallback is disabled; upload throws if Supabase fails
 *
 * This replaces direct calls to uploadToStorage() from supabaseStorage.ts.
 */

import { uploadToReplitStorage, isReplitStorageAvailable } from "./replitStorage";
import { uploadToStorage, BUCKETS } from "./supabaseStorage";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Map Supabase bucket names → Replit Object Storage folder names
const BUCKET_TO_FOLDER: Record<string, string> = {
  [BUCKETS.facility]: "facility-images",
  [BUCKETS.proof]: "payment-proofs",
  [BUCKETS.docTemplates]: "doc-templates",
  [BUCKETS.corporateDocs]: "corporate-docs",
  "invoice-pdfs": "invoice-pdfs",
};
/**
 * Upload a file to storage.
 *
 * In production (GAE): Supabase only — no Replit sidecar, no local FS.
 * In development: Replit Object Storage → Supabase.
 *
 * Throws if all available providers fail. Never silently drops files.
 */
export async function uploadFile(
  bucket: string,
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const folder = BUCKET_TO_FOLDER[bucket] ?? bucket;
  const filename = objectPath.split("/").pop() ?? objectPath;

  // 1. Replit Object Storage — ONLY in Replit environment, NEVER in production GAE
  if (!IS_PRODUCTION && isReplitStorageAvailable()) {
    try {
      return await uploadToReplitStorage(folder, filename, buffer, contentType);
    } catch (replitErr: any) {
      console.warn(
        `[Storage] Replit Object Storage upload failed (${replitErr?.message ?? replitErr}), falling back to Supabase`,
      );
    }
  }

  // 2. Supabase Storage — primary for production, fallback for dev
  try {
    return await uploadToStorage(bucket, objectPath, buffer, contentType);
  } catch (supaErr: any) {
    throw new Error(
      `[Storage] Supabase Storage upload failed${IS_PRODUCTION ? " in production" : ""}: ` +
      `${supaErr?.message ?? supaErr}. Check the configured storage provider and bucket "${bucket}".`,
    );
  }
}

export { BUCKETS };
