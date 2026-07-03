import pg from "pg";
import type { Booking, GymMembership, CompanyInvoice } from "@workspace/db";

const { Pool } = pg;

const PROD_URL =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

let _prodPool: pg.Pool | null = null;
function getProdPool(): pg.Pool | null {
  if (!PROD_URL) return null;
  if (!_prodPool) {
    _prodPool = new Pool({
      connectionString: PROD_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      options: "-c search_path=sport_center,public",
    });
  }
  return _prodPool;
}

export const bizportalSyncConfigured = Boolean(PROD_URL);

export async function initBizportalTables(): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sport_center.sport_bookings_sync (
        id                SERIAL PRIMARY KEY,
        booking_code      TEXT UNIQUE NOT NULL,
        facility_id       TEXT,
        facility_name     TEXT,
        customer_name     TEXT,
        customer_phone    TEXT,
        customer_email    TEXT,
        date              TEXT,
        start_time        TEXT,
        end_time          TEXT,
        total_hours       NUMERIC,
        total_price       BIGINT,
        notes             TEXT,
        status            TEXT DEFAULT 'pending_payment',
        payment_status    TEXT DEFAULT 'unpaid',
        payment_proof_url TEXT,
        payment_proof_at  TIMESTAMPTZ,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE sport_center.sport_bookings_sync
        ADD COLUMN IF NOT EXISTS ppn_rate      NUMERIC(5,2),
        ADD COLUMN IF NOT EXISTS dpp           BIGINT,
        ADD COLUMN IF NOT EXISTS dpp_nilai_lain BIGINT,
        ADD COLUMN IF NOT EXISTS ppn_amount    BIGINT,
        ADD COLUMN IF NOT EXISTS grand_total   BIGINT;
      CREATE TABLE IF NOT EXISTS sport_center.sport_memberships_sync (
        id                SERIAL PRIMARY KEY,
        name              TEXT,
        email             TEXT,
        phone             TEXT,
        start_date        TEXT,
        end_date          TEXT,
        months            INTEGER,
        total_price       BIGINT,
        status            TEXT DEFAULT 'active',
        notes             TEXT,
        payment_method    TEXT,
        payment_proof_url TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.info("[bizportalSync] ✓ BizPortal tables ensured (schema: sport_center)");
  } catch (err: any) {
    console.warn(`[bizportalSync] ⚠ Could not ensure BizPortal tables: ${err?.message}`);
  }
}

// In-memory last sync tracking for diagnostic endpoint
export const lastSyncState = {
  booking:    { at: null as string | null, success: null as boolean | null, error: null as string | null },
  membership: { at: null as string | null, success: null as boolean | null, error: null as string | null },
  status:     { at: null as string | null, success: null as boolean | null, error: null as string | null },
};

async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 2): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        console.warn(`[bizportalSync] Retry ${attempt + 1}/${retries} for ${label}: ${err?.message}`);
      }
    }
  }
  throw lastErr;
}

function toStatus(scStatus: string): string {
  switch (scStatus) {
    case "confirmed":  return "confirmed";
    case "completed":  return "completed";
    case "cancelled":
    case "rejected":
    case "expired":
    case "refunded":   return "cancelled";
    default:           return "pending_payment";
  }
}

function toPaymentStatus(scStatus: string): string {
  switch (scStatus) {
    case "paid":
    case "confirmed":
    case "completed":         return "paid";
    case "waiting_confirmation": return "pending";
    default:                  return "unpaid";
  }
}

export interface SyncBookingPayload {
  booking: Booking;
  facilityName: string;
  facilityCategory?: string | null;
  paymentProofUrl?: string | null;
  paidAt?: Date | null;
}


function calcTaxBreakdown(booking: Booking): {
  ppnRate: number | null;
  dpp: number | null;
  dppNilaiLain: number | null;
  ppnAmount: number | null;
  grandTotal: number | null;
} {
  const rate = booking.ppnRate != null ? Number(booking.ppnRate) : null;
  const storedPpn = booking.ppnAmount != null ? Math.round(Number(booking.ppnAmount)) : null;
  const storedGrand = booking.grandTotal != null ? Math.round(Number(booking.grandTotal)) : null;

  if (rate === null || rate === 0 || storedPpn === null || storedGrand === null) {
    return { ppnRate: null, dpp: null, dppNilaiLain: null, ppnAmount: null, grandTotal: null };
  }

  const dpp = storedGrand - storedPpn;
  const dppNilaiLain = Math.round(dpp * 11 / 12);
  return { ppnRate: rate, dpp, dppNilaiLain, ppnAmount: storedPpn, grandTotal: storedGrand };
}

