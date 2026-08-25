import pg from "pg";
import crypto from "crypto";

const { Client } = pg;

const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET not set");

const hash = crypto.createHmac("sha256", secret).update("admin123").digest("hex");

const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL ?? "";
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const res = await client.query(
  `UPDATE sport_center.users SET password_hash = $1 WHERE email = 'admin@sportcenter.com' RETURNING id, email, role`,
  [hash]
);

if (res.rows.length === 0) {
  console.log("User admin@sportcenter.com tidak ditemukan — insert baru...");
  const ins = await client.query(
    `INSERT INTO sport_center.users (email, password_hash, role, name)
     VALUES ('admin@sportcenter.com', $1, 'admin', 'Admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = $1
     RETURNING id, email, role`,
    [hash]
  );
  console.log("Upserted:", JSON.stringify(ins.rows));
} else {
  console.log("Updated:", JSON.stringify(res.rows));
}

await client.end();
console.log("✅ Admin password hash fixed!");
