/**
 * schema-diff.ts
 *
 * Compares the sport_center schema between DEV and PROD Supabase databases.
 * Reports tables, columns, and enum values that exist in DEV but are missing
 * in PROD (i.e. things that need to be applied to production before a deploy).
 *
 * Usage:
 *   pnpm --filter scripts migrate:diff
 *   # or directly:
 *   tsx scripts/src/schema-diff.ts
 *
 * Requires:
 *   SUPABASE_DATABASE_URL_DEV  — dev database connection string
 *   SUPABASE_DATABASE_URL      — prod database connection string
 */

import pg from "pg";
const { Client } = pg;

// ── helpers ────────────────────────────────────────────────────────────────

function to5432(raw: string): string {
  return raw.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
}

interface TableColumn {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface EnumRow {
  typname: string;
  label: string;
  sortorder: number;
}

async function fetchColumns(client: pg.Client): Promise<TableColumn[]> {
  const { rows } = await client.query<TableColumn>(`
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'sport_center'
    ORDER BY c.table_name, c.ordinal_position
  `);
  return rows;
}

async function fetchEnums(client: pg.Client): Promise<EnumRow[]> {
  const { rows } = await client.query<EnumRow>(`
    SELECT
      t.typname,
      e.enumlabel AS label,
      e.enumsortorder AS sortorder
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'sport_center'
    ORDER BY t.typname, e.enumsortorder
  `);
  return rows;
}

async function fetchPublicColumns(client: pg.Client): Promise<TableColumn[]> {
  const { rows } = await client.query<TableColumn>(`
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name IN (
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name LIKE 'sport_center_%'
      )
    ORDER BY c.table_name, c.ordinal_position
  `);
  return rows;
}

// ── main ───────────────────────────────────────────────────────────────────

const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;
const prodUrl = process.env.SUPABASE_DATABASE_URL;

const missing: string[] = [];

if (!devUrl) {
  console.error("ERROR: SUPABASE_DATABASE_URL_DEV is not set.");
  process.exit(1);
}
if (!prodUrl) {
  console.error("ERROR: SUPABASE_DATABASE_URL is not set.");
  process.exit(1);
}

const devClient = new Client({
  connectionString: to5432(devUrl),
  ssl: { rejectUnauthorized: false },
});
const prodClient = new Client({
  connectionString: to5432(prodUrl),
  ssl: { rejectUnauthorized: false },
});

await Promise.all([devClient.connect(), prodClient.connect()]);
console.log("\n╔══════════════════════════════════════════════════════════╗");
console.log("║  Sport Center — Schema Diff (DEV → PROD)                ║");
console.log("╚══════════════════════════════════════════════════════════╝\n");

try {
  // ── 1. Fetch sport_center schema from both DBs ──────────────────────────
  const [devCols, prodCols, devEnums, prodEnums, devPub, prodPub] = await Promise.all([
    fetchColumns(devClient),
    fetchColumns(prodClient),
    fetchEnums(devClient),
    fetchEnums(prodClient),
    fetchPublicColumns(devClient),
    fetchPublicColumns(prodClient),
  ]);

  // ── 2. Table-level diff ─────────────────────────────────────────────────
  const devTables = new Set(devCols.map((r) => r.table_name));
  const prodTables = new Set(prodCols.map((r) => r.table_name));

  const missingTables = [...devTables].filter((t) => !prodTables.has(t));
  const missingTablesPub = [...new Set(devPub.map((r) => r.table_name))].filter(
    (t) => !new Set(prodPub.map((r) => r.table_name)).has(t)
  );

  console.log("━━━ Tables (sport_center schema) ━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  DEV : ${devTables.size} tables`);
  console.log(`  PROD: ${prodTables.size} tables`);
  if (missingTables.length === 0) {
    console.log("  ✅ No missing tables in PROD\n");
  } else {
    console.log(`  ❌ Missing in PROD (${missingTables.length}):`);
    for (const t of missingTables) {
      console.log(`       → sport_center.${t}`);
      missing.push(`TABLE sport_center.${t}`);
    }
    console.log();
  }

  if (missingTablesPub.length > 0) {
    console.log("━━━ Tables (public schema mirror tables) ━━━━━━━━━━━━━━━━");
    console.log(`  ❌ Missing in PROD (${missingTablesPub.length}):`);
    for (const t of missingTablesPub) {
      console.log(`       → public.${t}`);
      missing.push(`TABLE public.${t}`);
    }
    console.log();
  }

  // ── 3. Column-level diff ────────────────────────────────────────────────
  console.log("━━━ Columns (sport_center schema) ━━━━━━━━━━━━━━━━━━━━━━━");

  // Group prod columns by table
  const prodColSet = new Map<string, Set<string>>();
  for (const r of prodCols) {
    if (!prodColSet.has(r.table_name)) prodColSet.set(r.table_name, new Set());
    prodColSet.get(r.table_name)!.add(r.column_name);
  }

  const missingCols: { table: string; column: string; type: string }[] = [];
  for (const r of devCols) {
    const prodSet = prodColSet.get(r.table_name);
    if (!prodSet) continue; // already flagged as missing table
    if (!prodSet.has(r.column_name)) {
      missingCols.push({ table: r.table_name, column: r.column_name, type: r.data_type });
    }
  }

  if (missingCols.length === 0) {
    console.log("  ✅ No missing columns in PROD\n");
  } else {
    // Group by table for readability
    const byTable = new Map<string, typeof missingCols>();
    for (const c of missingCols) {
      if (!byTable.has(c.table)) byTable.set(c.table, []);
      byTable.get(c.table)!.push(c);
    }
    console.log(`  ❌ Missing columns in PROD (${missingCols.length} total):\n`);
    for (const [table, cols] of byTable) {
      console.log(`     sport_center.${table}:`);
      for (const c of cols) {
        console.log(`       + ${c.column}  (${c.type})`);
        missing.push(`COLUMN sport_center.${table}.${c.column}`);
      }
    }
    console.log();
  }

  // ── 4. Enum diff ────────────────────────────────────────────────────────
  console.log("━━━ Enum values (sport_center schema) ━━━━━━━━━━━━━━━━━━━");

  // Group prod enum values by type name
  const prodEnumMap = new Map<string, Set<string>>();
  for (const r of prodEnums) {
    if (!prodEnumMap.has(r.typname)) prodEnumMap.set(r.typname, new Set());
    prodEnumMap.get(r.typname)!.add(r.label);
  }
  const devEnumMap = new Map<string, Set<string>>();
  for (const r of devEnums) {
    if (!devEnumMap.has(r.typname)) devEnumMap.set(r.typname, new Set());
    devEnumMap.get(r.typname)!.add(r.label);
  }

  const missingEnumTypes = [...devEnumMap.keys()].filter((k) => !prodEnumMap.has(k));
  const missingEnumValues: { type: string; value: string }[] = [];

  for (const [typname, devValues] of devEnumMap) {
    if (!prodEnumMap.has(typname)) continue; // already flagged as missing type
    const prodValues = prodEnumMap.get(typname)!;
    for (const v of devValues) {
      if (!prodValues.has(v)) {
        missingEnumValues.push({ type: typname, value: v });
      }
    }
  }

  if (missingEnumTypes.length === 0 && missingEnumValues.length === 0) {
    console.log("  ✅ No missing enum types or values in PROD\n");
  } else {
    if (missingEnumTypes.length > 0) {
      console.log(`  ❌ Missing enum types in PROD:`);
      for (const t of missingEnumTypes) {
        const values = [...(devEnumMap.get(t) ?? [])].join(", ");
        console.log(`       → ${t} (${values})`);
        missing.push(`ENUM_TYPE sport_center.${t}`);
      }
      console.log();
    }
    if (missingEnumValues.length > 0) {
      // Group by type
      const byType = new Map<string, string[]>();
      for (const e of missingEnumValues) {
        if (!byType.has(e.type)) byType.set(e.type, []);
        byType.get(e.type)!.push(e.value);
      }
      console.log(`  ❌ Missing enum values in PROD:`);
      for (const [type, values] of byType) {
        console.log(`     ${type}: + ${values.join(", ")}`);
        for (const v of values) missing.push(`ENUM_VALUE ${type}.${v}`);
      }
      console.log();
    }
  }

  // ── 5. Summary ──────────────────────────────────────────────────────────
  console.log("━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (missing.length === 0) {
    console.log("  ✅ PROD schema is up to date with DEV — safe to deploy!\n");
    process.exit(0);
  } else {
    console.log(`  ⚠️  ${missing.length} schema items are missing in PROD.\n`);
    console.log("  Run the migration to fix:\n");
    console.log("    pnpm --filter scripts migrate:prod\n");
    console.log(
      "  Then re-run this diff to confirm all clear before deploying.\n"
    );
    process.exit(1); // non-zero exit so CI/pre-deploy hooks can gate on it
  }
} finally {
  await Promise.all([devClient.end(), prodClient.end()]);
}
