/**
 * Unified storage adapter.
 *
 * All environments use Supabase Storage. There is intentionally no alternate
 * runtime provider or local filesystem fallback, so DEV and production exercise
 * the same persistence path.
 */
import { uploadToStorage, BUCKETS } from "./supabaseStorage";

/**
 * Upload a file to Supabase Storage.
 *
 * Throws when the remote upload fails. Files are never silently dropped or
 * redirected to an environment-specific provider.
 */
export async function uploadFile(
  bucket: string,
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  try {
    return await uploadToStorage(bucket, objectPath, buffer, contentType);
  } catch (err: any) {
    throw new Error(
      `[Storage] Supabase Storage upload failed: ${err?.message ?? err}. ` +
      `Check the configured Supabase storage provider and bucket "${bucket}".`,
    );
  }
}

export { BUCKETS };
