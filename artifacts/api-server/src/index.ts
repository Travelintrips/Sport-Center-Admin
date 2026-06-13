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
  // Jalankan setiap migration secara terpisah — ADD VALUE harus di luar transaksi
  const migrations = [
    // Kolom lama (idempotent)
    `ALTER TABLE sport_center.bank_reconciliation_matches
       ADD COLUMN IF NOT EXISTS status_valid_match boolean NOT NULL DEFAULT false`,
    `ALTER TABLE sport_center.bank_reconciliation_matches
       ADD COLUMN IF NOT EXISTS tolerance_used boolean NOT NULL DEFAULT false`,
    `ALTER TABLE sport_center.bank_reconciliation_matches
       ADD COLUMN IF NOT EXISTS note text`,
    // Tambah nilai enum baru — ALTER TYPE ADD VALUE tidak bisa di dalam transaksi eksplisit
    // IF NOT EXISTS mencegah error jika sudah ada
    `DO $$ BEGIN
       ALTER TYPE sport_center.bank_mutation_status ADD VALUE IF NOT EXISTS 'auto_matched';
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
       ALTER TYPE sport_center.bank_mutation_status ADD VALUE IF NOT EXISTS 'need_review';
     EXCEPTION WHEN duplicate_object THEN null; END $$`,
  ];

  for (const stmt of migrations) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (err) {
      logger.warn({ err, stmt: stmt.slice(0, 80) }, "Startup migration warning (non-fatal)");
    }
  }
  logger.info("Startup migrations OK");
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
