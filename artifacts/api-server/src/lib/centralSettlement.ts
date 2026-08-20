import pg from "pg";

type QueryClient = pg.PoolClient | pg.Pool;

export type CentralSettlementInput = {
  paymentId: number;
  companyId: number;
  providerCode: string;
  bankAccountId: string | null;
  settlementDate: string | null;
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