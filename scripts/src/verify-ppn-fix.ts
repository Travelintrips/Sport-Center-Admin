import pg from "pg";
const { Client } = pg;
const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL ?? "";
const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("=== sport_center.accounting_journals (MB-1) ===");
const aj = await c.query(`
  SELECT id, order_number, journal_type, debit_amount, credit_revenue_amount, credit_ppn_account, credit_ppn_amount
  FROM sport_center.accounting_journals WHERE order_number = 'MB-1'`);
console.log(JSON.stringify(aj.rows, null, 2));

console.log("\n=== sport_center.accounting_journal_lines (MB-1) ===");
const ajl = await c.query(`
  SELECT l.* FROM sport_center.accounting_journal_lines l
  JOIN sport_center.accounting_journals j ON j.id = l.journal_id
  WHERE j.order_number = 'MB-1'`);
console.log(JSON.stringify(ajl.rows, null, 2));

console.log("\n=== public.accounting_entries (MB-1) ===");
const ae = await c.query(`
  SELECT id, entry_number, ref, status::text, total_debit, total_credit, source::text, correlation_id
  FROM public.accounting_entries WHERE ref = 'MB-1' ORDER BY id`);
console.log(JSON.stringify(ae.rows, null, 2));

console.log("\n=== public.accounting_entry_lines (semua entry MB-1) ===");
const ael = await c.query(`
  SELECT l.entry_id, l.account_id, l.description, l.debit, l.credit
  FROM public.accounting_entry_lines l
  JOIN public.accounting_entries ae ON ae.id = l.entry_id
  WHERE ae.ref = 'MB-1' ORDER BY l.entry_id, l.id`);
console.log(JSON.stringify(ael.rows, null, 2));

await c.end();
