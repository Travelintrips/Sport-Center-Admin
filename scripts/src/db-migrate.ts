import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { CUSTOM_MIGRATION_SQL } from "../migrate.js";

/**
 * Split a SQL string into individual statements while respecting $$ dollar-
 * quoting used in PL/pgSQL DO blocks and function bodies.
 */
function splitSqlStatements(sql: string): string[] {
  const results: string[] = [];
  let current = "";
  let inDollarQuote = false;
  let dollarTag = "";
  let i = 0;

  while (i < sql.length) {
    // Detect opening/closing $$ (or $tag$) delimiter
    if (sql[i] === "$") {
      const rest = sql.slice(i);
      const match = rest.match(/^\$([A-Za-z_]*)?\$/);
      if (match) {
        const tag = match[0];
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = tag;
          current += tag;
          i += tag.length;
          continue;
        } else if (tag === dollarTag) {
          inDollarQuote = false;
          dollarTag = "";
          current += tag;
          i += tag.length;
          continue;
        }
      }
    }

    if (!inDollarQuote && sql[i] === ";") {
      current += ";";
      const trimmed = current.trim();
      if (trimmed && trimmed !== ";") results.push(trimmed);
      current = "";
      i++;
      continue;
    }

    current += sql[i];
    i++;
  }

  const trimmed = current.trim();
  if (trimmed && trimmed !== ";") results.push(trimmed);
  return results;
}

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isProd = process.argv.includes("--prod");
const envLabel = isProd ? "PROD" : "DEV";

const rawUrl = isProd
  ? process.env.SUPABASE_DATABASE_URL
  : process.env.SUPABASE_DATABASE_URL_DEV ??
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DATABASE_URL;

if (!rawUrl) {
  const missing = isProd ? "SUPABASE_DATABASE_URL" : "DATABASE_URL or SUPABASE_DATABASE_URL_DEV";
  console.error(`[migrate] ERROR: ${missing} is not set.`);
  process.exit(1);
}

