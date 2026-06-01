import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import multer from "multer";

const router: IRouter = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const PROOFS_DIR = path.join(UPLOADS_DIR, "proofs");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });

const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROOFS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const uploadProof = multer({
  storage: proofStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

router.post("/storage/upload-proof", uploadProof.single("file"), (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const url = `/api/uploads/proofs/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  try {
    const { name, contentType } = req.body;
    const ext = name ? path.extname(name) : "";
    const objectId = randomUUID();
    const filename = `${objectId}${ext}`;
    const objectPath = `/api/uploads/${filename}`;

    res.json({
      uploadURL: objectPath,
      objectPath,
      metadata: { name, contentType },
    });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const localPath = path.join(UPLOADS_DIR, filePath);
    if (!fs.existsSync(localPath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.sendFile(localPath);
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const localPath = path.join(UPLOADS_DIR, wildcardPath);
    if (!fs.existsSync(localPath)) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    res.sendFile(localPath);
  } catch (error) {
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
