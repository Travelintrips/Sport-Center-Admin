import { Client } from "pg";

const DB_URL = process.env.SUPABASE_DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.DATABASE_URL;
if (!DB_URL) throw new Error("No database URL found. Set SUPABASE_DATABASE_URL or DATABASE_URL.");

const client = new Client({ connectionString: DB_URL });

async function run() {
  await client.connect();
  console.log("Connected to DB. Running bank production readiness migration...");

  try {
    await client.query("BEGIN");

    // Phase 3: bank_account_balances table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sport_center.bank_account_balances (
        id              SERIAL PRIMARY KEY,
        bank_account_id TEXT NOT NULL,
        company_id      INTEGER,
        opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        last_reconciled_balance NUMERIC(14,2) DEFAULT 0,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✓ bank_account_balances table created (if not exists)");

    // Add unique constraint on bank_account_id + company_id for upsert
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'bank_account_balances_account_company_unique'
        ) THEN
          ALTER TABLE sport_center.bank_account_balances
            ADD CONSTRAINT bank_account_balances_account_company_unique
            UNIQUE (bank_account_id, company_id);
        END IF;
      END $$;
    `);
    console.log("✓ bank_account_balances unique constraint ensured");

    // Phase 4: company_id on bank_mutations
    await client.query(`
      ALTER TABLE sport_center.bank_mutations
        ADD COLUMN IF NOT EXISTS company_id INTEGER;
    `);
    console.log("✓ bank_mutations.company_id added");

    // Phase 4: company_id on bank_journal_entries
    await client.query(`
      ALTER TABLE sport_center.bank_journal_entries
        ADD COLUMN IF NOT EXISTS company_id INTEGER;
    `);
    console.log("✓ bank_journal_entries.company_id added");

    // Phase 2: period lock audit fields — track who attempted locked-period operations
    // (no schema change needed, uses existing audit_logs)

    await client.query("COMMIT");
    console.log("\n✅ Migration completed successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed, rolled back:", err);
    throw err;
  } finally {
    await client.end();
  }
}

run();
