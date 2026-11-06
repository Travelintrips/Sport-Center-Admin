import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  matchMandiriQrisEmailToPayments,
  parseMandiriQrisMerchantEmail,
  type MandiriQrisEmailPaymentCandidate,
} from "./mandiriQrisEmailReconciliation";
import type { MandiriGmailMessage } from "./gmailMandiriQrisDevSource";

function rows<T>(result: unknown): T[] {
  return (((result as any)?.rows ?? result ?? []) as T[]);
}

function fingerprint(message: MandiriGmailMessage): string {
  return createHash("sha256")
    .update(message.id)
    .update("\n")
    .update(message.bodyText.replace(/\r/g, "").trim())
    .digest("hex");
}

export type QrisEmailIngestResult = {
  gmailMessageId: string;
  inserted: boolean;
  reconciled: boolean;
  decision: string;
  reason: string;
  candidatePaymentIds: number[];
};

export async function ingestMandiriQrisGmailMessage(
  message: MandiriGmailMessage,
  sourceMailbox: string,
): Promise<QrisEmailIngestResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("QRIS Gmail DEV ingestion cannot run in production");
  }
  const transaction = parseMandiriQrisMerchantEmail(message.bodyText);
  if (!transaction.valid || transaction.total == null || !transaction.transactionDate || !transaction.transactionTime) {
    const decision = matchMandiriQrisEmailToPayments(message.bodyText, []);
    return {
      gmailMessageId: message.id,
      inserted: false,
      reconciled: false,
      decision: decision.decision,
      reason: decision.reason,
      candidatePaymentIds: [],
    };
  }

  const reference = transaction.reference ?? "";
  const candidateResult = await db.execute(sql`
    SELECT
      id,
      amount,
      payment_method AS "paymentMethod",
      payment_provider::text AS "paymentProvider",
      provider_reference AS "providerReference",
      merchant_trade_no AS "merchantTradeNo",
      provider_trade_no AS "providerTradeNo",
      status::text AS status
    FROM sport_center.sport_payments
    WHERE payment_method = 'QRIS'
      AND payment_provider::text = 'mandiri_direct'
      AND status::text NOT IN ('confirmed','rejected')
      AND (
        ABS(amount::numeric - ${transaction.total}::numeric) < 0.005
        OR provider_reference = ${reference}
        OR merchant_trade_no = ${reference}
        OR provider_trade_no = ${reference}
      )
    ORDER BY id DESC
    LIMIT 25
  `);
  const candidates = rows<MandiriQrisEmailPaymentCandidate>(candidateResult).map((row) => ({
    ...row,
    id: Number(row.id),
    amount: Number(row.amount),
  }));
  const match = matchMandiriQrisEmailToPayments(message.bodyText, candidates);
  const matchStatus =
    match.decision === "REFERENCE_MATCH_REVIEW" ? "reference_match_review" :
    match.decision === "AMBIGUOUS_REVIEW" || match.decision === "AMOUNT_ONLY_REVIEW" ? "ambiguous" :
    match.decision === "UNMATCHED" ? "unmatched" : "invalid";

  const insert = await db.execute(sql`
    INSERT INTO sport_center.qris_email_transactions_dev (
      gmail_message_id, source_mailbox, merchant_name, acquirer,
      provider_reference, issuer_rrn, payer_bank, payer_name,
      transaction_at, amount, tip, total, parse_status, match_status,
      candidate_payment_ids, fingerprint_sha256, created_at, updated_at
    )
    VALUES (
      ${message.id},
      ${sourceMailbox},
      ${transaction.merchant ?? ""},
      ${transaction.acquirer ?? ""},
      ${transaction.reference ?? ""},
      ${transaction.issuerRrn},
      ${transaction.payerBank},
      ${transaction.payerName},
      (${transaction.transactionDate} || ' ' || ${transaction.transactionTime})::timestamp AT TIME ZONE 'Asia/Jakarta',
      ${transaction.amount ?? 0},
      ${transaction.tip ?? 0},
      ${transaction.total},
      'parsed',
      ${matchStatus},
      ${match.candidatePaymentIds}::integer[],
      ${fingerprint(message)},
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `);

  const inserted = rows<{ id: unknown }>(insert).length > 0;
  let reconciled = false;

  if (!inserted) {
    const update = await db.execute(sql`
      UPDATE sport_center.qris_email_transactions_dev
      SET
        match_status = ${matchStatus},
        candidate_payment_ids = ${match.candidatePaymentIds}::integer[],
        updated_at = NOW()
      WHERE gmail_message_id = ${message.id}
        AND (
          match_status IS DISTINCT FROM ${matchStatus}
          OR candidate_payment_ids IS DISTINCT FROM ${match.candidatePaymentIds}::integer[]
        )
      RETURNING id
    `);
    reconciled = rows<{ id: unknown }>(update).length > 0;
  }

  return {
    gmailMessageId: message.id,
    inserted,
    reconciled,
    decision: match.decision,
    reason: match.reason,
    candidatePaymentIds: match.candidatePaymentIds,
  };
}
