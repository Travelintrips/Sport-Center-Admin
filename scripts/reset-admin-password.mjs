/**
 * reset-admin-password.mjs
 * Re-hash admin password using current SESSION_SECRET and update DB.
 * Usage: node scripts/reset-admin-password.mjs
 */
import crypto from "crypto";
import pg from "pg";

const { Client } = pg;

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  console.error("ERROR: SESSION_SECRET is not set");
  process.exit(1);
}

// Same schema as auth.ts hashPassword()
function hashPassword(password) {
  return crypto.createHmac("sha256", SECRET).update(password).digest("hex");
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@sportcenter.com";
const ADMIN_PASSWORD = "admin123";
const DB_URL = process.env.SUPABASE_DATABASE_URL_DEV || process.env.SUPABASE_DATABASE_URL;

if (!DB_URL) {
  console.error("ERROR: SUPABASE_DATABASE_URL_DEV or SUPABASE_DATABASE_URL not set");
  process.exit(1);
}

const client = new Client({ connectionString: DB_URL });

async function main() {
  await client.connect();
  console.log("Connected to DB");

  const newHash = hashPassword(ADMIN_PASSWORD);

  // Check if admin exists
  const { rows } = await client.query(
    `SELECT id, email, role, password_hash FROM sport_center.users WHERE email = $1`,
    [ADMIN_EMAIL]
  );

  if (rows.length === 0) {
    // Create admin
    const { rows: inserted } = await client.query(
      `INSERT INTO sport_center.users (name, email, password_hash, role, registration_source, created_at)
       VALUES ($1, $2, $3, 'admin', 'web', NOW())
       RETURNING id, email, role`,
      ["Admin", ADMIN_EMAIL, newHash]
    );
    console.log("✓ Admin CREATED:", inserted[0]);
  } else {
    const user = rows[0];
    console.log("Found user:", { id: user.id, email: user.email, role: user.role });

    // Update password hash and ensure role is admin
    const { rows: updated } = await client.query(
      `UPDATE sport_center.users SET password_hash = $1, role = 'admin' WHERE email = $2 RETURNING id, email, role`,
      [newHash, ADMIN_EMAIL]
    );
    console.log("✓ Admin password UPDATED:", updated[0]);
  }

  await client.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
