import { execSync } from "child_process";

const url = process.env.PROD_DATABASE_URL;
if (!url) {
  console.error("❌ PROD_DATABASE_URL is not set");
  process.exit(1);
}

console.log("🚀 Running schema push to production database...");
console.log("   Target:", url.replace(/:[^:@]+@/, ":***@"));

try {
  execSync("pnpm run push", {
    cwd: new URL("../lib/db", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  console.log("✅ Production database schema is up to date.");
} catch {
  console.error("❌ Migration failed.");
  process.exit(1);
}
