import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /health — lightweight health check for App Engine and load balancers.
 * - No authentication required
 * - No secrets exposed
 * - No heavy DB queries
 * Returns 200 + { status: "ok", uptime, timestamp }
 */
router.get("/health", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /healthz — legacy alias kept for backwards compatibility.
 * Prefer /health for new integrations.
 */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
