import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { normalizeGymGuestName, resolveGymGuestName } from "./x904GymGuestNameRouting";
import { x904CurrentGymGuestInSnapshot } from "./x904GymGuestSnapshotPolicy";
import {
  isX904AutoSuspendExempt, resolveX904NonmemberCard,
  x904NonmemberOpeningHours,
} from "./x904NonmemberAccessPolicy";

export type ConfirmedGymAccessOutcome = {
  state: "active" | "pending" | "identity_review_required" | "reservation_pending" | "expired" | "review_required";
  code: string;
  message: string;
  action: "verify_pin_identity" | "wait" | "review" | "none";
};

const outcome = (
  state: ConfirmedGymAccessOutcome["state"], code: string, message: string,
  action: ConfirmedGymAccessOutcome["action"],
): ConfirmedGymAccessOutcome => ({ state, code, message, action });
const review = (code: string, message = "Pembayaran terkonfirmasi. Akses Gym perlu diperiksa petugas pada booking yang sama; tidak perlu membayar ulang.") =>
  outcome("review_required", code, message, "review");
const identityReview = (canVerify = false): ConfirmedGymAccessOutcome =>
  outcome("identity_review_required", canVerify ? "X904_PIN_IDENTITY_REVIEW_REQUIRED" : "X904_IDENTITY_REVIEW_REQUIRED",
    canVerify
      ? "Pembayaran terkonfirmasi. Petugas perlu memverifikasi identitas PIN pada booking ini sebelum akses diaktifkan; tidak perlu membayar ulang."
      : "Pembayaran terkonfirmasi. Identitas akses berubah atau belum cocok. Petugas perlu memeriksa booking ini; akses belum dapat dinyatakan aktif.",
    canVerify ? "verify_pin_identity" : "review");
const normalized = (value: unknown) => normalizeGymGuestName(String(value ?? ""));

/** Read-only presentation after financial commit. This never grants access,
 * changes identity, allocates a card, or records a physical handover. Existing
 * authorization endpoints and the ACK worker remain the only writers. */
