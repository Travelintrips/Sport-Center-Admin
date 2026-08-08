/**
 * secretLoader.ts
 * Google Secret Manager loader for production GAE.
 *
 * DESIGN:
 *   - Uses Application Default Credentials (ADC), which are automatically
 *     available on App Engine via the runtime service account.
 *   - Reads named secrets from Google Secret Manager at startup and injects
 *     them into process.env so the rest of the app consumes them normally.
 *   - Only runs in production (NODE_ENV=production) and only when the
 *     GOOGLE_CLOUD_PROJECT env var (set automatically by GAE) is present.
 *   - If Secret Manager is unreachable or a secret is missing, logs clearly
 *     but does NOT crash — envValidation.ts will catch missing required vars.
 *   - NEVER logs secret values.
 *
 * USAGE:
 *   Call `await loadSecretsFromGSM()` at the very beginning of index.ts,
 *   before any other module reads from process.env.
 *
 * SECRET NAMING CONVENTION (GCP project: sc-sport-center):
 *   sport-center-prod-supabase-database-url   → SUPABASE_DATABASE_URL
 *   sport-center-prod-supabase-url            → SUPABASE_URL
 *   sport-center-prod-supabase-anon-key       → SUPABASE_ANON_KEY
 *   sport-center-prod-supabase-service-role-key → SUPABASE_SERVICE_ROLE_KEY
 *   sport-center-prod-session-secret          → SESSION_SECRET
 *   sport-center-prod-fonnte-token            → FONNTE_TOKEN
 *   sport-center-prod-openai-api-key          → OPENAI_API_KEY
 *   sport-center-prod-google-service-account-json → GOOGLE_SERVICE_ACCOUNT_JSON
 *   sport-center-prod-google-client-id        → GOOGLE_CLIENT_ID
 *   sport-center-prod-bizportal-sync-api-key  → BIZPORTAL_SYNC_API_KEY
 *   sport-center-prod-cashier-token-secret    → CASHIER_TOKEN_SECRET
 *   sport-center-prod-vapid-public-key        → VAPID_PUBLIC_KEY
 *   sport-center-prod-vapid-private-key       → VAPID_PRIVATE_KEY
 *   sport-center-prod-admin-wa-phones         → ADMIN_WA_PHONES
 *   sport-center-prod-wati-api-token          → WATI_API_TOKEN
 *   sport-center-prod-wati-base-url           → WATI_BASE_URL
 *
 * IAM REQUIREMENTS:
 *   The App Engine default service account (PROJECT_ID@appspot.gserviceaccount.com)
 *   must have `roles/secretmanager.secretAccessor` on each secret above.
 *
 *   Minimum IAM role: roles/secretmanager.secretAccessor
 *   Scope: per-secret (not project-wide) for least privilege.
 *
 * RUNTIME SERVICE ACCOUNT:
 *   App Engine default SA: sc-sport-center@appspot.gserviceaccount.com
 *   DO NOT grant broader roles (e.g. roles/secretmanager.admin) at project level.
 */

/** Maps Secret Manager secret IDs → process.env variable names. */
const SECRET_MAP: Record<string, string> = {
  "sport-center-prod-supabase-database-url":         "SUPABASE_DATABASE_URL",
  "sport-center-prod-supabase-url":                  "SUPABASE_URL",
  "sport-center-prod-supabase-anon-key":             "SUPABASE_ANON_KEY",
  "sport-center-prod-supabase-service-role-key":     "SUPABASE_SERVICE_ROLE_KEY",
  "sport-center-prod-session-secret":                "SESSION_SECRET",
  "sport-center-prod-fonnte-token":                  "FONNTE_TOKEN",
  "sport-center-prod-openai-api-key":                "OPENAI_API_KEY",
  "sport-center-prod-google-service-account-json":   "GOOGLE_SERVICE_ACCOUNT_JSON",
  "sport-center-prod-google-client-id":              "GOOGLE_CLIENT_ID",
  "sport-center-prod-bizportal-sync-api-key":        "BIZPORTAL_SYNC_API_KEY",
  "sport-center-prod-cashier-token-secret":          "CASHIER_TOKEN_SECRET",
  "sport-center-prod-vapid-public-key":              "VAPID_PUBLIC_KEY",
  "sport-center-prod-vapid-private-key":             "VAPID_PRIVATE_KEY",
  "sport-center-prod-admin-wa-phones":               "ADMIN_WA_PHONES",
  "sport-center-prod-wati-api-token":                "WATI_API_TOKEN",
  "sport-center-prod-wati-base-url":                 "WATI_BASE_URL",
};

/**
 * Load secrets from Google Secret Manager into process.env.
 *
 * - Runs only if NODE_ENV=production AND GOOGLE_CLOUD_PROJECT is set.
 * - Skips any variable that is already set in process.env (allows override
 *   via `gcloud app deploy --update-env-vars` for emergency hotfixes).
 * - Non-fatal: logs failures per secret but does not throw.
 * - Returns a summary for startup logs.
 */
export async function loadSecretsFromGSM(): Promise<{
  loaded: string[];
  skipped: string[];
  failed: string[];
}> {
  const loaded: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  const isProd = process.env.NODE_ENV === "production";
  const project = process.env.GOOGLE_CLOUD_PROJECT;

  if (!isProd || !project) {
    // Not running on GAE — skip silently
    return { loaded, skipped, failed };
  }

  let SecretManagerServiceClient: new () => {
    accessSecretVersion(args: {
      name: string;
    }): Promise<[{ payload?: { data?: Buffer | string | null } }]>;
  };

  try {
    // Dynamic import so the package is not required in dev environments.
    // Add @google-cloud/secret-manager to gae-deploy/package.json to enable.
    const mod = await import("@google-cloud/secret-manager" as string);
    SecretManagerServiceClient = mod.SecretManagerServiceClient;
  } catch {
    // Package not installed — log once and bail out gracefully.
    console.warn(
      "[secretLoader] @google-cloud/secret-manager not installed. " +
      "Secrets must be injected via env vars (gcloud app deploy --update-env-vars). " +
      "Add @google-cloud/secret-manager to gae-deploy/package.json to enable ADC loading.",
    );
    return { loaded, skipped, failed };
  }

  const client = new SecretManagerServiceClient();

  for (const [secretId, envVar] of Object.entries(SECRET_MAP)) {
    // If the var is already set, respect the existing value (allows emergency override)
    if (process.env[envVar]) {
      skipped.push(envVar);
      continue;
    }

    const name = `projects/${project}/secrets/${secretId}/versions/latest`;
    try {
      const [version] = await client.accessSecretVersion({ name });
      const raw = version?.payload?.data;
      if (!raw) {
        failed.push(`${envVar} (secret "${secretId}" has empty payload)`);
        continue;
      }
      const value = Buffer.isBuffer(raw) ? raw.toString("utf-8") : String(raw);
      process.env[envVar] = value.trim();
      loaded.push(envVar); // log NAME only, never the value
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Truncate message so secret-like strings don't leak via error text
      const safeMsg = msg.slice(0, 120).replace(/[\r\n]/g, " ");
      failed.push(`${envVar} (secret "${secretId}": ${safeMsg})`);
    }
  }

  return { loaded, skipped, failed };
}
