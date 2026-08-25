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

// The base Drizzle migration creates legacy table names. The application schema
// reads the sport_* names, so normalize them before seeding or starting the API.
for (const [from, to] of [
  ["settings", "sport_settings"],
  ["bookings", "sport_bookings"],
  ["facilities", "sport_facilities"],
  ["gym_memberships", "sport_memberships"],
  ["payments", "sport_payments"],
] as const) {
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
console.log("Legacy tables normalized to sport_* names");

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

console.log("Base schema ready; run scripts seed-all to populate facilities and demo data");
await client.end();
console.log("Done.");
