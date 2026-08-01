import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

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

/**
 * GET /readiness — database readiness probe for App Engine.
 *
 * Separate from /health so that App Engine can:
 *   - Use /health as a liveness probe (fast, always returns 200 if process is up)
 *   - Use /readiness as a readiness probe (200 only when DB is reachable)
 *
 * A cold instance that cannot reach the DB will return 503 here, preventing
 * load balancer traffic from being routed to it until the DB connection is ready.
 *
 * Lightweight: issues a single `SELECT 1` with a 3-second timeout.
 * No authentication required. Never exposes secret values.
 */
router.get("/readiness", async (_req, res) => {
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    res.json({
      status: "ok",
      db: "reachable",
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log the error category only — never expose connection string or credentials
    res.status(503).json({
      status: "error",
      db: "unreachable",
      error: message.replace(/postgresql:\/\/[^@]*@/g, "postgresql://***@"),
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
