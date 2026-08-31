/**
 * Shared Google Secret Manager loader.
 *
 * One GCP secret contains separate `dev` and `prod` sections. The runtime
 * environment, never the secret name, decides which section is used.
 * Secret values and bootstrap credentials are never logged.
 */

type JsonObject = Record<string, unknown>;

type BootstrapConfig = {
  credentials?: JsonObject;
  projectId?: string;
  secretId?: string;
};

type LoadResult = {
  loaded: string[];
  skipped: string[];
  failed: string[];
  fatal: string[];
};

const ENV_KEYS = [
  "SUPABASE_DATABASE_URL",
  "SUPABASE_DATABASE_URL_DEV",
  "SUPABASE_PROD_AUDIT_DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_URL_DEV",
  "SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY_DEV",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY_DEV",
  "SUPABASE_STORAGE_BUCKET",
  "SUPABASE_STORAGE_BUCKET_DEV",
  "SESSION_SECRET",
  "FONNTE_TOKEN",
  "OPENAI_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_CLIENT_ID",
  "BIZPORTAL_SYNC_API_KEY",
  "CASHIER_TOKEN_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "ADMIN_WA_PHONES",
  "WATI_API_TOKEN",
  "WATI_BASE_URL",
  "MERCHANT_ID_SANDBOX",
  "PAYLABS_SANDBOX_PRIVATE_KEY",
  "PAYLABS_SANDBOX_PUBLIC_KEY",
  "MERCHANT_ID_PROD",
  "PAYLABS_PROD_PRIVATE_KEY",
  "PAYLABS_PROD_PUBLIC_KEY",
];

// These values are explicitly global/shared in the existing application.
// They may remain in the runtime environment when the GCP payload omits them.
const SHARED_RUNTIME_ENV_KEYS = new Set(["SESSION_SECRET"]);

const FIELD_ALIASES: Record<string, string[]> = {
  database_url: [
    "database_url",
    "SUPABASE_DATABASE_URL",
    "SUPABASE_PG_URL",
    "supabase_database_url",
  ],
  production_audit_database_url: [
    "production_audit_database_url",
    "SUPABASE_PROD_AUDIT_DATABASE_URL",
    "supabase_prod_audit_database_url",
  ],
  supabase_url: ["supabase_url", "SUPABASE_URL"],
  supabase_anon_key: [
    "supabase_anon_key",
    "supabase_key",
    "SUPABASE_ANON_KEY",
    "SUPABASE_KEY",
  ],
  supabase_service_role_key: [
    "supabase_service_role_key",
    "SUPABASE_SERVICE_ROLE_KEY",
  ],
  supabase_storage_bucket: ["supabase_storage_bucket", "SUPABASE_STORAGE_BUCKET"],
  session_secret: ["session_secret", "SESSION_SECRET"],
  fonnte_token: ["fonnte_token", "FONNTE_TOKEN"],
  openai_api_key: ["openai_api_key", "OPENAI_API_KEY"],
  google_service_account_json: [
    "google_service_account_json",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
  ],
  google_client_id: ["google_client_id", "GOOGLE_CLIENT_ID"],
  bizportal_sync_api_key: ["bizportal_sync_api_key", "BIZPORTAL_SYNC_API_KEY"],
  cashier_token_secret: ["cashier_token_secret", "CASHIER_TOKEN_SECRET"],
  vapid_public_key: ["vapid_public_key", "VAPID_PUBLIC_KEY"],
  vapid_private_key: ["vapid_private_key", "VAPID_PRIVATE_KEY"],
  admin_wa_phones: ["admin_wa_phones", "ADMIN_WA_PHONES"],
  wati_api_token: ["wati_api_token", "WATI_API_TOKEN"],
  wati_base_url: ["wati_base_url", "WATI_BASE_URL"],
  merchant_id_sandbox: ["merchant_id_sandbox", "MERCHANT_ID_SANDBOX"],
  paylabs_sandbox_private_key: [
    "paylabs_sandbox_private_key",
    "PAYLABS_SANDBOX_PRIVATE_KEY",
  ],
  paylabs_sandbox_public_key: [
    "paylabs_sandbox_public_key",
    "PAYLABS_SANDBOX_PUBLIC_KEY",
  ],
  merchant_id_prod: ["merchant_id_prod", "MERCHANT_ID_PROD"],
  paylabs_prod_private_key: [
    "paylabs_prod_private_key",
    "PAYLABS_PROD_PRIVATE_KEY",
  ],
  paylabs_prod_public_key: [
    "paylabs_prod_public_key",
    "PAYLABS_PROD_PUBLIC_KEY",
  ],
};

