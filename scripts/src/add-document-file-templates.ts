import { Client } from "pg";

const DB_URL = process.env.SUPABASE_DATABASE_URL_DEV || process.env.SUPABASE_DATABASE_URL;
if (!DB_URL) { console.error("No DB URL"); process.exit(1); }

const SESSION_URL = DB_URL.replace(":6543/", ":5432/");

async function run() {
  const client = new Client({ connectionString: SESSION_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const sqls = [
    `CREATE TABLE IF NOT EXISTS sport_center.document_file_templates (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      document_type TEXT NOT NULL,
      template_type TEXT NOT NULL DEFAULT 'image',
      file_url TEXT NOT NULL,
      file_name TEXT,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_doc_file_tpl_type ON sport_center.document_file_templates(document_type, company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_doc_file_tpl_active ON sport_center.document_file_templates(document_type, is_active)`,
  ];

  for (const sql of sqls) {
    await client.query(sql);
    console.log("OK:", sql.slice(0, 60));
  }

  await client.end();
  console.log("Done.");
}

run().catch((e) => { console.error(e); process.exit(1); });
