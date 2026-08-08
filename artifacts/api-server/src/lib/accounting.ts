import { db, accountingJournalsTable, accountingJournalLinesTable, taxTransactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import pg from "pg";

// ─── Public Accounting (public.accounting_entries) ───────────────────────────
// Gunakan direct pg.Pool ke Supabase (PROD atau DEV fallback).
// db Drizzle hanya konek ke sport_center schema; public.accounting_entries ada di shared Supabase.
const SHARED_DB_URL =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

let _publicPool: pg.Pool | null = null;
function getPublicPool(): pg.Pool | null {
  if (!SHARED_DB_URL) return null;
  if (!_publicPool) {
    _publicPool = new pg.Pool({
      connectionString: SHARED_DB_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return _publicPool;
}

const TAX_ID_PPN_11 = 1;
const COMPANY_ID = 1;

type PublicPaymentMethod = "QRIS" | "Transfer Bank";

function normalizePublicPaymentMethod(paymentMethod?: string): PublicPaymentMethod {
  return String(paymentMethod ?? "").trim().toLowerCase().includes("qris")
    ? "QRIS"
    : "Transfer Bank";
}

async function getPublicPaymentAccount(
  pool: pg.Pool | pg.PoolClient,
  paymentMethod?: string,
): Promise<{ id: number; code: string; name: string; label: PublicPaymentMethod }> {
  const label = normalizePublicPaymentMethod(paymentMethod);
  // QRIS settles into Bank Mandiri CST, so it uses the same public COA
  // as transfer bank. Never look up a separate "QRIS" cash account.
  const result = await pool.query(
    `SELECT id, code, name
       FROM public.chart_of_accounts
      WHERE code = '1-1020-CST'
        AND is_active = true
      LIMIT 1`,
  );

  if (result.rows.length !== 1) {
    throw new Error(
      "[accounting] COA Bank Mandiri CST (1-1020-CST) tidak ditemukan; jurnal tidak diubah.",
    );
  }

  return {
    id: Number(result.rows[0].id),
    code: String(result.rows[0].code),
    name: String(result.rows[0].name),
    label,
  };
}

// ─── Helper: ekstrak DPP dari booking ────────────────────────────────────────
// Harga fasilitas di sport center sudah inklusif PPN (grandTotal = totalPrice).
// Fungsi journal menerima DPP (sebelum PPN) sebagai subtotal.
// Gunakan helper ini di semua caller agar tidak double-count PPN.
//
// Contoh: badminton 100.000 (inklusif 11%)
//   → dpp = 90.090, ppnAmount = 9.910, grandTotal = 100.000 ✅
export function extractBookingDpp(booking: {
  totalPrice: string | number | null;
  dpp?: string | number | null;
  ppnAmount?: string | number | null;
  grandTotal?: string | number | null;
}): { dpp: number; ppnAmount: number } {
  const ppnAmount = booking.ppnAmount != null ? Number(booking.ppnAmount) : 0;
  const grandTotalAmt = booking.grandTotal != null
    ? Number(booking.grandTotal)
    : Number(booking.totalPrice);
  // Prioritaskan kolom dpp yang tersimpan; fallback: grandTotal - ppnAmount
  const dpp = booking.dpp != null && Number(booking.dpp) > 0
    ? Number(booking.dpp)
    : ppnAmount > 0 ? grandTotalAmt - ppnAmount : grandTotalAmt;
  return { dpp, ppnAmount };
}

// Cache COA/journal IDs dari public schema
let _publicIds: {
  journalId: number;
  coaKas: number;
  coaPendapatan: number;
  coaPpnKeluaran: number;
  taxIdPpn: number;
} | null = null;

async function getPublicIds() {
  if (_publicIds) return _publicIds;

  const pool = getPublicPool();
  if (!pool) throw new Error("[accounting] Tidak ada Supabase URL — tidak bisa write ke public.accounting_entries");

  const [journal, kas, pendapatan, ppn, tax] = await Promise.all([
    pool.query(`SELECT id FROM public.accounting_journals WHERE code = 'BNK-CST' LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '1-1020-CST' AND is_active = true LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST' AND is_active = true LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST' AND is_active = true LIMIT 1`),
    pool.query(`SELECT id FROM public.accounting_taxes WHERE name ILIKE '%PPN Keluaran%' AND company_id = $1 ORDER BY id LIMIT 1`, [COMPANY_ID]),
  ]);

  const journalId = Number(journal.rows[0]?.id);
  const coaKas = Number(kas.rows[0]?.id);
  const coaPendapatan = Number(pendapatan.rows[0]?.id);
  const coaPpnKeluaran = Number(ppn.rows[0]?.id);
  const taxIdPpn = Number(tax.rows[0]?.id ?? 1);

  if (!journalId || !coaKas || !coaPendapatan || !coaPpnKeluaran) {
    throw new Error(
      `[accounting] Public COA/journal lookup gagal. ` +
      `journalId=${journalId} coaKas=${coaKas} coaPendapatan=${coaPendapatan} coaPpnKeluaran=${coaPpnKeluaran}. ` +
      `Pastikan public.accounting_journals code=BNK-CST dan chart_of_accounts 1-1020-CST, 4-1017-CST, 2-1020-CST ada.`
    );
  }

  _publicIds = { journalId, coaKas, coaPendapatan, coaPpnKeluaran, taxIdPpn };
  return _publicIds;
}

async function nextPublicEntryNumber(pool: pg.Pool | pg.PoolClient, year: number): Promise<string> {
  const result = await pool.query(
    `SELECT COALESCE(MAX(
      NULLIF(REGEXP_REPLACE(entry_number, '^SC-BNK/[0-9]+/', ''), '')::integer
    ), 0) + 1 AS seq
    FROM public.accounting_entries
    WHERE entry_number LIKE $1`,
    [`SC-BNK/${year}/%`]
  );
  const seq = Number(result.rows[0]?.seq ?? 1);
  return `SC-BNK/${year}/${String(seq).padStart(4, "0")}`;
}

export async function createPublicAccountingEntry(
  bookingId: number,
  orderNumber: string,
  subtotal: number,
  ppnAmount: number,
  facilityId: number | null,
  journalDate: string,
  paymentMethod?: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip createPublicAccountingEntry");
    return;
  }

  // subtotal  = DPP (harga SEBELUM PPN — bukan totalPrice inklusif).
  //             Caller wajib mengekstrak DPP terlebih dahulu:
  //               dpp = grandTotalInklusif - ppnAmount
  //             Jangan kirim booking.totalPrice langsung — akan double-count PPN.
  // ppnAmount = PPN yang sudah dihitung (terpisah dari DPP)
  // grandTotal = DPP + PPN = jumlah yang diterima dari customer (masuk ke Bank Mandiri CST)
  const grandTotal = subtotal + ppnAmount;
  const netRevenue = subtotal;
  const hasPpn = ppnAmount > 0;
  const year = new Date(journalDate).getFullYear();
  const period = journalDate.slice(0, 7);
  const entryNumber = await nextPublicEntryNumber(pool, year);
  const ids = await getPublicIds();
  const paymentAccount = await getPublicPaymentAccount(pool, paymentMethod);

  // 1. Buat accounting entry (draft)
  const entryResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_booking',$6,$7,$7,$8,$9,$10,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, orderNumber,
      `Pembayaran Booking Sport Center (${orderNumber}) via ${paymentAccount.label}`,
      bookingId, grandTotal, COMPANY_ID, facilityId ?? null,
      `sc_booking_${orderNumber}`,
    ]
  );
  const entryId = Number(entryResult.rows[0]?.id);

  // 2. Baris GL: Kas (debit), Pendapatan net (kredit), PPN Keluaran (kredit jika ada)
  if (hasPpn) {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$7),
        ($1,$8,$9,0,$10)`,
      [
        entryId,
        paymentAccount.id,  `Penerimaan booking ${orderNumber} via ${paymentAccount.label}`, grandTotal,
        ids.coaPendapatan,  `Pendapatan booking ${orderNumber}`, netRevenue,
        ids.coaPpnKeluaran, `PPN Keluaran booking ${orderNumber}`, ppnAmount,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$4)`,
      [entryId, paymentAccount.id, `Penerimaan booking ${orderNumber} via ${paymentAccount.label}`, grandTotal, ids.coaPendapatan, `Pendapatan booking ${orderNumber}`]
    );
  }

  // 3. Post entry
  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);

  // 4. sport_center.tax_transactions — hanya jika ada PPN
  if (hasPpn) {
    await db.insert(taxTransactionsTable).values({
      referenceType: "sport_center_booking",
      referenceId: bookingId,
      referenceNumber: orderNumber,
      taxCode: "PPN_OUT_11",
      taxRate: "11",
      dpp: String(subtotal),
      dppNilaiLain: String(Math.round((subtotal * 11) / 12 * 100) / 100),
      grandTotal: String(grandTotal),
      taxAmount: String(ppnAmount),
      transactionDate: period,
      status: "posted",
      transactionType: "original",
    });

    // 5. public.gl_tax_lines
    await pool.query(
      `INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period, entity_type, entity_id, is_reported, created_at)
      VALUES ($1,$2,'PPN_OUT',11,$3,$4,'out',$5,'booking',$6,false,NOW())`,
      [COMPANY_ID, entryId, subtotal, ppnAmount, period, orderNumber]
    );
  }

  console.info(`[accounting] ✓ Public accounting entry created: ${entryNumber} (${orderNumber})`);
}

