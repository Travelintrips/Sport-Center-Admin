/**
 * fix_sc_entries.ts
 * Fix jumlah yang salah di public.accounting_entries untuk SC-0005 dan SC-0006.
 * Jalankan: tsx scripts/fix_sc_entries.ts
 *
 * Idempotent: script membandingkan nilai saat ini sebelum update.
 */
import pg from "pg";
const { Client } = pg;

const url = process.env.SUPABASE_DATABASE_URL_DEV;
if (!url) { console.error("SUPABASE_DATABASE_URL_DEV not set"); process.exit(1); }

const client = new Client({ connectionString: url });
await client.connect();

const corrections: Record<string, { grandTotal: number; ppnAmount: number; netRevenue: number }> = {
  "SC-0005": { grandTotal: 30000,  ppnAmount: 2973,  netRevenue: 27027 },
  "SC-0006": { grandTotal: 100000, ppnAmount: 9910,  netRevenue: 90090 },
};

await client.query("BEGIN");
try {
  // Bypass immutability trigger — scoped to this transaction via SET LOCAL
  await client.query("SET LOCAL session_replication_role = replica");

  const entries = await client.query(`
    SELECT id, ref, total_debit, total_credit FROM public.accounting_entries
    WHERE source = 'sport_center_booking' AND ref = ANY($1::text[])
    ORDER BY ref
  `, [Object.keys(corrections)]);

  if (entries.rows.length === 0) {
    console.log("Tidak ada entry SC-0005/SC-0006 di DB ini — tidak ada yang perlu difix.");
    await client.query("ROLLBACK");
    await client.end();
    process.exit(0);
  }

  console.log("Entries sebelum fix:", entries.rows);

  for (const row of entries.rows) {
    const c = corrections[row.ref as string];
    if (!c) continue;
    const entryId = row.id;

    // Idempotency: skip jika total sudah benar
    if (Number(row.total_debit) === c.grandTotal && Number(row.total_credit) === c.grandTotal) {
      console.log(`  ${row.ref} — total sudah benar (${c.grandTotal}), skip entry header.`);
    } else {
      await client.query(
        `UPDATE public.accounting_entries SET total_debit=$1, total_credit=$1, updated_at=NOW() WHERE id=$2`,
        [c.grandTotal, entryId]
      );
      console.log(`  ${row.ref} entry total: ${row.total_debit} → ${c.grandTotal}`);
    }

    const lines = await client.query(
      `SELECT id, debit, credit FROM public.accounting_entry_lines WHERE entry_id=$1`,
      [entryId]
    );
    for (const line of lines.rows) {
      if (Number(line.debit) > 0) {
        if (Number(line.debit) === c.grandTotal) {
          console.log(`  ${row.ref} debit line ${line.id}: ${line.debit} (sudah benar, skip)`);
        } else {
          await client.query(
            `UPDATE public.accounting_entry_lines SET debit=$1, updated_at=NOW() WHERE id=$2`,
            [c.grandTotal, line.id]
          );
          console.log(`  ${row.ref} Kas line ${line.id}: ${line.debit} → ${c.grandTotal}`);
        }
      } else if (Number(line.credit) > 0) {
        const cr = Math.round(Number(line.credit));
        if (cr === c.ppnAmount) {
          console.log(`  ${row.ref} PPN line ${line.id}: ${line.credit} (sudah benar, skip)`);
        } else if (cr === c.netRevenue) {
          console.log(`  ${row.ref} Revenue line ${line.id}: ${line.credit} (sudah benar, skip)`);
        } else {
          // Tentukan apakah ini PPN atau revenue berdasarkan proximity
          const targetCredit = Math.abs(cr - c.ppnAmount) < Math.abs(cr - c.netRevenue)
            ? c.ppnAmount
            : c.netRevenue;
          await client.query(
            `UPDATE public.accounting_entry_lines SET credit=$1, updated_at=NOW() WHERE id=$2`,
            [targetCredit, line.id]
          );
          console.log(`  ${row.ref} credit line ${line.id}: ${line.credit} → ${targetCredit}`);
        }
      }
    }
  }

  await client.query("COMMIT");
  console.log("\n✅ COMMIT OK");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("❌ ROLLBACK:", err);
  await client.end();
  process.exit(1);
}

// Verifikasi akhir
const verify = await client.query(`
  SELECT ae.ref, ae.total_debit, ael.debit, ael.credit
  FROM public.accounting_entries ae
  JOIN public.accounting_entry_lines ael ON ael.entry_id = ae.id
  WHERE ae.source = 'sport_center_booking' AND ae.ref = ANY($1::text[])
  ORDER BY ae.ref, ael.id
`, [Object.keys(corrections)]);
console.log("\nVerifikasi setelah fix:");
verify.rows.forEach(r => console.log(JSON.stringify(r)));

await client.end();