export async function syncBookingToBizportal(payload: SyncBookingPayload): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const { booking, facilityName, facilityCategory, paymentProofUrl, paidAt } = payload;
  const bizFacilityId = `sc-${booking.facilityId}`;
  const status        = toStatus(booking.status);
  const paymentStatus = toPaymentStatus(booking.status);
  const tax           = calcTaxBreakdown(booking);

  try {
    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.sport_bookings_sync
          (booking_code, facility_id, facility_name, customer_name, customer_phone, customer_email,
           date, start_time, end_time, total_hours, total_price, notes, status,
           payment_status, payment_proof_url, payment_proof_at,
           ppn_rate, dpp, dpp_nilai_lain, ppn_amount, grand_total,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
         ON CONFLICT (booking_code) DO UPDATE SET
           status            = EXCLUDED.status,
           payment_status    = EXCLUDED.payment_status,
           payment_proof_url = COALESCE(EXCLUDED.payment_proof_url, sport_bookings_sync.payment_proof_url),
           payment_proof_at  = COALESCE(EXCLUDED.payment_proof_at,  sport_bookings_sync.payment_proof_at),
           ppn_rate          = COALESCE(EXCLUDED.ppn_rate,          sport_bookings_sync.ppn_rate),
           dpp               = COALESCE(EXCLUDED.dpp,               sport_bookings_sync.dpp),
           dpp_nilai_lain    = COALESCE(EXCLUDED.dpp_nilai_lain,    sport_bookings_sync.dpp_nilai_lain),
           ppn_amount        = COALESCE(EXCLUDED.ppn_amount,        sport_bookings_sync.ppn_amount),
           grand_total       = COALESCE(EXCLUDED.grand_total,       sport_bookings_sync.grand_total),
           updated_at        = NOW()`,
        [
          booking.orderNumber,
          bizFacilityId,
          facilityName,
          booking.customerName,
          booking.customerPhone,
          booking.customerEmail,
          booking.bookingDate,
          booking.startTime,
          booking.endTime,
          booking.durationHours,
          Math.round(Number(booking.totalPrice)),
          booking.notes || null,
          status,
          paymentStatus,
          paymentProofUrl || null,
          paidAt || null,
          tax.ppnRate,
          tax.dpp,
          tax.dppNilaiLain,
          tax.ppnAmount,
          tax.grandTotal,
          booking.createdAt,
        ]
      );
    }, `syncBooking:${booking.orderNumber}`);

    lastSyncState.booking = { at: new Date().toISOString(), success: true, error: null };
    console.info(`[bizportalSync] ✓ Booking synced: ${booking.orderNumber} → ${status}`);
  } catch (err: any) {
    lastSyncState.booking = { at: new Date().toISOString(), success: false, error: err?.message };
    console.error(`[bizportalSync] ✗ Booking sync failed: ${booking.orderNumber} — ${err?.message}`);
  }
}

export async function syncMembershipToBizportal(membership: GymMembership): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  try {
    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.sport_memberships_sync
          (id, name, email, phone, start_date, end_date, months, total_price,
           status, notes, payment_method, payment_proof_url, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
           name              = EXCLUDED.name,
           email             = EXCLUDED.email,
           phone             = EXCLUDED.phone,
           start_date        = EXCLUDED.start_date,
           end_date          = EXCLUDED.end_date,
           months            = EXCLUDED.months,
           total_price       = EXCLUDED.total_price,
           status            = EXCLUDED.status,
           notes             = EXCLUDED.notes,
           payment_method    = COALESCE(EXCLUDED.payment_method,    sport_memberships_sync.payment_method),
           payment_proof_url = COALESCE(EXCLUDED.payment_proof_url, sport_memberships_sync.payment_proof_url),
           updated_at        = EXCLUDED.updated_at`,
        [
          membership.id,
          membership.name,
          membership.email,
          membership.phone,
          membership.startDate,
          membership.endDate,
          membership.months,
          Math.round(Number(membership.totalPrice)),
          membership.status,
          membership.notes || null,
          membership.paymentMethod || null,
          membership.paymentProofUrl || null,
          membership.createdAt,
          membership.updatedAt,
        ]
      );
    }, `syncMembership:${membership.id}`);

    lastSyncState.membership = { at: new Date().toISOString(), success: true, error: null };
    console.info(`[bizportalSync] ✓ Membership synced: ID=${membership.id} → ${membership.status}`);
  } catch (err: any) {
    lastSyncState.membership = { at: new Date().toISOString(), success: false, error: err?.message };
    console.error(`[bizportalSync] ✗ Membership sync failed: ID=${membership.id} — ${err?.message}`);
  }
}