export type SportCenterBookingPaymentPosting = {
  paymentNumber: string;
  bookingId: number;
  orderNumber: string;
  amount: number;
  paymentMethod?: string | null;
  paymentType?: string | null;
  paidAt?: Date | string | null;
  ppnRate?: number | null;
};

export type SportCenterBookingPaymentPostingResult = {
  entryId: number;
  postingStatus: "posted";
  alreadyPosted: boolean;
};

/**
 * Post one mirrored Sport Center payment to public accounting.
 *
 * This is deliberately keyed by the mirrored payment number, not only by
 * booking/order number. A booking may have DP and pelunasan payments, and
 * each payment must produce at most one accounting entry.
 */
export async function postSportCenterBookingPayment(
  input: SportCenterBookingPaymentPosting,
): Promise<SportCenterBookingPaymentPostingResult> {
  const pool = getPublicPool();
  if (!pool) {
    throw new Error("[accounting] Supabase URL tidak tersedia; payment belum diposting.");
  }

  const correlationId = `sc_payment_${input.paymentNumber}`;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const paymentResult = await client.query(
      `SELECT id, entry_id, posting_status
         FROM public.sport_payments
        WHERE payment_number = $1
        FOR UPDATE`,
      [input.paymentNumber],
    );
    const mirroredPayment = paymentResult.rows[0];
    if (!mirroredPayment) {
      throw new Error(`[accounting] Mirrored payment ${input.paymentNumber} tidak ditemukan.`);
    }

    if (mirroredPayment.posting_status === "posted" && mirroredPayment.entry_id) {
      await client.query("COMMIT");
      return {
        entryId: Number(mirroredPayment.entry_id),
        postingStatus: "posted",
        alreadyPosted: true,
      };
    }

    const existingEntry = await client.query(
      `SELECT id, status
         FROM public.accounting_entries
        WHERE correlation_id = $1
        LIMIT 1`,
      [correlationId],
    );
    if (existingEntry.rows.length > 0) {
      const existing = existingEntry.rows[0];
      if (existing.status !== "posted") {
        throw new Error(
          `[accounting] Entry ${existing.id} untuk ${input.paymentNumber} belum posted (status=${existing.status}).`,
        );
      }

      await client.query(
        `UPDATE public.sport_payments
            SET entry_id = $2, posting_status = 'posted', posting_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [mirroredPayment.id, Number(existing.id)],
      );
      await client.query("COMMIT");
      return {
        entryId: Number(existing.id),
        postingStatus: "posted",
        alreadyPosted: true,
      };
    }

    const grossAmount = Math.round(Number(input.amount));
    if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
      throw new Error(`[accounting] Nominal payment ${input.paymentNumber} tidak valid.`);
    }

    const rate = Math.max(0, Number(input.ppnRate ?? 0));
    const ppnAmount = rate > 0
      ? Math.round((grossAmount * rate) / (100 + rate))
      : 0;
    const dpp = grossAmount - ppnAmount;
    const journalDate = input.paidAt
      ? new Date(input.paidAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const year = new Date(journalDate).getFullYear();
    const entryNumber = await nextPublicEntryNumber(client, year);
    const ids = await getPublicIdsForQuery(client);
    const paymentAccount = await getPublicPaymentAccount(client, input.paymentMethod ?? undefined);
    const methodLabel = normalizePublicPaymentMethod(input.paymentMethod ?? undefined);
    const hasPpn = ppnAmount > 0;

    const entryResult = await client.query(
      `INSERT INTO public.accounting_entries
        (entry_number, journal_id, date, ref, description, status, source, source_id,
         total_debit, total_credit, company_id, correlation_id, governance_flags)
       VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_booking',$6,$7,$7,$8,$9,'{}')
       RETURNING id`,
      [
        entryNumber,
        ids.journalId,
        journalDate,
        input.orderNumber,
        `Pembayaran Sport Center ${input.orderNumber} (${input.paymentNumber}, ${input.paymentType ?? "booking"}) via ${methodLabel}`,
        input.bookingId,
        grossAmount,
        COMPANY_ID,
        correlationId,
      ],
    );
    const entryId = Number(entryResult.rows[0]?.id);
    if (!entryId) throw new Error(`[accounting] Entry gagal dibuat untuk ${input.paymentNumber}.`);

    if (hasPpn) {
      await client.query(
        `INSERT INTO public.accounting_entry_lines
          (entry_id, account_id, description, debit, credit) VALUES
          ($1,$2,$3,$4,0),
          ($1,$5,$6,0,$7),
          ($1,$8,$9,0,$10)`,
        [
          entryId,
          paymentAccount.id,
          `Penerimaan ${input.paymentNumber} via ${methodLabel}`,
          grossAmount,
          ids.coaPendapatan,
          `Pendapatan booking ${input.orderNumber}`,
          dpp,
          ids.coaPpnKeluaran,
          `PPN Keluaran booking ${input.orderNumber}`,
          ppnAmount,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO public.accounting_entry_lines
          (entry_id, account_id, description, debit, credit) VALUES
          ($1,$2,$3,$4,0),
          ($1,$5,$6,0,$4)`,
        [
          entryId,
          paymentAccount.id,
          `Penerimaan ${input.paymentNumber} via ${methodLabel}`,
          grossAmount,
          ids.coaPendapatan,
          `Pendapatan booking ${input.orderNumber}`,
        ],
      );
    }

    await client.query(
      `UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`,
      [entryId],
    );
    if (hasPpn) {
      await client.query(
        `INSERT INTO sport_center.tax_transactions
          (reference_type, reference_id, reference_number, tax_code, tax_rate,
           dpp, dpp_nilai_lain, grand_total, tax_amount, transaction_date,
           status, transaction_type, created_at)
         SELECT 'sport_center_payment', $1, $2, 'PPN_OUT_11', $3,
                $4, $5, $6, $7, $8, 'posted', 'original', NOW()
          WHERE NOT EXISTS (
            SELECT 1
              FROM sport_center.tax_transactions
             WHERE reference_type = 'sport_center_payment'
               AND reference_id = $1
               AND transaction_type = 'original'
          )`,
        [
          mirroredPayment.id,
          input.paymentNumber,
          String(rate),
          String(dpp),
          String(Math.round((dpp * 11) / 12 * 100) / 100),
          String(grossAmount),
          String(ppnAmount),
          journalDate,
        ],
      );
      await client.query(
        `INSERT INTO public.gl_tax_lines
          (company_id, accounting_entry_id, tax_type, rate,
           base_amount, tax_amount, direction, period, entity_type, entity_id,
           is_reported, created_at)
         VALUES ($1,$2,'PPN_OUT',$3,$4,$5,'out',$6,'booking',$7,false,NOW())`,
        [COMPANY_ID, entryId, rate, dpp, ppnAmount, journalDate.slice(0, 7), input.orderNumber],
      );
    }
    await client.query(
      `UPDATE public.sport_payments
          SET entry_id = $2, posting_status = 'posted', posting_error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [mirroredPayment.id, entryId],
    );
    await client.query("COMMIT");

    console.info(`[accounting] ✓ Sport Center payment posted: ${input.paymentNumber} → entry ${entryId}`);
    return { entryId, postingStatus: "posted", alreadyPosted: false };
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    const message = String(err?.message ?? err).slice(0, 1000);
    await pool.query(
      `UPDATE public.sport_payments
          SET posting_status = 'failed', posting_error = $2, updated_at = NOW()
        WHERE payment_number = $1`,
      [input.paymentNumber, message],
    ).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function getPublicIdsForQuery(pool: pg.Pool | pg.PoolClient) {
  const [journal, kas, pendapatan, ppn] = await Promise.all([
    pool.query(`SELECT id FROM public.accounting_journals WHERE code = 'BNK-CST' LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '1-1020-CST' AND is_active = true LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST' AND is_active = true LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST' AND is_active = true LIMIT 1`),
  ]);
  const journalId = Number(journal.rows[0]?.id);
  const coaKas = Number(kas.rows[0]?.id);
  const coaPendapatan = Number(pendapatan.rows[0]?.id);
  const coaPpnKeluaran = Number(ppn.rows[0]?.id);
  if (!journalId || !coaKas || !coaPendapatan || !coaPpnKeluaran) {
    throw new Error(
      `[accounting] Public COA/journal lookup gagal untuk payment posting: journalId=${journalId} coaKas=${coaKas} coaPendapatan=${coaPendapatan} coaPpnKeluaran=${coaPpnKeluaran}.`,
    );
  }
  return { journalId, coaKas, coaPendapatan, coaPpnKeluaran };
}


/**
 * Buat SATU accounting entry di BizPortal untuk seluruh booking dalam grup.
 * Idempotent: jika correlation_id sc_group_<groupRef> sudah ada, skip.
 */
export async function createPublicAccountingEntryForGroup(
  groupRef: string,
  groupBookings: Array<{
    id: number;
    orderNumber: string;
    subtotal: number;
    ppnAmount: number;
    facilityId: number | null;
  }>,
  journalDate: string,
  paymentMethod?: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip createPublicAccountingEntryForGroup");
    return;
  }

  const correlationId = `sc_group_${groupRef}`;

  // Idempotency: skip jika sudah ada entry untuk grup ini
  const existing = await pool.query(
    `SELECT id FROM public.accounting_entries WHERE correlation_id = $1 LIMIT 1`,
    [correlationId]
  );
  if (existing.rows.length > 0) {
    console.info(`[accounting] Group entry sudah ada untuk ${groupRef} (id=${existing.rows[0].id}) — skip`);
    return;
  }

  const totalGross   = groupBookings.reduce((s, b) => s + b.subtotal, 0);
  const totalPpn     = groupBookings.reduce((s, b) => s + b.ppnAmount, 0);
  const totalRevenue = totalGross - totalPpn;
  const hasPpn       = totalPpn > 0;
  const year         = new Date(journalDate).getFullYear();
  const entryNumber  = await nextPublicEntryNumber(pool, year);
  const ids          = await getPublicIds();
  const paymentAccount = await getPublicPaymentAccount(pool, paymentMethod);

  const orderList   = groupBookings.map(b => b.orderNumber).join(", ");
  const description = `Pembayaran Grup Booking Sport Center (${groupRef} — ${groupBookings.length} sesi: ${orderList}) via ${paymentAccount.label}`;


  // Gunakan facilityId dari booking pertama (representatif)
  const facilityId = groupBookings[0]?.facilityId ?? null;

  // 1. Buat accounting entry
  const entryResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_booking',$6,$7,$7,$8,$9,$10,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, groupRef,
      description,
      groupBookings[0]?.id ?? 0,
      totalGross, COMPANY_ID, facilityId, correlationId,
    ]
  );
  const entryId = Number(entryResult.rows[0]?.id);

  // 2. GL lines
  if (hasPpn) {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$7),
        ($1,$8,$9,0,$10)`,
      [
        entryId,
        paymentAccount.id,  `Penerimaan grup booking ${groupRef} via ${paymentAccount.label}`, totalGross,
        ids.coaPendapatan,  `Pendapatan grup booking ${groupRef}`, totalRevenue,
        ids.coaPpnKeluaran, `PPN Keluaran grup booking ${groupRef}`, totalPpn,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$4)`,
      [entryId, paymentAccount.id, `Penerimaan grup booking ${groupRef} via ${paymentAccount.label}`, totalGross, ids.coaPendapatan, `Pendapatan grup booking ${groupRef}`]
    );
  }

  // 3. Post entry
  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);

  console.info(`[accounting] ✓ Group accounting entry created: ${entryNumber} (${groupRef}, ${groupBookings.length} sesi, total Rp ${totalGross.toLocaleString("id-ID")})`);
}

// ─── Public Accounting: Member Gym & Invoice Perusahaan ──────────────────────

export async function createPublicMembershipAccountingEntry(
  membershipId: number,
  refNumber: string,
  dpp: number,
  ppnAmount: number,
  journalDate: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip createPublicMembershipAccountingEntry");
    return;
  }

  const grandTotal  = dpp + ppnAmount;
  const hasPpn      = ppnAmount > 0;
  const year        = new Date(journalDate).getFullYear();
  const period      = journalDate.slice(0, 7);
  const entryNumber = await nextPublicEntryNumber(pool, year);
  const ids         = await getPublicIds();

  const entryResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_membership',$6,$7,$7,$8,NULL,$9,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, refNumber,
      `Pembayaran Member Gym Sport Center (${refNumber})`,
      membershipId, grandTotal, COMPANY_ID,
      `sc_membership_${refNumber}`,
    ]
  );
  const entryId = Number(entryResult.rows[0]?.id);

  if (hasPpn) {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$7),
        ($1,$8,$9,0,$10)`,
      [
        entryId,

        ids.coaKas,         `Penerimaan member gym ${refNumber}`, grandTotal,
        ids.coaPendapatan,  `Pendapatan member gym ${refNumber}`, dpp,
        ids.coaPpnKeluaran, `PPN Keluaran member gym ${refNumber}`, ppnAmount,
      ]
    );
    await db.insert(taxTransactionsTable).values({
      referenceType: "sport_center_membership",
      referenceId: membershipId,
      referenceNumber: refNumber,
      taxCode: "PPN_OUT_11",
      taxRate: "11",
      dpp: String(dpp),
      dppNilaiLain: String(Math.round(dpp * 11 / 12)),
      grandTotal: String(grandTotal),
      taxAmount: String(ppnAmount),
      transactionDate: period,
      status: "posted",
      transactionType: "original",
    });
  } else {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$4)`,
      [entryId, ids.coaKas, `Penerimaan member gym ${refNumber}`, grandTotal, ids.coaPendapatan, `Pendapatan member gym ${refNumber}`]
    );
  }

  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);
  console.info(`[accounting] ✓ Public accounting entry created (membership): ${entryNumber} (${refNumber})`);
}

export async function createPublicInvoiceAccountingEntry(
  invoiceId: number,
  invoiceNumber: string,
  subtotal: number,
  ppnAmount: number,
  journalDate: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip createPublicInvoiceAccountingEntry");
    return;
  }

  const grandTotal  = subtotal + ppnAmount;
  const netRevenue  = subtotal;
  const hasPpn      = ppnAmount > 0;
  const year        = new Date(journalDate).getFullYear();
  const period      = journalDate.slice(0, 7);
  const entryNumber = await nextPublicEntryNumber(pool, year);
  const ids         = await getPublicIds();

  const entryResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_invoice',$6,$7,$7,$8,NULL,$9,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, invoiceNumber,
      `Pembayaran Invoice Perusahaan (${invoiceNumber})`,
      invoiceId, grandTotal, COMPANY_ID,
      `sc_invoice_${invoiceNumber}`,
    ]
  );
  const entryId = Number(entryResult.rows[0]?.id);

  if (hasPpn) {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$7),
        ($1,$8,$9,0,$10)`,
      [
        entryId,
        ids.coaKas,         `Penerimaan invoice ${invoiceNumber}`, grandTotal,
        ids.coaPendapatan,  `Pendapatan invoice ${invoiceNumber}`, netRevenue,
        ids.coaPpnKeluaran, `PPN Keluaran invoice ${invoiceNumber}`, ppnAmount,
      ]
    );

  } else {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$4)`,
      [entryId, ids.coaKas, `Penerimaan invoice ${invoiceNumber}`, grandTotal, ids.coaPendapatan, `Pendapatan invoice ${invoiceNumber}`]
    );
  }

  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);

  if (hasPpn) {

    await db.insert(taxTransactionsTable).values({
      referenceType: "sport_center_invoice",
      referenceId: invoiceId,
      referenceNumber: invoiceNumber,
      taxCode: "PPN_OUT_11",
      taxRate: "11",
      dpp: String(subtotal),
      dppNilaiLain: String(Math.round((subtotal * 11) / 12 * 100) / 100),
      grandTotal: String(grandTotal),
      taxAmount: String(ppnAmount),
      transactionDate: period,
      status: "posted",
      transactionType: "original",
    });
    await pool.query(
      `INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period, entity_type, entity_id, is_reported, created_at)
      VALUES ($1,$2,'PPN_OUT',11,$3,$4,'out',$5,'company_invoice',$6,false,NOW())`,
      [COMPANY_ID, entryId, subtotal, ppnAmount, period, invoiceNumber]
    );
  } else {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$4)`,
      [entryId, ids.coaKas, `Penerimaan invoice ${invoiceNumber}`, grandTotal, ids.coaPendapatan, `Pendapatan invoice ${invoiceNumber}`]
    );
  }

  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);
  console.info(`[accounting] ✓ Public accounting entry created (invoice): ${entryNumber} (${invoiceNumber})`);
}

