import { Router, type IRouter } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { isStartupReady } from "../lib/startupReadiness";

const router: IRouter = Router();
// Immutable build attestation loaded from the deployed Node.js artifact.
// Missing metadata is reported as unknown rather than claiming a commit.
const buildIdentity = (() => {
  try {
    const location = path.join(path.dirname(fileURLToPath(import.meta.url)), "build-info.json");
    const raw = JSON.parse(readFileSync(location, "utf8")) as { git_commit?: unknown; built_at?: unknown };
    return {
      git_commit: typeof raw.git_commit === "string" && /^[0-9a-f]{40}$/.test(raw.git_commit) ? raw.git_commit : null,
      built_at: typeof raw.built_at === "string" && !Number.isNaN(Date.parse(raw.built_at)) ? raw.built_at : null,
    };
  } catch { return { git_commit: null, built_at: null }; }
})();

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
  const onlyPin = process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  const scope = onlyPin === undefined ? "all"
    : onlyPin === "700" ? "pin700"
      : /^[0-9]{1,8}$/.test(onlyPin) ? "other_pin" : "invalid";
  const nonmemberEnabled = process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED === "true";
  const manualAccessEnabled = process.env.GYM_X904_MANUAL_ACCESS_ENABLED === "true";
  const userWriteEnabled = process.env.GYM_X904_USER_WRITE_ENABLED === "true";
  const actor = Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY);
  const actorConfigured = Number.isSafeInteger(actor) && actor > 0;
  const pin700Eligible = nonmemberEnabled && manualAccessEnabled && userWriteEnabled &&
    actorConfigured && scope !== "invalid" && scope !== "other_pin";
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ...data,
    ...buildIdentity,
    x904NonmemberWorker: {
      nonmemberEnabled,
      manualAccessEnabled,
      userWriteEnabled,
      actorConfigured,
      scope,
      pin700Eligible,
    },
  });
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

  if (!isStartupReady()) {
    res.setHeader("Retry-After", "2");
    res.status(503).json({
      status: "starting",
      db: "not_checked",
      code: "STARTUP_INITIALIZATION_PENDING",
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
    return;
  }

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
