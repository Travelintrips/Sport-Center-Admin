import sharp from "sharp";

const MAX_IMAGE_DIMENSION = 2400;

export type CompressedImage = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  wasCompressed: boolean;
};

function imageFormatFromContentType(contentType: string, objectPath: string): "jpeg" | "png" | "webp" | "avif" | null {
  const mime = contentType.toLowerCase().split(";")[0].trim();
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/avif") return "avif";
  if (mime === "image/gif") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "jpeg";
  if (mime.startsWith("image/")) return "webp";

  // Some mobile clients send HEIC/HEIF as image/* or octet-stream. The
  // extension is the only reliable hint in that case.
  const ext = objectPath.toLowerCase().split("?")[0].split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  if (ext === "avif") return "avif";
  if (ext === "heic" || ext === "heif") return "jpeg";
  return null;
}

function replaceExtension(objectPath: string, extension: string): string {
  const queryIndex = objectPath.indexOf("?");
  const pathPart = queryIndex >= 0 ? objectPath.slice(0, queryIndex) : objectPath;
  const suffix = queryIndex >= 0 ? objectPath.slice(queryIndex) : "";
  const dotIndex = pathPart.lastIndexOf(".");
  const slashIndex = pathPart.lastIndexOf("/");
  const base = dotIndex > slashIndex ? pathPart.slice(0, dotIndex) : pathPart;
  return `${base}.${extension}${suffix}`;
}

/**
 * Re-encode supported raster images with a bounded dimension and stripped
 * metadata. If the result is not smaller, keep the original bytes so an
 * already-optimized image is never made larger.
 */
export async function compressImage(
  buffer: Buffer,
  contentType: string,
  objectPath: string,
): Promise<CompressedImage> {
  const format = imageFormatFromContentType(contentType, objectPath);
  if (!format) {
    return {
      buffer,
      contentType,
      extension: objectPath.split(".").pop()?.toLowerCase() ?? "bin",
      wasCompressed: false,
    };
  }

  const image = sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });

  let compressed: Buffer;
  let outputContentType: string;
  let extension: string;

  switch (format) {
    case "png":
      compressed = await image.png({
        compressionLevel: 9,
        adaptiveFiltering: true,
        effort: 10,
      }).toBuffer();
      outputContentType = "image/png";
      extension = "png";
      break;
    case "webp":
      compressed = await image.webp({ quality: 82, effort: 5 }).toBuffer();
      outputContentType = "image/webp";
      extension = "webp";
      break;
    case "avif":
      compressed = await image.avif({ quality: 65, effort: 5 }).toBuffer();
      outputContentType = "image/avif";
      extension = "avif";
      break;
    case "jpeg":
    default:
      compressed = await image.jpeg({
        quality: 82,
        mozjpeg: true,
        progressive: true,
      }).toBuffer();
      outputContentType = "image/jpeg";
      extension = "jpg";
      break;
  }

  // Do not replace a file with a larger version. This also keeps the original
  // bytes for tiny icons and already-optimized images.
  if (compressed.length >= buffer.length) {
    return {
      buffer,
      contentType,
      extension: objectPath.split(".").pop()?.toLowerCase() ?? extension,
      wasCompressed: false,
    };
  }

  return {
    buffer: compressed,
    contentType: outputContentType,
    extension,
    wasCompressed: true,
  };
}

export function isCompressibleImage(contentType: string, objectPath: string): boolean {
  const mime = contentType.toLowerCase().split(";")[0].trim();
  return mime.startsWith("image/") || imageFormatFromContentType(contentType, objectPath) !== null;
}

export { replaceExtension };