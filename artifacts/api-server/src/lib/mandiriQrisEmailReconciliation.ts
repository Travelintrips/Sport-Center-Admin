export type MandiriQrisEmailPaymentCandidate = {
  id: number;
  amount: number;
  paymentMethod?: string | null;
  paymentProvider?: string | null;
  providerReference?: string | null;
  merchantTradeNo?: string | null;
  providerTradeNo?: string | null;
  status?: string | null;
};

export type MandiriQrisEmailTransaction = {
  valid: boolean;
  status: "reported_success" | "unrecognized";
  merchant: string | null;
  acquirer: string | null;
  reference: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
  payerBank: string | null;
  payerName: string | null;
  issuerRrn: string | null;
  amount: number | null;
  tip: number | null;
  total: number | null;
};

export type MandiriQrisEmailCandidateResult = {
  decision: "REFERENCE_MATCH_REVIEW" | "AMOUNT_ONLY_REVIEW" | "AMBIGUOUS_REVIEW" | "UNMATCHED" | "INVALID";
  reason: string;
  candidatePaymentIds: number[];
  confidence: "HIGH" | "LOW" | "NONE";
  autoConfirmEligible: false;
  transaction: MandiriQrisEmailTransaction;
};

function field(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp("^\\s*" + escaped + "\\s*:\\s*(.*?)\\s*$", "im"));
  return match?.[1]?.trim() || null;
}

function parseMoney(value: string | null): number | null {
  if (!value || !/^\d{1,3}(?:,\d{3})*(?:\.\d{2})?$|^\d+(?:\.\d{2})?$/.test(value)) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null;
}

export function parseMandiriQrisMerchantEmail(body: string): MandiriQrisEmailTransaction {
  const status = /(?:TRASAKSI|TRANSAKSI)\s+BERHASIL/i.test(body) ? "reported_success" : "unrecognized";
  const reference = field(body, "Nomor Referensi");
  const transactionDate = field(body, "Tanggal Transaksi");
  const transactionTime = field(body, "Waktu Transaksi");
  const amount = parseMoney(field(body, "Nominal Transaksi"));
  const tip = parseMoney(field(body, "TIP"));
  const total = parseMoney(field(body, "Total"));
  const merchant = field(body, "Nama Toko");
  const acquirer = field(body, "Nama Acquirer");

  const validDate = !!transactionDate && /^\d{4}-\d{2}-\d{2}$/.test(transactionDate)
    && !Number.isNaN(Date.parse(transactionDate + "T00:00:00Z"));
  const validTime = !!transactionTime && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(transactionTime);
  const valid = status === "reported_success"
    && acquirer?.trim().toUpperCase() === "MANDIRI"
    && !!merchant
    && !!reference
    && /^[A-Za-z0-9-]{6,64}$/.test(reference)
    && validDate
    && validTime
    && amount != null
    && tip != null
    && total != null
    && Math.abs((amount + tip) - total) < 0.005;

  return {
    valid,
    status,
    merchant,
    acquirer,
    reference,
    transactionDate,
    transactionTime,
    payerBank: field(body, "Pembayaran dari"),
    payerName: field(body, "Nama Customer"),
    issuerRrn: field(body, "Issuer RRN"),
    amount,
    tip,
    total,
  };
}

function normalized(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function eligiblePayment(payment: MandiriQrisEmailPaymentCandidate): boolean {
  const status = normalized(payment.status).toLowerCase();
  return normalized(payment.paymentMethod) === "QRIS"
    && normalized(payment.paymentProvider) === "MANDIRI_DIRECT"
    && status !== "confirmed"
    && status !== "rejected";
}

/**
 * Email is detection evidence only. It never auto-confirms a booking/payment.
 * Final confirmation remains gated by existing settlement/bank reconciliation.
 */
export function matchMandiriQrisEmailToPayments(
  body: string,
  payments: MandiriQrisEmailPaymentCandidate[],
): MandiriQrisEmailCandidateResult {
  const transaction = parseMandiriQrisMerchantEmail(body);
  const base = {
    autoConfirmEligible: false as const,
    transaction,
  };

  if (!transaction.valid || transaction.total == null || !transaction.reference) {
    return { ...base, decision: "INVALID", reason: "INVALID_MANDIRI_EMAIL", candidatePaymentIds: [], confidence: "NONE" };
  }

  const candidates = payments.filter(eligiblePayment);
  const reference = normalized(transaction.reference);
  const referenced = candidates.filter((payment) =>
    [payment.providerReference, payment.merchantTradeNo, payment.providerTradeNo]
      .some((value) => normalized(value) === reference),
  );

  const referencedExactAmount = referenced.filter(
    (payment) => Math.abs(Number(payment.amount) - transaction.total!) < 0.005,
  );

  if (referencedExactAmount.length === 1) {
    return {
      ...base,
      decision: "REFERENCE_MATCH_REVIEW",
      reason: "EXACT_REFERENCE_AND_AMOUNT_EMAIL_EVIDENCE",
      candidatePaymentIds: [referencedExactAmount[0].id],
      confidence: "HIGH",
    };
  }

  if (referenced.length > 0) {
    return {
      ...base,
      decision: "AMBIGUOUS_REVIEW",
      reason: referenced.length > 1 ? "DUPLICATE_REFERENCE_CANDIDATES" : "REFERENCE_AMOUNT_MISMATCH",
      candidatePaymentIds: referenced.map((payment) => payment.id),
      confidence: "LOW",
    };
  }

  const amountMatches = candidates.filter(
    (payment) => Math.abs(Number(payment.amount) - transaction.total!) < 0.005,
  );

  if (amountMatches.length === 1) {
    return {
      ...base,
      decision: "AMOUNT_ONLY_REVIEW",
      reason: "AMOUNT_ONLY_NOT_AUTHORITATIVE",
      candidatePaymentIds: [amountMatches[0].id],
      confidence: "LOW",
    };
  }

  if (amountMatches.length > 1) {
    return {
      ...base,
      decision: "AMBIGUOUS_REVIEW",
      reason: "AMBIGUOUS_AMOUNT_MATCH",
      candidatePaymentIds: amountMatches.map((payment) => payment.id),
      confidence: "LOW",
    };
  }

  return { ...base, decision: "UNMATCHED", reason: "NO_ELIGIBLE_PAYMENT", candidatePaymentIds: [], confidence: "NONE" };
}
