import pg from "pg";
const { Client } = pg;
const client = new Client({
  connectionString: "postgresql://postgres.nzdweipzckfszczzqtuw:ZRM0IiRaXvHrY7dP@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false }
});
await client.connect();
const { rows } = await client.query("SELECT qris_image_url FROM sport_center.settings LIMIT 1");
console.log("QRIS URL:", rows[0]?.qris_image_url ?? "null");
await client.end();