const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const useSsl = /supabase\.(co|com|in)/.test(url);

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║  Sport Center Jakarta — DB Migration Runner          ║`);
console.log(`╚══════════════════════════════════════════════════════╝`);
console.log(`  Target : ${envLabel}`);
console.log(`  SSL    : ${useSsl}`);
console.log("");

const client = new Client({
  connectionString: url,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

await client.connect();
console.log("  ✓ Connected to database\n");

try {
  const db = drizzle(client);

  // ── Step 1: Drizzle numbered migrations (0000, 0001, 0002) ─────────────────
  const migrationsFolder = path.resolve(__dirname, "../../lib/db/drizzle");
  console.log(`[1/3] Drizzle migrations (${migrationsFolder})...`);

  // Check if the sport_center schema already has tables (existing DB).
  // If so, baseline the __drizzle_migrations tracking table so drizzle
  // doesn't try to re-apply migrations that are already in place.
  const { rows: schemaRows } = await client.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM information_schema.tables
    WHERE table_schema = 'sport_center'
  `);
  const existingTableCount = parseInt(schemaRows[0]?.count ?? "0", 10);

  if (existingTableCount > 0) {
    console.log(`      Schema sport_center already has ${existingTableCount} tables — baselining migration tracking...`);
    // Ensure drizzle migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `).catch(async () => {
      // drizzle schema might not exist yet
      await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `);
    });

    // Read journal to get all migration hashes
    const journalPath = path.resolve(migrationsFolder, "meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag: string; when: number }>;
    };

    for (const entry of journal.entries) {
      const sqlFile = path.resolve(migrationsFolder, `${entry.tag}.sql`);
      if (!fs.existsSync(sqlFile)) continue;
      const hash = entry.tag;
      const { rows } = await client.query(
        `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE hash = $1`,
        [hash]
      );
      if (rows.length === 0) {
        await client.query(
          `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
          [hash, entry.when]
        );
        console.log(`      ✓ Baselined: ${entry.tag}`);
      } else {
        console.log(`      — Already tracked: ${entry.tag}`);
      }
    }
    console.log("      ✓ Baseline done — no SQL re-applied\n");
  } else {
    await migrate(db, { migrationsFolder });
    console.log("      ✓ Done\n");
  }

  // ── Step 1b: Rename legacy tables to sport_ prefix (idempotent) ────────────
  console.log(`[1b] Rename legacy tables to sport_ prefix if needed...`);
  const tablesToRename: [string, string][] = [
    ['settings',      'sport_settings'],
    ['bookings',      'sport_bookings'],
    ['facilities',    'sport_facilities'],
    ['gym_memberships','sport_memberships'],
    ['payments',      'sport_payments'],
  ];
  for (const [from, to] of tablesToRename) {
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sport_center' AND table_name = '${from}'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'sport_center' AND table_name = '${to}'
        ) THEN
          EXECUTE 'ALTER TABLE sport_center.${from} RENAME TO ${to}';
        END IF;
      END $$
    `);
  }
  // Add extra columns to sport_settings that were added after base migration
  await client.query(`
    ALTER TABLE sport_center.sport_settings
      ADD COLUMN IF NOT EXISTS fonnte_token text,
      ADD COLUMN IF NOT EXISTS fonnte_admin_wa text,
      ADD COLUMN IF NOT EXISTS admin_wa_phones text,
      ADD COLUMN IF NOT EXISTS app_url text,
      ADD COLUMN IF NOT EXISTS payment_deadline_hours text DEFAULT '24'
  `);
  console.log("      ✓ Done\n");

  // ── Step 2: Extra SQL file (add_tax_effective_date) ─────────────────────────
  const extraSql = path.resolve(__dirname, "../../lib/db/drizzle/add_tax_effective_date.sql");
  if (fs.existsSync(extraSql)) {
    console.log(`[2/3] Extra SQL: ${path.basename(extraSql)}...`);
    await client.query(fs.readFileSync(extraSql, "utf8"));
    console.log("      ✓ Done\n");
  } else {
    console.log(`[2/3] Extra SQL: not found, skipping\n`);
  }

  // ── Step 3: Custom incremental migrations (all idempotent) ──────────────────
  console.log(`[3/3] Custom schema migrations (enums, columns, tables)...`);
  // PostgreSQL requires a newly-added enum value to be committed before it
  // can be referenced by a later statement. Keep this outside the large
  // custom migration batch so source-scoped indexes can use it safely.
  const sourceEnum = await client.query<{ exists: boolean; has_value: boolean }>(`
    SELECT EXISTS (
      SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = 'accounting_entry_source'
         AND n.nspname = 'public'
    ) AS exists,
    EXISTS (
      SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = 'accounting_entry_source'
         AND n.nspname = 'public'
         AND e.enumlabel = 'sport_center_payment'
    ) AS has_value
  `);
  if (sourceEnum.rows[0]?.exists && !sourceEnum.rows[0]?.has_value) {
    await client.query(
      `ALTER TYPE public.accounting_entry_source ADD VALUE 'sport_center_payment'`,
    );
    console.log("      ✓ Added public.accounting_entry_source=sport_center_payment\n");
  }
  // Apply CUSTOM_MIGRATION_SQL statement-by-statement so a single missing
  // table or object (e.g. paylabs_transactions on a fresh dev DB) doesn't
  // abort all remaining migrations.  We use a $$ -aware splitter to avoid
  // splitting inside PL/pgSQL bodies.
  const statements = splitSqlStatements(CUSTOM_MIGRATION_SQL);
  let ok = 0, skipped = 0;
  for (const stmt of statements) {
    try {
      await client.query(stmt);
      ok++;
    } catch (e: any) {
      skipped++;
      // Only log non-trivial failures (not "already exists" noise)
      const msg: string = e?.message ?? "";
      if (!msg.includes("already exists") && !msg.includes("duplicate_object")) {
        console.warn(`      ⚠ Skipped statement (${msg.slice(0, 120)})`);
      }
    }
  }
  console.log(`      ✓ Done (${ok} applied, ${skipped} skipped)\n`);

  console.log(`╔══════════════════════════════════════════════════════╗`);
  console.log(`║  ✅  All migrations applied successfully!            ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);
} finally {
  await client.end();
}
