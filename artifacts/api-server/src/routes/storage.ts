import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import { uploadFile, BUCKETS } from "../lib/storage";
import { adminMiddleware } from "../lib/auth";

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

/** Upload bukti pembayaran ke Supabase Storage. */
export async function uploadProofWithFallback(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
): Promise<string> {
  const ext = path.extname(originalname).toLowerCase() || ".jpg";
  const objectName = `proof-${randomUUID()}${ext}`;
  return await uploadFile(BUCKETS.proof, objectName, buffer, mimetype);
}

router.post("/storage/upload-proof", adminMiddleware, uploadProof.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const url = await uploadProofWithFallback(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "Upload proof error");
    res.status(500).json({ error: "Upload failed" });
  }
});


export default router;
