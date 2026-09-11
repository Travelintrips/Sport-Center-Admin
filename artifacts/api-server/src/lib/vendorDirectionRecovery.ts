import type { BankMutation } from "@workspace/db";

const VENDOR_DESCRIPTION_PATTERN =
  /vendor|supplier|pemasok|pembayaran\s+vendor|invoice|faktur/i;

export type VendorDirectionRecoveryBlocker =
  | "already_approved"
  | "already_rejected"
  | "accounting_posted"
  | "journal_attached"
  | "approved_match"
  | "period_locked"
  | "not_vendor_evidence"
  | "missing_debit_evidence"
  | "ambiguous_credit_and_debit"
  | "duplicate_out_mutation";

export type VendorDirectionRecoveryAssessment = {
  eligible: boolean;
  debitAmount: number | null;
  evidence: string[];
  blockers: VendorDirectionRecoveryBlocker[];
};

function numericValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text || text === "-") return 0;
  const normalized = text.includes(".") && text.includes(",")
    ? (text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, ""))
    : text.includes(",")
      ? text.replace(",", ".")
      : text;
  return Number(normalized.replace(/[^0-9.-]/g, "")) || 0;
}

function payloadValue(payload: unknown, names: string[]): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const normalized = key.toLowerCase().replace(/[\s\-\.]+/g, "_");
    if (names.includes(normalized)) return value;
  }
  return undefined;
}

/**
 * A legacy IN row is recoverable only when the original debit/keluar evidence
 * is still present. We never infer OUT merely from vendor words.
 */
export function assessVendorDirectionRecovery(
  mutation: Pick<BankMutation, "direction" | "status" | "accountingPosted" | "journalId" | "description" | "amount" | "creditAmount" | "debitAmount" | "rawPayload">,
  options: { approvedMatch?: boolean; periodLocked?: boolean; duplicateOut?: boolean } = {},
): VendorDirectionRecoveryAssessment {
  const blockers: VendorDirectionRecoveryBlocker[] = [];
  const evidence: string[] = [];

  if (mutation.direction !== "IN") blockers.push("not_vendor_evidence");
  if (mutation.status === "approved") blockers.push("already_approved");
  if (mutation.status === "rejected") blockers.push("already_rejected");
  if (mutation.accountingPosted) blockers.push("accounting_posted");
  if (mutation.journalId) blockers.push("journal_attached");
  if (options.approvedMatch) blockers.push("approved_match");
  if (options.periodLocked) blockers.push("period_locked");
  if (options.duplicateOut) blockers.push("duplicate_out_mutation");

  if (VENDOR_DESCRIPTION_PATTERN.test(mutation.description)) {
    evidence.push("vendor_description");
  } else {
    blockers.push("not_vendor_evidence");
  }

  const payloadCredit = numericValue(payloadValue(mutation.rawPayload, ["credit", "kredit", "cr", "masuk", "credit_amount"]));
  const payloadDebit = numericValue(payloadValue(mutation.rawPayload, ["debit", "db", "keluar", "debit_amount"]));
  const storedCredit = numericValue(mutation.creditAmount);
  const storedDebit = numericValue(mutation.debitAmount);
  const debitAmount = Math.max(storedDebit, payloadDebit);
  const creditAmount = Math.max(storedCredit, payloadCredit);

  if (debitAmount > 0) {
    evidence.push(storedDebit > 0 ? "stored_debit_amount" : "raw_payload_debit_amount");
  } else {
    blockers.push("missing_debit_evidence");
  }
  if (creditAmount > 0) blockers.push("ambiguous_credit_and_debit");

  const originalAmount = numericValue(mutation.amount);
  if (debitAmount > 0 && Math.abs(debitAmount - originalAmount) > 0.01) {
    evidence.push("amount_corrected_from_debit");
  }

  return {
    eligible: blockers.length === 0 && debitAmount > 0,
    debitAmount: debitAmount > 0 ? debitAmount : null,
    evidence,
    blockers: [...new Set(blockers)],
  };
}