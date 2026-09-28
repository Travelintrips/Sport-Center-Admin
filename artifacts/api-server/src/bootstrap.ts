import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadSecretsFromGSM } from "./lib/secretLoader";

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

const rawPort = process.env.PORT?.trim() || "3000";
const port = Number(rawPort);
const host = process.env.HOST?.trim() || "0.0.0.0";

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let requestHandler: RequestHandler = (req, res) => {
  const pathname = (req.url ?? "/").split("?")[0] ?? "/";
  const isHealthProbe =
    pathname === "/health" ||
    pathname === "/healthz" ||
    pathname === "/api/health" ||
    pathname === "/api/healthz";

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (isHealthProbe) {
    res.statusCode = 200;
    res.end(JSON.stringify({
      status: "starting",
      service: "sport-center",
    }));
    return;
  }

  res.setHeader("Retry-After", "2");
  res.statusCode = 503;
  res.end(JSON.stringify({
    error: "Server sedang menyiapkan runtime. Coba lagi sebentar.",
    code: "STARTUP_INITIALIZATION_PENDING",
  }));
};

const server = createServer((req, res) => requestHandler(req, res));

server.on("error", (error) => {
  console.error("[bootstrap] HTTP server error", error);
  process.exit(1);
});

async function initializeAfterListen(): Promise<void> {
  // Open the Hostinger-assigned port first. Network/database bootstrap happens
  // only after listen() so a slow external dependency cannot trigger the
  // platform's three-second "did not call listen" watchdog.
  const result = await loadSecretsFromGSM();

  if (result.fatal.length > 0) {
    console.error("[secretLoader] Shared secret bootstrap failed:", result.fatal);
    process.exit(1);
  }

  if (result.loaded.length > 0) {
    console.info("[secretLoader] Shared GCP secret access: PASS");
    console.info("[secretLoader] Runtime configuration loaded:", result.loaded);
  }

  if (result.failed.length > 0) {
    console.warn("[secretLoader] Shared GCP secret access warnings:", result.failed);
  }

  // Import application modules only after Secret Manager has populated env.
  // This preserves the existing rule that database/storage clients must never
  // initialize from stale or arbitrary runtime values.
  const runtime = await import("./index");

  // Express can now serve liveness/readiness. Its startup readiness middleware
  // keeps all business traffic fail-closed until initializeRuntime() succeeds.
  requestHandler = runtime.app as unknown as RequestHandler;

  await runtime.initializeRuntime();
  console.info("[bootstrap] Runtime initialization complete");
}

server.listen(port, host, () => {
  console.info(`[bootstrap] Listening on ${host}:${port}; initializing runtime`);
  void initializeAfterListen().catch((error) => {
    console.error("[bootstrap] Runtime initialization failed", error);
    process.exit(1);
  });
});
