import express, { type Express } from "express";
import cors from "cors";
import * as _pinoHttpModule from "pino-http";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pinoHttp: any = (_pinoHttpModule as any).default ?? _pinoHttpModule;
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
import fs from "fs";

// ── AI KERNEL v2: DB ENGINE GUARD ─────────────────────────────────────────
// Only Supabase PostgreSQL is permitted. Any other DB engine is a kernel violation.
const dbUrl =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.DATABASE_URL ||
  "";
if (dbUrl && !/supabase\.(co|com|in)/.test(dbUrl)) {
  throw new Error(
    "[KERNEL VIOLATION] Invalid DB engine. Only Supabase PostgreSQL is allowed.\n" +
    "Set SUPABASE_DATABASE_URL or SUPABASE_DATABASE_URL_DEV to a valid Supabase URL."
  );
}

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
  const frontendDist = path.resolve(process.cwd(), "artifacts/sport-center/dist/public");
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
  }
}

export default app;
