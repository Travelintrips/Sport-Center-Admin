import pg from "pg";
const { Client } = pg;
const url = (process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL ?? "").replace(":6543", ":5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(`
  INSERT INTO sport_center.sport_vendors (name, contact_person, phone, is_active)
  VALUES
    ('PT Mitra Olahraga', 'Budi Santoso', '081234567890', true),
    ('CV Sport Supplier', 'Andi Rahman', '087654321098', true)
  ON CONFLICT DO NOTHING
`);
console.log("Vendors seeded OK");
await client.end();