export async function deleteBookingFromBizportal(orderNumber: string): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  try {
    await withRetry(async () => {
      await pool.query(
        `DELETE FROM sport_center.sport_bookings_sync WHERE booking_code = $1`,
        [orderNumber]
      );
    }, `deleteBooking:${orderNumber}`);

    console.info(`[bizportalSync] ✓ Booking deleted from BizPortal: ${orderNumber}`);
  } catch (err: any) {
    console.error(`[bizportalSync] ✗ Booking delete failed: ${orderNumber} — ${err?.message}`);
  }
}

// ── Bank Mutation Push ──────────────────────────────────────────────────────
// Saat booking payment dikonfirmasi, otomatis buat entry bank_mutations
// dengan bankAccountId = nomor rekening dari settings (Mandiri CST).
// Idempotent: mutationKey 'SC-{orderNumber}' dicek sebelum insert.
export async function pushConfirmedPaymentAsBankMutation(
  booking: Booking,
  confirmedAt?: Date | null,
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const amount =
    booking.grandTotal != null && Number(booking.grandTotal) > 0
      ? Math.round(Number(booking.grandTotal))
      : Math.round(Number(booking.totalPrice));
  if (amount <= 0) return;

  const mutationKey = `SC-${booking.orderNumber}`;
  const transactionDate = confirmedAt
    ? confirmedAt.toISOString().split("T")[0]!
    : new Date().toISOString().split("T")[0]!;
  const description = `SPORT CENTER | ${booking.orderNumber} | ${booking.customerName}`;
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  try {
    // Ambil bankAccountId (nomor rekening Mandiri CST) dari settings
    let bankAccountId: string | null = null;
    try {
      const { rows } = await pool.query(
        `SELECT bank_account FROM sport_center.settings LIMIT 1`,
      );
      if (rows[0]?.bank_account) bankAccountId = String(rows[0].bank_account);
    } catch {
      // non-fatal — lanjut tanpa bankAccountId
    }

    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.bank_mutations
           (bank_account_id, transaction_date, description, credit_amount, debit_amount,
            amount, direction, mutation_key, normalized_description, provider_order_id,
            status, matched_order_id, created_at, updated_at)
         SELECT $1,$2,$3,$4,'0',$4,'IN',$5,$6,$7,'auto_matched',$8,NOW(),NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM sport_center.bank_mutations WHERE mutation_key = $5
         )`,
        [
          bankAccountId,
          transactionDate,
          description,
          String(amount),
          mutationKey,
          normalizedDescription,
          booking.orderNumber,
          booking.id,
        ],
      );
    }, `pushBankMutation:${booking.orderNumber}`);

    console.info(`[bizportalSync] ✓ Bank mutation created: ${booking.orderNumber} → Rp ${amount.toLocaleString("id-ID")}`);
  } catch (err: any) {
    console.error(`[bizportalSync] ✗ Bank mutation push failed: ${booking.orderNumber} — ${err?.message}`);
  }
}

async function getBankAccountId(pool: pg.Pool): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT bank_account FROM sport_center.settings LIMIT 1`,
    );
    return rows[0]?.bank_account ? String(rows[0].bank_account) : null;
  } catch {
    return null;
  }
}

