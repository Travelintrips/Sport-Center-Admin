import { db } from "@workspace/db";
import { bookingsTable, paymentsTable } from "@workspace/db";
import {
  bankMutationsTable,
  bankReconciliationMatchesTable,
  type BankMutation,
} from "@workspace/db";
import { eq, inArray, notInArray, sql } from "drizzle-orm";

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

/**
 * Cek apakah dua nilai nominal cocok.
 * Toleransi: selisih absolut < 1 rupiah ATAU selisih relatif < 1%
 * (menangani kasus pembulatan, biaya admin kecil, dsb.)
 */
function amountMatches(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  return diff < 1 || diff / Math.max(a, b) < 0.01;
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
}

export async function computeMatchesForMutation(mutation: BankMutation): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];

  const mutationAmount = Number(mutation.amount);
  const normDesc = mutation.normalizedDescription ?? normalizeDescription(mutation.description);
  const providerOrderId = mutation.providerOrderId;

  // Hanya cocokkan arah IN (uang masuk) ke payments/bookings
  if (mutation.direction !== "IN") return [];

  // Ambil booking yang aktif / pernah bayar — skip expired/cancelled yang sudah sangat lama
  const INACTIVE = ["cancelled", "rejected", "refunded"] as const;
  const bookings = await db
    .select({
      id: bookingsTable.id,
      orderNumber: bookingsTable.orderNumber,
      customerName: bookingsTable.customerName,
      bookingDate: bookingsTable.bookingDate,
      totalPrice: bookingsTable.totalPrice,
      grandTotal: bookingsTable.grandTotal,
      status: bookingsTable.status,
      updatedAt: sql<string>`${bookingsTable.updatedAt}`.as("updated_at"),
    })
    .from(bookingsTable)
    .where(notInArray(bookingsTable.status, INACTIVE));

  // Ambil semua payments — Map: bookingId → payments[] (diurutkan confirmed/terbaru dulu)
  const allPayments = await db
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

  // Group payments by bookingId; prioritas: confirmed dulu, lalu terbaru
  const paymentsByBookingId = new Map<number, typeof allPayments>();
  for (const p of allPayments) {
    if (!p.bookingId) continue;
    const existing = paymentsByBookingId.get(p.bookingId) ?? [];
    existing.push(p);
    paymentsByBookingId.set(p.bookingId, existing);
  }

  // Pilih payment terbaik per booking (confirmed > terbaru)
  function bestPayment(payments: typeof allPayments) {
    const confirmed = payments.filter((p) => p.status === "confirmed");
    const pool = confirmed.length ? confirmed : payments;
    return pool.reduce((best, p) => {
      const bt = new Date(best.createdAt ?? 0).getTime();
      const pt = new Date(p.createdAt ?? 0).getTime();
      return pt > bt ? p : best;
    });
  }

  for (const booking of bookings) {
    const payments = paymentsByBookingId.get(booking.id);
    const payment = payments?.length ? bestPayment(payments) : undefined;

    // --- Amount match (40 pts) ---
    // Cek 3 kemungkinan: payment.amount, booking.grandTotal, booking.totalPrice
    const bookingAmountGross = booking.grandTotal ? Number(booking.grandTotal) : null;
    const bookingAmountNet = Number(booking.totalPrice);
    const paymentAmount = payment ? Number(payment.amount) : null;

    let amountMatch = false;

    if (paymentAmount !== null && amountMatches(paymentAmount, mutationAmount)) {
      amountMatch = true;
    } else if (bookingAmountGross !== null && amountMatches(bookingAmountGross, mutationAmount)) {
      amountMatch = true;
    } else if (amountMatches(bookingAmountNet, mutationAmount)) {
      amountMatch = true;
    }

    if (!amountMatch) continue; // wajib cocok nominal

    const score_parts: string[] = [];
    let score = 40;
    score_parts.push("nominal cocok");

    let dateMatch = false;
    let nameMatch = false;
    let orderIdMatch = false;
    let proofMatch = false;

    // --- Date match (max 25 pts) ---
    // Gunakan tanggal payment, bukan tanggal booking (booking date = tanggal pakai fasilitas)
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
        score += 20;
        dateMatch = true;
        score_parts.push(`tanggal pembayaran selisih ${diff} hari`);
      } else if (diff <= 7) {
        score += 10;
        dateMatch = true;
        score_parts.push(`tanggal pembayaran selisih ${diff} hari`);
      }
      // > 7 hari: tidak dapat poin tanggal
    }

    // --- Order ID match (30 pts) ---
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

    // --- Customer name match (15 pts) ---
    const customerNorm = normalizeDescription(booking.customerName ?? "");
    if (customerNorm) {
      // Cek setiap kata nama (>= 4 huruf) agar tidak false-positive dari kata pendek
      const words = customerNorm.split(" ").filter((w) => w.length >= 4);
      const anyWordMatch = words.some((w) => normDesc.includes(w));
      if (anyWordMatch) {
        score += 15;
        nameMatch = true;
        score_parts.push(`nama customer "${booking.customerName}" ditemukan`);
      }
    }

    // --- Bukti transfer bonus (5 pts) ---
    if (payment?.proofUrl) {
      score += 5;
      proofMatch = true;
      score_parts.push("ada bukti transfer");
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

  // Deteksi duplikat: mutasi dengan mutation_key yang sama
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

    // Tandai duplikat
    if (sameKey.length > 1) {
      await db
        .update(bankMutationsTable)
        .set({ status: "duplicate_need_review", updatedAt: new Date() })
        .where(eq(bankMutationsTable.id, mutation.id));
      duplicates++;
      continue;
    }

    // Hapus kandidat lama sebelum re-komputasi
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

    // Simpan semua kandidat
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
        status: "candidate" as const,
      }))
    );

    const best = candidates[0]!;

    if (best.score >= 80) {
      // Auto approve — skor sangat tinggi, cocok otomatis
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
      // Kandidat ditemukan tapi skor tidak cukup tinggi untuk auto-approve
      // Set status "matched" dengan kandidat terbaik agar admin bisa review
      await db
        .update(bankMutationsTable)
        .set({
          status: "matched",
          matchedPaymentId: best.candidateType === "payment" ? best.candidateId : null,
          matchedOrderId: best.candidateType === "order" ? best.candidateId : null,
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
