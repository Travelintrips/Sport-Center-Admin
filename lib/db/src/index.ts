import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const isProd = process.env.NODE_ENV === "production";

const SUPABASE_PROD_URL = process.env.SUPABASE_DATABASE_URL;
const SUPABASE_DEV_URL  = process.env.SUPABASE_DATABASE_URL_DEV;
const FALLBACK_URL      = process.env.DATABASE_URL;

let connectionString: string | undefined;
let dbSource: string;

if (isProd) {
  // Production: always prefer Supabase prod, then generic fallback
  connectionString = SUPABASE_PROD_URL || FALLBACK_URL;
  dbSource = SUPABASE_PROD_URL
    ? "SUPABASE_DATABASE_URL (prod)"
    : "DATABASE_URL (fallback — no SUPABASE_DATABASE_URL set in prod)";
} else {
  // Development: prefer isolated dev DB, then prod with warning, then Replit fallback
  if (SUPABASE_DEV_URL) {
    connectionString = SUPABASE_DEV_URL;
    dbSource = "SUPABASE_DATABASE_URL_DEV (dev)";
  } else if (SUPABASE_PROD_URL) {
    // No dev DB set — fall back to prod but warn loudly
    connectionString = SUPABASE_PROD_URL;
    dbSource = "SUPABASE_DATABASE_URL (prod — used in dev, SUPABASE_DATABASE_URL_DEV not set)";
    console.warn(
      "[DB] ⚠️  WARNING: SUPABASE_DATABASE_URL_DEV is not set. " +
      "Development environment is connected to the PRODUCTION Supabase database. " +
      "Set SUPABASE_DATABASE_URL_DEV to an isolated dev database to avoid polluting production data."
    );
  } else if (FALLBACK_URL) {
    connectionString = FALLBACK_URL;
    dbSource = "DATABASE_URL (Replit Postgres fallback — no Supabase URL set)";
    console.warn(
      "[DB] ⚠️  WARNING: No Supabase DB URL set. Using DATABASE_URL (Replit Postgres). " +
      "This database may be empty. Set SUPABASE_DATABASE_URL or SUPABASE_DATABASE_URL_DEV."
    );
  }
}

if (!connectionString) {
  throw new Error(
    "No database connection string found. Set SUPABASE_DATABASE_URL (prod), " +
    "SUPABASE_DATABASE_URL_DEV (dev), or DATABASE_URL as fallback."
  );
}

console.info(`[DB] Source: ${dbSource} (NODE_ENV=${process.env.NODE_ENV ?? "not set"})`);

const useSsl = /supabase\.(co|com|in)/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const db = drizzle(pool, { schema });

export { dbSource };
export * from "./schema";
