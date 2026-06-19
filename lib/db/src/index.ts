import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const NODE_ENV          = process.env.NODE_ENV ?? "development";
const isProd            = NODE_ENV === "production";
const isDev             = !isProd;

const SUPABASE_PROD_URL   = process.env.SUPABASE_DATABASE_URL;
const SUPABASE_DEV_URL    = process.env.SUPABASE_DATABASE_URL_DEV;
const FALLBACK_URL        = process.env.DATABASE_URL;
const ALLOW_DEV_ON_PROD   = process.env.ALLOW_DEV_ON_PROD_DB === "true";

let connectionString: string | undefined;
let dbSource: string;
let isDevUsingProdDb = false;

// ── Production ────────────────────────────────────────────────────────────────
if (isProd) {
  if (!SUPABASE_PROD_URL) {
    console.error(
      "\n╔══════════════════════════════════════════════════════════════════╗\n" +
      "║  FATAL: SUPABASE_DATABASE_URL is not set in production.         ║\n" +
      "║                                                                  ║\n" +
      "║  Production MUST use the dedicated Supabase Postgres database.  ║\n" +
      "║  Set SUPABASE_DATABASE_URL in the production environment.       ║\n" +
      "╚══════════════════════════════════════════════════════════════════╝\n"
    );
    process.exit(1);
  }
  connectionString = SUPABASE_PROD_URL;
  dbSource = "SUPABASE_DATABASE_URL (prod)";

// ── Development ───────────────────────────────────────────────────────────────
} else {
  if (ALLOW_DEV_ON_PROD) {
    // Emergency override — dev deliberately routed to prod
    if (!SUPABASE_PROD_URL && !FALLBACK_URL) {
      throw new Error(
        "[DB] ALLOW_DEV_ON_PROD_DB=true but neither SUPABASE_DATABASE_URL nor DATABASE_URL is set. " +
        "Cannot start. Provide at least one database URL."
      );
    }
    connectionString = SUPABASE_PROD_URL || FALLBACK_URL;
    isDevUsingProdDb = Boolean(SUPABASE_PROD_URL);
    dbSource = SUPABASE_PROD_URL
      ? "SUPABASE_DATABASE_URL (prod — ALLOW_DEV_ON_PROD_DB=true, EMERGENCY OVERRIDE)"
      : "DATABASE_URL (fallback — ALLOW_DEV_ON_PROD_DB=true)";

    console.warn(
      "\n" +
      "╔══════════════════════════════════════════════════════════════════╗\n" +
      "║  ⚠️   DANGER: DEV IS CONNECTED TO PRODUCTION DATABASE           ║\n" +
      "║  ALLOW_DEV_ON_PROD_DB=true is set.                             ║\n" +
      "║  Any write in development WILL affect production data.          ║\n" +
      "║  Set SUPABASE_DATABASE_URL_DEV and remove this override ASAP.  ║\n" +
      "╚══════════════════════════════════════════════════════════════════╝\n"
    );

  } else if (SUPABASE_DEV_URL) {
    connectionString = SUPABASE_DEV_URL;
    dbSource = "SUPABASE_DATABASE_URL_DEV (dev — isolated)";

  } else if (FALLBACK_URL) {
    connectionString = FALLBACK_URL;
    dbSource = "DATABASE_URL (dev — local heliumdb)";

  } else {
    // GUARD: no dev DB, no override — refuse to start
    throw new Error(
      "\n" +
      "╔══════════════════════════════════════════════════════════════════╗\n" +
      "║  Development DB is not configured.                              ║\n" +
      "║                                                                  ║\n" +
      "║  To fix, choose one of:                                         ║\n" +
      "║  1. Set SUPABASE_DATABASE_URL_DEV to your dev database URL.     ║\n" +
      "║     (recommended — fully isolated from production)              ║\n" +
      "║                                                                  ║\n" +
      "║  2. Set ALLOW_DEV_ON_PROD_DB=true to allow dev to use the       ║\n" +
      "║     production database temporarily (EMERGENCY ONLY).           ║\n" +
      "║     This WILL expose production data to dev writes.             ║\n" +
      "╚══════════════════════════════════════════════════════════════════╝\n"
    );
  }
}

if (!connectionString) {
  throw new Error(
    "[DB] No database connection string resolved. " +
    "Set SUPABASE_DATABASE_URL (prod) or SUPABASE_DATABASE_URL_DEV (dev)."
  );
}

console.info(
  `[DB] Source: ${dbSource} | NODE_ENV=${NODE_ENV} | ` +
  `isDevUsingProdDb=${isDevUsingProdDb} | allowDevOnProd=${ALLOW_DEV_ON_PROD}`
);

const useSsl = /supabase\.(co|com|in)/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const db = drizzle(pool, { schema });

export { dbSource, isDevUsingProdDb, NODE_ENV as dbEnvironment };
export const allowDevOnProdDb = ALLOW_DEV_ON_PROD;

export * from "./schema";
