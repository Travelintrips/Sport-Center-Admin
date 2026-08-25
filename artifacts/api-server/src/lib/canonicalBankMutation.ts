import pg from "pg";

type QueryClient = pg.PoolClient | pg.Pool;

export type CanonicalBankMutationInput = {
  paymentId: number;
  companyId: number;
  amount: number;
  paymentMethod: string;
  paymentProvider: string;
  bankAccountId: string | null;
  providerReference: string | null;
  providerOrderId: string | null;
  orderNumber: string;
  journalEntryId: number;
  occurredAt: string;
};

/**
 * Creates the shared bank identity for a central-mode Sport Center payment.
 *
 * The canonical key is payment-scoped because one booking may contain DP and
 * pelunasan. This intentionally writes public.bank_mutations directly; the
 * Sport Center bank_mutations projection is a legacy/reconciliation surface.
 */
export async function ensureCanonicalSportCenterBankMutation(
  client: QueryClient,
  input: CanonicalBankMutationInput,
): Promise<number> {
  const canonicalKey = `sport_center:payment:${input.paymentId}`;
  const mutationKey = `SC-PAY-${input.paymentId}`;
  const description = `SPORT CENTER | ${input.orderNumber} | ${input.paymentMethod}`;
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const providerOrderId = input.providerOrderId ?? input.providerReference;

  const result = await client.query(
    `INSERT INTO public.bank_mutations
       (bank_account_id, transaction_date, description, credit_amount, debit_amount,
        amount, direction, mutation_key, normalized_description, provider_name,
        provider_order_id, status, company_id, owner_app, owner_company_id,
        source_app, source_module, source_table, source_id, accounting_posted,
        linked_transaction_type, linked_transaction_id, journal_entry_id,
        source, reconciliation_status, canonical_key, suspected_duplicate,
        source_classification, created_at, updated_at)
     VALUES ($1,$2::date,$3,$4,0,$4,'IN',$5,$6,$7,$8,'unmatched',$9,
             'sport_center',$9,'sport_center','central_finance','sport_payments',
             $10,true,'sport_center_payment',$10,$11,'sport_center_payment',
             'unreconciled',$12,false,'synthetic',NOW(),NOW())
      ON CONFLICT (canonical_key) WHERE canonical_key IS NOT NULL DO UPDATE
       SET journal_entry_id = EXCLUDED.journal_entry_id,
           accounting_posted = true,
           linked_transaction_type = EXCLUDED.linked_transaction_type,
           linked_transaction_id = EXCLUDED.linked_transaction_id,
           updated_at = NOW()
     WHERE public.bank_mutations.source_app = 'sport_center'
       AND public.bank_mutations.source_table = 'sport_payments'
       AND public.bank_mutations.source_id = EXCLUDED.source_id
     RETURNING id`,
    [
      input.bankAccountId,
      input.occurredAt.slice(0, 10),
      description,
      Math.round(input.amount),
      mutationKey,
      normalizedDescription,
      input.paymentProvider,
      providerOrderId,
      input.companyId,
      input.paymentId,
      input.journalEntryId,
      canonicalKey,
    ],
  );

  const mutationId = Number(result.rows[0]?.id);
  if (!mutationId) {
    throw new Error(`CANONICAL_BANK_MUTATION_IDENTITY_CONFLICT:${canonicalKey}`);
  }
  return mutationId;
}