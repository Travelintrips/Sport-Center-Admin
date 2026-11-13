import { db } from "@workspace/db";
import { logAudit } from "../lib/auditLog";
import { sql } from "drizzle-orm";
import { notifyGymVisitorCardReserved } from "../lib/notifications";
import { getBaseUrl } from "../lib/appUrl";

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
  officialFundsChecked: boolean;
  confirmedPaymentId?: number;
  // Only an authenticated staff route may opt in existing paid web Gym bookings.
  allowWebBooking?: boolean;
}): Promise<{ cardCode: string; state: string; newReservation: boolean }> {
  const ref = String(input.officialBankReference ?? "").trim().toUpperCase();
  const actor = String(input.verifiedBy ?? "").trim();
  if (input.officialFundsChecked !== true || !/^[A-Z0-9/_-]{6,80}$/.test(ref) ||
      actor.length < 3 || !/^[A-Z0-9-]{4,40}$/i.test(String(input.orderNumber))) {
    throw new VisReservationError(400, "bank_verification_required",
      "Admin wajib memeriksa penerimaan dana di kanal resmi Mandiri/Yokke atau rekening bank dan mencatat referensi transaksi yang unik.");
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
      const existingWebGuest = input.allowWebBooking === true && booking.source === "web";
      if (!["gym_public_guest", ...(existingWebGuest ? ["web"] : [])].includes(String(booking.source)) ||
          booking.status !== "confirmed") {
        throw new VisReservationError(409, "booking_not_confirmed",
          "Kartu VIS hanya untuk booking Gym yang sudah dikonfirmasi dan melalui jalur terotorisasi.");
      }
      if (existingWebGuest) {
        const todayWib = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
        const hourWib = Number(new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23",
        }).format(new Date()));
        if (String(booking.booking_date) !== todayWib || hourWib < 6 || hourWib >= 23) {
          throw new VisReservationError(409, "booking_day_closed",
            "Booking web hanya dapat menerima VIS pada tanggal kunjungan, pukul 06.00–23.00 WIB.");
        }
      }
      if (!existingWebGuest && !String(booking.notes ?? "").includes("Kartu VIS001–VIS006 menunggu pilihan")) {
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
          proof_url,confirmed_at,reference_number,provider_reference,provider_trade_no,merchant_trade_no
        FROM sport_center.sport_payments
        WHERE booking_id=${Number(booking.id)}
          AND status::text='confirmed'
        ORDER BY confirmed_at DESC LIMIT 2 FOR UPDATE`);
      if (payResult.rows.length !== 1) throw new VisReservationError(409, "payment_ambiguous",
        "Pembayaran belum confirmed atau ada pembayaran ganda yang perlu rekonsiliasi.");
      const payment = payResult.rows[0] as any;
      if (input.confirmedPaymentId !== undefined &&
          Number(payment.id) !== Number(input.confirmedPaymentId)) {
        throw new VisReservationError(409, "payment_confirmation_changed",
          "Pembayaran yang dikonfirmasi admin tidak sama dengan pembayaran booking saat alokasi VIS.");
      }
      // Internal idempotency key for manual confirmation (NOT a bank receipt).
      // It is accepted only when the confirming endpoint passes this payment id.
      const internalManualReference = input.confirmedPaymentId !== undefined &&
        ref === `ADMINPAY-${Number(payment.id)}`;
      if (ref.startsWith("ADMINPAY-") && !internalManualReference) {
        throw new VisReservationError(400, "internal_reference_forbidden",
          "Referensi internal hanya dapat dibuat oleh konfirmasi pembayaran admin.");
      }
      if (!payment.confirmed_at || !String(payment.proof_url ?? "").trim() ||
          !Number.isFinite(Number(payment.amount)) ||
          Number(payment.amount) < Number(booking.amount)) {
        throw new VisReservationError(409, "payment_unverified",
          "Status, jumlah, atau bukti pembayaran belum memenuhi ketentuan.");
      }
      // A provider-confirmed payment may already carry a canonical transaction
      // reference. A manually entered reference must never contradict that evidence.
      // Bank transfers without a stored reference still require the staff attestation.
      // For static Mandiri QRIS, provider_reference / merchant_trade_no may
      // be merchant-generated order identifiers, NOT the bank receipt.
      // Compare only explicit bank reference or provider transaction receipt.
      // The admin enters the official bank statement reference separately.
      const recordedReferences = [
        payment.reference_number, payment.provider_trade_no,
      ].map((value: unknown) => String(value ?? "").trim().toUpperCase()).filter(Boolean);
      if (!internalManualReference && recordedReferences.length > 0 && !recordedReferences.includes(ref)) {
        throw new VisReservationError(409, "bank_reference_mismatch",
          "Referensi resmi tidak cocok dengan referensi pembayaran yang tercatat. Perlu rekonsiliasi.");
      }
      // Manual Mandiri/Yokke QRIS or bank transfer workflow:
      // payment and booking must already be confirmed by staff, then a
      // logged-in admin re-attests that funds reached the official account.
      // A screenshot alone, matching amount, or unmatched Gmail notification
      // cannot set those statuses or reserve a card.
      // The provider/API feed is optional for manual confirmation, not a
      // prerequisite for physical card reservation.
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
      // Do not reuse a reference already bound to a confirmed payment for
      // another booking, even if that payment has not yet been confirmed.
      const otherPayment = await tx.execute(sql`SELECT 1 FROM sport_center.sport_payments
        WHERE booking_id<>${Number(booking.id)}
          AND (upper(btrim(coalesce(reference_number,'')))=${ref}
            OR upper(btrim(coalesce(provider_reference,'')))=${ref}
            OR upper(btrim(coalesce(provider_trade_no,'')))=${ref}
            OR upper(btrim(coalesce(merchant_trade_no,'')))=${ref})
        LIMIT 1`);
      if (otherPayment.rows.length) throw new VisReservationError(409,"bank_reference_other_booking",
        "Referensi bank sudah digunakan dalam pembayaran booking lain.");
      // Only known machine cards with correct UID/role/name can be picked.
      // A card still assigned, already on another payment/door entitlement,
      // or owned by a member/privileged user is not available.
      const candidate = await tx.execute(sql`WITH cards(code,pin,uid) AS (
          VALUES ('VIS001','78',338),('VIS002','90',339),('VIS003','13',13),
                 ('VIS004','17',17),('VIS005','11',11),('VIS006','15',15)
        )
        SELECT c.code,c.pin,c.uid,u.display_name AS machine_name
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
          SELECT 1
          FROM sport_center.x904_nonmember_daily_access a
          LEFT JOIN sport_center.sport_bookings prior ON prior.id=a.booking_id
          WHERE a.device_serial='TDBD234200545' AND a.user_pin=c.pin
            AND (
              a.access_state IN ('pending','active')
              OR (a.access_state='review_required' AND (
                a.expires_at IS NULL OR a.expires_at>now()
                OR (prior.booking_date::date >= (now() AT TIME ZONE 'Asia/Jakarta')::date
                    AND prior.status::text NOT IN ('cancelled','expired','rejected','refunded','completed'))
              ))
            )
        )
        AND EXISTS (
          SELECT 1 FROM (
            SELECT observed_at,user_count,users
            FROM sport_center.gym_x904_access_snapshots
            WHERE device_serial='TDBD234200545'
            ORDER BY snapshot_id DESC LIMIT 1
          ) snap
          WHERE snap.observed_at>=now()-interval '5 minutes'
            AND jsonb_typeof(snap.users)='array'
            AND jsonb_array_length(snap.users)=snap.user_count
            AND (SELECT count(*) FROM jsonb_array_elements(snap.users) su
                 WHERE su->>'pin'=c.pin
                   AND regexp_replace(upper(coalesce(su->>'name','')),'[[:space:]]+','','g')=c.code
                   AND su->>'group'='2' AND su->>'role'='0' AND su->>'enabled'='true')=1
        )
        ORDER BY c.code LIMIT 1`);
      if (!candidate.rows.length) throw new VisReservationError(409,"vis_pool_exhausted",
        "Seluruh kartu VIS sedang dipakai atau membutuhkan pemeriksaan petugas. Booking tetap tersimpan tanpa kartu.");
      const card = candidate.rows[0] as any;
      // The candidate query has just proven this physical card is Group 2 in a
      // fresh device snapshot. Close only old, expired review residues for the
      // same PIN so they cannot block this new grant or the later card return.
      await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access a
        SET access_state='expired'
        FROM sport_center.sport_bookings prior
        WHERE prior.id=a.booking_id
          AND a.device_serial='TDBD234200545' AND a.user_pin=${String(card.pin)}
          AND a.access_state='review_required'
          AND a.expires_at IS NOT NULL AND a.expires_at<=now()
          AND (prior.booking_date::date < (now() AT TIME ZONE 'Asia/Jakarta')::date
            OR prior.status::text IN ('completed','cancelled','expired','rejected','refunded'))`);
      await tx.execute(sql`INSERT INTO sport_center.gym_vis_card_reservations
        (booking_id,payment_id,card_code,user_pin,device_uid,funds_reference,funds_verified_by)
        VALUES (${Number(booking.id)},${Number(payment.id)},${String(card.code)},
          ${String(card.pin)},${Number(card.uid)},${ref},${actor})`);
      // Create the paid grant in the SAME transaction, but do not authorize a
      // machine command until a physical card handover is witnessed.
      // Confirmed paid VIS grant is independently eligible for the existing
      // worker's access authorization; reservation != physical handover.
      // A physical handover is still recorded separately (never fabricated).
      // expires_at holds the booking-day 23:00 WIB hard closing time; the
      // worker starts the 12-hour clock from its authenticated ACTIVATE ACK.
      const grant = await tx.execute(sql`INSERT INTO sport_center.x904_nonmember_daily_access
        (device_serial,identity_type,identity_label,user_pin,device_uid,verified_name,
         visitor_name,booking_id,payment_id,confirmed_at,expires_at,verification_state,access_state)
        VALUES ('TDBD234200545','card',${String(card.code)},${String(card.pin)},
          ${Number(card.uid)},${String(card.machine_name)},
          ${String(booking.customer_name)},${Number(booking.id)},${Number(payment.id)},
          ${payment.confirmed_at},
          ((${String(booking.booking_date)}::date + time '23:00') AT TIME ZONE 'Asia/Jakarta'),
          'pending','pending')
        RETURNING access_id`);
      if (grant.rows.length !== 1) throw new VisReservationError(409,"vis_grant_not_created",
        "Hak akses VIS belum berhasil disiapkan. Reservasi kartu dibatalkan.");
      // Keep the existing production RLS INSERT invariant: a newly created
      // paid VIS grant starts pending. Authorize it within the SAME transaction
      // using the already existing RLS-allowed UPDATE path after proof and
      // device inventory have been checked above. No second admin click.
      const approved = await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
        SET verification_state='verified'
        WHERE access_id=${Number(grant.rows[0].access_id)}
          AND device_serial='TDBD234200545'
          AND identity_type='card'
          AND identity_label=${String(card.code)}
          AND user_pin=${String(card.pin)}
          AND device_uid=${Number(card.uid)}
          AND booking_id=${Number(booking.id)}
          AND payment_id=${Number(payment.id)}
          AND verification_state='pending' AND access_state='pending'
          AND activated_at IS NULL
        RETURNING access_id`);
      if (approved.rows.length !== 1) throw new VisReservationError(409, "vis_grant_not_authorized",
        "Grant VIS belum diotorisasi; reservasi dibatalkan tanpa perintah ke mesin.");
      return { cardCode: String(card.code), state: "reserved", newReservation: true };
    });
  } catch (error) {
    if (error instanceof VisReservationError) throw error;
    // Fail closed, but persist an admin-only diagnostic after transaction rollback.
    const err = error as any;
    console.error("[gym-vis] auto reservation failed", error);
    await logAudit({
      action: "GYM_VIS_RESERVATION_ERROR",
      entity: "booking",
      after: {
        orderNumber: input.orderNumber,
        confirmedPaymentId: input.confirmedPaymentId ?? null,
        code: String(err?.code ?? "unknown"),
        constraint: String(err?.constraint ?? ""),
        message: String(err?.message ?? error).slice(0, 500),
      },
    });
    throw new VisReservationError(503,"vis_reservation_failed",
      "Kartu belum berhasil dialokasikan. Tidak ada akses pintu yang diaktifkan.");
  }
}


/**
 * Retry an already-confirmed public Gym booking if a transient failure left
 * payment committed but no VIS reservation. No financial or device writes.
 */
export async function recoverUnallocatedPaidGymVis(now = new Date()): Promise<number> {
  if (process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_MANUAL_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_USER_WRITE_ENABLED !== "true") return 0;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23",
  }).format(now));
  if (hour < 6 || hour >= 23) return 0;
  const pending = await db.execute(sql`SELECT b.id AS booking_id,b.order_number,b.customer_name,b.customer_phone,p.id AS payment_id
    FROM sport_center.sport_bookings b
    JOIN sport_center.sport_payments p ON p.booking_id=b.id
    WHERE b.source='gym_public_guest' AND b.status::text='confirmed'
      AND b.notes LIKE '%Kartu VIS001–VIS006 menunggu pilihan%'
      AND b.booking_date::date=${day}::date
      AND p.status::text='confirmed' AND p.confirmed_at IS NOT NULL
      AND NULLIF(btrim(p.proof_url),'') IS NOT NULL
      AND p.amount>=COALESCE(b.grand_total,b.total_price)
      AND NOT EXISTS (
        SELECT 1 FROM sport_center.gym_vis_card_reservations r
        WHERE r.booking_id=b.id
      )
    ORDER BY p.confirmed_at,b.id LIMIT 12`);
  let recovered = 0;
  for (const row of pending.rows as Array<{booking_id: number;order_number: string;customer_name: string;customer_phone: string;payment_id: number}>) {
    try {
      const result = await reserveVisAfterAdminPaymentConfirmation({
        orderNumber: String(row.order_number),
        paymentId: Number(row.payment_id),
        confirmedBy: "X904 AUTO RECOVERY",
      });
      if (result.newReservation) {
        recovered++;
        if (process.env.NODE_ENV === "production" && String(row.customer_phone ?? "").trim()) {
          // A recovered VIS must also reach its customer. Fire only for the
          // newly inserted reservation (never on idempotent retries).
          const statusUrl = `${await getBaseUrl()}/status/${String(row.order_number)}`;
          void notifyGymVisitorCardReserved({
            bookingId: Number(row.booking_id),
            orderNumber: String(row.order_number),
            customerName: String(row.customer_name ?? ""),
            customerPhone: String(row.customer_phone),
            cardCode: result.cardCode,
            statusUrl,
          }).catch(error => console.warn("[gym-vis] recovered VIS customer notice failed",
            error instanceof Error ? error.message : String(error)));
        }
      }
    } catch (error) {
      const code = error instanceof VisReservationError ? error.code : "unknown";
      console.warn("[gym-vis] paid booking allocation retry pending", {
        orderNumber: String(row.order_number), code,
      });
    }
  }
  return recovered;
}

/**
 * Called by Booking Admin after its existing payment+booking confirmation.
 * One admin click: the backend reserves a physical card idempotently.
 * ADMINPAY-<id> is a payment-scoped database key, NOT a bank transaction proof.
 * No X904 activation or door command is issued.
 */
export async function reserveVisAfterAdminPaymentConfirmation(input: {
  orderNumber: string;
  paymentId: number;
  confirmedBy: string;
}): Promise<{ cardCode: string; state: string; newReservation: boolean }> {
  if (!Number.isSafeInteger(input.paymentId) || input.paymentId <= 0) {
    throw new VisReservationError(400, "invalid_confirmed_payment",
      "ID pembayaran yang dikonfirmasi admin tidak sah.");
  }
  return autoReserveVisAfterFundsVerified({
    orderNumber: input.orderNumber,
    officialBankReference: `ADMINPAY-${input.paymentId}`,
    officialFundsChecked: true,
    verifiedBy: input.confirmedBy,
    confirmedPaymentId: input.paymentId,
  });
}

/** Record a witnessed physical handover; this does NOT authorize the machine. */
export async function collectReservedVisCard(input: {
  orderNumber: string;
  physicalCardHandedOver: boolean;
  collectedBy: string;
}): Promise<{ cardCode: string; state: "collected" }> {
  if (input.physicalCardHandedOver !== true || !String(input.collectedBy ?? "").trim()) {
    throw new VisReservationError(400, "vis_handover_required",
      "Petugas wajib memastikan kartu fisik telah diserahkan sebelum mencatat pengambilan.");
  }
  try {
    return await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(90400661)`);
      const found = await tx.execute(sql`SELECT r.id,r.card_code,r.state,r.booking_id,r.payment_id,r.user_pin,r.device_uid,b.status::text AS booking_status,
               p.status::text AS payment_status
        FROM sport_center.gym_vis_card_reservations r
        JOIN sport_center.sport_bookings b ON b.id=r.booking_id
        JOIN sport_center.sport_payments p ON p.id=r.payment_id
        WHERE b.order_number=${input.orderNumber} FOR UPDATE OF r`);
      if (found.rows.length !== 1) throw new VisReservationError(404, "vis_not_reserved",
        "Reservasi kartu VIS tidak ditemukan.");
      const row = found.rows[0] as any;
      if (row.state === "collected") return { cardCode: String(row.card_code), state: "collected" };
      if (row.state !== "reserved") throw new VisReservationError(409,"vis_not_handover_ready",
        "Kartu VIS tidak sedang menunggu penyerahan.");
      if (row.booking_status !== "confirmed" || row.payment_status !== "confirmed") {
        throw new VisReservationError(409,"vis_payment_or_booking_changed",
          "Booking atau pembayaran sudah tidak terkonfirmasi. Jangan serahkan kartu VIS.");
      }
      const linkedGrant = await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
        SET verification_state='verified'
        WHERE device_serial='TDBD234200545'
          AND booking_id=${Number(row.booking_id)}
          AND payment_id=${Number(row.payment_id)}
          AND identity_type='card'
          AND identity_label=${String(row.card_code)}
          AND user_pin=${String(row.user_pin)}
          AND device_uid=${Number(row.device_uid)}
          AND verification_state IN ('pending','verified')
          AND access_state IN ('pending','active')
          AND expires_at>now()
        RETURNING access_id`);
      if (linkedGrant.rows.length !== 1) {
        throw new VisReservationError(409, "vis_grant_not_ready",
          "Hak akses belum siap; serah-terima kartu tidak diproses.");
      }
      await tx.execute(sql`UPDATE sport_center.gym_vis_card_reservations
        SET state='collected',collected_at=now()
        WHERE id=${Number(row.id)} AND state='reserved'`);
      return { cardCode: String(row.card_code), state: "collected" };
    });
  } catch (error) {
    if (error instanceof VisReservationError) throw error;
    console.error("[gym-vis] handover failed",error);
    throw new VisReservationError(503, "vis_handover_unavailable",
      "Penyerahan kartu belum berhasil dicatat; akses pintu tidak berubah.");
  }
}

/** Reuse only after confirmed physical card return and safe X904 read-back. */
export async function returnVerifiedVisCard(input: {
  orderNumber: string;
  physicalCardReturned: boolean;
  x904ReadbackChecked: boolean;
  returnedBy: string;
}): Promise<{ cardCode: string; state: "returned"; deviceSnapshotAt: string | null }> {
  if (input.physicalCardReturned !== true || input.x904ReadbackChecked !== true ||
      !String(input.returnedBy ?? "").trim()) {
    throw new VisReservationError(400,"return_verification_required",
      "Petugas harus mengonfirmasi kartu fisik kembali dan X904 telah dibaca ulang.");
  }
  try {
    return await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(90400661)`);
      const result = await tx.execute(sql`SELECT r.id,r.card_code,r.state,r.user_pin,r.device_uid,r.booking_id,r.reserved_at,r.collected_at,
          b.status::text AS booking_status
        FROM sport_center.gym_vis_card_reservations r
        JOIN sport_center.sport_bookings b ON b.id=r.booking_id
        WHERE b.order_number=${input.orderNumber} FOR UPDATE OF r`);
      if (!result.rows.length) throw new VisReservationError(404,"no_reservation","Kartu VIS belum dialokasikan.");
      const row = result.rows[0] as any;
      if (row.state === "returned") return { cardCode:String(row.card_code),state:"returned",deviceSnapshotAt:null };
      // A paid VIS may be activated immediately while its physical handover
      // remains unrecorded. Do not fabricate collected_at; allow an actual
      // witnessed return only after independently verified suspend/read-back.
      if (!((row.state === "collected" && row.collected_at) ||
            (row.state === "reserved" && !row.collected_at && row.reserved_at)))
        throw new VisReservationError(409,"invalid_return_state","Status kartu tidak dapat dikembalikan.");
      if (!["completed","cancelled","refunded","expired","rejected"].includes(String(row.booking_status))) {
        throw new VisReservationError(409,"booking_still_open",
          "Booking masih berjalan. Selesaikan atau batalkan booking sebelum kartu dibebaskan.");
      }
      // Reject return if ANY booking still has a live/pending grant for this physical PIN.
      // Another booking can retain an entitlement even when this booking is finished.
      const grant = await tx.execute(sql`SELECT 1
        FROM sport_center.x904_nonmember_daily_access
        WHERE device_serial='TDBD234200545'
          AND user_pin=${String(row.user_pin)}
          AND access_state IN ('pending','active','review_required')
        LIMIT 1`);
      if (grant.rows.length) throw new VisReservationError(409,"access_still_pending",
        "Masih ada hak akses X904 belum selesai. Verifikasi suspend/read-back terlebih dahulu.");
      // Require device-observed post-reservation evidence: a fresh snapshot
      // proves the PIN is in suspended group 2, not just an admin checkbox.
      const readback = await tx.execute(sql`WITH latest AS (
          SELECT observed_at,users FROM sport_center.gym_x904_access_snapshots
          WHERE device_serial='TDBD234200545'
            AND observed_at >= ${row.collected_at ?? row.reserved_at}
            AND observed_at >= now()-interval '10 minutes'
          ORDER BY observed_at DESC LIMIT 1
        ) SELECT observed_at FROM latest
        WHERE jsonb_typeof(users)='array'
          AND (SELECT count(*) FROM jsonb_array_elements(users) u
               WHERE u->>'pin'=${String(row.user_pin)})=1
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(users) u
               WHERE u->>'pin'=${String(row.user_pin)}
                 AND u->>'group'='2' AND u->>'role'='0')
          AND NOT EXISTS (
            SELECT 1 FROM sport_center.x904_user_commands cmd
            WHERE cmd.device_serial='TDBD234200545'
              AND cmd.user_pin=${String(row.user_pin)}
              AND cmd.created_at>latest.observed_at
          )
          -- PROD VMSC stores a device-confirmed result on the command itself.
          -- Do not depend on the DEV-only receipt table. Require actual
          -- command completion + device read-back + last observed Group 2.
          AND NOT EXISTS (
            SELECT 1 FROM (
              SELECT command_id,command_type,state,completed_at,result
              FROM sport_center.x904_user_commands
              WHERE device_serial='TDBD234200545'
                AND user_pin=${String(row.user_pin)}
                AND created_at>=${row.collected_at ?? row.reserved_at}
              ORDER BY created_at DESC,command_id DESC LIMIT 1
            ) last_command
            WHERE last_command.command_type<>'SUSPEND_USER'
               OR last_command.state<>'completed'
               OR last_command.completed_at IS NULL
               OR last_command.completed_at>latest.observed_at
               OR coalesce(last_command.result->>'readBackConfirmed','false')<>'true'
               OR coalesce(last_command.result->>'afterGroup','')<>'2'
               OR coalesce(last_command.result->>'deviceUid','')<>${String(row.device_uid)}
          ) LIMIT 1`);
      if (!readback.rows.length) throw new VisReservationError(409,"x904_readback_missing",
        "Snapshot X904 terbaru belum membuktikan PIN tersuspend di Grup 2. Kartu tetap ditahan.");
      if (row.state === "reserved") {
        // Reserved cards that were auto-activated require an actual completed
        // SUSPEND_USER/ACK for the same grant, not merely an old Group 2 image.
        const suspended = await tx.execute(sql`SELECT 1
          FROM sport_center.x904_nonmember_daily_access a
          JOIN sport_center.x904_user_commands c
            ON c.device_serial=a.device_serial
           AND c.user_pin=a.user_pin
           AND c.payload->>'accessId'=a.access_id::text
          WHERE a.booking_id=${Number(row.booking_id)}
            AND a.activated_at IS NOT NULL
            AND c.command_type='SUSPEND_USER' AND c.state='completed'
            AND c.completed_at IS NOT NULL
            AND c.completed_at <= ${readback.rows[0].observed_at}
            AND c.result->>'readBackConfirmed'='true'
            AND c.result->>'afterGroup'='2'
            AND c.result->>'deviceUid'=${String(row.device_uid)}
          ORDER BY c.completed_at DESC LIMIT 1`);
        if (!suspended.rows.length) throw new VisReservationError(409,"vis_suspend_proof_missing",
          "Kartu otomatis aktif hanya dapat dikembalikan setelah ACK suspend X904 terbukti.");
      }
      await tx.execute(sql`UPDATE sport_center.gym_vis_card_reservations
        SET state='returned',returned_at=now()
        WHERE id=${Number(row.id)} AND state=${String(row.state)}`);
      return { cardCode:String(row.card_code),state:"returned",deviceSnapshotAt:new Date(String(readback.rows[0].observed_at)).toISOString() };
    });
  } catch (error) {
    if (error instanceof VisReservationError) throw error;
    console.error("[gym-vis] return failed",error);
    throw new VisReservationError(503,"vis_return_unavailable","Pengembalian kartu belum dapat diverifikasi.");
  }
}
