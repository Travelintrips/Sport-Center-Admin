/**
 * Unified storage adapter.
 *
 * Strategy:
 *   1. Replit Object Storage (primary — no egress quota)
 *   2. Supabase Storage (fallback)
 *   3. Local filesystem /uploads/ (last resort — always works on Replit dev)
 *
 * This replaces direct calls to uploadToStorage() from supabaseStorage.ts
 * which fails when Supabase exceeds egress quota.
 */

import { uploadToReplitStorage, isReplitStorageAvailable } from "./replitStorage";
import { uploadToStorage, BUCKETS } from "./supabaseStorage";
import path from "path";
import fs from "fs";

// Map Supabase bucket names → Replit Object Storage folder names
const BUCKET_TO_FOLDER: Record<string, string> = {
  [BUCKETS.facility]: "facility-images",
  [BUCKETS.proof]: "payment-proofs",
  [BUCKETS.docTemplates]: "doc-templates",
};

/**
 * Local filesystem fallback — saves to <cwd>/uploads/<folder>/<filename>
 * Returns a URL served via /api/uploads/<folder>/<filename>
 */
async function uploadToLocalFs(
  folder: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const uploadsBase = path.resolve(process.cwd(), "uploads", folder);
  fs.mkdirSync(uploadsBase, { recursive: true });
  const dest = path.join(uploadsBase, filename);
  fs.writeFileSync(dest, buffer);
  return `/api/uploads/${folder}/${filename}`;
}

/**
 * Upload a file to storage. Tries Replit Object Storage first,
 * falls back to Supabase, then local filesystem as last resort.
 * Returns a URL string.
 */
export async function uploadFile(
  bucket: string,
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const folder = BUCKET_TO_FOLDER[bucket] ?? bucket;
  const filename = path.basename(objectPath);

  // 1. Replit Object Storage (primary)
  if (isReplitStorageAvailable()) {
    try {
      return await uploadToReplitStorage(folder, filename, buffer, contentType);
    } catch (replitErr: any) {
      console.warn(
        `[Storage] Replit Object Storage upload failed (${replitErr?.message ?? replitErr}), falling back to Supabase`,
      );
    }
  }

  // 2. Supabase Storage (fallback)
  try {
    return await uploadToStorage(bucket, objectPath, buffer, contentType);
  } catch (supaErr: any) {
    console.warn(
      `[Storage] Supabase Storage upload failed (${supaErr?.message ?? supaErr}), falling back to local filesystem`,
    );
  }

  // 3. Local filesystem (last resort — always available in Replit dev environment)
  console.warn(`[Storage] Using local filesystem fallback for ${folder}/${filename}`);
  return await uploadToLocalFs(folder, filename, buffer);
}

export { BUCKETS };
