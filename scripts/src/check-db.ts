import pg from "pg";
const { Client } = pg;

async function checkDb(label: string, rawUrl: string) {
  const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log(`\n── ${label} ──────────────────────────`);
    const tables = ["facilities", "bookings", "payments", "users", "promos", "settings"];
    for (const t of tables) {
      const r = await client.query(`SELECT COUNT(*) FROM sport_center.${t}`);
      console.log(`  ${t.padEnd(12)}: ${r.rows[0].count}`);
    }
  } catch (e: any) {
    console.log(`  ERROR: ${e.message}`);
  } finally {
    await client.end();
  }
}

const devUrl  = process.env.SUPABASE_DATABASE_URL_DEV ?? "";
const prodUrl = process.env.SUPABASE_DATABASE_URL ?? "";

if (devUrl)  await checkDb("DEV  (SUPABASE_DATABASE_URL_DEV)", devUrl);
else         console.log("DEV: SUPABASE_DATABASE_URL_DEV tidak diset");

if (prodUrl) await checkDb("PROD (SUPABASE_DATABASE_URL)", prodUrl);
else         console.log("PROD: SUPABASE_DATABASE_URL tidak diset");
