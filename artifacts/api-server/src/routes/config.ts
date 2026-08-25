import { Router } from "express";

const router = Router();

router.get("/config/public", (_req, res) => {
  const isDev = process.env.NODE_ENV !== "production";
  res.json({
    supabaseUrl: isDev
      ? (process.env.SUPABASE_URL_DEV || process.env.SUPABASE_URL || "")
      : (process.env.SUPABASE_URL || ""),
    supabaseAnonKey: isDev
      ? (process.env.SUPABASE_ANON_KEY_DEV || process.env.SUPABASE_ANON_KEY || "")
      : (process.env.SUPABASE_ANON_KEY || ""),
  });
});

export default router;