export async function reversePublicAccountingEntry(
  orderNumber: string,
  reason: string,
  journalDate: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip reversePublicAccountingEntry");
    return;
  }

  const originalResult = await pool.query(
    `SELECT id, total_debit, total_credit FROM public.accounting_entries
     WHERE source = 'sport_center_booking' AND ref = $1 AND status = 'posted' LIMIT 1`,
    [orderNumber]
  );
  if (!originalResult.rows.length) return;

  const original = originalResult.rows[0];
  const year = new Date(journalDate).getFullYear();
  const period = journalDate.slice(0, 7);
  const entryNumber = await nextPublicEntryNumber(pool, year);
  const ids = await getPublicIds();

  // 1. Reversal accounting entry (draft)
  const revResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_booking_reversal',$6,$7,$7,$8,$9,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, orderNumber,
      `Reversal Booking ${orderNumber}: ${reason}`,
      original.id, original.total_debit, COMPANY_ID,
      `sc_reversal_${orderNumber}`,
    ]
  );
  const revId = Number(revResult.rows[0]?.id);

  // 2. Swap debit/kredit dari lines asli
  await pool.query(
    `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit)
     SELECT $1, account_id, $2, credit, debit FROM public.accounting_entry_lines WHERE entry_id = $3`,
    [revId, `Reversal: ${reason}`, original.id]
  );

  // 3. Post reversal entry
  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [revId]);

  // 4. Reverse sport_center.tax_transactions
  const origTaxRows = await db
    .select()
    .from(taxTransactionsTable)
    .where(
      and(
        eq(taxTransactionsTable.referenceType, "sport_center_booking"),
        eq(taxTransactionsTable.referenceNumber, orderNumber),
        eq(taxTransactionsTable.status, "posted"),
      )
    )
    .limit(1);
  if (origTaxRows.length) {
    const origTax = origTaxRows[0];
    await db
      .update(taxTransactionsTable)
      .set({ status: "reversed" })
      .where(eq(taxTransactionsTable.id, origTax.id));
    await db.insert(taxTransactionsTable).values({
      referenceType: "sport_center_booking_reversal",
      referenceId: revId,
      referenceNumber: orderNumber,
      taxCode: "PPN_OUT_11",
      taxRate: origTax.taxRate,
      dpp: String(-Math.abs(Number(origTax.dpp))),
      taxAmount: String(-Math.abs(Number(origTax.taxAmount))),
      transactionDate: period,
      status: "reversed",
      transactionType: "reversal",
      reversalOfId: origTax.id,
    });

    // 5. Reversal gl_tax_lines
    await pool.query(
      `INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period, entity_type, entity_id, is_reported, created_at)
       SELECT $1,$2,tax_type,rate,-ABS(base_amount),-ABS(tax_amount),direction,$3,
              entity_type,entity_id,false,NOW()
       FROM public.gl_tax_lines WHERE accounting_entry_id = $4`,
      [COMPANY_ID, revId, period, original.id]
    );
  }

  console.info(`[accounting] ✓ Public accounting entry reversed: ${entryNumber} (${orderNumber})`);
}

