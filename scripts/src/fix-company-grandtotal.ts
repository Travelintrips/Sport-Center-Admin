import pg from "pg";

const { Client } = pg;

const rawUrl = process.env.SUPABASE_DATABASE_URL;
if (!rawUrl) { console.error("SUPABASE_DATABASE_URL not set"); process.exit(1); }

const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log("Connected to prod DB");

  const { rows } = await client.query(`
    UPDATE sport_center.company_invoices
    SET grand_total = (
      ROUND(total_amount::numeric / 1.11) +
      ROUND(ROUND(ROUND(total_amount::numeric / 1.11) * 11 / 12) * 0.12)
    )
    WHERE grand_total::numeric <> (
      ROUND(total_amount::numeric / 1.11) +
      ROUND(ROUND(ROUND(total_amount::numeric / 1.11) * 11 / 12) * 0.12)
    )
    RETURNING id, invoice_number, total_amount::text, grand_total::text
  `);

  console.log(`Fixed ${rows.length} row(s):`);
  for (const r of rows) {
    console.log(`  Invoice ${r.invoice_number}: totalAmount=${r.total_amount} → grandTotal fixed to ${r.grand_total}`);
  }

  await client.end();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
