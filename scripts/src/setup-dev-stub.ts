import pg from "pg";
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Create a minimal public.companies stub so company-related migrations can run on heliumdb
await client.query(`
  CREATE TABLE IF NOT EXISTS public.companies (
    id serial PRIMARY KEY,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`);
console.log("public.companies stub created (or already exists)");
await client.end();
