import pg from "pg";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connStr = process.env.SUPABASE_DATABASE_URL_DEV;
  if (!connStr) throw new Error("SUPABASE_DATABASE_URL_DEV not set");

  const sql = fs.readFileSync(
    path.resolve(__dirname, "../migrations/paylabs-settings.sql"),
    "utf8"
  );

  const client = new Client({ connectionString: connStr });
  await client.connect();
  try {
    await client.query(sql);
    console.log("✅ paylabs_settings table created (or already exists)");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
