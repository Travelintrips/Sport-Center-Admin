import { Client } from "@replit/object-storage";

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || undefined;
    _client = new Client({ bucketId });
  }
  return _client;
}

export function isReplitStorageAvailable(): boolean {
  return Boolean(
    (process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN) &&
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID
  );
}

/**
 * Upload a Buffer to Replit Object Storage.
 * Stored at `payment-proofs/{objectName}` (publicly accessible prefix).
 * Returns an absolute URL served via the API proxy endpoint.
 */
export async function uploadToReplitStorage(
  folder: string,
  objectName: string,
  buffer: Buffer,
  _contentType: string,
): Promise<string> {
  const client = getClient();
  const fullPath = `${folder}/${objectName}`;
  const result = await client.uploadFromBytes(fullPath, buffer, { compress: false });
  if (!result.ok) {
    throw new Error(`Replit Object Storage upload failed: ${result.error?.message}`);
  }
  return `/api/storage/files/${folder}/${objectName}`;
}

/**
 * Download a file from Replit Object Storage as a Buffer.
 */
export async function downloadFromReplitStorage(objectPath: string): Promise<{ buffer: Buffer; found: boolean }> {
  try {
    const client = getClient();
    const result = await client.downloadAsBytes(objectPath);
    if (!result.ok) return { buffer: Buffer.alloc(0), found: false };
    return { buffer: result.value[0], found: true };
  } catch {
    return { buffer: Buffer.alloc(0), found: false };
  }
}
