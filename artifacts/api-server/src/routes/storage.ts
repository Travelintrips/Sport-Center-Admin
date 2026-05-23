import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

const router: IRouter = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
