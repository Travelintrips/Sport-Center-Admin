/**
 * Unified storage adapter.
 *
 * Priority:
 *   1. Replit Object Storage  — only when running inside Replit (REPL_ID env present)
 *   2. Supabase Storage       — primary for production (GAE) and Replit fallback
 *   3. Local filesystem       — dev-only last resort; disabled in production
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
import path from "path";
import fs from "fs";

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
 * Local filesystem fallback — saves to <cwd>/uploads/<folder>/<filename>.
 * DISABLED in production to prevent silent data loss on GAE (read-only FS).
 * Returns a URL served via /api/uploads/<folder>/<filename>.
 */
async function uploadToLocalFs(
  folder: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  if (IS_PRODUCTION) {
    throw new Error(
      `[Storage] Local filesystem fallback is disabled in production. ` +
      `Supabase Storage must be configured (SUPABASE_SERVICE_ROLE_KEY). ` +
      `Failed upload: ${folder}/${filename}`,
    );
  }
  const uploadsBase = path.resolve(process.cwd(), "uploads", folder);
  fs.mkdirSync(uploadsBase, { recursive: true });
  const dest = path.join(uploadsBase, filename);
  fs.writeFileSync(dest, buffer);
  return `/api/uploads/${folder}/${filename}`;
}

/**
 * Upload a file to storage.
 *
 * In production (GAE): Supabase only — no Replit sidecar, no local FS.
 * In development: Replit Object Storage → Supabase → local filesystem.
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
  const filename = path.basename(objectPath);

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
    if (IS_PRODUCTION) {
      // In production, never fall through to local FS — throw clearly
      throw new Error(
        `[Storage] Supabase Storage upload failed in production: ${supaErr?.message ?? supaErr}. ` +
        `Check SUPABASE_SERVICE_ROLE_KEY and bucket "${bucket}" configuration.`,
      );
    }
    console.warn(
      `[Storage] Supabase Storage upload failed (${supaErr?.message ?? supaErr}), falling back to local filesystem`,
    );
  }

  // 3. Local filesystem — dev only (disabled in production above)
  console.warn(`[Storage] Using local filesystem fallback for ${folder}/${filename}`);
  return await uploadToLocalFs(folder, filename, buffer);
}

export { BUCKETS };
