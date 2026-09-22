import { loadSecretsFromGSM } from "./lib/secretLoader";

if (process.env.NODE_ENV === "test") {
  process.env.SKIP_SECRET_MANAGER = "true";
} else {
  const result = await loadSecretsFromGSM();
  if (result.fatal.length > 0) {
    throw new Error(
      `[testSetup] Development Secret Manager bootstrap failed: ${result.fatal.join("; ")}`,
    );
  }
}
