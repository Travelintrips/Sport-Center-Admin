/**
 * Full DEV → PROD schema audit for the sport_center schema.
 *
 * Read-only. It compares:
 *   tables, columns, enum types/values, indexes, constraints,
 *   functions, triggers, views/materialized views, and RLS policies.
 *
 * Required environment variables:
 *   SUPABASE_DATABASE_URL_DEV
 *   SUPABASE_DATABASE_URL
 *
 * Run:
 *   pnpm --filter scripts audit:schema
 */

import pg from "pg";

const { Client } = pg;
const SCHEMA = "sport_center";

type Row = Record<string, unknown>;
type Snapshot = Record<string, Record<string, string>>;

function toSessionPooler(raw: string): string {
  return raw.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(canonical).sort());
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return JSON.stringify(
      Object.keys(object)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = object[key];
          return result;
        }, {}),
    );
  }
  return JSON.stringify(value);
}

function snapshot(rows: Row[], keyFields: string[]): Snapshot {
  const result: Snapshot = {};
  for (const row of rows) {
    const key = keyFields.map((field) => String(row[field] ?? "")).join("|");
    result[key] = { value: canonical(row) };
  }
  return result;
}

async function query(client: pg.Client, sql: string): Promise<Row[]> {
  const result = await client.query<Row>(sql);
  return result.rows;
}

async function readSnapshot(client: pg.Client): Promise<Record<string, Snapshot>> {
  const [
    tables,
    columns,
    enums,
    indexes,
    constraints,
    functions,
    triggers,
    views,
    rlsTables,
    policies,
  ] = await Promise.all([
    query(
      client,
      `
        SELECT c.relname AS table_name,
               CASE c.relkind
                 WHEN 'r' THEN 'table'
                 WHEN 'p' THEN 'partitioned_table'
               END AS relation_type,
               c.relispartition AS is_partition
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${SCHEMA}'
          AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
      `,
    ),
    query(
      client,
      `
        SELECT c.relname AS table_name,
               a.attname AS column_name,
               format_type(a.atttypid, a.atttypmod) AS data_type,
               a.attnotnull AS not_null,
               pg_get_expr(d.adbin, d.adrelid) AS column_default,
               a.attgenerated AS generated
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d
          ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = '${SCHEMA}'
          AND c.relkind IN ('r', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum
      `,
    ),
    query(
      client,
      `
        SELECT t.typname AS type_name,
               e.enumlabel AS enum_value,
               e.enumsortorder AS sort_order
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = '${SCHEMA}'
        ORDER BY t.typname, e.enumsortorder
      `,
    ),
    query(
      client,
      `
        SELECT indexname AS index_name,
               tablename AS table_name,
               indexdef AS definition
        FROM pg_indexes
        WHERE schemaname = '${SCHEMA}'
        ORDER BY tablename, indexname
      `,
    ),
    query(
      client,
      `
        SELECT c.relname AS table_name,
               con.conname AS constraint_name,
               con.contype AS constraint_type,
               pg_get_constraintdef(con.oid, true) AS definition,
               con.convalidated AS is_valid
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${SCHEMA}'
        ORDER BY c.relname, con.conname
      `,
    ),
    query(
      client,
      `
        SELECT p.proname AS function_name,
               pg_get_function_identity_arguments(p.oid) AS identity_arguments,
               l.lanname AS language,
               p.prosecdef AS security_definer,
               pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = '${SCHEMA}'
        ORDER BY p.proname, identity_arguments
      `,
    ),
    query(
      client,
      `
        SELECT c.relname AS table_name,
               t.tgname AS trigger_name,
               pg_get_triggerdef(t.oid, true) AS definition,
               t.tgenabled AS enabled
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${SCHEMA}'
          AND NOT t.tgisinternal
        ORDER BY c.relname, t.tgname
      `,
    ),
    query(
      client,
      `
        SELECT c.relname AS view_name,
               CASE c.relkind
                 WHEN 'v' THEN 'view'
                 WHEN 'm' THEN 'materialized_view'
               END AS view_type,
               pg_get_viewdef(c.oid, true) AS definition,
               c.reloptions AS options
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${SCHEMA}'
          AND c.relkind IN ('v', 'm')
        ORDER BY c.relname
      `,
    ),
    query(
      client,
      `
        SELECT c.relname AS table_name,
               c.relrowsecurity AS rls_enabled,
               c.relforcerowsecurity AS rls_forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${SCHEMA}'
          AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
      `,
    ),
    query(
      client,
      `
        SELECT schemaname AS schema_name,
               tablename AS table_name,
               policyname AS policy_name,
               permissive,
               roles,
               cmd,
               qual,
               with_check
        FROM pg_policies
        WHERE schemaname = '${SCHEMA}'
        ORDER BY tablename, policyname
      `,
    ),
  ]);

  return {
    tables: snapshot(tables, ["table_name"]),
    columns: snapshot(columns, ["table_name", "column_name"]),
    enums: snapshot(enums, ["type_name", "enum_value"]),
    indexes: snapshot(indexes, ["table_name", "index_name"]),
    constraints: snapshot(constraints, ["table_name", "constraint_name"]),
    functions: snapshot(functions, ["function_name", "identity_arguments"]),
    triggers: snapshot(triggers, ["table_name", "trigger_name"]),
    views: snapshot(views, ["view_name"]),
    rlsTables: snapshot(rlsTables, ["table_name"]),
    policies: snapshot(policies, ["table_name", "policy_name"]),
  };
}

