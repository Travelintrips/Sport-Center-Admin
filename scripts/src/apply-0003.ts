import pg from "pg";
import fs from "fs";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const sql = fs.readFileSync("/home/runner/workspace/lib/db/drizzle/0003_init.sql", "utf8");
const stmts = sql.split("--> statement-breakpoint").map((s: string) => s.trim()).filter(Boolean);
let ok = 0, fail = 0;
for (const s of stmts) {
  try { await client.query(s); ok++; } catch (e: any) { fail++; }
}
console.log(`0003_init.sql: ${ok} ok, ${fail} skip/fail`);
await client.end();
