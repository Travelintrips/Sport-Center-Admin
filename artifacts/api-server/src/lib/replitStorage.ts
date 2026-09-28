import type { Client as ReplitObjectStorageClient } from "@replit/object-storage";

type ReplitClientConstructor = typeof import("@replit/object-storage").Client;

let _clientCtorPromise: Promise<ReplitClientConstructor> | null = null;

async function getClientConstructor(): Promise<ReplitClientConstructor> {
  if (!_clientCtorPromise) {
    // Keep the package name runtime-computed so esbuild does not pull the
    // Replit/legacy Google dependency tree into the production startup bundle.
    // This branch is only reached in an actual Replit development runtime.
    const packageName = ["@replit", "object-storage"].join("/");
    _clientCtorPromise = import(packageName).then((mod) => mod.Client as ReplitClientConstructor);
  }
  return _clientCtorPromise;
}

// In production deployment, the sidecar (127.0.0.1:1106) auto-provides the
// correct bucket ID for this project. Do NOT pass the env-var bucket ID because
// the .replit [userenv] may hold a stale value from a previous bucket.
// In dev workspace the sidecar returns an empty bucket ID, so we fall back to
// the env var as a last resort.
async function makeClient(): Promise<ReplitObjectStorageClient> {
  const Client = await getClientConstructor();

  // First: let the sidecar resolve the bucket (correct in Replit runtime).
  const sidecarClient = new Client();

  // Probe whether the sidecar gave us a valid bucket by attempting a cheap
  // exists check. If it throws "A bucket name is needed" we know the sidecar
  // returned an empty ID (dev workspace) and we fall back to the env var.
  try {
    await sidecarClient.list();
    return sidecarClient;
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("bucket name is needed") || msg.includes("bucketId")) {
      // Dev workspace: sidecar has no bucket configured — use env var.
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) throw new Error("Replit Object Storage: no bucket configured");
      return new Client({ bucketId });
    }
    throw err;
  }
}

let _clientPromise: Promise<ReplitObjectStorageClient> | null = null;

function getClientPromise(): Promise<ReplitObjectStorageClient> {
  if (!_clientPromise) {
    _clientPromise = makeClient().catch((err) => {
      // Reset so next call retries
      _clientPromise = null;
      throw err;
    });
  }
  return _clientPromise;
}

export function isReplitStorageAvailable(): boolean {
  return Boolean(process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN);
}

/**
 * Upload a Buffer to Replit Object Storage.
 * Returns a relative URL served via the API proxy endpoint.
 */
export async function uploadToReplitStorage(
  folder: string,
  objectName: string,
  buffer: Buffer,
  _contentType: string,
): Promise<string> {
  const client = await getClientPromise();
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
    const client = await getClientPromise();
    const result = await client.downloadAsBytes(objectPath);
    if (!result.ok) return { buffer: Buffer.alloc(0), found: false };
    return { buffer: result.value[0], found: true };
  } catch {
    return { buffer: Buffer.alloc(0), found: false };
  }
}