// ─── Sport Center Internal Journal (sport_center schema) ─────────────────────

async function postJournalLines(
  journalId: number,
  lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }>,
): Promise<void> {
  if (!lines.length) return;
  await db.insert(accountingJournalLinesTable).values(
    lines.map((l) => ({
      journalId,
      lineType: l.lineType,
      accountCode: l.accountCode,
      accountName: l.accountName,
      amount: String(l.amount),
      description: l.description ?? null,
    })),
  );
}

/**
 * Petakan metode pembayaran ke nama akun GL dan kode akun yang sesuai.
 * Default: Bank Mandiri (Transfer Bank) jika tidak dikenali.
 */
function resolvePaymentAccount(paymentMethod?: string): { debitAccount: string; accountCode: string } {
  const m = (paymentMethod ?? "").toLowerCase().trim();
  // QRIS settles to Bank Mandiri CST, not a separate cash account.
  if (m.includes("qris"))                                                   return { debitAccount: "Bank Mandiri",             accountCode: "1104" };
  if (m.includes("tunai") || m.includes("cash"))                            return { debitAccount: "Kas Tunai",               accountCode: "1101" };
  if (m.includes("ewallet") || m.includes("e-wallet") || m.includes("ovo")
    || m.includes("dana") || m.includes("gopay") || m.includes("shopeepay")) return { debitAccount: "Kas - E-Wallet",         accountCode: "1103" };
  if (m.includes("virtual account") || m.startsWith("va"))                  return { debitAccount: "Bank - Virtual Account",  accountCode: "1106" };
  if (m.includes("kartu kredit") || m.includes("credit card") || m === "cc") return { debitAccount: "Bank - Kartu Kredit",   accountCode: "1107" };
  // default: transfer bank / Bank Mandiri
  return { debitAccount: "Bank Mandiri", accountCode: "1104" };
}

