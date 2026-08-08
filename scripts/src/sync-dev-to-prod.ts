import pg from "pg";

const { Client } = pg;

const DEV_URL = process.env.DATABASE_URL ?? "postgresql://postgres:password@helium/heliumdb?sslmode=disable";
const rawProdUrl = process.env.SUPABASE_DATABASE_URL;
if (!rawProdUrl) { console.error("SUPABASE_DATABASE_URL not set"); process.exit(1); }
const PROD_URL = rawProdUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

async function getColumns(client: pg.Client, schema: string, table: string): Promise<string[]> {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
    [schema, table]
  );
  return r.rows.map((row: any) => row.column_name);
}

async function syncTable(
  dev: pg.Client,
  prod: pg.Client,
  table: string,
  opts: { conflictCol?: string; skip?: string[]; truncate?: boolean } = {}
) {
  const { conflictCol = "id", skip = [], truncate = false } = opts;
  const sc = "sport_center";

  const devCols = await getColumns(dev, sc, table);
  const prodCols = await getColumns(prod, sc, table);
  const commonCols = devCols.filter(c => prodCols.includes(c) && !skip.includes(c));

  const { rows: data } = await dev.query(
    `SELECT ${commonCols.map(c => `"${c}"`).join(",")} FROM ${sc}.${table} ORDER BY id`
  );

  if (data.length === 0) {
    console.log(`  [${table}] 0 rows in dev — skipped`);
    return;
  }

  if (truncate) {
    await prod.query(`TRUNCATE TABLE ${sc}.${table} RESTART IDENTITY CASCADE`);
    console.log(`  [${table}] Truncated`);
  }

  const updateCols = commonCols.filter(c => c !== conflictCol && c !== "id" && c !== "created_at");
  let upserted = 0;

  for (const row of data) {
    const vals = commonCols.map(c => row[c]);
    const placeholders = commonCols.map((_, i) => `$${i + 1}`).join(",");
    const colList = commonCols.map(c => `"${c}"`).join(",");
    const setClause = updateCols.map(c => `"${c}"=$${commonCols.indexOf(c) + 1}`).join(",");

    const sql = `
      INSERT INTO ${sc}.${table} (${colList})
      VALUES (${placeholders})
      ON CONFLICT ("${conflictCol}") DO UPDATE SET ${setClause}
    `;

    await prod.query(sql, vals);
    upserted++;
  }

  console.log(`  [${table}] ${data.length} rows → prod (${upserted} upserted)`);
}

async function main() {
  const dev = new Client({ connectionString: DEV_URL });
  const prod = new Client({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });

  await dev.connect();
  console.log("✓ Connected to DEV (heliumdb)");
  await prod.connect();
  console.log("✓ Connected to PROD (Supabase)\n");

  console.log("═══ Syncing dev → prod ═══\n");

  // 1. facilities — upsert by id
  await syncTable(dev, prod, "facilities", { conflictCol: "id" });

  // 2. settings — single row, replace completely
  {
    const devCols = await getColumns(dev, "sport_center", "settings");
    const prodCols = await getColumns(prod, "sport_center", "settings");
    const commonCols = devCols.filter(c => prodCols.includes(c) && c !== "id" && c !== "created_at");
    const { rows: [row] } = await dev.query(
      `SELECT ${commonCols.map(c => `"${c}"`).join(",")} FROM sport_center.settings LIMIT 1`
    );
    if (row) {
      const setClause = commonCols.map((c, i) => `"${c}"=$${i + 1}`).join(",");
      await prod.query(
        `UPDATE sport_center.settings SET ${setClause}`,
        commonCols.map(c => row[c])
      );
      console.log(`  [settings] Updated 1 row`);
    }
  }

  // 3. tax_settings — upsert by tax_code
  await syncTable(dev, prod, "tax_settings", { conflictCol: "id" });

  // 4. notification_templates — upsert by key (unique constraint)
  await syncTable(dev, prod, "notification_templates", { conflictCol: "key" });

  // 5. company_document_templates — upsert by id (skip company_id FK to avoid constraint issues)
  await syncTable(dev, prod, "company_document_templates", { conflictCol: "id", skip: ["company_id"] });

  // 6. promos — upsert by id (only if dev has data)
  await syncTable(dev, prod, "promos", { conflictCol: "id" });

  // 7. Fix sequences so new inserts don't conflict with existing IDs
  const seqTables = ["facilities", "tax_settings", "notification_templates", "company_document_templates", "promos"];
  for (const t of seqTables) {
    await prod.query(`
      SELECT setval(
        pg_get_serial_sequence('sport_center.${t}', 'id'),
        COALESCE((SELECT MAX(id) FROM sport_center.${t}), 1)
      )
    `).catch(() => {}); // ignore if no sequence
  }
  console.log("\n  [sequences] Reset to max IDs");

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  ✅  Sync dev → prod selesai!        ║");
  console.log("╚══════════════════════════════════════╝\n");

  await dev.end();
  await prod.end();
}

main().catch(e => { console.error(e); process.exit(1); });
