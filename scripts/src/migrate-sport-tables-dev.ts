import pg from "pg";

const { Client } = pg;

const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL;
if (!rawUrl) { console.error("SUPABASE_DATABASE_URL_DEV not set"); process.exit(1); }
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");

async function main() {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("✓ Connected to DEV Supabase");

  // Check what already exists
  const { rows: existing } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'sport_center'
    AND table_name IN ('bookings','facilities','payments','gym_memberships','settings',
                       'sport_bookings','sport_facilities','sport_payments','sport_memberships','sport_settings')
    ORDER BY table_name
  `);
  console.log("Existing tables:", existing.map(r => r.table_name).join(", "));

  const hasOld = (name: string) => existing.some(r => r.table_name === name);
  const hasNew = (name: string) => existing.some(r => r.table_name === name);

  const migrations: string[] = [];

  if (hasOld("bookings") && !hasNew("sport_bookings"))
    migrations.push("ALTER TABLE sport_center.bookings RENAME TO sport_bookings");
  if (hasOld("facilities") && !hasNew("sport_facilities"))
    migrations.push("ALTER TABLE sport_center.facilities RENAME TO sport_facilities");
  if (hasOld("payments") && !hasNew("sport_payments"))
    migrations.push("ALTER TABLE sport_center.payments RENAME TO sport_payments");
  if (hasOld("gym_memberships") && !hasNew("sport_memberships"))
    migrations.push("ALTER TABLE sport_center.gym_memberships RENAME TO sport_memberships");
  if (hasOld("settings") && !hasNew("sport_settings"))
    migrations.push("ALTER TABLE sport_center.settings RENAME TO sport_settings");

  const seqMigrations = [
    { old: "bookings_id_seq", new: "sport_bookings_id_seq" },
    { old: "facilities_id_seq", new: "sport_facilities_id_seq" },
    { old: "payments_id_seq", new: "sport_payments_id_seq" },
    { old: "gym_memberships_id_seq", new: "sport_memberships_id_seq" },
    { old: "settings_id_seq", new: "sport_settings_id_seq" },
  ];

  await client.query("BEGIN");
  try {
    for (const sql of migrations) {
      console.log("  →", sql);
      await client.query(sql);
    }
    for (const seq of seqMigrations) {
      await client.query(
        `ALTER SEQUENCE IF EXISTS sport_center.${seq.old} RENAME TO ${seq.new}`
      ).catch(() => {});
    }
    await client.query(`
      UPDATE sport_center.tax_settings
      SET applies_to = 'sport_booking'
      WHERE applies_to = 'sport_center_booking'
    `);
    console.log("  → Updated tax_settings.applies_to: sport_center_booking → sport_booking");
    await client.query(`
      CREATE OR REPLACE VIEW sport_center.sport_invoices AS SELECT * FROM sport_center.company_invoices;
      CREATE OR REPLACE VIEW sport_center.sport_invoice_items AS SELECT * FROM sport_center.company_invoice_items;
      CREATE OR REPLACE VIEW sport_center.sport_customers AS SELECT * FROM sport_center.users WHERE role = 'customer';
    `);
    console.log("  → Created views: sport_invoices, sport_invoice_items, sport_customers");
    await client.query("COMMIT");
    console.log("\n✅ Migration selesai!");
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("Migration FAILED:", err?.message);
    process.exit(1);
  }
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
