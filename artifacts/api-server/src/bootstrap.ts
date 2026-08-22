import { loadSecretsFromGSM } from "./lib/secretLoader";

// This file is the only runtime entry point. The application is imported
// dynamically after Secret Manager has populated production env, so modules
// that create the database pool cannot observe stale or arbitrary env values.
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

await import("./index");