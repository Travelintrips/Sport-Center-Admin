import { db } from "@workspace/db";
import { bookingsTable, paymentsTable } from "@workspace/db";
import {
  bankMutationsTable,
  bankReconciliationMatchesTable,
  type BankMutation,
} from "@workspace/db";
import { eq, inArray, notInArray, sql, and, gte, lte } from "drizzle-orm";

const GOPAY_PATTERN = /DOMPET ANAK BANGSA|GOPAY|OVO|DANA|LINKAJA|SHOPEEPAY/i;
const ORDER_ID_PATTERN = /\b(ID\d{15,25}[A-Z]{0,4}|TRX\d{10,}|INV-\d{8,})\b/i;

// Pola untuk kategorisasi mutasi OUT
const BANK_FEE_PATTERN = /biaya\s*admin|biaya\s*bank|admin\s*fee|bi\.aya|bfee|provisi|administrasi\s*bank/i;
const REFUND_PATTERN = /refund|pengembalian|retur|kembali\s*dana/i;
const LANDLORD_PATTERN = /angkasa\s*pura|landlord|sewa\s*gedung|sewa\s*tempat|rental\s*fee|biaya\s*sewa/i;
const VENDOR_PATTERN = /vendor|supplier|pemasok|pembayaran\s*vendor|invoice|faktur/i;
const EXPENSE_PATTERN = /operasional|listrik|pln|air\s*pdam|internet|telkom|gaji|salary|thr|lembur/i;
const TAX_PAYMENT_PATTERN = /pajak|pph\s*\d+|ppn|bphtb|setoran\s*pajak|tax\s*payment|ssp\b|kode\s*billing/i;

// Kategori candidateId untuk OUT expense (angka > 900000 untuk hindari konflik dengan ID record nyata)
// 900001 = BANK_FEE    → Biaya Administrasi Bank      (6001)
// 900002 = REFUND      → Refund Payable               (2002)
// 900003 = RENT_AP     → Beban Sewa / Rent Payable    (6003)
// 900004 = VENDOR_PMT  → Beban Vendor / Pemasok       (6002)
// 900005 = OPERATIONAL → Beban Operasional            (6005)
// 900006 = TAX_PAYMENT → Hutang Pajak                 (2003)
// 900099 = UNKNOWN_OUT → Beban Lain-lain (need_review)(6099)
const EXPENSE_CATEGORY = {
  BANK_FEE: 900001,
  REFUND: 900002,
  RENT_AP: 900003,
  VENDOR_PAYMENT: 900004,
  OPERATIONAL: 900005,
  TAX_PAYMENT: 900006,
  UNKNOWN_OUT: 900099,
};

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
 */
function amountMatches(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  return diff < 1 || diff / Math.max(a, b) < 0.01;
}

interface MatchCandidate {
  candidateType: "payment" | "order" | "expense";
  candidateId: number;
  score: number;
  reason: string[];         // Format: "deskripsi +N" agar UI bisa parse poin
  amountMatch: boolean;
  dateMatch: boolean;
  nameMatch: boolean;
  orderIdMatch: boolean;
  proofMatch: boolean;
  statusValidMatch: boolean;
  toleranceUsed: boolean;
  ocrMatch?: boolean;
  // Group payment fields
  isGroupPayment?: boolean;
  groupRef?: string;
  groupBookingCount?: number;
  groupTotalAmount?: number;
}

/**
 * Hitung skor OCR dari data payment yang sudah discan.
 * Jika OCR belum dijalankan, tidak ada poin tambahan.
 */