function runtimeEnvironment(): "dev" | "prod" | "audit" | undefined {
  const value = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "")
    .trim()
    .toLowerCase();
  if (value === "dev" || value === "development") return "dev";
  if (value === "prod" || value === "production") return "prod";
  if (value === "audit" || value === "production-audit") return "audit";
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findField(section: JsonObject, field: string): string | undefined {
  const aliases = FIELD_ALIASES[field] ?? [field];
  for (const alias of aliases) {
    const value = stringValue(section[alias]);
    if (value) return value;
  }
  return undefined;
}

function parseBootstrap(raw: string): BootstrapConfig {
  const parsed = JSON.parse(raw) as JsonObject;
  const projectId =
    stringValue(parsed.GCP_PROJECT_ID) ??
    stringValue(parsed.project_id) ??
    stringValue(parsed.projectId);
  const secretId =
    stringValue(parsed.GCP_SECRET_ID) ??
    stringValue(parsed.secret_id) ??
    stringValue(parsed.secretId) ??
    stringValue(parsed.secretName);
  const credentials =
    (parsed.credentials as JsonObject | undefined) ??
    (parsed.serviceAccount as JsonObject | undefined) ??
    parsed;
  return { credentials, projectId, secretId };
}

const SHARED_FIELDS = new Set([
  "SESSION_SECRET",
  "FONNTE_TOKEN",
  "OPENAI_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_CLIENT_ID",
  "BIZPORTAL_SYNC_API_KEY",
  "CASHIER_TOKEN_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "ADMIN_WA_PHONES",
  "WATI_API_TOKEN",
  "WATI_BASE_URL",
  "SMTP_FROM",
  "SMTP_PASS",
]);

const PROD_FIELDS = new Set([
  "SUPABASE_DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "MERCHANT_ID_PROD",
  "PAYLABS_PROD_PRIVATE_KEY",
  "PAYLABS_PROD_PUBLIC_KEY",
]);

// Sandbox credentials belong only to the development section. Keeping this
// separate from SHARED_FIELDS prevents a production runtime from importing
// merchant test credentials from a flat shared payload.
const DEV_FIELDS = new Set([
  "MERCHANT_ID_SANDBOX",
  "PAYLABS_SANDBOX_PRIVATE_KEY",
  "PAYLABS_SANDBOX_PUBLIC_KEY",
]);

function flatPayloadSection(payload: JsonObject, env: "dev" | "prod"): JsonObject {
  const section: JsonObject = {};
  for (const [key, value] of Object.entries(payload)) {
    if (env === "dev" && (key.endsWith("_DEV") || DEV_FIELDS.has(key))) {
      const normalizedKey = key.endsWith("_DEV") ? key.slice(0, -4) : key;
      section[normalizedKey] = value;
    } else if (env === "prod" && (PROD_FIELDS.has(key) || SHARED_FIELDS.has(key))) {
      section[key] = value;
    } else if (SHARED_FIELDS.has(key)) {
      // Explicitly classified shared values are safe in either section.
      section[key] = value;
    }
  }
  return section;
}

function selectedSection(payload: JsonObject, env: "dev" | "prod" | "audit"): JsonObject | undefined {
  const section =
    env === "audit"
      ? payload.production ?? payload.prod
      : payload[env] ?? payload[env === "dev" ? "development" : "production"];
  if (section && typeof section === "object" && !Array.isArray(section)) {
    const shared = payload.shared;
    return {
      ...(shared && typeof shared === "object" && !Array.isArray(shared)
        ? (shared as JsonObject)
        : {}),
      ...(section as JsonObject),
    };
  }
  const flat = env === "audit" ? undefined : flatPayloadSection(payload, env);
  if (!flat) return undefined;
  return Object.keys(flat).length > 0 ? flat : undefined;
}