const labels: Record<string, string> = {
  tables: "Tables",
  columns: "Columns",
  enums: "Enums",
  indexes: "Indexes",
  constraints: "Constraints",
  functions: "Functions",
  triggers: "Triggers",
  views: "Views",
  rlsTables: "RLS table settings",
  policies: "RLS policies",
};

function diffCategory(
  category: string,
  dev: Snapshot,
  prod: Snapshot,
): number {
  const keys = [...new Set([...Object.keys(dev), ...Object.keys(prod)])].sort();
  const missingInProd = keys.filter((key) => dev[key] && !prod[key]);
  const onlyInProd = keys.filter((key) => !dev[key] && prod[key]);
  const changed = keys.filter(
    (key) => dev[key] && prod[key] && dev[key].value !== prod[key].value,
  );

  if (missingInProd.length === 0 && onlyInProd.length === 0 && changed.length === 0) {
    console.log(`  ✓ ${labels[category]}: identical`);
    return 0;
  }

  console.log(`  ! ${labels[category]}:`);
  for (const key of missingInProd.slice(0, 40)) {
    console.log(`      DEV only      + ${key}`);
  }
  for (const key of onlyInProd.slice(0, 40)) {
    console.log(`      PROD only     - ${key}`);
  }
  for (const key of changed.slice(0, 40)) {
    console.log(`      definition    ~ ${key}`);
  }

  const omitted =
    Math.max(0, missingInProd.length - 40) +
    Math.max(0, onlyInProd.length - 40) +
    Math.max(0, changed.length - 40);
  if (omitted > 0) console.log(`      ... ${omitted} more differences`);

  return missingInProd.length + onlyInProd.length + changed.length;
}

const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;
const prodUrl = process.env.SUPABASE_DATABASE_URL;

if (!devUrl || !prodUrl) {
  console.error(
    "Both SUPABASE_DATABASE_URL_DEV and SUPABASE_DATABASE_URL are required. " +
      "Run this from a context where DEV and PROD scopes are available.",
  );
  process.exit(2);
}

const devClient = new Client({
  connectionString: toSessionPooler(devUrl),
  ssl: { rejectUnauthorized: false },
});
const prodClient = new Client({
  connectionString: toSessionPooler(prodUrl),
  ssl: { rejectUnauthorized: false },
});

await Promise.all([devClient.connect(), prodClient.connect()]);

try {
  console.log("\nSport Center schema audit (DEV ↔ PROD)");
  console.log(`Scope: ${SCHEMA}`);
  console.log("Read-only: no DDL, data writes, or policy changes\n");

  const [dev, prod] = await Promise.all([
    readSnapshot(devClient),
    readSnapshot(prodClient),
  ]);

  let differences = 0;
  for (const category of Object.keys(labels)) {
    differences += diffCategory(category, dev[category], prod[category]);
  }

  console.log("\nSummary:");
  if (differences === 0) {
    console.log("  ✓ DEV and PROD schema objects are identical.");
  } else {
    console.log(`  ! ${differences} differences found.`);
    console.log("  No production changes were applied.");
  }

  process.exitCode = differences === 0 ? 0 : 1;
} finally {
  await Promise.all([devClient.end(), prodClient.end()]);
}