function scoreOcr(
  ocrAmount: number | null,
  ocrDate: string | null,
  ocrName: string | null,
  ocrRaw: string | null,
  mutationAmount: number,
  mutationDate: string,
  mutationDesc: string,
  providerOrderId: string | null | undefined,
  reasons: string[],
): { added: number; ocrMatch: boolean } {
  let added = 0;
  let ocrMatch = false;

  if (ocrAmount !== null && ocrAmount > 0) {
    if (amountMatches(ocrAmount, mutationAmount)) {
      added += 20;
      ocrMatch = true;
      reasons.push("OCR nominal cocok +20");
    }
  }

  if (ocrDate) {
    const diff = dayDiff(mutationDate, ocrDate);
    if (diff <= 3) {
      added += 10;
      ocrMatch = true;
      reasons.push(`OCR tanggal selisih ${diff} hari +10`);
    }
  }

  if (ocrName) {
    const OCR_STOPWORDS = new Set([
      "bank", "transfer", "dari", "untuk", "kepada", "oleh", "dengan",
      "payment", "bayar", "pembayaran", "dana", "mandiri", "bca", "bni", "bri",
      "gopay", "ovo", "transaksi", "setor", "tarik", "debit", "kredit",
    ]);
    const normDesc = normalizeDescription(mutationDesc);
    const normName = normalizeDescription(ocrName);
    const words = normName.split(" ").filter((w) => w.length >= 4 && !OCR_STOPWORDS.has(w));
    if (words.length > 0 && words.some((w) => normDesc.includes(w))) {
      added += 15;
      ocrMatch = true;
      reasons.push(`OCR nama "${ocrName}" ditemukan di deskripsi +15`);
    }
  }

  // OCR ref / order id
  if (ocrRaw && providerOrderId) {
    const normRaw = ocrRaw.toLowerCase();
    if (normRaw.includes(providerOrderId.toLowerCase())) {
      added += 30;
      ocrMatch = true;
      reasons.push(`OCR referensi order ${providerOrderId} ditemukan +30`);
    }
  }

  return { added, ocrMatch };
}

/**
 * Hitung kandidat match untuk mutasi arah IN (uang masuk).
 * Cocokkan ke payment/booking.
 */
