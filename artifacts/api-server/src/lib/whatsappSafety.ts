import { logger } from "./logger";

export type WhatsAppDispatchMode = "production" | "dry-run" | "blocked";

/**
 * WhatsApp is an external side effect. Development and test must never be
 * able to reach the provider accidentally, even when an old environment
 * omits WA_DRY_RUN or explicitly sets it to false.
 */
export function getWhatsAppDispatchMode(
  nodeEnv = process.env.NODE_ENV,
  dryRun = process.env.WA_DRY_RUN,
): WhatsAppDispatchMode {
  if (nodeEnv === "production") return "production";
  if (dryRun === "true") return "dry-run";
  return "blocked";
}

export function allowWhatsAppProviderSend(): boolean {
  const mode = getWhatsAppDispatchMode();
  if (mode === "production") return true;

  if (mode === "dry-run") {
    logger.info("[WA] DRY RUN — provider dispatch disabled");
  } else {
    logger.error(
      { nodeEnv: process.env.NODE_ENV, waDryRun: process.env.WA_DRY_RUN ?? "(unset)" },
      "[WA] FAIL CLOSED — provider dispatch refused outside production",
    );
  }
  return false;
}