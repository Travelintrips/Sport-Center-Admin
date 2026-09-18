import pg from "pg";
import { loadSecretsFromGSM } from "../../artifacts/api-server/src/lib/secretLoader.js";

const { Client } = pg;
const APPLY = process.argv.includes("--apply");

type InvoiceAggregate = {
  id: number;
  invoice_number: string;
  status: string;
  item_count: string;
  current_total_amount: string;
  current_ppn_amount: string;
  current_grand_total: string;
  current_net_amount: string;
  current_remaining_amount: string;
  paid_amount: string;
  recalculated_total_amount: string;
  recalculated_dpp: string;
  recalculated_ppn_amount: string;
  recalculated_grand_total: string;
};

const aggregateSql = `
  WITH item_values AS (
    SELECT
      invoice_id,
      GREATEST(0, ROUND(COALESCE(subtotal, total_amount, 0)::numeric)) AS total_price,
      GREATEST(0, ROUND(COALESCE(tax_amount, 0)::numeric)) AS stored_ppn,
      GREATEST(0, ROUND(COALESCE(total_amount, subtotal, 0)::numeric)) AS stored_grand
    FROM sport_center.company_invoice_items
  ),
  normalized AS (
    SELECT
      invoice_id,
      total_price,
      stored_ppn,
      stored_grand,
      (
        stored_ppn > 0
        AND total_price > 0
        AND stored_grand > total_price
        AND ABS(stored_grand - total_price - stored_ppn) <= 1
      ) AS legacy_additive
    FROM item_values
  ),
  aggregates AS (
    SELECT
      invoice_id,
      COUNT(*)::text AS item_count,
      SUM(total_price)::numeric AS recalculated_total_amount,
      SUM(
        CASE
          WHEN legacy_additive THEN ROUND(total_price / 1.11)
          ELSE GREATEST(0, stored_grand - stored_ppn)
        END
      )::numeric AS recalculated_dpp,
      SUM(
        CASE
          WHEN legacy_additive
            THEN ROUND(ROUND(ROUND(total_price / 1.11) * 11 / 12) * 0.12)
          ELSE stored_ppn
        END
      )::numeric AS recalculated_ppn_amount,
      SUM(CASE WHEN legacy_additive THEN total_price ELSE stored_grand END)::numeric
        AS recalculated_grand_total
    FROM normalized
    GROUP BY invoice_id
    HAVING COUNT(*) > 1
  )
  SELECT
    i.id,
    i.invoice_number,
    i.status,
    a.item_count,
    i.total_amount::text AS current_total_amount,
    i.ppn_amount::text AS current_ppn_amount,
    i.grand_total::text AS current_grand_total,
    i.net_amount::text AS current_net_amount,
    i.remaining_amount::text AS current_remaining_amount,
    i.paid_amount::text AS paid_amount,
    ROUND(a.recalculated_total_amount)::text AS recalculated_total_amount,
    ROUND(a.recalculated_dpp)::text AS recalculated_dpp,
    ROUND(a.recalculated_ppn_amount)::text AS recalculated_ppn_amount,
    ROUND(a.recalculated_grand_total)::text AS recalculated_grand_total
  FROM sport_center.company_invoices i
  JOIN aggregates a ON a.invoice_id = i.id
  ORDER BY i.id
`;

function numberValue(value: string | null | undefined): number {
  return Number(value ?? 0);
}

function changed(row: InvoiceAggregate): boolean {
  return (
    numberValue(row.current_total_amount) !== numberValue(row.recalculated_total_amount) ||
    numberValue(row.current_ppn_amount) !== numberValue(row.recalculated_ppn_amount) ||
    numberValue(row.current_grand_total) !== numberValue(row.recalculated_grand_total)
  );
}

