import pg from "pg";
const { Client } = pg;

function to5432(u: string) {
  return u.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
}

async function listSchema(label: string, rawUrl?: string) {
  if (!rawUrl) {
    console.log(label, "=> URL MISSING");
    return;
  }
  const c = new Client({ connectionString: to5432(rawUrl), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const t = await c.query(
      `select table_name from information_schema.tables where table_schema='sport_center' order by table_name`
    );
    const e = await c.query(
      `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) labels from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='sport_center' group by t.typname order by t.typname`
    );
    console.log(`\n=== ${label} ===`);
    console.log("tables (", t.rowCount, "):", t.rows.map((r: any) => r.table_name).join(", ") || "(none)");
    console.log("enums:", e.rows.map((r: any) => `${r.typname}[${r.labels.join("|")}]`).join("  ") || "(none)");
  } finally {
    await c.end();
  }
}

await listSchema("DEV", process.env.SUPABASE_DATABASE_URL_DEV);
await listSchema("PROD", process.env.SUPABASE_DATABASE_URL);