export async function createJournalEntry(
  bookingId: number,
  orderNumber: string,
  subtotal: number,
  ppnAmount: number,
  journalDate: string,
  paymentMethod?: string,
): Promise<void> {
  // subtotal = DPP (sebelum PPN), grandTotal = DPP + PPN = jumlah yang masuk ke bank
  const grandTotal = subtotal + ppnAmount;
  const netRevenue = subtotal;
  const { debitAccount, accountCode } = resolvePaymentAccount(paymentMethod);
  const methodLabel = paymentMethod ? ` via ${paymentMethod}` : "";

  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId,
      orderNumber,
      journalType: "payment_confirmed",
      debitAccount,
      debitAmount: String(grandTotal),
      creditRevenueAccount: "Pendapatan Sport Center",
      creditRevenueAmount: String(ppnAmount > 0 ? netRevenue : grandTotal),
      creditPpnAccount: ppnAmount > 0 ? "PPN Keluaran" : "",
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: `Pembayaran dikonfirmasi untuk booking ${orderNumber}${methodLabel}`,
    })
    .returning();

  if (!journal) return;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit",  accountCode, accountName: debitAccount,                         amount: grandTotal,                              description: `Penerimaan booking ${orderNumber}${methodLabel}` },
    { lineType: "credit", accountCode: "4-1001", accountName: "Pendapatan Sport Center",  amount: ppnAmount > 0 ? netRevenue : grandTotal, description: `Pendapatan booking ${orderNumber}` },
  ];
  if (ppnAmount > 0) {
    lines.push({ lineType: "credit", accountCode: "2-1101", accountName: "PPN Keluaran", amount: ppnAmount, description: `PPN 11% booking ${orderNumber}` });
  }

  await postJournalLines(journal.id, lines);
}

