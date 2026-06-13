import { db } from "@workspace/db";
import { bookingsTable, paymentsTable } from "@workspace/db";
import {
  bankMutationsTable,
  bankReconciliationMatchesTable,
  type BankMutation,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const GOPAY_PATTERN = /DOMPET ANAK BANGSA|GOPAY|OVO|DANA|LINKAJA|SHOPEEPAY/i;
const ORDER_ID_PATTERN = /\b(ID\d{15,25}[A-Z]{0,4}|TRX\d{10,}|INV-\d{8,})\b/i;

export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractOrderId(desc: string): string | null {
  const m = desc.match(ORDER_ID_PATTERN);
  return m ? m[0].toUpperCase() : null;
}

export function extractProviderName(desc: string): string | null {
  const m = desc.match(GOPAY_PATTERN);
  if (!m) return null;
  if (/DOMPET ANAK BANGSA|GOPAY/i.test(m[0])) return "GoPay";
  if (/OVO/i.test(m[0])) return "OVO";
  if (/DANA/i.test(m[0])) return "DANA";
  if (/LINKAJA/i.test(m[0])) return "LinkAja";
  if (/SHOPEEPAY/i.test(m[0])) return "ShopeePay";
  return m[0];
}

export function buildMutationKey(date: string, amount: number, direction: "IN" | "OUT"): string {
  const d = date.replace(/[-\/]/g, "").slice(0, 8);
  return `${d}_${Math.round(amount)}_${direction}`;
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.abs(Math.round((da - db) / 86400000));
}

interface MatchCandidate {
  candidateType: "payment" | "order";
  candidateId: number;
  score: number;
  reason: string[];
  amountMatch: boolean;
  dateMatch: boolean;
  nameMatch: boolean;
  orderIdMatch: boolean;
  proofMatch: boolean;
  statusValidMatch: boolean;
  toleranceUsed: boolean;
}

export async function computeMatchesForMutation(mutation: BankMutation): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];

  const amount = Number(mutation.amount);
  const normDesc = mutation.normalizedDescription ?? normalizeDescription(mutation.description);
  const providerOrderId = mutation.providerOrderId;

  // Only match IN direction to payments/bookings (money received)
  if (mutation.direction !== "IN") return [];

  const bookings = await db
    .select({
      id: bookingsTable.id,
      orderNumber: bookingsTable.orderNumber,
      customerName: bookingsTable.customerName,
      customerEmail: bookingsTable.customerEmail,
      bookingDate: bookingsTable.bookingDate,
      totalPrice: bookingsTable.totalPrice,
      grandTotal: bookingsTable.grandTotal,
      status: bookingsTable.status,
      updatedAt: sql<string>`${bookingsTable.updatedAt}`.as("updated_at"),
    })
    .from(bookingsTable);

  const payments = await db
    .select({
      id: paymentsTable.id,
      bookingId: paymentsTable.bookingId,
      amount: paymentsTable.amount,
      proofUrl: paymentsTable.proofUrl,
      status: paymentsTable.status,
      createdAt: paymentsTable.createdAt,
      confirmedAt: paymentsTable.confirmedAt,
    })
    .from(paymentsTable);

  const paymentByBookingId = new Map(payments.map((p) => [p.bookingId, p]));

  for (const booking of bookings) {
    const payment = paymentByBookingId.get(booking.id);
    // grandTotal includes PPN; use it if set, otherwise fall back to totalPrice
    const bookingAmount = Number(booking.grandTotal ?? booking.totalPrice);

    const score_parts: string[] = [];
    let score = 0;
    let amountMatch = false;
    let dateMatch = false;
    let nameMatch = false;
    let orderIdMatch = false;
    let proofMatch = false;

    // Amount match (40 pts)
    if (Math.abs(bookingAmount - amount) < 1) {
      score += 40;
      amountMatch = true;
      score_parts.push("nominal cocok");
    } else {
      continue; // Must have amount match to be a candidate
    }

    // Date match — use payment.createdAt if exists, else booking.updatedAt (when admin confirmed)
    // Never use booking.bookingDate (that's when the facility is used, not when money was paid)
    const toDateStr = (d: Date | string | null | undefined): string | null => {
      if (!d) return null;
      if (typeof d === "string") return d.slice(0, 10);
      return d.toISOString().slice(0, 10);
    };
    const paymentDateStr =
      toDateStr(payment?.createdAt) ??
      toDateStr(payment?.confirmedAt) ??
      (["confirmed", "paid", "completed"].includes(booking.status ?? "")
        ? toDateStr(booking.updatedAt)
        : null);

    if (paymentDateStr) {
      const diff = dayDiff(mutation.transactionDate, paymentDateStr);
      if (diff === 0) {
        score += 25;
        dateMatch = true;
        score_parts.push("tanggal pembayaran sama");
      } else if (diff <= 3) {
        score += 15;
        dateMatch = true;
        score_parts.push(`tanggal pembayaran selisih ${diff} hari`);
      }
    }

    // GoPay / provider order ID match (30 pts)
    if (providerOrderId) {
      const orderNum = booking.orderNumber ?? "";
      if (
        orderNum.toUpperCase() === providerOrderId.toUpperCase() ||
        normDesc.includes(providerOrderId.toLowerCase())
      ) {
        score += 30;
        orderIdMatch = true;
        score_parts.push(`Order ID cocok: ${providerOrderId}`);
      }
    }

    // Customer name match (15 pts)
    const customerNorm = normalizeDescription(booking.customerName ?? "");
    if (customerNorm && normDesc.includes(customerNorm.split(" ")[0]!)) {
      score += 15;
      nameMatch = true;
      score_parts.push(`nama customer "${booking.customerName}" ditemukan`);
    }

    // Proof URL presence bonus (5 pts)
    if (payment?.proofUrl) {
      score += 5;
      proofMatch = true;
      score_parts.push("ada bukti transfer");
    }

    if (score < 40) continue; // Must at least match amount

    // Status valid: booking is in an expected payment state
    const VALID_STATUSES = ["pending_payment", "waiting_confirmation", "confirmed", "completed", "paid"];
    const statusValidMatch = VALID_STATUSES.includes(booking.status ?? "");
    if (statusValidMatch) {
      score += 5;
      score_parts.push(`status booking valid (${booking.status})`);
    }

    const candidate: MatchCandidate = {
      candidateType: payment ? "payment" : "order",
      candidateId: payment ? payment.id : booking.id,
      score: Math.min(score, 100),
      reason: score_parts,
      amountMatch,
      dateMatch,
      nameMatch,
      orderIdMatch,
      proofMatch,
      statusValidMatch,
      toleranceUsed: false,
    };

    candidates.push(candidate);
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export async function runMatching(mutationIds?: number[]): Promise<{
  processed: number;
  autoApproved: number;
  needsReview: number;
  unmatched: number;
  duplicates: number;
}> {
  let mutations: BankMutation[];

  if (mutationIds?.length) {
    mutations = await db
      .select()
      .from(bankMutationsTable)
      .where(inArray(bankMutationsTable.id, mutationIds));
  } else {
    mutations = await db
      .select()
      .from(bankMutationsTable)
      .where(inArray(bankMutationsTable.status, ["unmatched", "duplicate_need_review"]));
  }

  // Detect duplicates: mutations with same mutation_key
  const keyCount = new Map<string, number[]>();
  for (const m of mutations) {
    const arr = keyCount.get(m.mutationKey) ?? [];
    arr.push(m.id);
    keyCount.set(m.mutationKey, arr);
  }

  let autoApproved = 0;
  let needsReview = 0;
  let unmatched = 0;
  let duplicates = 0;

  for (const mutation of mutations) {
    const sameKey = keyCount.get(mutation.mutationKey) ?? [];

    // Mark duplicates
    if (sameKey.length > 1) {
      await db
        .update(bankMutationsTable)
        .set({ status: "duplicate_need_review", updatedAt: new Date() })
        .where(eq(bankMutationsTable.id, mutation.id));
      duplicates++;
      continue;
    }

    // Delete old candidates for this mutation before re-computing
    await db
      .delete(bankReconciliationMatchesTable)
      .where(eq(bankReconciliationMatchesTable.mutationId, mutation.id));

    const candidates = await computeMatchesForMutation(mutation);

    if (!candidates.length) {
      await db
        .update(bankMutationsTable)
        .set({ status: "unmatched", updatedAt: new Date() })
        .where(eq(bankMutationsTable.id, mutation.id));
      unmatched++;
      continue;
    }

    // Insert all candidates
    await db.insert(bankReconciliationMatchesTable).values(
      candidates.map((c) => ({
        mutationId: mutation.id,
        candidateType: c.candidateType,
        candidateId: c.candidateId,
        matchScore: c.score,
        matchReason: c.reason.join("; "),
        amountMatch: c.amountMatch,
        dateMatch: c.dateMatch,
        nameMatch: c.nameMatch,
        orderIdMatch: c.orderIdMatch,
        proofMatch: c.proofMatch,
        statusValidMatch: c.statusValidMatch,
        toleranceUsed: c.toleranceUsed,
        status: "candidate" as const,
      }))
    );

    const best = candidates[0]!;

    if (best.score >= 80) {
      // Auto approve
      await db
        .update(bankMutationsTable)
        .set({
          status: "matched",
          matchedPaymentId: best.candidateType === "payment" ? best.candidateId : null,
          matchedOrderId: best.candidateType === "order" ? best.candidateId : null,
          updatedAt: new Date(),
        })
        .where(eq(bankMutationsTable.id, mutation.id));

      await db
        .update(bankReconciliationMatchesTable)
        .set({ status: "approved" })
        .where(
          sql`${bankReconciliationMatchesTable.mutationId} = ${mutation.id} AND ${bankReconciliationMatchesTable.candidateId} = ${best.candidateId}`
        );

      autoApproved++;
    } else {
      // Candidates found but score < 95 — set to "matched" so user can review
      await db
        .update(bankMutationsTable)
        .set({
          status: "matched",
          matchedPaymentId: null,
          matchedOrderId: null,
          updatedAt: new Date(),
        })
        .where(eq(bankMutationsTable.id, mutation.id));
      needsReview++;
    }
  }

  return {
    processed: mutations.length,
    autoApproved,
    needsReview,
    unmatched,
    duplicates,
  };
}
