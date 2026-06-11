import { db, taxTransactionsTable, taxSettingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const schemaCheck = await db.execute(sql`
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'sport_center'
    AND table_name IN ('tax_transactions', 'tax_settings')
  ORDER BY table_name, ordinal_position
`);

console.log("\n=== KOLOM YANG ADA DI SUPABASE ===");
for (const row of schemaCheck.rows as any[]) {
  console.log(`  ${row.table_name}.${row.column_name} (${row.data_type}, nullable=${row.is_nullable})`);
}

const settings = await db.select().from(taxSettingsTable);
console.log("\n=== ISI tax_settings ===");
console.log(JSON.stringify(settings, null, 2));

const txns = await db.select().from(taxTransactionsTable).limit(5);
console.log("\n=== SAMPLE tax_transactions (max 5) ===");
console.log(JSON.stringify(txns, null, 2));

process.exit(0);