// ─── Sport Center Internal Journal: Member Gym & Invoice Perusahaan ──────────

export async function createMembershipJournalEntry(
  membershipId: number,
  refNumber: string,
  dpp: number,
  ppnAmount: number,
  journalDate: string,
): Promise<void> {
  // grandTotal = dpp + ppnAmount = jumlah yang diterima dari customer (inklusif PPN)
  const grandTotal = dpp + ppnAmount;
  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId: null,
      orderNumber: refNumber,
      journalType: "membership_payment_confirmed",
      debitAccount: "Bank Mandiri",
      debitAmount: String(grandTotal),
      creditRevenueAccount: "Pendapatan Sport Center",
      creditRevenueAmount: String(ppnAmount > 0 ? dpp : grandTotal),
      creditPpnAccount: ppnAmount > 0 ? "PPN Keluaran" : "",
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: `Pembayaran dikonfirmasi untuk member gym ${refNumber}`,
    })
    .returning();

  if (!journal) return;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit",  accountCode: "1104",   accountName: "Bank Mandiri",              amount: grandTotal, description: `Penerimaan member gym ${refNumber}` },
    { lineType: "credit", accountCode: "4-1001", accountName: "Pendapatan Sport Center",   amount: ppnAmount > 0 ? dpp : grandTotal, description: `Pendapatan member gym ${refNumber}` },
  ];
  if (ppnAmount > 0) {
    lines.push({ lineType: "credit", accountCode: "2-1101", accountName: "PPN Keluaran", amount: ppnAmount, description: `PPN 11% member gym ${refNumber}` });
  }
  await postJournalLines(journal.id, lines);
}

export async function createInvoiceJournalEntry(
  invoiceId: number,
  invoiceNumber: string,
  subtotal: number,   // DPP (sebelum PPN) — bukan totalAmount inklusif
  ppnAmount: number,
  journalDate: string,
): Promise<void> {
  const grandTotal = subtotal + ppnAmount;
  const netRevenue = subtotal;

  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId: null,
      orderNumber: invoiceNumber,
      journalType: "invoice_payment_confirmed",
      debitAccount: "Bank Mandiri",
      debitAmount: String(grandTotal),
      creditRevenueAccount: "Pendapatan Sport Center",
      creditRevenueAmount: String(ppnAmount > 0 ? netRevenue : grandTotal),
      creditPpnAccount: ppnAmount > 0 ? "PPN Keluaran" : "",
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: `Pembayaran dikonfirmasi untuk invoice perusahaan ${invoiceNumber}`,
    })
    .returning();

  if (!journal) return;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit",  accountCode: "1104", accountName: "Bank Mandiri",              amount: grandTotal,  description: `Penerimaan invoice ${invoiceNumber}` },
    { lineType: "credit", accountCode: "4-1001", accountName: "Pendapatan Sport Center", amount: ppnAmount > 0 ? netRevenue : grandTotal, description: `Pendapatan invoice ${invoiceNumber}` },
  ];
  if (ppnAmount > 0) {
    lines.push({ lineType: "credit", accountCode: "2-1101", accountName: "PPN Keluaran", amount: ppnAmount, description: `PPN 11% invoice ${invoiceNumber}` });
  }

  await postJournalLines(journal.id, lines);
}

