import pg from "pg";

const { Client } = pg;
const connectionString = process.env.SUPABASE_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "SUPABASE_DATABASE_URL is required; refusing an implicit production connection.",
  );
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const { rows } = await client.query(
  "SELECT qris_image_url FROM sport_center.settings LIMIT 1",
);
console.log("QRIS URL:", rows[0]?.qris_image_url ?? "null");
await client.end();