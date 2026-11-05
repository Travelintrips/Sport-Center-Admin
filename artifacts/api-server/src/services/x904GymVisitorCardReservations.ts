import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Assignment is a physical-card reservation, NOT an X904 door entitlement.
// Physical handover and X904 activation remain independently verified.
export const GYM_VIS_CARDS = [
  { code: "VIS001", pin: "78", uid: 338 },
  { code: "VIS002", pin: "90", uid: 339 },
  { code: "VIS003", pin: "13", uid: 13 },
  { code: "VIS004", pin: "17", uid: 17 },
  { code: "VIS005", pin: "11", uid: 11 },
  { code: "VIS006", pin: "15", uid: 15 },
] as const;

export class VisReservationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export async function autoReserveVisAfterFundsVerified(input: {
  orderNumber: string;
  officialBankReference: string;
  verifiedBy: string;
  officialFundsChecked: true;
}): Promise<{ cardCode: string; state: string; newReservation: boolean }> {
  const ref = String(input.officialBankReference ?? "").trim().toUpperCase();
  const actor = String(input.verifiedBy ?? "").trim();
  if (input.officialFundsChecked !== true || !/^[A-Z0-9/_-]{6,80}$/.test(ref) ||
      actor.length < 3 || !/^[A-Z0-9-]{4,40}$/i.test(String(input.orderNumber))) {
    throw new VisReservationError(400, "bank_verification_required",
      "Petugas harus mencocokkan mutasi bank resmi dan memasukkan nomor referensi transaksi bank.");
  }
  try {
    return await db.transaction(async tx => {
      // Serialize all VIS1–VIS6 assignments to prevent cross-booking races;
      // the partial unique index is an independent DB guard.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(90400661)`);
      const bookingResult = await tx.execute(sql`SELECT id,booking_date,start_time,customer_name,
           source,status::text AS status,notes,
           COALESCE(grand_total,total_price)::numeric AS amount
        FROM sport_center.sport_bookings
        WHERE order_number=${input.orderNumber} FOR UPDATE`);
      const booking = bookingResult.rows[0] as any | undefined;
      if (!booking) throw new VisReservationError(404, "booking_not_found", "Booking tidak ditemukan.");
      if (booking.source !== "gym_public_guest" || booking.status !== "confirmed") {
        throw new VisReservationError(409, "booking_not_confirmed",
          "Kartu VIS hanya untuk booking Gym mandiri dengan pembayaran terkonfirmasi.");
      }
      if (!String(booking.notes ?? "").includes("Kartu VIS001–VIS006 menunggu pilihan")) {
        throw new VisReservationError(409, "not_a_new_visitor",
          "Booking ini bukan pengunjung baru yang berhak mendapat kartu VIS otomatis.");
      }
      // Recheck the machine inventory. If the name was enrolled in the meantime,
      // fail closed rather than claiming a visitor card.
      const enrolled = await tx.execute(sql`SELECT 1 FROM sport_center.gym_x904_lan_users
        WHERE device_serial='TDBD234200545' AND
          upper(regexp_replace(trim(display_name),'[[:space:]]+',' ','g')) =
          upper(regexp_replace(trim(${String(booking.customer_name)}::text),'[[:space:]]+',' ','g'))
        LIMIT 1`);
      if (enrolled.rows.length) throw new VisReservationError(409, "now_registered",
        "Nama sekarang terdaftar di X904; petugas perlu memeriksa identitas, bukan mengambil kartu VIS.");

      const payResult = await tx.execute(sql`SELECT id,amount,status::text AS status,
          proof_url,confirmed_at
        FROM sport_center.sport_payments
        WHERE booking_id=${Number(booking.id)}
          AND status::text='confirmed'
        ORDER BY confirmed_at DESC LIMIT 2 FOR UPDATE`);
      if (payResult.rows.length !== 1) throw new VisReservationError(409, "payment_ambiguous",
        "Pembayaran belum confirmed atau ada pembayaran ganda yang perlu rekonsiliasi.");
      const payment = payResult.rows[0] as any;
      if (!payment.confirmed_at || !String(payment.proof_url ?? "").trim() ||
          !Number.isFinite(Number(payment.amount)) ||
          Number(payment.amount) < Number(booking.amount)) {
        throw new VisReservationError(409, "payment_unverified",
          "Status, jumlah, atau bukti pembayaran belum memenuhi ketentuan.");
      }
      const prior = await tx.execute(sql`SELECT card_code,state,funds_reference
        FROM sport_center.gym_vis_card_reservations
        WHERE booking_id=${Number(booking.id)} FOR UPDATE`);
      if (prior.rows.length) {
        const row = prior.rows[0] as any;
        if (String(row.funds_reference) !== ref) throw new VisReservationError(409,"reference_mismatch",
          "Booking sudah mempunyai kartu VIS dengan referensi bank lain. Perlu audit.");
        return { cardCode: String(row.card_code), state: String(row.state), newReservation: false };
      }
      const reused = await tx.execute(sql`SELECT 1 FROM sport_center.gym_vis_card_reservations
        WHERE funds_reference=${ref} LIMIT 1`);
      if (reused.rows.length) throw new VisReservationError(409,"bank_reference_reused",
        "Referensi bank sudah dipakai oleh booking lain.");
      // Only known machine cards with correct UID/role/name can be picked.
      // A card still assigned, already on another payment/door entitlement,
      // or owned by a member/privileged user is not available.
      const candidate = await tx.execute(sql`WITH cards(code,pin,uid) AS (
          VALUES ('VIS001','78',338),('VIS002','90',339),('VIS003','13',13),
                 ('VIS004','17',17),('VIS005','11',11),('VIS006','15',15)
        )
        SELECT c.code,c.pin,c.uid
        FROM cards c
        JOIN sport_center.gym_x904_lan_users u
          ON u.device_serial='TDBD234200545' AND u.user_pin=c.pin
         AND u.device_uid=c.uid AND u.device_role=0
         AND regexp_replace(upper(u.display_name),'[[:space:]]+','','g')=c.code
        WHERE NOT EXISTS (
          SELECT 1 FROM sport_center.gym_vis_card_reservations r
          WHERE r.device_serial='TDBD234200545' AND r.card_code=c.code
            AND r.state IN ('reserved','collected')
        )
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.gym_x904_member_mapping m
          WHERE m.device_serial='TDBD234200545' AND m.user_pin=c.pin
        )
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.x904_nonmember_daily_access a
          WHERE a.device_serial='TDBD234200545' AND a.user_pin=c.pin
            AND a.access_state IN ('pending','active','review_required')
        )
        ORDER BY c.code LIMIT 1`);
      if (!candidate.rows.length) throw new VisReservationError(409,"vis_pool_exhausted",
        "Seluruh kartu VIS sedang dipakai atau membutuhkan pemeriksaan petugas. Booking tetap tersimpan tanpa kartu.");
      const card = candidate.rows[0] as any;
      await tx.execute(sql`INSERT INTO sport_center.gym_vis_card_reservations
        (booking_id,payment_id,card_code,user_pin,device_uid,funds_reference,funds_verified_by)
        VALUES (${Number(booking.id)},${Number(payment.id)},${String(card.code)},
          ${String(card.pin)},${Number(card.uid)},${ref},${actor})`);
      return { cardCode: String(card.code), state: "reserved", newReservation: true };
    });
  } catch (error) {
    if (error instanceof VisReservationError) throw error;
    // Fail closed (including missing migration or unique constraint conflicts).
    console.error("[gym-vis] auto reservation failed", error);
    throw new VisReservationError(503,"vis_reservation_failed",
      "Kartu belum berhasil dialokasikan. Tidak ada akses pintu yang diaktifkan.");
  }
}