async function main() {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Refusing to run: NODE_ENV must be production.");
  }

  if (!process.env.SUPABASE_DATABASE_URL) {
    const secretResult = await loadSecretsFromGSM();
    if (secretResult.fatal.length > 0) {
      throw new Error(`Production secrets could not be loaded: ${secretResult.fatal.join("; ")}`);
    }
  }

  const rawUrl = process.env.SUPABASE_DATABASE_URL;
  if (!rawUrl) throw new Error("SUPABASE_DATABASE_URL was not loaded.");

  const connectionString = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    query_timeout: 60_000,
  });

  await client.connect();
  try {
    const identity = await client.query<{
      database_name: string;
      database_user: string;
      server_port: number;
    }>(
      "SELECT current_database() AS database_name, current_user AS database_user, inet_server_port() AS server_port",
    );
    console.log(JSON.stringify({ mode: APPLY ? "APPLY" : "DRY_RUN", identity: identity.rows[0] }));

    const before = await client.query<InvoiceAggregate>(aggregateSql);
    const candidates = before.rows.filter(changed);
    console.log(JSON.stringify({
      invoiceCountWithMultipleSessions: before.rows.length,
      invoiceCountNeedingCorrection: candidates.length,
      candidates: candidates.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        status: row.status,
        itemCount: Number(row.item_count),
        before: {
          totalAmount: numberValue(row.current_total_amount),
          ppnAmount: numberValue(row.current_ppn_amount),
          grandTotal: numberValue(row.current_grand_total),
          netAmount: numberValue(row.current_net_amount),
          remainingAmount: numberValue(row.current_remaining_amount),
        },
        after: {
          totalAmount: numberValue(row.recalculated_total_amount),
          dpp: numberValue(row.recalculated_dpp),
          ppnAmount: numberValue(row.recalculated_ppn_amount),
          grandTotal: numberValue(row.recalculated_grand_total),
        },
      })),
    }, null, 2));

    if (!APPLY || candidates.length === 0) return;

    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "sport-center-company-invoice-total-backfill",
      ]);

      let updated = 0;
      for (const row of candidates) {
        const pphRate = 0;
        const pphAmount = 0;
        const netAmount = numberValue(row.recalculated_grand_total);
        const remainingAmount = Math.max(
          0,
          numberValue(row.recalculated_grand_total) - numberValue(row.paid_amount),
        );
        const result = await client.query(
          `UPDATE sport_center.company_invoices
              SET total_amount = $1,
                  dpp_nilai_lain = $2,
                  ppn_amount = $3,
                  grand_total = $4,
                  pph_rate = CASE WHEN pph_rate::numeric > 0 THEN pph_rate ELSE $5 END,
                  pph_amount = CASE
                    WHEN pph_rate::numeric > 0 OR pph_amount::numeric > 0
                      THEN ROUND($2::numeric * COALESCE(NULLIF(pph_rate::numeric, 0), 10) / 100)
                    ELSE $6
                  END,
                  net_amount = CASE
                    WHEN pph_rate::numeric > 0 OR pph_amount::numeric > 0
                      THEN GREATEST(0, $4::numeric - ROUND($2::numeric * COALESCE(NULLIF(pph_rate::numeric, 0), 10) / 100))
                    ELSE $7
                  END,
                  remaining_amount = GREATEST(0, $4::numeric - paid_amount::numeric)
            WHERE id = $8
              AND EXISTS (
                SELECT 1
                FROM sport_center.company_invoice_items item
                WHERE item.invoice_id = company_invoices.id
              )`,
          [
            row.recalculated_total_amount,
            numberValue(row.recalculated_ppn_amount) > 0
              ? Math.round(numberValue(row.recalculated_dpp) * 11 / 12)
              : 0,
            row.recalculated_ppn_amount,
            row.recalculated_grand_total,
            pphRate,
            pphAmount,
            netAmount,
            row.id,
          ],
        );
        updated += result.rowCount ?? 0;
      }

      await client.query("COMMIT");
      console.log(JSON.stringify({ applied: true, updated }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});