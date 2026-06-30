/**
 * Unified storage adapter.
 *
 * Strategy: Replit Object Storage is PRIMARY (always available, no egress quota).
 * Supabase Storage is the FALLBACK when Replit is unavailable.
 *
 * This replaces direct calls to uploadToStorage() from supabaseStorage.ts
 * which fails when Supabase exceeds egress quota.
 */

import { uploadToReplitStorage, isReplitStorageAvailable } from "./replitStorage";
import { uploadToStorage, BUCKETS } from "./supabaseStorage";
import path from "path";

// Map Supabase bucket names → Replit Object Storage folder names
const BUCKET_TO_FOLDER: Record<string, string> = {
  [BUCKETS.facility]: "facility-images",
  [BUCKETS.proof]: "payment-proofs",
  [BUCKETS.docTemplates]: "doc-templates",
};

/**
 * Upload a file to storage. Tries Replit Object Storage first, falls back to Supabase.
 * Returns a URL string (either a Replit proxy URL or a Supabase public URL).
 */
export async function uploadFile(
  bucket: string,
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const folder = BUCKET_TO_FOLDER[bucket] ?? bucket;
  const filename = path.basename(objectPath);

  if (isReplitStorageAvailable()) {
    try {
      return await uploadToReplitStorage(folder, filename, buffer, contentType);
    } catch (replitErr: any) {
      console.warn(
        `[Storage] Replit Object Storage upload failed (${replitErr?.message ?? replitErr}), falling back to Supabase`,
      );
    }
  }

  // Fallback: Supabase Storage
  return await uploadToStorage(bucket, objectPath, buffer, contentType);
}

export { BUCKETS };
