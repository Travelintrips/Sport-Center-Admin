import express, { type Express } from "express";
import cors from "cors";
import * as _pinoHttpModule from "pino-http";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pinoHttp: any = (_pinoHttpModule as any).default ?? _pinoHttpModule;
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";
import { isStartupReady } from "./lib/startupReadiness";
import path from "path";
import fs from "fs";

const app: Express = express();

const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/api/uploads", express.static(uploadsDir));
app.use("/api/uploads/proofs", express.static(path.join(uploadsDir, "proofs")));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Capture raw body buffer before JSON parsing — needed for Paylabs webhook signature verification.
// express.json() re-serialises req.body which may differ from the original bytes (whitespace, key
// order). Storing the raw buffer lets verifyPaylabsSignature work on the exact bytes Paylabs signed.
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// The development server binds its port before the background schema setup
// completes so the workflow health check can connect. Do not let application
// requests race that setup: otherwise an admin can submit against a table that
// has not been created yet and receive an opaque Drizzle query error.
app.use((req, res, next) => {
  const isHealthProbe =
    req.path === "/health" ||
    req.path === "/healthz" ||
    req.path === "/readiness" ||
    req.path === "/api/health" ||
    req.path === "/api/healthz" ||
    req.path === "/api/readiness";
  if (process.env.NODE_ENV !== "production" && !isStartupReady() && !isHealthProbe) {
    res.setHeader("Retry-After", "2");
    res.status(503).json({
      error: "Server sedang menyiapkan database. Coba lagi sebentar.",
      code: "STARTUP_MIGRATIONS_PENDING",
    });
    return;
  }
  next();
});

// ── Health / readiness endpoints at root level ────────────────────────────────
// Mounted without the /api prefix so App Engine liveness/readiness probes,
// uptime monitors, and the GAE default health check can reach them at:
//   GET /health     — liveness (process alive, no DB query)
//   GET /healthz    — legacy alias for /health
//   GET /readiness  — readiness (lightweight DB SELECT 1)
// They are also available under /api/health etc. via the api router below.
app.use(healthRouter);

app.get("/api", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  // Resolve frontend dist relative to process.cwd() — the server's working
  // directory. This works for both environments:
  //
  //   dev (workspace root):   process.cwd()/artifacts/sport-center/dist/public
  //   gae-deploy (gae-deploy/): process.cwd()/artifacts/sport-center/dist/public
  //
  // cloudbuild.yaml copies the frontend to gae-deploy/artifacts/sport-center/dist/public
  // and GAE starts the process with the deployment directory as cwd.
  const frontendDist = path.resolve(process.cwd(), "artifacts/sport-center/dist/public");
  logger.info({ frontendDist, exists: fs.existsSync(frontendDist) }, "[app] frontend dist path");

  if (fs.existsSync(frontendDist)) {
    // redirect: false — prevent express.static from issuing 301 redirects for
    // /facilities → /facilities/ when a directory exists. The custom route
    // handler below serves the correct prerendered index.html directly.
    app.use(express.static(frontendDist, { redirect: false }));
    // Serve prerendered per-route index.html when it exists (Phase 2 SEO),
    // fall back to root index.html only for routes without a dedicated file.
    app.get("/{*path}", (req, res) => {
      const routeSegment = req.path === "/" ? "" : req.path.replace(/^\//, "").split("/")[0];
      const specificFile =
        routeSegment
          ? path.join(frontendDist, routeSegment, "index.html")
          : path.join(frontendDist, "index.html");
      if (routeSegment && fs.existsSync(specificFile)) {
        res.sendFile(specificFile);
      } else {
        res.sendFile(path.join(frontendDist, "index.html"));
      }
    });
  } else {
    // Frontend dist not found — log loudly so it shows in build logs,
    // but still respond 200 on GET / so the Cloud Run health check passes.
    logger.warn("[app] frontend dist not found — serving API-only mode; GET / returns health stub");
    app.get("/", (_req, res) => {
      res.json({ status: "ok", mode: "api-only" });
    });
  }
}

export default app;
