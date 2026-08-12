import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const NODE_ENV          = process.env.NODE_ENV ?? "development";
const isProd            = NODE_ENV === "production";

const SUPABASE_PROD_URL   = process.env.SUPABASE_DATABASE_URL;
const SUPABASE_DEV_URL    = process.env.SUPABASE_DATABASE_URL_DEV;
const REPLIT_DB_URL       = process.env.DATABASE_URL;
const ALLOW_DEV_ON_PROD   = process.env.ALLOW_DEV_ON_PROD_DB === "true";

let connectionString: string | undefined;
let dbSource: string;
let isDevUsingProdDb = false;

if (isProd) {
  if (SUPABASE_PROD_URL) {
    connectionString = SUPABASE_PROD_URL;
    dbSource = "SUPABASE_DATABASE_URL (prod)";
  } else if (REPLIT_DB_URL) {
    connectionString = REPLIT_DB_URL;
    dbSource = "DATABASE_URL (Replit PostgreSQL — prod)";
  } else {
    console.error(
      "\n╔══════════════════════════════════════════════════════════════════╗\n" +
      "║  FATAL: No database URL configured in production.               ║\n" +
      "║  Set DATABASE_URL or SUPABASE_DATABASE_URL.                     ║\n" +
      "╚══════════════════════════════════════════════════════════════════╝\n"
    );
    process.exit(1);
  }
} else {
  if (ALLOW_DEV_ON_PROD) {
    const devFallback = SUPABASE_PROD_URL || REPLIT_DB_URL;
    if (!devFallback) {
      throw new Error(
        "[DB] ALLOW_DEV_ON_PROD_DB=true but no database URL is set. Cannot start."
      );
    }
    connectionString = devFallback;
    isDevUsingProdDb = Boolean(SUPABASE_PROD_URL);
    dbSource = SUPABASE_PROD_URL
      ? "SUPABASE_DATABASE_URL (prod — ALLOW_DEV_ON_PROD_DB=true, EMERGENCY OVERRIDE)"
      : "DATABASE_URL (ALLOW_DEV_ON_PROD_DB=true)";

    console.warn(
      "\n" +
      "╔══════════════════════════════════════════════════════════════════╗\n" +
      "║  ⚠️   DANGER: DEV IS CONNECTED TO PRODUCTION DATABASE           ║\n" +
      "║  ALLOW_DEV_ON_PROD_DB=true is set.                             ║\n" +
      "║  Any write in development WILL affect production data.          ║\n" +
      "╚══════════════════════════════════════════════════════════════════╝\n"
    );
  } else if (SUPABASE_DEV_URL) {
    connectionString = SUPABASE_DEV_URL;
    dbSource = "SUPABASE_DATABASE_URL_DEV (dev — isolated)";
  } else if (REPLIT_DB_URL) {
    connectionString = REPLIT_DB_URL;
    dbSource = "DATABASE_URL (Replit PostgreSQL — dev)";
  } else {
    throw new Error(
      "\n" +
      "╔══════════════════════════════════════════════════════════════════╗\n" +
      "║  Development DB is not configured.                              ║\n" +
      "║  Set DATABASE_URL (Replit PostgreSQL) or SUPABASE_DATABASE_URL_DEV.\n" +
      "╚══════════════════════════════════════════════════════════════════╝\n"
    );
  }
}

if (!connectionString) {
  throw new Error(
    "[DB] No database connection string resolved. Set DATABASE_URL or SUPABASE_DATABASE_URL."
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