// ── Membership Bank Mutation Push ───────────────────────────────────────────
// Saat membership gym berstatus "active" (lunas), otomatis buat entry
// bank_mutations dengan bankAccountId = nomor rekening dari settings (Mandiri CST).
// Idempotent: mutationKey 'SC-MB-{id}' dicek sebelum insert.
export async function pushMembershipPaymentAsBankMutation(
  membership: GymMembership,
  confirmedAt?: Date | null,
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const amount = Math.round(Number(membership.totalPrice));
  if (amount <= 0) return;

  const mutationKey = `SC-MB-${membership.id}`;
  const transactionDate = confirmedAt
    ? confirmedAt.toISOString().split("T")[0]!
    : new Date().toISOString().split("T")[0]!;
  const description = `SPORT CENTER MEMBER GYM | MB-${membership.id} | ${membership.name}`;
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  try {
    const bankAccountId = await getBankAccountId(pool);

    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.bank_mutations
           (bank_account_id, transaction_date, description, credit_amount, debit_amount,
            amount, direction, mutation_key, normalized_description, provider_order_id,
            status, matched_order_id, created_at, updated_at)
         SELECT $1,$2,$3,$4,'0',$4,'IN',$5,$6,$7,'auto_matched',$8,NOW(),NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM sport_center.bank_mutations WHERE mutation_key = $5
         )`,
        [
          bankAccountId,
          transactionDate,
          description,
          String(amount),
          mutationKey,
          normalizedDescription,
          mutationKey,
          null,
        ],
      );
    }, `pushMembershipMutation:${membership.id}`);

    console.info(`[bizportalSync] ✓ Bank mutation created (membership): MB-${membership.id} → Rp ${amount.toLocaleString("id-ID")}`);
  } catch (err: any) {
    console.error(`[bizportalSync] ✗ Bank mutation push failed (membership): MB-${membership.id} — ${err?.message}`);
  }
}

// ── Company Invoice Bank Mutation Push ──────────────────────────────────────
// Saat invoice perusahaan ditandai "paid" (lunas), otomatis buat entry
// bank_mutations dengan bankAccountId = nomor rekening dari settings (Mandiri CST).
// Idempotent: mutationKey 'SC-INV-{invoiceNumber}' dicek sebelum insert.
export async function pushInvoicePaymentAsBankMutation(
  invoice: CompanyInvoice,
  companyName?: string | null,
  confirmedAt?: Date | null,
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const amount =
    invoice.grandTotal != null && Number(invoice.grandTotal) > 0
      ? Math.round(Number(invoice.grandTotal))
      : Math.round(Number(invoice.totalAmount));
  if (amount <= 0) return;

  const mutationKey = `SC-INV-${invoice.invoiceNumber}`;
  const transactionDate = confirmedAt
    ? confirmedAt.toISOString().split("T")[0]!
    : new Date().toISOString().split("T")[0]!;
  const description = `SPORT CENTER INVOICE PERUSAHAAN | ${invoice.invoiceNumber} | ${companyName || ""}`.trim();
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  try {
    const bankAccountId = await getBankAccountId(pool);

    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.bank_mutations
           (bank_account_id, transaction_date, description, credit_amount, debit_amount,
            amount, direction, mutation_key, normalized_description, provider_order_id,
            status, matched_order_id, created_at, updated_at)
         SELECT $1,$2,$3,$4,'0',$4,'IN',$5,$6,$7,'auto_matched',$8,NOW(),NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM sport_center.bank_mutations WHERE mutation_key = $5
         )`,
        [
          bankAccountId,
          transactionDate,
          description,
          String(amount),
          mutationKey,
          normalizedDescription,
          mutationKey,
          null,
        ],
      );
    }, `pushInvoiceMutation:${invoice.invoiceNumber}`);

    console.info(`[bizportalSync] ✓ Bank mutation created (invoice): ${invoice.invoiceNumber} → Rp ${amount.toLocaleString("id-ID")}`);
  } catch (err: any) {
    console.error(`[bizportalSync] ✗ Bank mutation push failed (invoice): ${invoice.invoiceNumber} — ${err?.message}`);
  }
}

export async function syncStatusToBizportal(
  orderNumber: string,
  scStatus: string,
  paymentProofUrl?: string | null,
  paidAt?: Date | null,
  booking?: Booking
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const tax = booking ? calcTaxBreakdown(booking) : null;

  try {
    await withRetry(async () => {
      await pool.query(
        `UPDATE sport_center.sport_bookings_sync
         SET status            = $2,
             payment_status    = $3,
             payment_proof_url = COALESCE($4, payment_proof_url),
             payment_proof_at  = COALESCE($5, payment_proof_at),
             ppn_rate          = COALESCE($6, ppn_rate),
             dpp               = COALESCE($7, dpp),
             dpp_nilai_lain    = COALESCE($8, dpp_nilai_lain),
             ppn_amount        = COALESCE($9, ppn_amount),
             grand_total       = COALESCE($10, grand_total),
             updated_at        = NOW()
         WHERE booking_code    = $1`,
        [
          orderNumber,
          toStatus(scStatus),
          toPaymentStatus(scStatus),
          paymentProofUrl || null,
          paidAt || null,
          tax?.ppnRate ?? null,
          tax?.dpp ?? null,
          tax?.dppNilaiLain ?? null,
          tax?.ppnAmount ?? null,
          tax?.grandTotal ?? null,
        ]
      );
    }, `syncStatus:${orderNumber}`);

    lastSyncState.status = { at: new Date().toISOString(), success: true, error: null };
    console.info(`[bizportalSync] ✓ Status synced: ${orderNumber} → ${toStatus(scStatus)}`);
  } catch (err: any) {
    lastSyncState.status = { at: new Date().toISOString(), success: false, error: err?.message };
    console.error(`[bizportalSync] ✗ Status sync failed: ${orderNumber} — ${err?.message}`);
  }
}
