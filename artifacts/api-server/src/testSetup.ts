import { loadSecretsFromGSM } from "./lib/secretLoader";

const result = await loadSecretsFromGSM();
if (result.fatal.length > 0) {
  throw new Error(`[testSetup] Development Secret Manager bootstrap failed: ${result.fatal.join("; ")}`);
}