function setEnvironmentConfig(section: JsonObject, env: "dev" | "prod"): string[] {
  for (const key of ENV_KEYS) {
    if (!SHARED_RUNTIME_ENV_KEYS.has(key)) delete process.env[key];
  }

  const suffix = env === "dev" ? "_DEV" : "";
  const loaded: string[] = [];
  const mappings: Array<[string, string]> = [
    ["database_url", `SUPABASE_DATABASE_URL${suffix}`],
    ["supabase_url", `SUPABASE_URL${suffix}`],
    ["supabase_anon_key", `SUPABASE_ANON_KEY${suffix}`],
    ["supabase_service_role_key", `SUPABASE_SERVICE_ROLE_KEY${suffix}`],
    ["supabase_storage_bucket", `SUPABASE_STORAGE_BUCKET${suffix}`],
    ["session_secret", "SESSION_SECRET"],
    ["fonnte_token", "FONNTE_TOKEN"],
    ["openai_api_key", "OPENAI_API_KEY"],
    ["google_service_account_json", "GOOGLE_SERVICE_ACCOUNT_JSON"],
    ["google_client_id", "GOOGLE_CLIENT_ID"],
    ["bizportal_sync_api_key", "BIZPORTAL_SYNC_API_KEY"],
    ["cashier_token_secret", "CASHIER_TOKEN_SECRET"],
    ["vapid_public_key", "VAPID_PUBLIC_KEY"],
    ["vapid_private_key", "VAPID_PRIVATE_KEY"],
    ["admin_wa_phones", "ADMIN_WA_PHONES"],
    ["wati_api_token", "WATI_API_TOKEN"],
    ["wati_base_url", "WATI_BASE_URL"],
  ];

  for (const [field, envKey] of mappings) {
    const value = findField(section, field);
    if (value) {
      process.env[envKey] = value;
      loaded.push(envKey);
    }
  }
  return loaded;
}

function validationFailure(section: JsonObject): string[] {
  return ["database_url", "session_secret"]
    .filter((field) => !findField(section, field) && !(field === "session_secret" && process.env.SESSION_SECRET))
    .map((field) => `${field} (required field missing)`);
}

function safeError(err: unknown): string {
  const error = err as { name?: unknown; code?: unknown; details?: unknown; message?: unknown };
  const name = typeof error.name === "string" ? error.name : "Error";
  const code =
    typeof error.code === "string" || typeof error.code === "number"
      ? String(error.code)
      : "unknown";
  const details = typeof error.details === "string" ? error.details.slice(0, 120) : "";
  const message = typeof error.message === "string" ? error.message.slice(0, 120) : "";
  return `${name} (${code}) ${message}${details ? ` ${details}` : ""}`
    .replace(/[\r\n]/g, " ")
    .replace(/(private[_ -]?key|access[_ -]?token|password|secret[_ -]?payload|postgres(?:ql)?:\/\/)[^ ]*/gi, "$1=[redacted]");
}

async function accessSharedSecret(
  projectId: string,
  secretId: string,
  credentials?: JsonObject,
): Promise<JsonObject> {
  const raw = await accessSecretValue(projectId, secretId, credentials);
  const payload = JSON.parse(raw) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Shared secret payload must be a JSON object");
  }
  return payload as JsonObject;
}

async function accessSecretValue(
  projectId: string,
  secretId: string,
  credentials?: JsonObject,
): Promise<string> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = credentials
    ? new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] })
    : new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const response = await client.request<{ payload?: { data?: string | Buffer } }>({
    url:
      `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/secrets/${encodeURIComponent(secretId)}/versions/latest:access`,
  });
  const encoded = response.data?.payload?.data;
  if (!encoded) throw new Error("Secret Manager returned an empty payload");
  return Buffer.isBuffer(encoded)
    ? encoded.toString("utf8")
    : Buffer.from(encoded, "base64").toString("utf8");
}

/**
 * Load exactly one environment section from the shared GCP secret.
 */