export async function getConfirmedGymAccessOutcome(
  booking: any,
  payment: any,
  visReservation?: { status: string; code?: string } | null,
): Promise<ConfirmedGymAccessOutcome | null> {
  if (!booking || !payment || Number(booking.facilityId ?? booking.facility_id) !== 6 ||
      !["admin", "gym_public_guest"].includes(String(booking.source)) ||
      payment.status !== "confirmed" || (payment.paymentType ?? payment.payment_type) === "dp" ||
      (booking.membershipId ?? booking.membership_id) != null ||
      (booking.membershipPaymentId ?? booking.membership_payment_id) != null ||
      (payment.sourceMembershipPaymentId ?? payment.source_membership_payment_id) != null) return null;
  const bookingId = Number(booking.id), paymentId = Number(payment.id);
  try {
    if (!Number.isSafeInteger(bookingId) || bookingId <= 0 ||
        !Number.isSafeInteger(paymentId) || paymentId <= 0)
      return review("X904_ACCESS_REFERENCE_INVALID");
    // Re-read the committed link, including exclusions; do not infer access
    // from the payment response, a name match, or an allocator return value.
    const persisted = await db.execute(sql`SELECT
        b.facility_id,b.source,b.customer_name,b.booking_date,b.status::text AS booking_status,
        b.membership_id,b.membership_payment_id,COALESCE(b.grand_total,b.total_price) AS payable,
        p.status::text AS payment_status,p.payment_type::text AS payment_type,
        p.source_membership_payment_id,p.confirmed_at AS payment_confirmed_at,p.amount AS paid_amount,
        NULLIF(btrim(p.proof_url),'') IS NOT NULL AS proof_present,
        (SELECT count(*)::int FROM sport_center.sport_payments paid
          WHERE paid.booking_id=b.id AND paid.status::text='confirmed') AS confirmed_payment_count,
        a.access_id,a.payment_id AS grant_payment_id,a.identity_type,a.identity_label,
        gp.status::text AS grant_payment_status,gp.source_membership_payment_id AS grant_membership_payment_id,
        gp.confirmed_at AS grant_payment_confirmed_at,gp.amount AS grant_paid_amount,
        NULLIF(btrim(gp.proof_url),'') IS NOT NULL AS grant_proof_present,
        a.user_pin,a.device_uid,a.verified_name,a.verification_state,a.access_state,a.activated_at,a.expires_at,
        u.device_uid AS current_uid,u.display_name AS current_name,u.device_role AS current_role,
        r.device_uid AS registry_uid,r.display_name AS registry_name,
        r.verification_state AS registry_state,r.revoked_at,
        EXISTS (SELECT 1 FROM sport_center.gym_x904_member_mapping m
          WHERE m.device_serial=a.device_serial AND m.user_pin=a.user_pin) AS has_membership,
        v.state AS reservation_state,v.payment_id AS reservation_payment_id,
        v.card_code,v.user_pin AS reservation_pin,v.device_uid AS reservation_uid,
        v.collected_at,v.funds_verified_at
      FROM sport_center.sport_bookings b
      JOIN sport_center.sport_payments p ON p.booking_id=b.id AND p.id=${paymentId}
      LEFT JOIN sport_center.x904_nonmember_daily_access a
        ON a.booking_id=b.id AND a.device_serial='TDBD234200545'
      LEFT JOIN sport_center.sport_payments gp ON gp.id=a.payment_id AND gp.booking_id=b.id
      LEFT JOIN sport_center.gym_x904_lan_users u
        ON u.device_serial=a.device_serial AND u.user_pin=a.user_pin
      LEFT JOIN sport_center.x904_verified_nonmember_identities r
        ON r.device_serial=a.device_serial AND r.user_pin=a.user_pin
      LEFT JOIN sport_center.gym_vis_card_reservations v
        ON v.booking_id=b.id AND v.device_serial='TDBD234200545'
      WHERE b.id=${bookingId} LIMIT 3`);
    if (persisted.rows.length !== 1) return review("X904_ACCESS_LINK_REVIEW_REQUIRED");
    const row = persisted.rows[0] as any;
    if (Number(row.facility_id) !== 6 || !["admin", "gym_public_guest"].includes(String(row.source)) ||
        row.membership_id != null || row.membership_payment_id != null ||
        row.source_membership_payment_id != null || row.grant_membership_payment_id != null ||
        row.payment_type === "dp") return null;
    if (row.payment_status !== "confirmed")
      return review("X904_PAYMENT_ACCESS_EVIDENCE_REVIEW_REQUIRED");
    // Existing grants retain the canonical worker's payment rules, including
    // Admin cash and paid balances. These stricter evidence checks only decide
    // whether the existing public PIN approval endpoint can be offered.
    const approvalConfirmedAt = row.access_id == null ? row.payment_confirmed_at : row.grant_payment_confirmed_at;
    const approvalProof = row.access_id == null ? row.proof_present : row.grant_proof_present;
    const approvalAmount = Number(row.access_id == null ? row.paid_amount : row.grant_paid_amount);
    const pinApprovalFundsReady = Boolean(approvalConfirmedAt && approvalProof) &&
      Number.isFinite(Number(row.payable)) && Number(row.payable) > 0 &&
      Number.isFinite(approvalAmount) && approvalAmount >= Number(row.payable);
    if (!["confirmed", "paid", "completed"].includes(String(row.booking_status)))
      return review("X904_BOOKING_ACCESS_NOT_READY");

    const now = new Date(), nowMs = now.getTime();
    const day = String(row.booking_date ?? "").slice(0, 10);
    const closing = Date.parse(day + "T23:00:00+07:00");
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day) || !Number.isFinite(closing))
      return review("X904_BOOKING_DATE_INVALID");
    const activated = row.activated_at ? new Date(String(row.activated_at)) : null;
    // Admin/public day admission uses the worker's stored expiry capped by
    // booking-day closing; do not replace its clock with a new duration rule.
    const effectiveExpiry = activated && row.expires_at
      ? new Date(Math.min(closing, new Date(String(row.expires_at)).getTime()))
      : null;
    if (row.reservation_state === "returned" || row.access_state === "expired" ||
        nowMs >= closing || (effectiveExpiry && nowMs >= effectiveExpiry.getTime()))
      return outcome("expired", row.reservation_state === "returned" ? "X904_VIS_RETURNED" : "X904_ACCESS_EXPIRED",
        "Masa akses booking ini telah berakhir. Pembayaran tetap tercatat.", "none");
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    if (day !== today || !x904NonmemberOpeningHours(now))
      return outcome("pending", "X904_VISIT_NOT_STARTED",
        "Pembayaran terkonfirmasi. Akses menunggu tanggal kunjungan dan jam operasional Gym.", "wait");

    const snapshots = await db.execute(sql`SELECT observed_at,user_count,users
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
    const snapshot = snapshots.rows[0] as any;
    if (row.access_id == null) {
      if (row.reservation_state != null) return review("X904_RESERVED_GRANT_MISSING");
      if (row.source !== "gym_public_guest") return review("X904_GRANT_MISSING");
      const candidate = await resolveGymGuestName(String(row.customer_name ?? ""));
      if (candidate.route === "registered") {
        // The endpoint reauthorizes and rejects conflicts. A current exact
        // candidate only offers a review action; it does not link a PIN here.
        const inSnapshot = x904CurrentGymGuestInSnapshot(snapshot,
          String(candidate.userPin), String(candidate.displayName), nowMs);
        const group2 = inSnapshot && snapshot.users.some((u: any) =>
          String(u.pin) === candidate.userPin && normalized(u.name) === normalized(candidate.displayName) &&
          Number(u.group) === 2);
        return identityReview(Boolean(group2 && pinApprovalFundsReady && Number(row.confirmed_payment_count) === 1));
      }
      if (candidate.route !== "visitor_card" || visReservation?.code === "now_registered")
        return identityReview();
      return outcome("reservation_pending", "X904_VIS_RESERVATION_PENDING",
        "Pembayaran terkonfirmasi. Kartu VIS belum berhasil dialokasikan; petugas perlu memeriksa booking ini tanpa membuat pembayaran baru.",
        visReservation?.status === "needs_review" ? "review" : "wait");
    }

    // A later balance receipt need not replace the grant's canonical receipt.
    // The join above independently requires that receipt to belong to this
    // same booking; never accept a cross-booking or no-longer-paid link.
    if (row.grant_payment_id == null || row.grant_payment_status !== "confirmed")
      return review("X904_GRANT_PAYMENT_MISMATCH");
    const pin = String(row.user_pin ?? ""), uid = Number(row.device_uid);
    const name = normalized(row.verified_name);
    const currentMatches = /^[0-9]{1,8}$/.test(pin) && Number.isSafeInteger(uid) && uid > 0 && name &&
      Number(row.current_uid) === uid && Number(row.current_role) === 0 &&
      normalized(row.current_name) === name && row.has_membership === false &&
      !isX904AutoSuspendExempt(pin, Number(row.current_role));
    if (!currentMatches) return identityReview();
    if (row.identity_type === "pin") {
      if (Number(row.registry_uid) !== uid || normalized(row.registry_name) !== name ||
          row.registry_state !== "verified" || row.revoked_at != null) return identityReview();
    } else if (row.identity_type === "card") {
      const card = resolveX904NonmemberCard(String(row.identity_label));
      if (!card || card.userPin !== pin || card.deviceUid !== uid ||
          name.replaceAll(" ", "") !== String(row.identity_label)) return identityReview();
      if (row.source === "gym_public_guest" &&
          (Number(row.reservation_payment_id) !== Number(row.grant_payment_id) || row.card_code !== row.identity_label ||
           row.reservation_pin !== pin || Number(row.reservation_uid) !== uid ||
           !((row.reservation_state === "reserved" && row.collected_at == null && row.funds_verified_at != null) ||
             (row.reservation_state === "collected" && row.collected_at != null))))
        return review("X904_VIS_RESERVATION_REVIEW_REQUIRED");
    } else return review("X904_ACCESS_TYPE_REVIEW_REQUIRED");

    if (!x904CurrentGymGuestInSnapshot(snapshot, pin, String(row.verified_name), nowMs)) {
      const age = nowMs - new Date(String(snapshot?.observed_at ?? "")).getTime();
      const freshComplete = Number.isFinite(age) && age >= 0 && age <= 300_000 &&
        Array.isArray(snapshot?.users) && snapshot.users.length === Number(snapshot.user_count);
      if (freshComplete) return identityReview();
      return outcome("pending", "X904_SNAPSHOT_PENDING",
        "Pembayaran terkonfirmasi. Status akses menunggu pembaruan data mesin X904.", "wait");
    }
    if (row.access_state === "review_required" || row.verification_state !== "verified") {
      let canVerify = false;
      if (row.source === "gym_public_guest" && row.identity_type === "pin" &&
          row.access_state === "review_required" && row.verification_state === "review_required" &&
          row.activated_at == null && pinApprovalFundsReady) {
        const candidate = await resolveGymGuestName(String(row.verified_name), pin);
        canVerify = candidate.route === "registered" && candidate.userPin === pin && candidate.deviceUid === uid &&
          snapshot.users.some((u: any) => String(u.pin) === pin && normalized(u.name) === name && Number(u.group) === 2);
      }
      return canVerify ? identityReview(true) : review("X904_ACCESS_REVIEW_REQUIRED");
    }
    if (row.access_state === "active" && activated &&
        Number.isFinite(activated.getTime()) && activated.getTime() <= nowMs && effectiveExpiry &&
        Number.isFinite(effectiveExpiry.getTime()) && nowMs < effectiveExpiry.getTime() &&
        snapshot.users.some((u: any) => String(u.pin) === pin && Number(u.group) === 1 &&
          normalized(u.name) === name))
      return outcome("active", "X904_ACCESS_ACTIVE",
        row.identity_type === "card" && row.reservation_state === "reserved"
          ? "Akses kartu tercatat aktif. Penyerahan kartu tetap harus dicatat oleh petugas."
          : "Pembayaran terkonfirmasi dan akses X904 tercatat aktif.", "none");
    if (row.access_state !== "pending" && row.access_state !== "active")
      return review("X904_ACCESS_STATE_REVIEW_REQUIRED");
    return outcome("pending", "X904_ACTIVATION_PENDING",
      "Pembayaran terkonfirmasi. Aktivasi akses menunggu konfirmasi mesin X904.", "wait");
  } catch {
    // Query errors can contain customer data. Log identifiers only and keep
    // the already-committed payment response truthful and successful.
    logger.warn({ bookingId, paymentId, code: "X904_ACCESS_STATUS_UNAVAILABLE" },
      "[gym-x904] access status unavailable after payment");
    return review("X904_ACCESS_STATUS_UNAVAILABLE");
  }
}
