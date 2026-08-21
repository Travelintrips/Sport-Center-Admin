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
 *   - Production has no environment-variable fallback: Secret Manager failure
 *     is fatal and the bootstrap refuses to load the application.
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
  fatal: string[];
}> {
  const loaded: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const fatal: string[] = [];

  const isProd = process.env.NODE_ENV === "production";
  const project = process.env.GOOGLE_CLOUD_PROJECT;

  if (!isProd || !project) {
    if (isProd) fatal.push("GOOGLE_CLOUD_PROJECT");
    return { loaded, skipped, failed, fatal };
  }

  // Production application secrets must come from Secret Manager. Remove any
  // injected values before loading so stale env vars cannot become a fallback.
  for (const envVar of Object.values(SECRET_MAP)) delete process.env[envVar];

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
    failed.push("@google-cloud/secret-manager unavailable");
    fatal.push("@google-cloud/secret-manager");
    return { loaded, skipped, failed, fatal };
  }

  const client = new SecretManagerServiceClient();

  for (const [secretId, envVar] of Object.entries(SECRET_MAP)) {
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

  for (const required of ["SUPABASE_DATABASE_URL", "SESSION_SECRET"]) {
    if (!process.env[required]) fatal.push(required);
  }
  return { loaded, skipped, failed, fatal };
}
