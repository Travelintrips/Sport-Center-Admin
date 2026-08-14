import sharp from "sharp";

type StorageEntry = {
  name: string;
  id?: string | null;
  metadata?: {
    mimetype?: string;
    size?: number;
  } | null;
};

type StorageBucket = { id: string; name: string };

const APPLY = process.argv.includes("--apply");
const requestedBucket = process.argv
  .find((arg) => arg.startsWith("--bucket="))
  ?.slice("--bucket=".length);

if (process.env.NODE_ENV !== "production") {
  throw new Error("Refusing storage image migration unless NODE_ENV=production.");
}
if (!APPLY) {
  console.log("DRY RUN: no files will be changed. Add --apply to upload compressed images.");
}

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const storageApi = `${supabaseUrl}/storage/v1`;
const headers = {
  Authorization: `Bearer ${serviceRoleKey}`,
  apikey: serviceRoleKey,
};

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function storageFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${storageApi}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${detail}`);
  }
  return response;
}

async function listBuckets(): Promise<StorageBucket[]> {
  const response = await storageFetch("/bucket");
  return (await response.json()) as StorageBucket[];
}

async function listFiles(bucket: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  let offset = 0;

  while (true) {
    const response = await storageFetch(`/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    const entries = (await response.json()) as StorageEntry[];
    if (entries.length === 0) break;

    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Supabase represents folders as entries without an id.
      if (entry.id == null) {
        files.push(...await listFiles(bucket, path));
      } else {
        files.push(path);
      }
    }
    if (entries.length < 1000) break;
    offset += entries.length;
  }

  return files;
}

function targetFormat(path: string): "jpeg" | "png" | "webp" | "avif" | null {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  if (ext === "avif") return "avif";
  return null;
}

async function compress(buffer: Buffer, path: string): Promise<{ buffer: Buffer; contentType: string }> {
  const format = targetFormat(path);
  if (!format) return { buffer, contentType: "application/octet-stream" };

  const image = sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    });

  switch (format) {
    case "png":
      return {
        buffer: await image.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toBuffer(),
        contentType: "image/png",
      };
    case "webp":
      return {
        buffer: await image.webp({ quality: 82, effort: 5 }).toBuffer(),
        contentType: "image/webp",
      };
    case "avif":
      return {
        buffer: await image.avif({ quality: 65, effort: 5 }).toBuffer(),
        contentType: "image/avif",
      };
    case "jpeg":
    default:
      return {
        buffer: await image.jpeg({ quality: 82, mozjpeg: true, progressive: true }).toBuffer(),
        contentType: "image/jpeg",
      };
  }
}

async function download(bucket: string, path: string): Promise<Buffer> {
  const response = await storageFetch(`/object/public/${encodeURIComponent(bucket)}/${encodePath(path)}`);
  return Buffer.from(await response.arrayBuffer());
}

async function upload(bucket: string, path: string, buffer: Buffer, contentType: string): Promise<void> {
  await storageFetch(`/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "x-upsert": "true",
      "cache-control": "31536000",
    },
    body: new Uint8Array(buffer),
  });
}

const buckets = requestedBucket
  ? [{ id: requestedBucket, name: requestedBucket }]
  : await listBuckets();

let scanned = 0;
let compressedCount = 0;
let skippedCount = 0;
let savedBytes = 0;

for (const bucket of buckets) {
  const files = await listFiles(bucket.name);
  console.log(`[storage-compress] ${bucket.name}: ${files.length} file(s)`);

  for (const path of files) {
    // Existing URLs are stored in the database, so the migration deliberately
    // keeps each object's path/extension unchanged. Formats that would need a
    // different extension (GIF/HEIC/BMP/TIFF) are left untouched rather than
    // uploading bytes with a misleading content type.
    if (!targetFormat(path)) continue;
    scanned += 1;

    try {
      const original = await download(bucket.name, path);
      const result = await compress(original, path);
      if (result.buffer.length >= original.length) {
        skippedCount += 1;
        console.log(`[skip] ${bucket.name}/${path} — already optimized (${original.length} bytes)`);
        continue;
      }

      const saved = original.length - result.buffer.length;
      savedBytes += saved;
      compressedCount += 1;
      console.log(
        `[${APPLY ? "apply" : "dry-run"}] ${bucket.name}/${path}: ` +
        `${original.length} → ${result.buffer.length} bytes (−${saved} bytes)`,
      );
      if (APPLY) await upload(bucket.name, path, result.buffer, result.contentType);
    } catch (error) {
      throw new Error(`Failed ${bucket.name}/${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(
  `[storage-compress] done: scanned=${scanned}, compressed=${compressedCount}, ` +
  `skipped=${skippedCount}, saved=${savedBytes} bytes, apply=${APPLY}`,
);