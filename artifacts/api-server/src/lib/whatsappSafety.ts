import { logger } from "./logger";

export type WhatsAppDispatchMode = "production" | "dry-run" | "blocked";
export const DEV_MINA_TEST_RECIPIENT_ENV = "WA_DEV_MINA_TEST_RECIPIENT";

export type WhatsAppProviderSendOptions = {
  nodeEnv?: string;
  dryRun?: string;
  channel?: "mina" | "admin";
  recipient?: string;
  customerTokenConfigured?: boolean;
  allowlistedRecipient?: string;
};

function normalizeRecipient(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || /[,;|]/.test(raw)) return "";

  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits;
}

export function isMinaDevTestRecipient(
  recipient: unknown,
  allowlistedRecipient = process.env[DEV_MINA_TEST_RECIPIENT_ENV],
): boolean {
  const target = normalizeRecipient(recipient);
  const allowed = normalizeRecipient(allowlistedRecipient);
  return Boolean(target && allowed && target === allowed);
}

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

export function allowWhatsAppProviderSend(options: WhatsAppProviderSendOptions = {}): boolean {
  const mode = getWhatsAppDispatchMode(
    options.nodeEnv ?? process.env.NODE_ENV,
    options.dryRun ?? process.env.WA_DRY_RUN,
  );
  if (mode === "production") return true;

  if (mode === "dry-run") {
    logger.info("[WA] DRY RUN — provider dispatch disabled");
    return false;
  }

  const controlledMinaTest =
    options.channel === "mina" &&
    isMinaDevTestRecipient(options.recipient, options.allowlistedRecipient) &&
    options.customerTokenConfigured === true;

  if (controlledMinaTest) {
    logger.warn("[WA] DEV Mina controlled test dispatch allowed for configured recipient");
    return true;
  }

  logger.error(
    {
      nodeEnv: process.env.NODE_ENV,
      waDryRun: process.env.WA_DRY_RUN ?? "(unset)",
      channel: options.channel ?? "unspecified",
    },
    "[WA] FAIL CLOSED — provider dispatch refused outside production",
  );
  return false;
}