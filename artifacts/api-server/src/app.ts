import express, { type Express } from "express";
import cors from "cors";
import * as _pinoHttpModule from "pino-http";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pinoHttp: any = (_pinoHttpModule as any).default ?? _pinoHttpModule;
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Resolve directory of this module — works regardless of process.cwd()
// In the bundled dist/index.mjs, import.meta.url = file:///…/artifacts/api-server/dist/index.mjs
const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  // Resolve frontend dist relative to THIS module's compiled location.
  // __moduleDir = …/artifacts/api-server/dist
  // ../../sport-center/dist/public = …/artifacts/sport-center/dist/public
  const frontendDist = path.resolve(__moduleDir, "../../sport-center/dist/public");
  logger.info({ frontendDist, exists: fs.existsSync(frontendDist) }, "[app] frontend dist path");

  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
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
