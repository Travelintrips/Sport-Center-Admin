import pg from "pg";
import crypto from "crypto";

const { Client } = pg;
const url = (process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL ?? "").replace(":6543", ":5432");
const secret = process.env.SESSION_SECRET!;
if (!secret) { console.error("SESSION_SECRET tidak di-set"); process.exit(1); }

const hash = crypto.createHmac("sha256", secret).update("admin123").digest("hex");
console.log("Hash yang akan disimpan:", hash);

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const res = await client.query(
  `UPDATE sport_center.users SET password_hash = $1 WHERE email = 'admin@sportcenter.com' AND role = 'admin' RETURNING id, email, role`,
  [hash]
);

if ((res.rowCount ?? 0) === 0) {
  await client.query(
    `INSERT INTO sport_center.users (name, email, password_hash, role) VALUES ('Admin', 'admin@sportcenter.com', $1, 'admin')`,
    [hash]
  );
  console.log("Admin user dibuat baru dengan hash yang benar.");
} else {
  console.log("Password admin berhasil diupdate:", res.rows[0]);
}
await client.end();
