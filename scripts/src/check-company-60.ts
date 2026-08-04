import pg from "pg";
const { Client } = pg;

async function main() {
  const url = (process.env.SUPABASE_DATABASE_URL ?? "").replace(
    "pooler.supabase.com:6543",
    "pooler.supabase.com:5432"
  );
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // company_id = 60, look in public schema for companies or users
  // Check public.companies or similar
  const compTables = await client.query(`
    SELECT table_schema, table_name FROM information_schema.tables
    WHERE (table_schema = 'public' OR table_schema = 'sport_center')
      AND (table_name = 'companies' OR table_name = 'company' OR table_name = 'ap_members')
    ORDER BY table_schema, table_name
  `);
  console.log("Company-like tables:", compTables.rows.map((r: any) => `${r.table_schema}.${r.table_name}`).join(", "));

  // Check ap_members (company accounts)
  const apm = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'sport_center' AND table_name = 'ap_members'
    ORDER BY ordinal_position LIMIT 15
  `);
  console.log("ap_members cols:", apm.rows.map((r: any) => r.column_name).join(", "));

  const apmRow = await client.query(`SELECT * FROM sport_center.ap_members WHERE id = 60 LIMIT 1`);
  console.log("ap_members id=60:", JSON.stringify(apmRow.rows[0]));

  // Also check public.companies
  const pubComp = await client.query(`
    SELECT * FROM public.companies WHERE id = 60 LIMIT 1
  `).catch(() => ({ rows: ["no public.companies table"] }));
  console.log("public.companies id=60:", JSON.stringify(pubComp.rows[0]));

  // Check company_verifications where company_id=60
  const cv = await client.query(`
    SELECT cv.id, cv.company_id, cv.status, u.name as customer_name, u.email
    FROM sport_center.company_verifications cv
    LEFT JOIN sport_center.users u ON u.id = cv.customer_id
    WHERE cv.company_id = 60 LIMIT 5
  `).catch(e => ({ rows: [{ error: e.message }] }));
  console.log("company_verifications company_id=60:", JSON.stringify(cv.rows));

  // Check users table for company info
  const users = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'sport_center' AND table_name = 'users'
    ORDER BY ordinal_position LIMIT 20
  `);
  console.log("users cols:", users.rows.map((r: any) => r.column_name).join(", "));

  const userRow = await client.query(`SELECT * FROM sport_center.users WHERE id = 60 LIMIT 1`);
  console.log("users id=60:", JSON.stringify(userRow.rows[0]));

  await client.end();
}
main().catch(e => { console.error("❌", e.message); process.exit(1); });
