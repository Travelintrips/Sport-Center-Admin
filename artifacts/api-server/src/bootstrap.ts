import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadSecretsFromGSM } from "./lib/secretLoader";

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

const rawPort = process.env.PORT?.trim() || "3000";
const port = Number(rawPort);
const host = process.env.HOST?.trim() || "0.0.0.0";

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let startupFailureCode: string | null = null;

function classifyStartupFailure(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message =
    typeof candidate?.message === "string"
      ? candidate.message
      : String(error ?? "");

  if (
    code === "28P01" ||
    /password authentication failed|authentication failed for user/i.test(message)
  ) {
    return "DATABASE_AUTH_FAILED";
  }

  if (
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|connection terminated|server closed the connection|circuit breaker|EMAXCONNSESSION|max clients reached/i.test(
      message,
    )
  ) {
    return "DATABASE_UNAVAILABLE";
  }

  if (/SECRET_BOOTSTRAP_FAILED/i.test(message)) {
    return "SECRET_BOOTSTRAP_FAILED";
  }

  return "STARTUP_INITIALIZATION_FAILED";
}

let requestHandler: RequestHandler = (req, res) => {
  const pathname = (req.url ?? "/").split("?")[0] ?? "/";
  const isHealthProbe =
    pathname === "/health" ||
    pathname === "/healthz" ||
    pathname === "/api/health" ||
    pathname === "/api/healthz";
  const isReadinessProbe =
    pathname === "/readiness" ||
    pathname === "/api/readiness";

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (isHealthProbe) {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        status: startupFailureCode ? "degraded" : "starting",
        service: "sport-center",
      }),
    );
    return;
  }

  if (isReadinessProbe) {
    res.setHeader("Retry-After", startupFailureCode ? "30" : "2");
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        status: startupFailureCode ? "error" : "starting",
        service: "sport-center",
        code: startupFailureCode ?? "STARTUP_INITIALIZATION_PENDING",
      }),
    );
    return;
  }

  res.setHeader("Retry-After", startupFailureCode ? "30" : "2");
  res.statusCode = 503;
  res.end(
    JSON.stringify({
      error: startupFailureCode
        ? "Server belum siap karena inisialisasi runtime gagal."
        : "Server sedang menyiapkan runtime. Coba lagi sebentar.",
      code: startupFailureCode ?? "STARTUP_INITIALIZATION_PENDING",
    }),
  );
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
    throw new Error("SECRET_BOOTSTRAP_FAILED");
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

  // Keep the bootstrap handler active until required runtime initialization
  // has actually succeeded. If the database credential is invalid, the process
  // stays alive in a fail-closed degraded state instead of crash-looping and
  // repeatedly tripping Supavisor's authentication circuit breaker.
  await runtime.initializeRuntime();

  requestHandler = runtime.app as unknown as RequestHandler;
  console.info("[bootstrap] Runtime initialization complete");
}

let initializationInFlight = false;
let initializationRetryTimer: NodeJS.Timeout | null = null;
let initializationAttempt = 0;

async function initializeWithRecovery(): Promise<void> {
  if (initializationInFlight) return;
  initializationInFlight = true;
  initializationAttempt += 1;

  try {
    await initializeAfterListen();
    startupFailureCode = null;
    initializationAttempt = 0;
    if (initializationRetryTimer) {
      clearTimeout(initializationRetryTimer);
      initializationRetryTimer = null;
    }
  } catch (error) {
    startupFailureCode = classifyStartupFailure(error);
    const delayMs = Math.min(60_000, 10_000 * Math.max(1, initializationAttempt));
    console.error(
      "[bootstrap] Runtime initialization failed; scheduling controlled retry",
      { code: startupFailureCode, retryInMs: delayMs, attempt: initializationAttempt },
    );
    if (!initializationRetryTimer) {
      initializationRetryTimer = setTimeout(() => {
        initializationRetryTimer = null;
        void initializeWithRecovery();
      }, delayMs);
      initializationRetryTimer.unref();
    }
  } finally {
    initializationInFlight = false;
  }
}

server.listen(port, host, () => {
  console.info(`[bootstrap] Listening on ${host}:${port}; initializing runtime`);
  void initializeWithRecovery();
});
