import pg from "pg";
import fs from "fs";
import crypto from "crypto";

const { Client } = pg;
// Match the API runtime: development uses DATABASE_URL (local HeliumDB) when
// it is available, and only falls back to the isolated Supabase dev database.
const rawUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_DATABASE_URL ||
  "";
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

await client.connect();
console.log("Connected to dev DB");

for (const file of ["0000_fearless_adam_warlock.sql", "0001_huge_plazm.sql", "0002_init.sql"]) {
  const sql = fs.readFileSync(`/home/runner/workspace/lib/db/drizzle/${file}`, "utf8");
  const stmts = sql.split("--> statement-breakpoint").map((s: string) => s.trim()).filter(Boolean);
  let ok = 0, fail = 0;
  for (const s of stmts) {
    try { await client.query(s); ok++; } catch(e: any) { fail++; }
  }
  console.log(`${file}: ${ok} ok, ${fail} skip/fail`);
}

// Seed admin user
const hash = crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update("admin123").digest("hex");
await client.query(`
  INSERT INTO sport_center.users (name, email, phone, password_hash, role)
  VALUES ('Admin', 'admin@sportcenter.com', '08000000000', $1, 'admin')
  ON CONFLICT (email) DO NOTHING
`, [hash]);

// Seed settings
await client.query(`
  INSERT INTO sport_center.settings (center_name, address, phone, whatsapp, email)
  VALUES ('Sport Center Jakarta', 'Jakarta', '021-000000', '08000000000', 'admin@sportcenter.com')
  ON CONFLICT DO NOTHING
`).catch(() => {});

// Seed 1 facility
await client.query(`
  INSERT INTO sport_center.facilities (name, category, description, price_per_hour, open_hour, close_hour, is_active)
  VALUES ('Lapangan Futsal A', 'futsal', 'Lapangan futsal indoor', 150000, '06:00', '22:00', true)
  ON CONFLICT DO NOTHING
`).catch(() => {});

console.log("Seed done");
await client.end();
console.log("Done.");
