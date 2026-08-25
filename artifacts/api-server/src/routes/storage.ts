import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import { downloadFromReplitStorage } from "../lib/replitStorage";
import { uploadFile, BUCKETS } from "../lib/storage";

const router: IRouter = Router();

const uploadProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/octet-stream";
    if (ok) cb(null, true);
    else cb(new Error("Only image or PDF files are allowed"));
  },
});

/**
 * Upload bukti pembayaran — menggunakan Replit Object Storage sebagai primary,
 * Supabase sebagai fallback (via uploadFile di lib/storage.ts).
 */
export async function uploadProofWithFallback(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
): Promise<string> {
  const ext = path.extname(originalname).toLowerCase() || ".jpg";
  const objectName = `proof-${randomUUID()}${ext}`;
  return await uploadFile(BUCKETS.proof, objectName, buffer, mimetype);
}

router.post("/storage/upload-proof", uploadProof.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const url = await uploadProofWithFallback(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "Upload proof error");
    res.status(500).json({ error: "Upload failed" });
  }
});

/**
 * Serve files stored in Replit Object Storage (fallback URLs start with /api/storage/files/).
 *
 * PRODUCTION GUARD: This endpoint is only used for files uploaded via Replit Object Storage
 * (relative URLs like /api/storage/files/...). In production on GAE, all uploads go through
 * Supabase Storage (absolute URLs). This endpoint is disabled in production to prevent
 * accidental attempts to connect to the Replit sidecar at 127.0.0.1:1106, which does not
 * exist outside the Replit environment.
 */
router.get("/storage/files/:folder/:filename", async (req: Request, res: Response) => {
  // Production GAE: Replit sidecar is not available — this endpoint should never be reached
  // because all production uploads use Supabase Storage absolute URLs.
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({
      error: "Replit Object Storage is not available in production. Files should be served via Supabase Storage absolute URLs.",
    });
    return;
  }

  try {
    const objectPath = `${req.params.folder}/${req.params.filename}`;
    if (!objectPath) { res.status(400).send("Missing object path"); return; }

    const { buffer, found } = await downloadFromReplitStorage(objectPath);
    if (!found) { res.status(404).send("File not found"); return; }

    const ext = path.extname(objectPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".heic": "image/heic",
      ".pdf": "application/pdf",
    };
    const contentType = mimeMap[ext] ?? "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(buffer);
  } catch (err) {
    res.status(500).send("Failed to retrieve file");
  }
});

export default router;
