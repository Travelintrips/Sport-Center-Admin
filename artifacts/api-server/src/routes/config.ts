import { Router } from "express";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

router.get("/config/public", (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
});

router.post("/internal/migrate-prod", (req, res) => {
  const token = req.headers["x-migrate-token"];
  if (token !== process.env.SESSION_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const prodUrl = process.env.PROD_DATABASE_URL;
  if (!prodUrl) {
    res.status(400).json({ error: "PROD_DATABASE_URL not set" });
    return;
  }
  try {
    const dbDir = path.resolve(fileURLToPath(import.meta.url), "../../../../../../lib/db");
    execSync("pnpm run push", {
      cwd: dbDir,
      env: { ...process.env, DATABASE_URL: prodUrl },
      stdio: "pipe",
    });
    res.json({ success: true, message: "Production DB schema pushed successfully" });
  } catch (err: any) {
    res.status(500).json({ error: "Migration failed", detail: err.stderr?.toString() });
  }
});

export default router;
