import { loadSecretsFromGSM } from "../../artifacts/api-server/src/lib/secretLoader";

const APPLY = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");

if (!APPLY || !PROD) {
  console.error(
    "Refusing to run. Use --prod --apply to repair confirmed payments missing accounting journals.",
  );
  process.exit(1);
}

process.env.NODE_ENV = "production";

const secretResult = await loadSecretsFromGSM();
if (secretResult.fatal.length > 0) {
  console.error("[missing-payment-journals] Production secret bootstrap failed.");
  process.exit(1);
}

const { centralFinanceModeForDiagnostics } = await import(
  "../../artifacts/api-server/src/lib/centralFinance"
);
if (centralFinanceModeForDiagnostics() === "central") {
  console.error(
    "[missing-payment-journals] Refusing legacy repair while Central Finance mode is active.",
  );
  process.exit(1);
}

const { getProdPool, processPaymentAccountingOutbox } = await import(
  "../../artifacts/api-server/src/lib/bizportalSync"
);
const pool = getProdPool();
if (!pool) {
  console.error("[missing-payment-journals] Production database URL is unavailable.");
  process.exit(1);
}

const missingQuery = `
  SELECT sp.id, sb.order_number, sp.amount, aj.id AS journal_id,
         COUNT(l.id)::int AS line_count,
         o.id AS outbox_id, o.status AS outbox_status
    FROM sport_center.sport_payments sp
    JOIN sport_center.sport_bookings sb ON sb.id = sp.booking_id
    LEFT JOIN sport_center.accounting_journals aj
      ON aj.payment_id = sp.id
     AND aj.journal_type = 'payment_confirmed'
     AND aj.is_reversal = false
    LEFT JOIN sport_center.accounting_journal_lines l
      ON l.journal_id = aj.id
    LEFT JOIN sport_center.payment_accounting_outbox o
      ON o.payment_id = sp.id
     AND o.event_type = 'payment_confirmed'
   WHERE sp.status = 'confirmed'
   GROUP BY sp.id, sb.order_number, sp.amount, aj.id, o.id, o.status
  HAVING aj.id IS NULL OR COUNT(l.id) = 0
   ORDER BY sp.id
`;

try {
  const before = await pool.query(missingQuery);
  if (before.rows.length === 0) {
    console.log("[missing-payment-journals] No confirmed payments are missing journals.");
    process.exit(0);
  }

  console.log(
    "[missing-payment-journals] Candidates:",
    JSON.stringify(before.rows, null, 2),
  );
  const candidatePaymentIds = before.rows.map((row) => Number(row.id));

  await pool.query("BEGIN");
  try {
    await pool.query("SELECT pg_advisory_xact_lock(918274615)");
    await pool.query(
      "SET LOCAL sport_center.allow_posted_accounting_journal_lines_backfill = 'on'",
    );
    await pool.query(`
      INSERT INTO sport_center.accounting_journal_lines
        (journal_id, line_type, account_code, account_name, amount, description)
      SELECT
        aj.id, line.line_type, line.account_code, line.account_name,
        line.amount, line.description
      FROM sport_center.accounting_journals aj
      JOIN sport_center.sport_payments sp ON sp.id = aj.payment_id
      CROSS JOIN LATERAL (
        VALUES
          (
            'debit',
            CASE
              WHEN lower(coalesce(aj.payment_method, '')) LIKE '%cash%'
                OR lower(coalesce(aj.payment_method, '')) LIKE '%tunai%' THEN '1101'
              ELSE '1104'
            END,
            aj.debit_account,
            aj.debit_amount,
            'Penerimaan booking ' || aj.order_number ||
              CASE WHEN aj.payment_method IS NULL THEN '' ELSE ' via ' || aj.payment_method END
          ),
          (
            'credit',
            '4-1001',
            aj.credit_revenue_account,
            aj.credit_revenue_amount,
            'Pendapatan booking ' || aj.order_number
          ),
          (
            'credit',
            '2-1101',
            aj.credit_ppn_account,
            aj.credit_ppn_amount,
            'PPN 11% booking ' || aj.order_number
          )
      ) AS line(line_type, account_code, account_name, amount, description)
      WHERE sp.status = 'confirmed'
        AND aj.journal_type = 'payment_confirmed'
        AND aj.is_reversal = false
        AND (line.account_code <> '2-1101' OR aj.credit_ppn_amount > 0)
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.accounting_journal_lines l
           WHERE l.journal_id = aj.id
        )
    `);
    await pool.query(`
      UPDATE sport_center.payment_accounting_outbox o
         SET status = 'pending',
             available_at = NOW(),
             locked_at = NULL,
             last_error = NULL,
             updated_at = NOW()
       WHERE o.status IN ('processing', 'failed')
         AND (o.locked_at IS NULL OR o.locked_at < NOW() - INTERVAL '15 minutes')
         AND o.event_type = 'payment_confirmed'
         AND o.payment_id = ANY($1::int[])
         AND EXISTS (
           SELECT 1
             FROM sport_center.sport_payments sp
             LEFT JOIN sport_center.accounting_journals aj
               ON aj.payment_id = sp.id
              AND aj.journal_type = 'payment_confirmed'
              AND aj.is_reversal = false
            WHERE sp.id = o.payment_id
              AND sp.status = 'confirmed'
              AND (
                aj.id IS NULL
                OR NOT EXISTS (
                  SELECT 1
                    FROM sport_center.accounting_journal_lines l
                   WHERE l.journal_id = aj.id
                )
              )
         )
    `, [candidatePaymentIds]);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => {});
    throw error;
  }

  let totalPosted = 0;
  let totalClaimed = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await processPaymentAccountingOutbox();
    totalClaimed += result.claimed;
    totalPosted += result.posted;
    console.log("[missing-payment-journals] Batch:", result);
    if (result.claimed === 0) break;
  }

  const after = await pool.query(missingQuery);
  const summary = {
    candidates: before.rows.length,
    claimed: totalClaimed,
    posted: totalPosted,
    remaining: after.rows.length,
    remainingRows: after.rows,
  };
  console.log("[missing-payment-journals] Result:", JSON.stringify(summary, null, 2));

  if (after.rows.length > 0) {
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}