export async function loadSecretsFromGSM(): Promise<LoadResult> {
  const result: LoadResult = { loaded: [], skipped: [], failed: [], fatal: [] };
  const env = runtimeEnvironment();
  if (!env) {
    result.fatal.push("Unsupported or missing runtime environment");
    return result;
  }
  if (env === "audit") {
    result.fatal.push("Production audit environment requires the dedicated audit loader");
    return result;
  }

  const bootstrapRaw = process.env.GCP_SECRET_MANAGER_BOOTSTRAP_JSON;
  let bootstrap: BootstrapConfig = {};
  try {
    if (bootstrapRaw) bootstrap = parseBootstrap(bootstrapRaw);
  } catch {
    result.fatal.push("Bootstrap JSON is invalid");
    return result;
  }

  const projectId =
    process.env.GCP_PROJECT_ID ??
    bootstrap.projectId ??
    (env === "prod" ? process.env.GOOGLE_CLOUD_PROJECT : undefined);
  const secretId = process.env.GCP_SECRET_ID ?? bootstrap.secretId;
  if (!projectId) result.fatal.push("GCP project ID is missing");
  if (!secretId) result.fatal.push("GCP secret ID is missing");
  if (result.fatal.length) return result;

  try {
    const payload = await accessSharedSecret(projectId as string, secretId as string, bootstrap.credentials);
    const section = selectedSection(payload, env);
    if (!section) {
      result.fatal.push(`${env.toUpperCase()} configuration is missing in shared GCP secret`);
      return result;
    }
    const missing = validationFailure(section);
    if (missing.length) {
      result.fatal.push(`${env.toUpperCase()} configuration validation failed: ${missing.join(", ")}`);
      return result;
    }
    result.loaded = setEnvironmentConfig(section, env);
    if (!result.loaded.includes(`SUPABASE_DATABASE_URL${env === "dev" ? "_DEV" : ""}`)) {
      result.fatal.push("database_url could not be loaded");
    }
  } catch (err) {
    result.failed.push(`Secret Manager access failed: ${safeError(err)}`);
    result.fatal.push("Shared GCP secret access failed");
  }
  return result;
}


/** Kept as a compatibility export for callers that used the old DEV-specific name. */
export async function loadDevDatabaseSecretFromGSM(): Promise<{ loaded: boolean; fatal: string[] }> {
  if (runtimeEnvironment() !== "dev") return { loaded: false, fatal: [] };
  const result = await loadSecretsFromGSM();
  return { loaded: result.loaded.includes("SUPABASE_DATABASE_URL_DEV"), fatal: result.fatal };
}

/**
 * Load only the dedicated production audit URL.
 *
 * Unlike the application loader, this path never maps application database
 * credentials, service keys, or session settings into the process.
 */
export async function loadProductionAuditDatabaseSecretFromGSM(): Promise<LoadResult> {
  const result: LoadResult = { loaded: [], skipped: [], failed: [], fatal: [] };
  if (runtimeEnvironment() !== "audit") {
    result.fatal.push("Production audit loader requires production-audit environment");
    return result;
  }

  const bootstrapRaw = process.env.GCP_SECRET_MANAGER_BOOTSTRAP_JSON;
  if (!bootstrapRaw) {
    result.skipped.push("GCP_SECRET_MANAGER_BOOTSTRAP_JSON is unavailable");
    return result;
  }

  let bootstrap: BootstrapConfig = {};
  try {
    bootstrap = parseBootstrap(bootstrapRaw);
  } catch {
    result.fatal.push("Bootstrap JSON is invalid");
    return result;
  }

  const projectId =
    process.env.GCP_PROJECT_ID ??
    bootstrap.projectId ??
    process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) result.fatal.push("GCP project ID is missing");
  if (result.fatal.length) return result;

  try {
    const auditUrl = await accessSecretValue(
      projectId as string,
      "SUPABASE_PROD_AUDIT_DATABASE_URL",
      bootstrap.credentials,
    );
    if (!auditUrl.trim()) throw new Error("Production audit secret is empty");
    process.env.SUPABASE_PROD_AUDIT_DATABASE_URL = auditUrl.trim();
    result.loaded.push("SUPABASE_PROD_AUDIT_DATABASE_URL");
  } catch (err) {
    const safe = safeError(err);
    if (/\b404\b|not found|does not exist/i.test(safe)) {
      result.skipped.push("SUPABASE_PROD_AUDIT_DATABASE_URL is unavailable");
    } else {
      result.failed.push(`Secret Manager access failed: ${safe}`);
      result.fatal.push("Production audit secret access failed");
    }
  }
  return result;
}