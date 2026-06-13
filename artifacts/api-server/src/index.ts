import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureDefaultTemplates } from "./lib/seedTemplates";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function runStartupMigrations() {
  try {
    await db.execute(sql`
      ALTER TABLE sport_center.bank_reconciliation_matches
        ADD COLUMN IF NOT EXISTS status_valid_match boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS tolerance_used boolean NOT NULL DEFAULT false
    `);
    logger.info("Startup migrations OK");
  } catch (err) {
    logger.warn({ err }, "Startup migration warning (non-fatal)");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  runStartupMigrations().catch(() => {});
  startScheduler();
  ensureDefaultTemplates().catch(() => {});
});
