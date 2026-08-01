/**
 * envValidation.ts
 * Centralized environment variable audit and startup validation.
 *
 * Categories:
 *   1. REQUIRED_STARTUP   — fatal in production if missing
 *   2. OPTIONAL           — warn in production if missing but app still starts
 *   3. FEATURE_SPECIFIC   — only needed when a particular feature is used
 *   4. BUILD_TIME         — consumed at frontend build time, not backend runtime
 *   5. RUNTIME_BACKEND    — runtime config (PORT, NODE_ENV)
 *
 * Rules:
 *   - Error messages NEVER print the value of a variable.
 *   - Application does NOT fail startup because a FEATURE_SPECIFIC or OPTIONAL
 *     secret is absent.
 *   - In production, REQUIRED_STARTUP variables cause process.exit(1) if missing.
 *   - In development, missing REQUIRED_STARTUP variables are warnings only.
 */

import { logger } from "./logger";

// ─── Variable catalogue ───────────────────────────────────────────────────────

/** Fatal in production if absent. */
const REQUIRED_STARTUP: Array<{ name: string; description: string }> = [
  { name: "SESSION_SECRET",            description: "HMAC key for auth tokens and password hashing" },
  { name: "SUPABASE_DATABASE_URL",     description: "Primary PostgreSQL connection URL (Supabase production DB)" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", description: "Supabase service role key — required for all file uploads/downloads" },
];

/** Warn in production; app degrades gracefully. */
const OPTIONAL: Array<{ name: string; description: string }> = [
  { name: "SUPABASE_URL",             description: "Supabase project URL — required for realtime availability broadcasts" },
  { name: "SUPABASE_ANON_KEY",        description: "Supabase anon key — required for realtime availability broadcasts" },
  { name: "APP_URL",                  description: "Production base URL (e.g. https://sc.travelintrips.co.id) — used in invoice links, WA messages" },
];

/** Only needed when the feature is actively used; no warning at startup. */
export const FEATURE_SPECIFIC: Array<{ name: string; feature: string }> = [
  { name: "FONNTE_TOKEN",                feature: "WhatsApp notifications via Fonnte" },
  { name: "FONNTE_CUSTOMER_TOKEN",       feature: "WhatsApp customer channel (Fonnte)" },
  { name: "FONNTE_ADMIN_WA",             feature: "Admin WhatsApp number override (Fonnte)" },
  { name: "ADMIN_WA_PHONES",             feature: "Comma-separated admin WA numbers override (falls back to DB settings)" },
  { name: "ADMIN_WA_GROUP",             feature: "WhatsApp group ID for admin notifications" },
  { name: "OPENAI_API_KEY",             feature: "AI assistant / AI conversation feature" },
  { name: "GOOGLE_CLIENT_ID",           feature: "Google OAuth / Social login" },
  { name: "GOOGLE_SERVICE_ACCOUNT_JSON", feature: "Google Sheets integration" },
  { name: "GA4_SERVICE_ACCOUNT_JSON",   feature: "Google Analytics GA4 public stats widget" },
  { name: "GA4_PROPERTY_ID",            feature: "Google Analytics GA4 property" },
  { name: "BIZPORTAL_SYNC_API_KEY",     feature: "BizPortal data sync (corporate customer sync)" },
  { name: "CASHIER_TOKEN_SECRET",       feature: "Cashier short-lived token signing (falls back to SESSION_SECRET)" },
  { name: "VAPID_PUBLIC_KEY",           feature: "Web Push notifications (VAPID)" },
  { name: "VAPID_PRIVATE_KEY",          feature: "Web Push notifications (VAPID)" },
  { name: "WATI_API_TOKEN",             feature: "WhatsApp via WATI (alternative to Fonnte)" },
  { name: "WATI_BASE_URL",              feature: "WhatsApp via WATI base URL" },
  { name: "SMTP_FROM",                  feature: "Email delivery (invoice, booking confirmation)" },
  { name: "SMTP_PASS",                  feature: "Email delivery (Gmail app password)" },
];

/**
 * Baked into the frontend bundle at build time — NOT read at backend runtime.
 * Listed here for documentation only.
 */
export const BUILD_TIME_FRONTEND: Array<{ name: string; description: string }> = [
  {
    name: "VITE_PUBLIC_URL",
    description:
      "Canonical public URL for prerendered HTML (e.g. https://sc.travelintrips.co.id). " +
      "Must be set during `pnpm --filter @workspace/sport-center run build`. " +
      "Changing the domain requires a new frontend build — app.yaml env_variables does NOT update an already-built bundle.",
  },
];

/** Platform-provided runtime config — always present on GAE. */
export const RUNTIME_BACKEND: Array<{ name: string; description: string }> = [
  { name: "PORT",     description: "Injected by App Engine Standard — must not be hardcoded" },
  { name: "NODE_ENV", description: "Set to 'production' in app.yaml env_variables" },
];

// ─── Validation ───────────────────────────────────────────────────────────────

export interface EnvValidationResult {
  ok: boolean;
  fatal: string[];
  warnings: string[];
}

/**
 * Validate environment variables at startup.
 *
 * - In production (`NODE_ENV=production`): missing REQUIRED_STARTUP vars are fatal.
 * - In development: missing REQUIRED_STARTUP vars are warnings only.
 * - FEATURE_SPECIFIC vars are never checked here — checked at feature-call time.
 * - Never logs the VALUE of any variable.
 */
export function validateEnv(): EnvValidationResult {
  const isProd = process.env.NODE_ENV === "production";
  const fatal: string[] = [];
  const warnings: string[] = [];

  for (const { name, description } of REQUIRED_STARTUP) {
    if (!process.env[name]) {
      const msg = `"${name}" is not set — ${description}`;
      if (isProd) {
        fatal.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  if (isProd) {
    for (const { name, description } of OPTIONAL) {
      if (!process.env[name]) {
        warnings.push(`"${name}" is not set — ${description} (optional, app will degrade gracefully)`);
      }
    }

    // Dev-only vars in production env are harmless but noisy — warn
    const devOnlyVars = [
      "SUPABASE_DATABASE_URL_DEV",
      "SUPABASE_SERVICE_ROLE_KEY_DEV",
      "SUPABASE_URL_DEV",
      "SUPABASE_ANON_KEY_DEV",
    ];
    for (const name of devOnlyVars) {
      if (process.env[name]) {
        warnings.push(`"${name}" is set in production env — this variable is for development only, remove it`);
      }
    }

    // Dangerous override flags should not be active in production
    if (process.env.ALLOW_DEV_ON_PROD_DB === "true") {
      warnings.push(`"ALLOW_DEV_ON_PROD_DB=true" is set in production — harmless (DB module ignores it), but remove when possible`);
    }
    if (process.env.ALLOW_DEV_ON_PROD_STORAGE === "true") {
      warnings.push(`"ALLOW_DEV_ON_PROD_STORAGE=true" is set in production — harmless (storage module ignores it), but remove when possible`);
    }

    // Production should have APP_URL set (hard to generate correct invoice links otherwise)
    if (!process.env.APP_URL) {
      warnings.push(`"APP_URL" is not set — invoice links and WA messages will use fallback base URL`);
    }
  }

  for (const w of warnings) {
    logger.warn(`[env] ${w}`);
  }

  if (fatal.length > 0) {
    logger.error(
      { missingVars: fatal.map((f) => f.split('"')[1]) }, // log only the variable NAME, never the value
      "[env] FATAL: Required environment variables are missing. Refusing to start.",
    );
    for (const f of fatal) {
      logger.error(`[env] ✗ ${f}`);
    }
  } else if (isProd) {
    logger.info("[env] Production environment validation passed.");
  }

  return { ok: fatal.length === 0, fatal, warnings };
}
