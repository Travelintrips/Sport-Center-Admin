import pg from "pg";

type QueryClient = pg.PoolClient | pg.Pool;

export type CentralSettlementInput = {
  paymentId: number;
  bookingId: number;
  orderNumber: string;
  companyId: number;
  providerCode: string;
  paymentMethod: string;
  paymentType: string;
  bankAccountId: string | null;
  settlementDate: string | null;
  journalDate: string;
  grossAmount: number;
  ppnRate: number;
  canonicalBankMutationId: number;
};

/**
 * Create the canonical settlement batch for one central-owned payment.
 *
 * The database function is the settlement owner: it resolves the active rule,
 * calculates MDR/net, takes the identity lock, and returns an existing batch
 * on retry. The caller deliberately supplies the transaction client so a
 * rollback harness (and the runtime's controlled transaction) contains every
 * financial row.
 */
export async function ensureCentralPaymentSettlement(
  client: QueryClient,
  input: CentralSettlementInput,
): Promise<number> {
  if (!input.settlementDate) {
    throw new Error(`CONFIG_SETTLEMENT_DATE_MISSING: payment=${input.paymentId}`);
  }

  const canonical = await client.query(
    `SELECT id
       FROM public.bank_mutations
      WHERE id = $1
        AND canonical_key = $2
        AND source_app = 'sport_center'
        AND source_module = 'central_finance'
      FOR SHARE`,
    [input.canonicalBankMutationId, `sport_center:payment:${input.paymentId}`],
  );
  if (canonical.rows.length !== 1) {
    throw new Error(`CANONICAL_BANK_MUTATION_REQUIRED: payment=${input.paymentId}`);
  }

  const ppnAmount = input.ppnRate > 0
    ? Math.round((input.grossAmount * input.ppnRate) / (100 + input.ppnRate))
    : 0;
  const dppAmount = input.grossAmount - ppnAmount;
  const journal = await client.query(
    `SELECT id, gross_amount
       FROM sport_center.accounting_journals
      WHERE payment_id = $1
        AND journal_type = 'payment_confirmed'
        AND is_reversal = false
      FOR UPDATE`,
    [input.paymentId],
  );
  if (journal.rows.length > 1) {
    throw new Error(`CENTRAL_PAYMENT_JOURNAL_AMBIGUOUS: payment=${input.paymentId}`);
  }
  if (journal.rows.length === 1) {
    if (Math.abs(Number(journal.rows[0].gross_amount) - input.grossAmount) > 0.005) {
      throw new Error(`CENTRAL_PAYMENT_JOURNAL_AMOUNT_MISMATCH: payment=${input.paymentId}`);
    }
    await client.query(
      `UPDATE sport_center.accounting_journals
          SET status = 'posted'
        WHERE id = $1
          AND status <> 'posted'`,
      [journal.rows[0].id],
    );
  } else {
    await client.query(
      `INSERT INTO sport_center.accounting_journals
         (booking_id, payment_id, company_id, order_number, journal_type, status,
          payment_method, payment_provider, payment_type, bank_account_id,
          gross_amount, dpp_amount, tax_amount, debit_account, debit_amount,
          credit_revenue_account, credit_revenue_amount, credit_ppn_account,
          credit_ppn_amount, journal_date, is_reversal, notes)
       VALUES ($1,$2,$3,$4,'payment_confirmed','posted',$5,$6,$7,$8,
               $9,$10,$11,$12,$9,$13,$14,$15,$11,$16,false,$17)`,
      [
        input.bookingId,
        input.paymentId,
        input.companyId,
        input.orderNumber,
        input.paymentMethod,
        input.providerCode,
        input.paymentType,
        input.bankAccountId,
        input.grossAmount,
        dppAmount,
        ppnAmount,
        input.paymentMethod.toLowerCase().includes("qris") ? "Bank Mandiri" : "Bank Mandiri",
        "Pendapatan Sport Center",
        dppAmount,
        "PPN Keluaran",
        input.journalDate,
        `Central settlement source journal for payment ${input.paymentId}`,
      ],
    );
  }

  const eligibility = await client.query(
    `SELECT p.id, p.status::text AS status, p.company_id,
            p.payment_provider::text AS provider, p.bank_account_id,
            p.expected_settlement_date::text AS expected_settlement_date,
            j.id AS journal_id, j.status AS journal_status,
            j.journal_type, j.is_reversal
       FROM sport_center.sport_payments p
       LEFT JOIN sport_center.accounting_journals j
         ON j.payment_id = p.id
        AND j.journal_type = 'payment_confirmed'
        AND j.is_reversal = false
      WHERE p.id = $1`,
    [input.paymentId],
  );
  const eligible = eligibility.rows[0];
  if (
    !eligible ||
    eligible.status !== "confirmed" ||
    Number(eligible.company_id) !== input.companyId ||
    String(eligible.provider ?? "").toLowerCase() !== input.providerCode.toLowerCase() ||
    String(eligible.bank_account_id ?? "") !== String(input.bankAccountId ?? "") ||
    String(eligible.expected_settlement_date ?? "") !== input.settlementDate ||
    !eligible.journal_id ||
    eligible.journal_status !== "posted"
  ) {
    throw new Error(
      `CENTRAL_SETTLEMENT_PRECHECK_FAILED: ${JSON.stringify({
        paymentId: input.paymentId,
        expected: {
          status: "confirmed",
          companyId: input.companyId,
          provider: input.providerCode,
          bankAccountId: input.bankAccountId,
          settlementDate: input.settlementDate,
          journalStatus: "posted",
        },
        actual: eligible ?? null,
      })}`,
    );
  }

  const result = await client.query(
    `SELECT sport_center.create_payment_settlement_batch(
       $1, $2, $3, $4, $5::date, ARRAY[$6]::integer[], $7
     ) AS id`,
    [
      `sport_center:payment:${input.paymentId}`,
      input.companyId,
      input.providerCode,
      input.bankAccountId,
      input.settlementDate,
      input.paymentId,
      "central_finance",
    ],
  );
  const batchId = Number(result.rows[0]?.id);
  if (!batchId) {
    throw new Error(`CENTRAL_SETTLEMENT_BATCH_NOT_CREATED: payment=${input.paymentId}`);
  }

  const linked = await client.query(
    `SELECT canonical_bank_mutation_id, bank_mutation_id
       FROM sport_center.payment_settlement_batches
      WHERE id = $1
      FOR SHARE`,
    [batchId],
  );
  const row = linked.rows[0];
  if (
    !row ||
    Number(row.canonical_bank_mutation_id) !== input.canonicalBankMutationId ||
    row.bank_mutation_id != null
  ) {
    throw new Error(`CENTRAL_SETTLEMENT_MUTATION_LINK_INVALID: batch=${batchId}`);
  }
  return batchId;
}