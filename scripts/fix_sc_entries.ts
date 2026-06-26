import pg from "pg";
const { Client } = pg;

const url = process.env.SUPABASE_DATABASE_URL_DEV;
if (!url) { console.error("SUPABASE_DATABASE_URL_DEV not set"); process.exit(1); }

const client = new Client({ connectionString: url });
await client.connect();

const corrections: Record<string, { grandTotal: number; ppnAmount: number; netRevenue: number }> = {
  "SC-0005": { grandTotal: 30000, ppnAmount: 2973, netRevenue: 27027 },
  "SC-0006": { grandTotal: 100000, ppnAmount: 9910, netRevenue: 90090 },
};

try {
  await client.query("SET session_replication_role = replica");

  const entries = await client.query(`
    SELECT id, ref, total_debit, total_credit FROM public.accounting_entries
    WHERE source = 'sport_center_booking' AND ref IN ('SC-0005','SC-0006')
    ORDER BY ref
  `);
  console.log("Entries sebelum fix:", entries.rows);

  for (const row of entries.rows) {
    const c = corrections[row.ref as string];
    if (!c) continue;
    const entryId = row.id;

    await client.query(
      `UPDATE public.accounting_entries SET total_debit=$1, total_credit=$1, updated_at=NOW() WHERE id=$2`,
      [c.grandTotal, entryId]
    );

    const lines = await client.query(
      `SELECT id, debit, credit FROM public.accounting_entry_lines WHERE entry_id=$1`,
      [entryId]
    );
    for (const line of lines.rows) {
      if (Number(line.debit) > 0) {
        await client.query(
          `UPDATE public.accounting_entry_lines SET debit=$1, updated_at=NOW() WHERE id=$2`,
          [c.grandTotal, line.id]
        );
        console.log(`  ${row.ref} Kas line ${line.id}: ${line.debit} → ${c.grandTotal}`);
      } else if (Number(line.credit) > 0) {
        const cr = Math.round(Number(line.credit));
        if (cr === c.ppnAmount) {
          console.log(`  ${row.ref} PPN line ${line.id}: ${line.credit} (ok, tidak diubah)`);
        } else {
          await client.query(
            `UPDATE public.accounting_entry_lines SET credit=$1, updated_at=NOW() WHERE id=$2`,
            [c.netRevenue, line.id]
          );
          console.log(`  ${row.ref} Pendapatan line ${line.id}: ${line.credit} → ${c.netRevenue}`);
        }
      }
    }
  }

  const verify = await client.query(`
    SELECT ae.ref, ae.total_debit, ael.debit, ael.credit
    FROM public.accounting_entries ae
    JOIN public.accounting_entry_lines ael ON ael.entry_id=ae.id
    WHERE ae.source='sport_center_booking' AND ae.ref IN ('SC-0005','SC-0006')
    ORDER BY ae.ref, ael.id
  `);
  console.log("\nVerifikasi setelah fix:");
  verify.rows.forEach(r => console.log(JSON.stringify(r)));

} finally {
  await client.query("SET session_replication_role = DEFAULT");
  await client.end();
}
