import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SECRET = process.env.SESSION_SECRET || "sport-center-secret-key-2024";

function hashPassword(password: string): string {
  return crypto.createHmac("sha256", SECRET).update(password).digest("hex");
}

async function main() {
  const passwordHash = hashPassword("admin123");
  console.log("Hash:", passwordHash);

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, "admin@sportcenter.com")).limit(1);
  if (existing.length > 0) {
    await db.update(usersTable).set({ passwordHash, role: "admin", name: "Admin" }).where(eq(usersTable.email, "admin@sportcenter.com"));
    console.log("Admin user updated");
  } else {
    await db.insert(usersTable).values({
      name: "Admin",
      email: "admin@sportcenter.com",
      passwordHash,
      role: "admin",
    });
    console.log("Admin user created");
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
