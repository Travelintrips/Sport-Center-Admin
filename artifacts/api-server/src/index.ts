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
    // Indexes untuk performa query filter, duplicate detection, dan scheduler guard
    `CREATE INDEX IF NOT EXISTS idx_bank_mutations_status
       ON sport_center.bank_mutations (status)`,
    `CREATE INDEX IF NOT EXISTS idx_bank_mutations_transaction_date
       ON sport_center.bank_mutations (transaction_date)`,
    `CREATE INDEX IF NOT EXISTS idx_bank_mutations_mutation_key
       ON sport_center.bank_mutations (mutation_key)`,
    `CREATE INDEX IF NOT EXISTS idx_bank_mutations_status_date
       ON sport_center.bank_mutations (status, transaction_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_recon_matches_mutation_id
       ON sport_center.bank_reconciliation_matches (mutation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recon_matches_status
       ON sport_center.bank_reconciliation_matches (status)`,
    `CREATE INDEX IF NOT EXISTS idx_recon_matches_candidate
       ON sport_center.bank_reconciliation_matches (candidate_type, candidate_id)`,
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
