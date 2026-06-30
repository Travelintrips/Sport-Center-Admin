import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import { BUCKETS, uploadToStorage } from "../lib/supabaseStorage";
import { uploadToReplitStorage, downloadFromReplitStorage } from "../lib/replitStorage";

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
 * Upload a proof file — tries Supabase Storage first, falls back to Replit Object Storage.
 */
export async function uploadProofWithFallback(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
): Promise<string> {
  const ext = path.extname(originalname).toLowerCase() || ".jpg";
  const objectName = `proof-${randomUUID()}${ext}`;

  try {
    return await uploadToStorage(BUCKETS.proof, objectName, buffer, mimetype);
  } catch (supabaseErr: any) {
    console.warn(
      `[Storage] Supabase upload failed (${supabaseErr?.message ?? supabaseErr}), falling back to Replit Object Storage`,
    );
    return await uploadToReplitStorage("payment-proofs", objectName, buffer, mimetype);
  }
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
 */
router.get("/storage/files/:folder/:filename", async (req: Request, res: Response) => {
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