export type ExpenseJournalType =
  | "operational"
  | "liability"
  | "kasbon"
  | "kasbon_settlement"

export function detectJournalType(accountType: string): ExpenseJournalType {
  if (accountType === "liability") return "liability";
  if (accountType === "asset") return "kasbon";
  return "operational";
}

export async function createExpenseJournalEntry(
  expenseNo: string,
  category: string,
  amount: number,
  ppnAmount: number,
  totalAmount: number,
  paymentMethod: string,
  description: string,
  journalDate: string,
  coaAccountCode?: string,
  coaAccountName?: string,
  coaAccountType?: string,
): Promise<number> {
  const effectiveAccountCode = coaAccountCode ?? "6-0001";
  const effectiveAccountName = coaAccountName ?? category;
  const journalType = coaAccountType ? detectJournalType(coaAccountType) : "operational";
  const kasSource = `Kas/Bank (${paymentMethod})`;

  let debitAccount = effectiveAccountName;
  let creditAccount = kasSource;
  let journalNotes = `Pengeluaran ${expenseNo}: ${description}`;
  let journalTypeLabel = "expense_paid";

  if (journalType === "liability") {
    journalTypeLabel = "expense_paid_liability";
    journalNotes = `Pembayaran hutang/pinjaman ${expenseNo}: ${description}`;
  } else if (journalType === "kasbon") {
    journalTypeLabel = "expense_paid_kasbon";
    debitAccount = effectiveAccountName;
    journalNotes = `Kasbon karyawan ${expenseNo}: ${description}`;
  }

  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId: null,
      orderNumber: expenseNo,
      journalType: journalTypeLabel,
      debitAccount,
      debitAmount: String(ppnAmount > 0 ? amount : totalAmount),
      creditRevenueAccount: creditAccount,
      creditRevenueAmount: String(totalAmount),
      creditPpnAccount: ppnAmount > 0 ? "PPN Masukan" : "",
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: journalNotes,
    })
    .returning();

  if (!journal) return 0;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [];

  if (journalType === "operational") {
    lines.push({ lineType: "debit", accountCode: effectiveAccountCode, accountName: effectiveAccountName, amount, description: `Beban ${expenseNo}` });
    if (ppnAmount > 0) {
      lines.push({ lineType: "debit", accountCode: "2-1201", accountName: "PPN Masukan", amount: ppnAmount, description: `PPN Masukan ${expenseNo}` });
    }
    lines.push({ lineType: "credit", accountCode: "1-1001", accountName: kasSource, amount: totalAmount, description: `Pembayaran ${expenseNo}` });
  } else if (journalType === "liability") {
    lines.push({ lineType: "debit", accountCode: effectiveAccountCode, accountName: effectiveAccountName, amount: totalAmount, description: `Bayar hutang ${expenseNo}` });
    lines.push({ lineType: "credit", accountCode: "1-1001", accountName: kasSource, amount: totalAmount, description: `Pembayaran ${expenseNo}` });
  } else if (journalType === "kasbon") {
    lines.push({ lineType: "debit", accountCode: effectiveAccountCode, accountName: effectiveAccountName, amount: totalAmount, description: `Kasbon diberikan ${expenseNo}` });
    lines.push({ lineType: "credit", accountCode: "1-1001", accountName: kasSource, amount: totalAmount, description: `Kas keluar kasbon ${expenseNo}` });
  }

  await postJournalLines(journal.id, lines);
  return journal.id;
}

// ─── Public Accounting: Expense (Pengeluaran) ────────────────────────────────
// Debit: akun expense COA → Kredit: akun bank berdasarkan payment method
// Ini memastikan Bank Mandiri CST HANYA di sisi kredit untuk pengeluaran,
// tidak pernah muncul sebagai debit.

const EXP_JOURNAL_CODE = "EXP-CST";
let _expJournalId: number | null = null;

async function getExpJournalId(pool: pg.Pool): Promise<number> {
  if (_expJournalId) return _expJournalId;
  const r = await pool.query(
    `SELECT id FROM public.accounting_journals WHERE code = $1 LIMIT 1`,
    [EXP_JOURNAL_CODE],
  );
  _expJournalId = Number(r.rows[0]?.id ?? 0);
  return _expJournalId;
}

async function nextPublicExpEntryNumber(pool: pg.Pool, year: number): Promise<string> {
  const result = await pool.query(
    `SELECT COALESCE(MAX(
      NULLIF(REGEXP_REPLACE(entry_number, '^SC-EXP/[0-9]+/', ''), '')::integer
    ), 0) + 1 AS seq
    FROM public.accounting_entries
    WHERE entry_number LIKE $1`,
    [`SC-EXP/${year}/%`],
  );
  const seq = Number(result.rows[0]?.seq ?? 1);
  return `SC-EXP/${year}/${String(seq).padStart(4, "0")}`;
}

function mapPaymentMethodToBankCoaCode(paymentMethod: string): string {
  const pm = (paymentMethod ?? "").toLowerCase();
  if (pm.includes("bca")) return "1-1021-CST";
  if (pm.includes("bni")) return "1-1022-CST";
  if (pm.includes("kas") || pm.includes("cash") || pm.includes("tunai")) return "1-1010-CST";
  // Default: Bank Mandiri CST (transfer / bank_mandiri / kosong)
  return "1-1020-CST";
}

