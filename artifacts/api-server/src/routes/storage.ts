import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import { BUCKETS, uploadToStorage } from "../lib/supabaseStorage";

const router: IRouter = Router();

const uploadProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

router.post("/storage/upload-proof", uploadProof.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const objectPath = `proof-${randomUUID()}${ext}`;
    const url = await uploadToStorage(
      BUCKETS.proof,
      objectPath,
      req.file.buffer,
      req.file.mimetype,
    );
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "Upload proof error");
    res.status(500).json({ error: "Upload failed" });
  }
});

export default router;
