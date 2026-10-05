import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const NODE_ENV          = process.env.NODE_ENV ?? "development";
const isProd            = NODE_ENV === "production";

const SUPABASE_PROD_URL   = process.env.SUPABASE_DATABASE_URL;
const SUPABASE_DEV_URL    = process.env.SUPABASE_DATABASE_URL_DEV;
const ALLOW_DEV_ON_PROD   = process.env.ALLOW_DEV_ON_PROD_DB === "true";

let connectionString: string | undefined;
let dbSource: string;
let isDevUsingProdDb = false;

if (ALLOW_DEV_ON_PROD) {
  throw new Error(
    "[DB] ALLOW_DEV_ON_PROD_DB is no longer supported. " +
    "Development and production must use separate Supabase databases."
  );
}

if (isProd) {
  if (!SUPABASE_PROD_URL) {
    throw new Error(
      "[DB] Production database is not configured. " +
      "Set SUPABASE_DATABASE_URL (production Supabase PostgreSQL)."
    );
  }
  connectionString = SUPABASE_PROD_URL;
  dbSource = "SUPABASE_DATABASE_URL (prod)";
} else {
  if (!SUPABASE_DEV_URL) {
    throw new Error(
      "[DB] Development database is not configured. " +
      "Set SUPABASE_DATABASE_URL_DEV (development Supabase PostgreSQL)."
    );
  }
  if (SUPABASE_PROD_URL && SUPABASE_DEV_URL === SUPABASE_PROD_URL) {
    throw new Error(
      "[DB] Development and production point to the same Supabase database. " +
      "Set a distinct SUPABASE_DATABASE_URL_DEV."
    );
  }
  connectionString = SUPABASE_DEV_URL;
  dbSource = "SUPABASE_DATABASE_URL_DEV (dev — isolated)";
}

if (!connectionString) {
  throw new Error(
    "[DB] No database connection string resolved for this environment."
  );
}

console.info(
  `[DB] Source: ${dbSource} | NODE_ENV=${NODE_ENV} | ` +
  `isDevUsingProdDb=${isDevUsingProdDb} | allowDevOnProd=${ALLOW_DEV_ON_PROD}`
);

const useSsl = /supabase\.(co|com|in)/.test(connectionString);

const configuredPoolMax = Number(process.env.DB_POOL_MAX);
const poolMax =
  Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
    ? Math.max(1, Math.min(isProd ? 1 : 5, Math.floor(configuredPoolMax)))
    : isProd
      ? 1
      : 5;

export const pool = new Pool({
  connectionString,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  // Semua aplikasi production berbagi project Supabase yang sama. Jangan biarkan
  // satu Hostinger process memakai default pg-pool=10 dan menghabiskan limit
  // Supavisor session pool saat rolling deploy.
  max: poolMax,
  // Keep one authenticated production connection warm. Supavisor's auth
  // circuit breaker is triggered by other stale Hostinger postgres clients;
  // repeatedly closing our valid app connection after five seconds forces a
  // fresh authentication and makes login/booking intermittently fail even
  // though the existing connection was healthy.
  idleTimeoutMillis: isProd ? 10 * 60_000 : 30_000,
  connectionTimeoutMillis: 8_000,
  query_timeout: 20_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  allowExitOnIdle: false,
  application_name: "sport-center-admin",
});

// node-postgres emits "error" on the Pool when an idle client is terminated by
// the backend/network. Without a listener EventEmitter treats it as uncaught
// and can terminate the whole Node process. The pool discards that client;
// subsequent queries obtain a fresh connection.
pool.on("error", (err) => {
  const error = err as NodeJS.ErrnoException;
  console.error(
    `[DB] Idle PostgreSQL client error; connection discarded (code=${error.code ?? "unknown"}): ${error.message}`,
  );
});

export const db = drizzle(pool, { schema });

export { dbSource, isDevUsingProdDb, NODE_ENV as dbEnvironment };
export const allowDevOnProdDb = ALLOW_DEV_ON_PROD;

export * from "./schema";
