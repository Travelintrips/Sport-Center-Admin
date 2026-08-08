import { Router } from "express";
import { adminMiddleware } from "../lib/auth";
import { runConnectionHealthCheck } from "../lib/connectionHealth";

const router = Router();

router.get(
  "/admin/system/connections/health",
  adminMiddleware,
  async (_req, res) => {
    try {
      const connections = await runConnectionHealthCheck("manual");

      const summary = {
        total: connections.length,
        healthy: connections.filter((c) => c.status === "healthy").length,
        warning: connections.filter((c) => c.status === "warning").length,
        error: connections.filter((c) => c.status === "error").length,
        changed: connections.filter((c) => c.status === "changed").length,
        unavailable: connections.filter((c) => c.status === "unavailable").length,
      };

      res.json({
        success: true,
        environment: process.env.NODE_ENV === "development" ? "development" : "production",
        checkedAt: new Date().toISOString(),
        summary,
        connections,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message ?? "Health check failed" });
    }
  }
);

export default router;