// Cache lookup COA by code
async function getPublicCoaId(pool: pg.Pool, code: string): Promise<number | null> {
  const r = await pool.query(
    `SELECT id FROM public.chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [code],
  );
  return r.rows[0]?.id ? Number(r.rows[0].id) : null;
}

export async function createPublicExpenseAccountingEntry(
  expenseId: number,
  expenseNo: string,
  description: string,
  expenseCoaCode: string | null | undefined, // kode COA akun expense (sisi DEBIT)
  amount: number,                            // DPP
  ppnAmount: number,                         // PPN Masukan (0 jika tidak ada)
  totalAmount: number,                       // total dibayar
  paymentMethod: string,                     // menentukan akun bank kredit
  journalDate: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip createPublicExpenseAccountingEntry");
    return;
  }

  const correlationId = `sc_expense_${expenseNo}`;

  // Idempotent: skip jika sudah ada
  const exists = await pool.query(
    `SELECT id FROM public.accounting_entries WHERE correlation_id = $1 LIMIT 1`,
    [correlationId],
  );
  if (exists.rows.length > 0) {
    console.info(`[accounting] Expense entry sudah ada untuk ${expenseNo}, skip.`);
    return;
  }

  const bankCoaCode = mapPaymentMethodToBankCoaCode(paymentMethod);
  const fallbackExpenseCode = "5-2040-CST"; // Beban Operasional Lain CST
  const effectiveExpenseCode = expenseCoaCode || fallbackExpenseCode;

  const [expenseAccountId, bankAccountId] = await Promise.all([
    getPublicCoaId(pool, effectiveExpenseCode),
    getPublicCoaId(pool, bankCoaCode),
  ]);

  if (!expenseAccountId) {
    console.warn(`[accounting] COA expense '${effectiveExpenseCode}' tidak ditemukan di public schema, skip.`);
    return;
  }
  if (!bankAccountId) {
    console.warn(`[accounting] COA bank '${bankCoaCode}' tidak ditemukan di public schema, skip.`);
    return;
  }

  const year = new Date(journalDate).getFullYear();
  const [entryNumber, journalId] = await Promise.all([
    nextPublicExpEntryNumber(pool, year),
    getExpJournalId(pool),
  ]);

  if (!journalId) {
    console.warn(`[accounting] Journal '${EXP_JOURNAL_CODE}' tidak ditemukan di public schema, skip.`);
    return;
  }

  // Gunakan transaksi: insert sebagai draft → insert lines → update ke posted
  // Jika lines gagal, entry tetap draft (tidak orphan sebagai posted)
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotent di level DB: jika correlation_id sudah ada, rollback & skip
    const existsInTx = await client.query(
      `SELECT id FROM public.accounting_entries WHERE correlation_id = $1 LIMIT 1 FOR UPDATE`,
      [correlationId],
    );
    if (existsInTx.rows.length > 0) {
      await client.query("ROLLBACK");
      console.info(`[accounting] Expense entry sudah ada untuk ${expenseNo}, skip.`);
      return;
    }

    const entryResult = await client.query(
      `INSERT INTO public.accounting_entries
        (entry_number, journal_id, date, ref, description, status, source, source_id,
         total_debit, total_credit, company_id, correlation_id, governance_flags)
      VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_expense',$6,$7,$7,$8,$9,'{}')
      RETURNING id`,
      [
        entryNumber, journalId, journalDate, expenseNo,
        `Pengeluaran Sport Center: ${description} (${expenseNo})`,
        expenseId, totalAmount, COMPANY_ID, correlationId,
      ],
    );
    const entryId = Number(entryResult.rows[0]?.id);
    if (!entryId) { await client.query("ROLLBACK"); return; }

    if (ppnAmount > 0) {
      const ppnId = await getPublicCoaId(pool, "2-1201-CST").catch(() => null)
        ?? await getPublicCoaId(pool, "1-1201-CST").catch(() => null);

      if (ppnId) {
        await client.query(
          `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
            ($1,$2,$3,$4,0),
            ($1,$5,$6,$7,0),
            ($1,$8,$9,0,$10)`,
          [
            entryId,
            expenseAccountId, `Beban ${expenseNo}`, amount,
            ppnId,            `PPN Masukan ${expenseNo}`, ppnAmount,
            bankAccountId,    `Pembayaran ${expenseNo} via ${paymentMethod}`, totalAmount,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
            ($1,$2,$3,$4,0),
            ($1,$5,$6,0,$4)`,
          [entryId, expenseAccountId, `Beban ${expenseNo}`, totalAmount, bankAccountId, `Pembayaran ${expenseNo} via ${paymentMethod}`],
        );
      }
    } else {
      await client.query(
        `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
          ($1,$2,$3,$4,0),
          ($1,$5,$6,0,$4)`,
        [entryId, expenseAccountId, `Beban ${expenseNo}`, totalAmount, bankAccountId, `Pembayaran ${expenseNo} via ${paymentMethod}`],
      );
    }

    // Semua lines berhasil → ubah ke posted
    await client.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);
    await client.query("COMMIT");

    console.info(`[accounting] ✓ Public expense entry created: ${entryNumber} (${expenseNo}) — DEBIT ${effectiveExpenseCode} / CREDIT ${bankCoaCode}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function reverseJournalEntry(
  bookingId: number,
  orderNumber: string,
  reason: string,
  journalDate: string,
): Promise<void> {
  const [original] = await db
    .select()
    .from(accountingJournalsTable)
    .where(
      and(
        eq(accountingJournalsTable.bookingId, bookingId),
        eq(accountingJournalsTable.isReversal, false),
      ),
    )
    .limit(1);

  if (!original) return;

  const [reversal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId,
      orderNumber,
      journalType: "reversal",
      debitAccount: original.creditRevenueAccount,
      debitAmount: original.debitAmount,
      creditRevenueAccount: original.debitAccount,
      creditRevenueAmount: original.creditRevenueAmount,
      creditPpnAccount: original.creditPpnAccount,
      creditPpnAmount: original.creditPpnAmount,
      journalDate,
      isReversal: true,
      reversalOfId: original.id,
      notes: reason,
    })
    .returning();

  if (!reversal) return;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit",  accountCode: "4-1001", accountName: "Pendapatan Sport Center", amount: Number(original.creditRevenueAmount), description: `Reversal: ${reason}` },
    { lineType: "credit", accountCode: "1-1001", accountName: "Kas/Bank",                amount: Number(original.debitAmount),          description: `Reversal: ${reason}` },
  ];
  if (Number(original.creditPpnAmount) > 0) {
    lines.push({ lineType: "debit", accountCode: "2-1101", accountName: "PPN Keluaran", amount: Number(original.creditPpnAmount), description: `Reversal PPN: ${reason}` });
  }

  await postJournalLines(reversal.id, lines);
}
