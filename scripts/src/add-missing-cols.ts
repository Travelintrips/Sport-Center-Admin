import pg from "pg";
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const stmts = [
  // sport_bookings missing columns
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS invoice_pdf_url text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS approved_by_admin_phone text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS approved_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS rejected_reason text`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS paid_at timestamptz`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS booked_by_user_id integer REFERENCES sport_center.users(id) ON DELETE SET NULL`,
  `ALTER TABLE sport_center.sport_bookings ADD COLUMN IF NOT EXISTS group_ref text`,
];

let ok = 0, skip = 0;
for (const stmt of stmts) {
  try {
    await client.query(stmt);
    ok++;
  } catch (e: any) {
    skip++;
    console.warn("skip:", e.message?.slice(0, 80));
  }
}
console.log(`Done: ${ok} applied, ${skip} skipped`);
await client.end();