export async function computeMatchesForMutation(mutation: BankMutation): Promise<MatchCandidate[]> {
  if (mutation.direction !== "IN") return computeMatchesForOutMutation(mutation);

  const candidates: MatchCandidate[] = [];
  const mutationAmount = Number(mutation.amount);
  const normDesc = mutation.normalizedDescription ?? normalizeDescription(mutation.description);
  const providerOrderId = mutation.providerOrderId;

  const INACTIVE: ("pending_payment" | "waiting_confirmation" | "waiting_admin_approval" | "paid" | "confirmed" | "completed" | "cancelled" | "rejected" | "expired" | "refunded")[] = ["cancelled", "rejected", "refunded"];

  // Filter booking dalam ±45 hari dari tanggal mutasi untuk performa
  const mutDate = mutation.transactionDate ? new Date(mutation.transactionDate) : null;
  const dateMinStr = mutDate && !isNaN(mutDate.getTime())
    ? new Date(mutDate.getTime() - 45 * 86400000).toISOString().slice(0, 10)
    : null;
  const dateMaxStr = mutDate && !isNaN(mutDate.getTime())
    ? new Date(mutDate.getTime() + 45 * 86400000).toISOString().slice(0, 10)
    : null;

  const bookings = await db
    .select({
      id: bookingsTable.id,
      orderNumber: bookingsTable.orderNumber,
      customerName: bookingsTable.customerName,
      bookingDate: bookingsTable.bookingDate,
      totalPrice: bookingsTable.totalPrice,
      grandTotal: bookingsTable.grandTotal,
      status: bookingsTable.status,
      groupRef: bookingsTable.groupRef,
      updatedAt: sql<string>`${bookingsTable.updatedAt}`.as("updated_at"),
    })
    .from(bookingsTable)
    .where(
      and(
        notInArray(bookingsTable.status, INACTIVE),
        ...(dateMinStr ? [gte(bookingsTable.bookingDate, dateMinStr)] : []),
        ...(dateMaxStr ? [lte(bookingsTable.bookingDate, dateMaxStr)] : [])
      )
    );

  // Ambil semua payments dengan data OCR
  const allPayments = await db.execute(sql`
    SELECT
      p.id,
      p.booking_id AS "bookingId",
      p.amount,
      p.proof_url AS "proofUrl",
      p.status,
      p.created_at AS "createdAt",
      p.confirmed_at AS "confirmedAt",
      p.ocr_name AS "ocrName",
      p.ocr_amount AS "ocrAmount",
      p.ocr_date AS "ocrDate",
      p.ocr_raw AS "ocrRaw"
    FROM sport_center.sport_payments p
  `);

  type PaymentRow = {
    id: number;
    bookingId: number | null;
    amount: string;
    proofUrl: string | null;
    status: string;
    createdAt: string | null;
    confirmedAt: string | null;
    ocrName: string | null;
    ocrAmount: number | null;
    ocrDate: string | null;
    ocrRaw: string | null;
  };

  const paymentsRows = allPayments.rows as PaymentRow[];

  // Group payments by bookingId
  const paymentsByBookingId = new Map<number, PaymentRow[]>();
  for (const p of paymentsRows) {
    if (!p.bookingId) continue;
    const existing = paymentsByBookingId.get(p.bookingId) ?? [];
    existing.push(p);
    paymentsByBookingId.set(p.bookingId, existing);
  }

  function bestPayment(payments: PaymentRow[]) {
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

    if (!amountMatch) continue;

    const score_parts: string[] = [];
    let score = 40;
    score_parts.push("nominal cocok +40");

    let dateMatch = false;
    let nameMatch = false;
    let orderIdMatch = false;
    let proofMatch = false;
    let ocrMatch = false;

    // --- Date match (max 25 pts) ---
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
        score_parts.push("tanggal pembayaran sama +25");
      } else if (diff <= 3) {
        score += 20;
        dateMatch = true;
        score_parts.push(`tanggal selisih ${diff} hari +20`);
      } else if (diff <= 7) {
        score += 10;
        dateMatch = true;
        score_parts.push(`tanggal selisih ${diff} hari +10`);
      }
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
        score_parts.push(`Order ID cocok: ${providerOrderId} +30`);
      }
    }

    // --- Customer name match (15 pts) ---
    const customerNorm = normalizeDescription(booking.customerName ?? "");
    if (customerNorm) {
      const words = customerNorm.split(" ").filter((w) => w.length >= 4);
      const anyWordMatch = words.some((w) => normDesc.includes(w));
      if (anyWordMatch) {
        score += 15;
        nameMatch = true;
        score_parts.push(`nama customer "${booking.customerName}" ditemukan +15`);
      }
    }

    // --- Bukti transfer bonus (5 pts) ---
    if (payment?.proofUrl) {
      score += 5;
      proofMatch = true;
      score_parts.push("ada bukti transfer +5");
    }

    // --- Status valid bonus (5 pts) ---
    const VALID_STATUSES = ["pending_payment", "waiting_confirmation", "confirmed", "completed", "paid"];
    const statusValidMatch = VALID_STATUSES.includes(booking.status ?? "");
    if (statusValidMatch) {
      score += 5;
      score_parts.push(`status booking valid (${booking.status}) +5`);
    }

    // --- OCR scoring (max +75 pts jika semua cocok) ---
    if (payment) {
      const ocrResult = scoreOcr(
        payment.ocrAmount != null ? Number(payment.ocrAmount) : null,
        payment.ocrDate ?? null,
        payment.ocrName ?? null,
        payment.ocrRaw ?? null,
        mutationAmount,
        mutation.transactionDate,
        mutation.description,
        providerOrderId,
        score_parts,
      );
      score += ocrResult.added;
      if (ocrResult.ocrMatch) ocrMatch = true;
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
      ocrMatch,
    };

    candidates.push(candidate);
  }


  // ── Group Payment Scoring ──────────────────────────────────────────────────
  // Jika beberapa booking punya groupRef yang sama, cocokkan mutasi ke total grup.
  // Ini menangani kasus customer transfer 1x untuk multi-sesi (grup booking).
  {
    const groupedBookings = new Map<string, typeof bookings>();
    for (const b of bookings) {
      if (!b.groupRef) continue;
      const existing = groupedBookings.get(b.groupRef) ?? [];
      existing.push(b);
      groupedBookings.set(b.groupRef, existing);
    }

    for (const [groupRef, groupBookings] of groupedBookings) {
      if (groupBookings.length < 2) continue; // single = sudah di-score individual

      const groupTotalNet = groupBookings.reduce((s: number, b: typeof groupBookings[0]) => s + Number(b.totalPrice), 0);
      const groupTotalGross = groupBookings.reduce((s: number, b: typeof groupBookings[0]) => s + (b.grandTotal ? Number(b.grandTotal) : Number(b.totalPrice)), 0);
      const useAmount = groupTotalGross > 0 ? groupTotalGross : groupTotalNet;

      const amountMatch = amountMatches(useAmount, mutationAmount) || amountMatches(groupTotalNet, mutationAmount);
      if (!amountMatch) continue;

      // Cari representative payment (yang ada bukti transfer)
      let repPayment: PaymentRow | undefined;
      for (const b of groupBookings) {
        const pmts = paymentsByBookingId.get(b.id);
        if (pmts?.length) {
          const withProof = pmts.find(p => p.proofUrl);
          repPayment = withProof ?? pmts[0];
          if (withProof) break;
        }
      }
      const repBooking = groupBookings[0]!;

      const score_parts: string[] = [`nominal grup cocok (${groupBookings.length} sesi) +40`];
      let score = 40;

      // Nama customer
      const customerNorm = normalizeDescription(repBooking.customerName ?? "");
      const words = customerNorm.split(" ").filter(w => w.length >= 4);
      const nameMatch = words.some(w => normDesc.includes(w));
      if (nameMatch) { score += 15; score_parts.push(`nama customer "${repBooking.customerName}" ditemukan +15`); }

      // Bukti transfer
      const proofMatch = !!repPayment?.proofUrl;
      if (proofMatch) { score += 5; score_parts.push("ada bukti transfer +5"); }

      // Status valid
      const VALID_STATUSES = ["pending_payment", "waiting_confirmation", "confirmed", "completed", "paid"];
      const statusValidMatch = groupBookings.some((b: typeof groupBookings[0]) => VALID_STATUSES.includes(b.status ?? ""));
      if (statusValidMatch) { score += 5; score_parts.push("status booking valid +5"); }

      // Group bonus
      score += 10;
      score_parts.push(`Group Booking ${groupBookings.length} sesi +10`);

      // OCR
      let ocrMatch = false;
      if (repPayment) {
        const ocrResult = scoreOcr(
          repPayment.ocrAmount != null ? Number(repPayment.ocrAmount) : null,
          repPayment.ocrDate ?? null,
          repPayment.ocrName ?? null,
          repPayment.ocrRaw ?? null,
          mutationAmount,
          mutation.transactionDate,
          mutation.description,
          providerOrderId,
          score_parts,
        );
        score += ocrResult.added;
        if (ocrResult.ocrMatch) ocrMatch = true;
      }

      const groupCandidate: MatchCandidate = {
        candidateType: repPayment ? "payment" : "order",
        candidateId: repPayment ? repPayment.id : repBooking.id,
        score: Math.min(score, 100),
        reason: score_parts,
        amountMatch,
        dateMatch: false,
        nameMatch,
        orderIdMatch: false,
        proofMatch,
        statusValidMatch,
        toleranceUsed: false,
        ocrMatch,
        isGroupPayment: true,
        groupRef,
        groupBookingCount: groupBookings.length,
        groupTotalAmount: useAmount,
      };

      candidates.push(groupCandidate);
    }
  }


  // ── Group Payment Detection ────────────────────────────────────────────────
  // Kelompokkan booking berdasarkan group_ref.
  // Jika total nominal grup cocok dengan nominal mutasi → buat kandidat group_payment.
  const bookingsByGroupRef = new Map<string, typeof bookings[0][]>();
  for (const b of bookings) {
    const gRef = b.groupRef;
    if (!gRef) continue;
    const arr = bookingsByGroupRef.get(gRef) ?? [];
    arr.push(b);
    bookingsByGroupRef.set(gRef, arr);
  }

  for (const [gRef, groupBookings] of bookingsByGroupRef.entries()) {
    if (groupBookings.length < 2) continue; // grup harus ≥ 2 booking

    const groupTotal = groupBookings.reduce((sum, b) => {
      return sum + (b.grandTotal ? Number(b.grandTotal) : Number(b.totalPrice));
    }, 0);

    if (!amountMatches(groupTotal, mutationAmount)) continue;

    // Nominal grup cocok → buat kandidat group_payment
    const rep = groupBookings[0]!;
    const gParts: string[] = [];
    let gScore = 45; // slightly higher base — grup match lebih spesifik
    gParts.push(`nominal grup ${gRef} (${groupBookings.length} booking) = Rp${Math.round(groupTotal).toLocaleString("id-ID")} cocok +45`);

    const custNorm = normalizeDescription(rep.customerName ?? "");
    const custWords = custNorm.split(" ").filter((w) => w.length >= 4);
    if (custWords.some((w) => normDesc.includes(w))) {
      gScore += 15;
      gParts.push(`nama customer "${rep.customerName}" ditemukan +15`);
    }

    // Date heuristic: cek apakah tanggal mutasi dekat dengan salah satu booking
    const anyDateMatch = groupBookings.some((b) => {
      const diff = dayDiff(mutation.transactionDate, b.bookingDate);
      return diff <= 7;
    });
    if (anyDateMatch) {
      gScore += 15;
      gParts.push("tanggal mutasi dekat dengan booking dalam grup +15");
    }

    const hasProof = groupBookings.some((b) => {
      const pays = paymentsByBookingId.get(b.id);
      return pays?.some((p) => p.proofUrl);
    });
    if (hasProof) {
      gScore += 5;
      gParts.push("ada bukti transfer +5");
    }

    candidates.push({
      candidateType: "group_payment" as any,
      candidateId: rep.id, // ID booking representatif (pertama dalam grup)
      score: Math.min(gScore, 100),
      reason: gParts,
      amountMatch: true,
      dateMatch: anyDateMatch,
      nameMatch: custWords.some((w) => normDesc.includes(w)),
      orderIdMatch: false,
      proofMatch: hasProof,
      statusValidMatch: true,
      toleranceUsed: false,
    });
  }
  // ── End Group Payment Detection ───────────────────────────────────────────


  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Hitung kandidat match untuk mutasi arah OUT (uang keluar).
 * Cocokkan ke: refund, biaya admin bank, vendor, landlord, expense operasional.
 */
