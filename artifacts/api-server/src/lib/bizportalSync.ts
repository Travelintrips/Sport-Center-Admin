import pg from "pg";
import type { Booking, GymMembership } from "@workspace/db";

const { Pool } = pg;

const PROD_URL = process.env.SUPABASE_DATABASE_URL;

let _prodPool: pg.Pool | null = null;
function getProdPool(): pg.Pool | null {
  if (!PROD_URL) return null;
  if (!_prodPool) {
    _prodPool = new Pool({
      connectionString: PROD_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return _prodPool;
}

function toStatus(scStatus: string): string {
  switch (scStatus) {
    case "confirmed": return "confirmed";
    case "completed": return "completed";
    case "cancelled":
    case "rejected":
    case "expired":
    case "refunded": return "cancelled";
    default: return "pending_payment";
  }
}

function toPaymentStatus(scStatus: string): string {
  switch (scStatus) {
    case "paid":
    case "confirmed":
    case "completed": return "paid";
    case "waiting_confirmation": return "pending";
    default: return "unpaid";
  }
}

function toFacilityId(facilityName: string, facilityId: number): string {
  return `sc-${facilityId}`;
}

export interface SyncBookingPayload {
  booking: Booking;
  facilityName: string;
  paymentProofUrl?: string | null;
  paidAt?: Date | null;
}

export async function syncBookingToBizportal(payload: SyncBookingPayload): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const { booking, facilityName, paymentProofUrl, paidAt } = payload;

  const bizFacilityId = toFacilityId(facilityName, booking.facilityId);
  const status = toStatus(booking.status);
  const paymentStatus = toPaymentStatus(booking.status);

  try {
    // Upsert berdasarkan booking_code = orderNumber Sport Center
    await pool.query(
      `INSERT INTO public.sport_center_bookings
        (booking_code, facility_id, facility_name, customer_name, customer_phone, customer_email,
         date, start_time, end_time, total_hours, total_price, notes, status,
         payment_status, payment_proof_url, payment_proof_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
       ON CONFLICT (booking_code) DO UPDATE SET
         status               = EXCLUDED.status,
         payment_status       = EXCLUDED.payment_status,
         payment_proof_url    = COALESCE(EXCLUDED.payment_proof_url, sport_center_bookings.payment_proof_url),
         payment_proof_at     = COALESCE(EXCLUDED.payment_proof_at, sport_center_bookings.payment_proof_at),
         updated_at           = NOW()`,
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
        booking.createdAt,
      ]
    );
  } catch (err: any) {
    // Jangan sampai gagal sync menghentikan operasi utama
    console.error("[bizportalSync] Sync error:", err?.message);
  }
}

export async function syncMembershipToBizportal(membership: GymMembership): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO public.sport_center_memberships
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
         payment_method    = COALESCE(EXCLUDED.payment_method, sport_center_memberships.payment_method),
         payment_proof_url = COALESCE(EXCLUDED.payment_proof_url, sport_center_memberships.payment_proof_url),
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
  } catch (err: any) {
    console.error("[bizportalSync] Membership sync error:", err?.message);
  }
}

export async function syncStatusToBizportal(
  orderNumber: string,
  scStatus: string,
  paymentProofUrl?: string | null,
  paidAt?: Date | null
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  try {
    await pool.query(
      `UPDATE public.sport_center_bookings
       SET status            = $2,
           payment_status    = $3,
           payment_proof_url = COALESCE($4, payment_proof_url),
           payment_proof_at  = COALESCE($5, payment_proof_at),
           updated_at        = NOW()
       WHERE booking_code    = $1`,
      [
        orderNumber,
        toStatus(scStatus),
        toPaymentStatus(scStatus),
        paymentProofUrl || null,
        paidAt || null,
      ]
    );
  } catch (err: any) {
    console.error("[bizportalSync] Status sync error:", err?.message);
  }
}
