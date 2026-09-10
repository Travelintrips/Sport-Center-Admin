import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const configuredSecret = process.env.SESSION_SECRET ?? "";
if (!configuredSecret) {
  throw new Error("SESSION_SECRET is required; refusing to seed an admin with a default secret.");
}

function hashPassword(password: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(password).digest("hex");
}

async function main() {
  const passwordHash = hashPassword("admin123", configuredSecret);

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