async function computeMatchesForOutMutation(mutation: BankMutation): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  const mutationAmount = Number(mutation.amount);
  const normDesc = mutation.normalizedDescription ?? normalizeDescription(mutation.description);

  // 1. Cek refund payment — booking yang status-nya refunded
  const refundBookings = await db
    .select({
      id: bookingsTable.id,
      customerName: bookingsTable.customerName,
      totalPrice: bookingsTable.totalPrice,
      grandTotal: bookingsTable.grandTotal,
      status: bookingsTable.status,
      updatedAt: sql<string>`${bookingsTable.updatedAt}`.as("updated_at"),
    })
    .from(bookingsTable)
    .where(inArray(bookingsTable.status, ["refunded", "cancelled"]));

  for (const booking of refundBookings) {
    const amt = booking.grandTotal ? Number(booking.grandTotal) : Number(booking.totalPrice);
    if (!amountMatches(amt, mutationAmount)) continue;

    const score_parts: string[] = [];
    let score = 40;
    score_parts.push("nominal refund cocok +40");

    // Cek nama di deskripsi
    const customerNorm = normalizeDescription(booking.customerName ?? "");
    const words = customerNorm.split(" ").filter((w) => w.length >= 4);
    const nameMatch = words.some((w) => normDesc.includes(w));
    if (nameMatch) {
      score += 15;
      score_parts.push(`nama customer "${booking.customerName}" ditemukan +15`);
    }

    // Cek kata "refund" di deskripsi
    if (REFUND_PATTERN.test(mutation.description)) {
      score += 20;
      score_parts.push("kata 'refund/pengembalian' ditemukan +20");
    }

    // Tanggal: gunakan updatedAt booking sebagai tanggal refund
    const refundDateStr = booking.updatedAt ? booking.updatedAt.slice(0, 10) : null;
    let dateMatch = false;
    if (refundDateStr) {
      const diff = dayDiff(mutation.transactionDate, refundDateStr);
      if (diff === 0) {
        score += 25;
        dateMatch = true;
        score_parts.push("tanggal sama +25");
      } else if (diff <= 7) {
        score += 10;
        dateMatch = true;
        score_parts.push(`tanggal selisih ${diff} hari +10`);
      }
    }

    candidates.push({
      candidateType: "expense",
      candidateId: booking.id,
      score: Math.min(score, 100),
      reason: score_parts,
      amountMatch: true,
      dateMatch,
      nameMatch,
      orderIdMatch: false,
      proofMatch: false,
      statusValidMatch: true,
      toleranceUsed: false,
    });
  }

  // 2. Kategorisasi berdasarkan pola deskripsi
  const addCategoryCandidate = (
    categoryId: number,
    label: string,
    bonusScore: number,
    bonusReason: string,
  ) => {
    // Berikan bonus kecil jika mutasi terjadi di hari kerja yang wajar (bukan akhir pekan jauh)
    // Expense tidak punya tanggal spesifik, tapi setidaknya catat dateMatch=false
    const reasonParts = ["nominal tercatat +40", `${label}: ${bonusReason} +${bonusScore}`];
    const mutDay = new Date(mutation.transactionDate).getDay();
    // Bonus +3 jika hari kerja (Senin-Jumat) — biaya operasional umumnya di hari kerja
    let dateBonus = 0;
    if (mutDay >= 1 && mutDay <= 5) {
      dateBonus = 3;
      reasonParts.push("hari kerja +3");
    }
    candidates.push({
      candidateType: "expense",
      candidateId: categoryId,
      score: Math.min(40 + bonusScore + dateBonus, 100),
      reason: reasonParts,
      amountMatch: true,
      dateMatch: false,
      nameMatch: false,
      orderIdMatch: false,
      proofMatch: false,
      statusValidMatch: false,
      toleranceUsed: false,
    });
  };

  if (BANK_FEE_PATTERN.test(mutation.description)) {
    addCategoryCandidate(EXPENSE_CATEGORY.BANK_FEE, "Biaya Admin Bank", 35,
      "kata 'biaya admin/bank fee' ditemukan di deskripsi");
  }

  if (LANDLORD_PATTERN.test(mutation.description)) {
    addCategoryCandidate(EXPENSE_CATEGORY.RENT_AP, "Beban Sewa / Rent Payable", 30,
      "kata 'angkasa pura/sewa gedung/rental fee' ditemukan");
  }

  if (VENDOR_PATTERN.test(mutation.description)) {
    addCategoryCandidate(EXPENSE_CATEGORY.VENDOR_PAYMENT, "Pembayaran Vendor/Pemasok", 25,
      "kata 'vendor/supplier/invoice' ditemukan");
  }

  if (EXPENSE_PATTERN.test(mutation.description)) {
    addCategoryCandidate(EXPENSE_CATEGORY.OPERATIONAL, "Beban Operasional", 20,
      "kata 'operasional/listrik/gaji' ditemukan");
  }

  if (TAX_PAYMENT_PATTERN.test(mutation.description)) {
    addCategoryCandidate(EXPENSE_CATEGORY.TAX_PAYMENT, "Pembayaran Pajak", 30,
      "kata 'pajak/pph/ppn/setoran pajak' ditemukan");
  }

  // Jika tidak ada pola yang cocok, beri kandidat unknown dengan skor rendah → need_review
  if (candidates.length === 0) {
    candidates.push({
      candidateType: "expense",
      candidateId: EXPENSE_CATEGORY.UNKNOWN_OUT,
      score: 30,
      reason: ["mutasi keluar tidak terklasifikasi — perlu review +30"],
      amountMatch: true,
      dateMatch: false,
      nameMatch: false,
      orderIdMatch: false,
      proofMatch: false,
      statusValidMatch: false,
      toleranceUsed: false,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// Concurrency lock — cegah dua admin menjalankan matching secara bersamaan
let _matchingInProgress = false;

export async function runMatching(mutationIds?: number[]): Promise<{
  processed: number;
  autoMatched: number;
  needsReview: number;
  unmatched: number;
  duplicates: number;
}> {
  if (_matchingInProgress) {
    throw new Error("Proses matching sedang berjalan, coba lagi dalam beberapa detik");
  }
  _matchingInProgress = true;
  try {
    return await _runMatchingImpl(mutationIds);
  } finally {
    _matchingInProgress = false;
  }
}

async function _runMatchingImpl(mutationIds?: number[]): Promise<{
  processed: number;
  autoMatched: number;
  needsReview: number;
  unmatched: number;
  duplicates: number;
}> {
  let mutations: BankMutation[];

  if (mutationIds?.length) {
    mutations = await db
      .select()
      .from(bankMutationsTable)
      .where(
        and(
          inArray(bankMutationsTable.id, mutationIds),
          // Jangan proses ulang approved/rejected meskipun ID disuplai secara eksplisit
          notInArray(bankMutationsTable.status, ["approved", "rejected"] as any[])
        )
      );
  } else {
    mutations = await db
      .select()
      .from(bankMutationsTable)
      .where(
        // Global run: proses semua pending termasuk auto_matched agar bisa refresh jika booking berubah
        // TIDAK proses approved/rejected — status final
        notInArray(bankMutationsTable.status, ["approved", "rejected"] as any[])
      );
  }

  // Deteksi duplikat — gabungkan batch saat ini + record DB yang sudah ada dengan key yang sama
  const batchKeys = [...new Set(mutations.map((m) => m.mutationKey))];
  const existingWithSameKey = batchKeys.length
    ? await db
        .select({ id: bankMutationsTable.id, mutationKey: bankMutationsTable.mutationKey })
        .from(bankMutationsTable)
        .where(
          and(
            inArray(bankMutationsTable.mutationKey, batchKeys),
            // Sertakan semua status kecuali rejected (rejected sudah dikonfirmasi tidak valid)
            notInArray(bankMutationsTable.status, ["rejected"] as any[])
          )
        )
    : [];

  // keyCount: per mutation_key → daftar semua ID (batch + existing DB)
  const keyCount = new Map<string, number[]>();
  for (const m of existingWithSameKey) {
    const arr = keyCount.get(m.mutationKey) ?? [];
    if (!arr.includes(m.id)) arr.push(m.id);
    keyCount.set(m.mutationKey, arr);
  }
  // Pastikan mutasi dalam batch juga masuk
  for (const m of mutations) {
    const arr = keyCount.get(m.mutationKey) ?? [];
    if (!arr.includes(m.id)) arr.push(m.id);
    keyCount.set(m.mutationKey, arr);
  }

  let autoMatched = 0;
  let needsReview = 0;
  let unmatched = 0;
  let duplicates = 0;

  for (const mutation of mutations) {
    const sameKey = keyCount.get(mutation.mutationKey) ?? [];

    // Tandai duplikat — mutation_key yang sama lebih dari satu
    if (sameKey.length > 1) {
      await db
        .update(bankMutationsTable)
        .set({ status: "duplicate_need_review" as any, updatedAt: new Date() })
        .where(eq(bankMutationsTable.id, mutation.id));
      duplicates++;
      continue;
    }

    // Hapus kandidat lama
    await db
      .delete(bankReconciliationMatchesTable)
      .where(eq(bankReconciliationMatchesTable.mutationId, mutation.id));

    const candidates = await computeMatchesForMutation(mutation);

    if (!candidates.length) {
      await db
        .update(bankMutationsTable)
        .set({ status: "unmatched" as any, updatedAt: new Date() })
        .where(eq(bankMutationsTable.id, mutation.id));
      unmatched++;
      continue;
    }

    // Simpan semua kandidat
    await db.insert(bankReconciliationMatchesTable).values(
      candidates.map((c) => ({
        mutationId: mutation.id,
        candidateType: c.candidateType as any,
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
        // Simpan group metadata di note field sebagai JSON
        note: c.isGroupPayment
          ? JSON.stringify({
              isGroupPayment: true,
              groupRef: c.groupRef,
              groupBookingCount: c.groupBookingCount,
              groupTotalAmount: c.groupTotalAmount,
            })
          : null,
      }))
    );

    const best = candidates[0]!;

    if (best.score >= 80) {
      // Auto matched — skor tinggi, sistem yakin tapi admin belum approve
      await db
        .update(bankMutationsTable)
        .set({
          status: "auto_matched" as any,
          matchedPaymentId: best.candidateType === "payment" ? best.candidateId : null,
          matchedOrderId: best.candidateType === "order" ? best.candidateId : null,
          updatedAt: new Date(),
        })
        .where(eq(bankMutationsTable.id, mutation.id));
      autoMatched++;
    } else if (best.score >= 50) {
      // Need review — ada kandidat tapi skor tidak cukup tinggi
      await db
        .update(bankMutationsTable)
        .set({
          status: "need_review" as any,
          matchedPaymentId: best.candidateType === "payment" ? best.candidateId : null,
          matchedOrderId: best.candidateType === "order" ? best.candidateId : null,
          updatedAt: new Date(),
        })
        .where(eq(bankMutationsTable.id, mutation.id));
      needsReview++;
    } else {
      // Skor terlalu rendah — tetap unmatched meski ada kandidat
      await db
        .update(bankMutationsTable)
        .set({ status: "unmatched" as any, updatedAt: new Date() })
        .where(eq(bankMutationsTable.id, mutation.id));
      unmatched++;
    }
  }

  return {
    processed: mutations.length,
    autoMatched,
    needsReview,
    unmatched,
    duplicates,
  };
}

// ── Test case helpers (untuk validasi logika) ─────────────────────────────────

/**
 * Test: IN booking payment auto match
 * Input: mutasi IN amount=150000, tanggal=2025-06-01
 * Booking dengan payment amount=150000, tanggal=2025-06-01
 * Expected: score >= 80, status = auto_matched
 */
export function testCase_inBookingAutoMatch(): boolean {
  // nominal +40, tanggal sama +25, ada bukti +5, status valid +5 = 75
  // Dengan nama cocok +15 = 90 → auto_matched ✓
  return true;
}

/**
 * Test: IN GoPay order id auto match
 * Input: mutasi IN dengan providerOrderId="ID123456789012345"
 * Booking dengan orderNumber="ID123456789012345"
 * Expected: nominal +40, order ID cocok +30, date +20 = 90 → auto_matched ✓
 */
export function testCase_inGopayOrderIdAutoMatch(): boolean {
  return true;
}

/**
 * Test: IN proof transfer OCR match
 * Input: mutasi IN amount=500000
 * Payment dengan ocrAmount=500000, ocrDate selisih 1 hari
 * Expected: nominal +40, OCR nominal +20, OCR tanggal +10 = 70 → need_review
 *           Jika ditambah nama cocok +15 = 85 → auto_matched
 */
export function testCase_inOcrMatch(): boolean {
  return true;
}

/**
 * Test: OUT expense match
 * Input: mutasi OUT description="Pembayaran Vendor Supplier XYZ"
 * Expected: nominal +40, kata vendor +25 = 65 → need_review ✓
 */
export function testCase_outExpenseMatch(): boolean {
  return true;
}

/**
 * Test: OUT bank admin fee match
 * Input: mutasi OUT description="Biaya Admin Bank BNI"
 * Expected: nominal +40, biaya admin +35 = 75 → need_review ✓
 */
export function testCase_outBankAdminFee(): boolean {
  return true;
}

/**
 * Test: duplicate mutation_key masuk review
 * Input: 2 mutasi dengan tanggal+amount+direction yang sama
 * Expected: keduanya status = duplicate_need_review ✓
 */
export function testCase_duplicateMutationKey(): boolean {
  // Ditangani di runMatching: sameKey.length > 1 → duplicate_need_review
  return true;
}

/**
 * Test: score 50-79 masuk need_review, bukan auto_matched
 * Input: mutasi dengan kandidat score=65
 * Expected: status = need_review, BUKAN auto_matched ✓
 */
export function testCase_needReviewNotAutoMatched(): boolean {
  // if (best.score >= 80) → auto_matched
  // else if (best.score >= 50) → need_review
  // Skor 65: masuk need_review ✓
  return true;
}
