import { dispatchX904AttendanceWhatsApp } from "../services/x904AttendanceWaOutbox";
import { dispatchX904LanScanNotifications, dispatchX904OneTimeReport } from "../services/x904LanWaNotifications";
import { db, bookingsTable, facilitiesTable, bankReconciliationMatchesTable, waActionTokensTable, gymMembershipsTable, membershipPaymentsTable } from "@workspace/db";
import { eq, and, lt, lte, isNotNull, isNull, inArray, or, sql } from "drizzle-orm";
import { notifyBookingExpired, notifyReminderH1, notifyWaDayReminder, notifyWaStaffCheckin, notifyAuditCritical, notifyPaymentReminder } from "./notifications";
import { createWaToken } from "./waTokens";
import { reverseTaxTransaction } from "./tax";
import { reverseJournalEntry } from "./accounting";
import { runBankAudit } from "./bankAudit";
import { runConnectionHealthCheck } from "./connectionHealth";
import { sendRekapPemakaianToAdmin } from "./rekapPemakaian";
import { bulkPushPaymentsToBizportal, processPaymentAccountingOutbox, prunePaymentSyncErrorCache } from "./bizportalSync";
import { processCentralFinance } from "./centralFinance";
import { logger } from "./logger";
import { completeBooking } from "./bookingLifecycle";
import { getBaseUrl } from "./appUrl";

function getWIBNow(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function getTomorrowWIB(): string {
  const d = getWIBNow();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function getTodayWIB(): string {
  return getWIBNow().toISOString().split("T")[0];
}

async function expireOverdueMemberships(): Promise<void> {
  try {
    const todayWIB = getTodayWIB();
    // Selective reconciliation: never change members with ambiguous renewal evidence.
    if (process.env.GYM_MEMBERSHIP_AUTO_SUSPEND_ENABLED !== "true") {
      return;
    }

    const memberships = await db.select({
      id: gymMembershipsTable.id,
      status: gymMembershipsTable.status,
      endDate: gymMembershipsTable.endDate,
    }).from(gymMembershipsTable)
      .where(inArray(gymMembershipsTable.status, ["active", "expired"]));

    let suspended = 0;
    let reactivated = 0;
    let heldForReview = 0;
    for (const member of memberships) {
      const payments = await db.select({
        id: membershipPaymentsTable.id,
        status: membershipPaymentsTable.status,
        periodStart: membershipPaymentsTable.periodStart,
        periodEnd: membershipPaymentsTable.periodEnd,
        amount: membershipPaymentsTable.amount,
      }).from(membershipPaymentsTable)
        .where(eq(membershipPaymentsTable.membershipId, member.id));

      // Reconcile renewal bookings per member, not by global payment completeness.
      const financialBookings = await db.select({
        id: bookingsTable.id,
        membershipPaymentId: bookingsTable.membershipPaymentId,
        status: bookingsTable.status,
      }).from(bookingsTable)
        .where(and(eq(bookingsTable.membershipId, member.id),
          eq(bookingsTable.source, "gym_membership_payment")));

      const canonicalIds = new Set(payments.map(p => p.id));
      const hasUnlinkedFinancialBooking = financialBookings.some(b =>
        !b.membershipPaymentId || !canonicalIds.has(b.membershipPaymentId));
      const hasPendingReview = payments.some(p => p.status === "waiting_confirmation") ||
        financialBookings.some(b => b.status === "waiting_confirmation");
      // A booking marked confirmed but missing a confirmed canonical payment
      // is inconsistent and must be investigated before any state change.
      const hasInconsistentConfirmedBooking = financialBookings.some(b =>
        b.status === "confirmed" && !payments.some(p =>
          p.id === b.membershipPaymentId && p.status === "confirmed"));
      // Unlinked or inconsistent financial records require manual review.
      // A separate pending renewal must not block an already-confirmed paid period.
      if (hasUnlinkedFinancialBooking || hasInconsistentConfirmedBooking) {
        heldForReview++;
        continue;
      }

      const coveredPayments = payments.filter(p =>
        p.status === "confirmed" && Number(p.amount) > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(p.periodStart) &&
        /^\d{4}-\d{2}-\d{2}$/.test(p.periodEnd) &&
        p.periodStart <= todayWIB && p.periodEnd >= todayWIB);
      if (coveredPayments.length) {
        // Never shorten membership endDate when reactivating a paid renewal.
        const coveredUntil = coveredPayments.map(p => p.periodEnd).sort().at(-1)!;
        if (member.status === "expired" || member.endDate < coveredUntil) {
          const updated = await db.update(gymMembershipsTable)
            .set({ status: "active", endDate: coveredUntil > member.endDate ? coveredUntil : member.endDate,
              updatedAt: new Date() })
            .where(and(eq(gymMembershipsTable.id, member.id),
              inArray(gymMembershipsTable.status, ["active", "expired"])))
            .returning({ id: gymMembershipsTable.id });
          if (member.status === "expired") reactivated += updated.length;
        }
        continue;
      }

      // Pending verification blocks suspension, but not reactivation from an
      // independently confirmed payment covering the current date.
      if (hasPendingReview) {
        heldForReview++;
        continue;
      }

      if (member.status !== "active" || member.endDate >= todayWIB) continue;
      // Seven full WIB calendar days after the inclusive membership end date.
      // Invalid legacy dates are never auto-suspended.
      const parsedEnd = /^\d{4}-\d{2}-\d{2}$/.test(member.endDate)
        ? Date.parse(member.endDate + "T00:00:00Z") : NaN;
      const parsedToday = Date.parse(todayWIB + "T00:00:00Z");
      if (!Number.isFinite(parsedEnd) || parsedToday <= parsedEnd + 7 * 86400000) continue;
      // Legacy memberships without a canonical renewal record and without
      // any renewal booking are candidates, not proof of non-payment. Keep
      // these in review until an authoritative payment-source audit exists.
      if (!payments.length && !financialBookings.length) {
        heldForReview++;
        continue;
      }
      // A pending renewal must not trigger suspension even after grace ends.
      if (payments.some(p => p.status === "pending_payment") ||
          financialBookings.some(b => b.status === "pending_payment")) {
        heldForReview++;
        continue;
      }
      // If any financial booking has a confirmed status inconsistent with the
      // canonical payment, stop and require review instead of suspending.
      if (financialBookings.some(b => b.status === "confirmed" &&
        !payments.some(p => p.id === b.membershipPaymentId && p.status === "confirmed"))) {
        heldForReview++;
        continue;
      }

      const updated = await db.update(gymMembershipsTable)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(gymMembershipsTable.id, member.id),
          eq(gymMembershipsTable.status, "active"), lt(gymMembershipsTable.endDate, todayWIB)))
        .returning({ id: gymMembershipsTable.id });
      suspended += updated.length;
    }
    logger.info({ examined: memberships.length, suspended, reactivated, heldForReview },
      "[scheduler] GYM payment entitlement reconciliation");
  } catch (err) {
    logger.error({ err }, "[scheduler] GYM payment entitlement reconciliation error");
  }
}

async function expireOverdueBookings(): Promise<void> {
  try {
    const now = new Date();
    // Expire booking pending_payment yang booking_date-nya sudah lewat 7 hari
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0]; // YYYY-MM-DD


    // Expire booking yang:
    // (a) pending_payment atau waiting_confirmation dan 7 hari setelah tanggal main sudah lewat, ATAU
    // (b) pending_payment dan paymentDeadline sudah lewat (deadline pembayaran singkat)

    const overdue = await db
      .select()
      .from(bookingsTable)
      .where(
        or(
          and(
            or(
              eq(bookingsTable.status, "pending_payment"),
              eq(bookingsTable.status, "waiting_confirmation"),
            ),
            lt(sql`(${bookingsTable.bookingDate}::date + interval '7 days')`, now),
          ),
          and(
            eq(bookingsTable.status, "pending_payment"),
            isNotNull(bookingsTable.paymentDeadline),
            lt(bookingsTable.paymentDeadline, now),
          ),
        )
      );

    if (!overdue.length) return;

    // Jangan expire booking yang sedang dalam proses rekonsiliasi bank
    // Cari booking IDs yang terhubung ke mutasi dengan status aktif (bank_mutation_status enum)
    const overdueIds = overdue.map((b) => b.id);
    const idsLiteral = sql.raw(`ARRAY[${overdueIds.join(",")}]::int[]`);
    const { rows: reconRows } = await db.execute(sql`
      SELECT DISTINCT bp.booking_id
      FROM sport_center.bank_mutations bm
      JOIN sport_center.bank_reconciliation_matches brm ON brm.mutation_id = bm.id
      JOIN sport_center.sport_payments bp ON bp.id = brm.candidate_id AND brm.candidate_type = 'payment'
      WHERE bm.status IN ('auto_matched','need_review','duplicate_need_review')
        AND bp.booking_id = ANY(${idsLiteral})
      UNION
      SELECT DISTINCT brm.candidate_id AS booking_id
      FROM sport_center.bank_mutations bm
      JOIN sport_center.bank_reconciliation_matches brm ON brm.mutation_id = bm.id
      WHERE bm.status IN ('auto_matched','need_review','duplicate_need_review')
        AND brm.candidate_type = 'order'
        AND brm.candidate_id = ANY(${idsLiteral})
    `);
    const reconProtectedIds = new Set((reconRows as any[]).map((r) => Number(r.booking_id)));

    for (const booking of overdue) {
      // Skip booking yang ada kandidat rekonsiliasi aktif — biarkan admin konfirmasi dulu
      if (reconProtectedIds.has(booking.id)) {
        logger.info(`[scheduler] Booking ${booking.orderNumber} overdue tapi punya kandidat rekon aktif — dilewati`);
        continue;
      }

      await db
        .update(bookingsTable)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));

      // Balik jurnal pajak + akuntansi (jika ada PPN pada booking ini)
      const today = new Date().toISOString().split("T")[0];
      const reason = `Booking ${booking.orderNumber} — expired otomatis`;
      reverseTaxTransaction(booking.id, booking.orderNumber, today).catch(() => {});
      reverseJournalEntry(booking.id, booking.orderNumber, reason, today).catch(() => {});

      const [facility] = await db
        .select({ name: facilitiesTable.name })
        .from(facilitiesTable)
        .where(eq(facilitiesTable.id, booking.facilityId))
        .limit(1);

      await notifyBookingExpired({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber,
        facilityName: facility?.name ?? "",
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      });

      logger.info(`[scheduler] Expired booking ${booking.orderNumber}`);
    }
  } catch (err) {
    console.error("[scheduler] expireOverdueBookings error:", err);
  }
}

async function sendReminderH1(): Promise<void> {
  try {
    const tomorrow = getTomorrowWIB();
    const now = getWIBNow();
    const hour = now.getUTCHours();

    // Only send between 08:00-10:00 WIB (01:00-03:00 UTC)
    if (hour < 1 || hour > 3) return;

    // Only bookings where reminderH1SentAt is NULL (never sent)
    const confirmed = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.bookingDate, tomorrow),
          eq(bookingsTable.status, "confirmed"),
          isNull(bookingsTable.reminderH1SentAt)
        )
      );

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;

    for (const booking of confirmed) {
      // Mark as sent FIRST to prevent race conditions
      await db
        .update(bookingsTable)
        .set({ reminderH1SentAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));

      await notifyReminderH1({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber,
        facilityName: facilityMap[booking.facilityId] ?? "",
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      });

      logger.info(`[scheduler] H-1 reminder sent for ${booking.orderNumber}`);
    }
  } catch (err) {
    console.error("[scheduler] sendReminderH1 error:", err);
  }
}

// Day-of reminder: sent at 07:00-08:00 WIB (00:00-01:00 UTC) to confirmed bookings today
async function sendDayOfReminder(): Promise<void> {
  try {
    const now = getWIBNow();
    const hour = now.getUTCHours();
    // 07:00-08:00 WIB = 00:00-01:00 UTC
    if (hour !== 0) return;

    const today = getTodayWIB();

    // Only bookings where reminderDaySentAt is NULL (never sent)
    const confirmed = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.bookingDate, today),
          eq(bookingsTable.status, "confirmed"),
          isNull(bookingsTable.reminderDaySentAt)
        )
      );

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const appUrl = await getBaseUrl();
    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;

    for (const booking of confirmed) {
      // Mark as sent FIRST to prevent race conditions / server restarts
      await db
        .update(bookingsTable)
        .set({ reminderDaySentAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));

      const statusUrl = `${appUrl}/status/${booking.orderNumber}`;
      const facilityName = facilityMap[booking.facilityId] ?? "";

      // Customer reminder
      await notifyWaDayReminder({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber,
        facilityName,
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
        statusUrl,
      });

      // Staff checkin/finish links
      if (booking.source === "whatsapp") {
        const checkinToken = await createWaToken(booking.id, "checkin", 2);
        const finishToken = await createWaToken(booking.id, "finish", 2);
        await notifyWaStaffCheckin({
          orderNumber: booking.orderNumber,
          customerName: booking.customerName,
          facilityName,
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          checkinUrl: `${appUrl}/wa/action/${checkinToken}`,
          finishUrl: `${appUrl}/wa/action/${finishToken}`,
        });
      }

      logger.info(`[scheduler] Day-of reminder sent for ${booking.orderNumber}`);
    }
  } catch (err) {
    console.error("[scheduler] sendDayOfReminder error:", err);
  }
}

// Payment reminder: kirim 2 jam sebelum deadline (sekali saja per booking)
async function sendPaymentReminder(): Promise<void> {
  try {
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    // Booking pending_payment yang deadline-nya dalam 2 jam ke depan, belum dikirim reminder
    const pending = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.status, "pending_payment"),
          isNotNull(bookingsTable.paymentDeadline),
          lt(bookingsTable.paymentDeadline, twoHoursLater),
          isNull(bookingsTable.paymentReminderSentAt)
        )
      );

    if (!pending.length) return;

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name }).from(facilitiesTable);
    const appUrl = await getBaseUrl();
    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;

    for (const booking of pending) {
      if (!booking.paymentDeadline) continue;

      const msLeft = booking.paymentDeadline.getTime() - now.getTime();
      if (msLeft <= 0) continue; // sudah expired, biarkan expireOverdueBookings yang handle

      const hoursLeft = Math.max(1, Math.floor(msLeft / (60 * 60 * 1000)));

      // Mark dulu sebelum kirim WA — cegah double-send
      await db
        .update(bookingsTable)
        .set({ paymentReminderSentAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));

      // Ambil token upload proof (reuse jika ada, buat baru jika tidak)
      const [tokenRow] = await db
        .select()
        .from(waActionTokensTable)
        .where(and(eq(waActionTokensTable.bookingId, booking.id), eq(waActionTokensTable.action, "upload_proof")))
        .limit(1);

      if (!tokenRow?.token) await createWaToken(booking.id, "upload_proof", 7);
      const proofToken = tokenRow?.token ?? (await createWaToken(booking.id, "upload_proof", 7));
      const uploadProofUrl = `${appUrl}/bukti/${proofToken}`;
      await notifyPaymentReminder({
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber,
        facilityName: facilityMap[booking.facilityId] ?? "",
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
        paymentDeadline: booking.paymentDeadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
        uploadProofUrl,
        hoursLeft,
      });

      logger.info(`[scheduler] Payment reminder sent for ${booking.orderNumber} (${hoursLeft}h left)`);
    }
  } catch (err) {
    console.error("[scheduler] sendPaymentReminder error:", err);
  }
}

async function autoCompleteBookings(): Promise<void> {
  try {
    const wibNow = getWIBNow();
    const todayWIB = wibNow.toISOString().split("T")[0];
    const nowMinutes = wibNow.getUTCHours() * 60 + wibNow.getUTCMinutes();

    // Ambil semua booking confirmed s.d. hari ini (termasuk hari-hari sebelumnya)
    const confirmed = await db
      .select()
      .from(bookingsTable)
      .where(and(
        eq(bookingsTable.status, "confirmed"),
        lte(bookingsTable.bookingDate, todayWIB),
        isNotNull(bookingsTable.checkedInAt),
      ));

    for (const booking of confirmed) {
      const isPastDay = booking.bookingDate < todayWIB;
      const [endH, endM] = booking.endTime.split(":").map(Number);
      const endMinutes = endH * 60 + endM;

      // Selesaikan jika: hari sudah lewat, ATAU hari ini & jam sudah lewat
      if ((isPastDay || nowMinutes >= endMinutes) && booking.checkedInAt) {
        const completion = await completeBooking(booking.id, { userName: "scheduler", userRole: "system" });
        if (completion.ok) {
          logger.info(`[scheduler] Auto-completed booking ${booking.orderNumber}`);
        } else {
          logger.info(`[scheduler] Booking ${booking.orderNumber} was not completed: ${completion.reason}`);
        }
      }
    }
  } catch (err) {
    console.error("[scheduler] autoCompleteBookings error:", err);
  }
}

// Nightly bank audit — 23:00 WIB (16:00 UTC), kirim WA jika ada temuan critical/warning
async function runNightlyBankAudit(): Promise<void> {
  const now = getWIBNow();
  const hourUTC = now.getUTCHours();
  // 23:00 WIB = 16:00 UTC (WIB = UTC+7)
  if (hourUTC !== 16) return;

  try {
    const result = await runBankAudit();
    const hasCritical = result.summary.critical > 0;
    const hasWarning = result.summary.warning > 0;

    if (hasCritical || hasWarning) {
      await notifyAuditCritical({
        critical: result.summary.critical,
        warning: result.summary.warning,
        info: result.summary.info,
        findings: result.findings,
        auditTimestamp: result.auditTimestamp,
      });
      logger.info(`[scheduler] Nightly bank audit: ${result.summary.critical} critical, ${result.summary.warning} warning — WA notif sent`);
    } else {
      logger.info("[scheduler] Nightly bank audit: ✅ production ready, no issues");
    }
  } catch (err) {
    console.error("[scheduler] runNightlyBankAudit error:", err);
  }
}

async function checkConnections(): Promise<void> {
  try {
    await runConnectionHealthCheck("scheduler");
  } catch (err) {
    console.error("[scheduler] checkConnections error:", err);
  }
}

// X904 auto check-ins enqueue one durable daily report update, never one WA per scan.
let x904GymUsageDispatchRunning = false;
async function dispatchX904GymUsageReport(): Promise<void> {
  if (process.env.X904_GYM_USAGE_WA_AUTO_ENABLED !== "true" || x904GymUsageDispatchRunning) return;
  x904GymUsageDispatchRunning = true;
  let reportDate: string | null = null;
  try {
    // Claim and persist BEFORE calling gateway: ambiguous failures must not auto-replay.
    const claimed = await db.execute(sql`
      with candidate as (
        select report_date from sport_center.x904_gym_usage_wa_queue
        where version > claimed_version
          and last_event_at <= now() - interval '2 minutes'
          and (last_sent_at is null or last_sent_at <= now() - interval '15 minutes')
        order by report_date desc limit 1 for update skip locked
      )
      update sport_center.x904_gym_usage_wa_queue q
      set claimed_version=q.version, claim_at=now(), updated_at=now()
      from candidate c where q.report_date=c.report_date
      returning q.report_date::text as report_date
    `);
    reportDate = String(claimed.rows[0]?.report_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return;
    await sendRekapPemakaianToAdmin(reportDate);
    await db.execute(sql`
      update sport_center.x904_gym_usage_wa_queue
      set first_sent_at=coalesce(first_sent_at,now()), last_sent_at=now(),
          last_error=null, updated_at=now()
      where report_date=${reportDate}::date
    `);
    logger.info({reportDate}, "[x904-gym-usage] report dispatched");
  } catch (err) {
    logger.error({err,reportDate}, "[x904-gym-usage] dispatch requires review; no blind replay");
  } finally {
    x904GymUsageDispatchRunning = false;
  }
}

// ─── Daily Rekap Pemakaian ke Grup WA Admin ────────────────────────────────
// Dikirim setiap hari jam 08:00 WIB (01:00 UTC), sekali per hari.
let lastRekapSentDate = "";

async function sendDailyRekap(): Promise<void> {
  try {
    const now = getWIBNow();
    const hourUTC = now.getUTCHours();
    // 08:00–09:00 WIB = 01:00–02:00 UTC
    if (hourUTC !== 1) return;

    const today = getTodayWIB();
    if (lastRekapSentDate === today) return; // sudah terkirim hari ini

    lastRekapSentDate = today; // tandai dulu, cegah double-send
    await sendRekapPemakaianToAdmin(today);
    logger.info({ date: today }, "[scheduler] Daily rekap pemakaian terkirim ke admin WA");
  } catch (err) {
    lastRekapSentDate = ""; // reset agar bisa retry di interval berikutnya
    console.error("[scheduler] sendDailyRekap error:", err);
  }
}

// ─── Nightly Rekap Update 23:30 WIB ───────────────────────────────────────
// Kirim ulang rekap hari ini jam 23:30 WIB agar status pembayaran ter-update.
// 23:30 WIB = 16:30 UTC
let lastNightRekapSentDate = "";

async function sendNightlyRekap(): Promise<void> {
  try {
    const now = getWIBNow();
    const hourUTC = now.getUTCHours();
    const minuteUTC = now.getUTCMinutes();
    // 23:30–23:35 WIB = 16:30–16:35 UTC
    if (hourUTC !== 16 || minuteUTC < 30 || minuteUTC >= 35) return;

    const today = getTodayWIB();
    if (lastNightRekapSentDate === today) return; // sudah terkirim malam ini

    lastNightRekapSentDate = today; // tandai dulu, cegah double-send
    await sendRekapPemakaianToAdmin(today);
    logger.info({ date: today }, "[scheduler] Nightly rekap 23:30 terkirim ke admin WA");
  } catch (err) {
    lastNightRekapSentDate = ""; // reset agar bisa retry
    console.error("[scheduler] sendNightlyRekap error:", err);
  }
}

export function startScheduler(): void {
  logger.info("[scheduler] Starting background scheduler...");

  // Run immediately on startup
  expireOverdueMemberships();
  expireOverdueBookings();
  autoCompleteBookings();
  checkConnections();
  processPaymentAccountingOutbox().catch((err) =>
    logger.error({ err }, "[scheduler] Initial payment accounting outbox processing failed"),
  );
  processCentralFinance().catch((err) =>
    logger.error({ err }, "[scheduler] Initial central finance processing failed"),
  );

  // Diagnose digest scheduler activation once per process without exposing secrets.
  logger.info({ x904DigestEnv: process.env.GYM_X904_LAN_WA_ENABLED ?? "unset", x904GroupConfigured: Boolean(process.env.GYM_X904_WA_GROUP_ID) }, "[scheduler] X904 LAN digest configuration");
  // Drain already-durable X904 batches immediately after a deploy/restart.
  // This does not replay scans: the DB claim and Gateway idempotency remain authoritative.
  console.info("[x904-digest] scheduler initialized", { enabled: process.env.GYM_X904_LAN_WA_ENABLED ?? "unset", groupConfigured: Boolean(process.env.GYM_X904_WA_GROUP_ID) });
  dispatchX904LanScanNotifications().then(() => console.info("[x904-digest] startup dispatch completed")).catch(err => console.error("[x904-digest] startup dispatch failed", err));
  // Attendance notifications: short cadence, guarded by opt-in env and durable claim.
  setInterval(() => {
    dispatchX904AttendanceWhatsApp().catch(err =>
      logger.error({err}, "[scheduler] X904 WhatsApp outbox dispatch failed"));
    dispatchX904LanScanNotifications().catch(err =>
      logger.error({err}, "[scheduler] X904 LAN observation WhatsApp failed"));
    dispatchX904OneTimeReport().catch(err =>
      logger.error({err}, "[scheduler] X904 one-time report WhatsApp failed"));
  }, 15 * 1000);

  // Every 5 minutes: expire overdue bookings + memberships + auto-complete + reminders + nightly audit + connection health + daily rekap
  setInterval(async () => {
    await expireOverdueMemberships();
    await expireOverdueBookings();
    await autoCompleteBookings();
    await sendPaymentReminder();
    await sendReminderH1();
    await sendDayOfReminder();
    await runNightlyBankAudit();
    await dispatchX904GymUsageReport();
    await sendDailyRekap();
    await sendNightlyRekap();
    await checkConnections();
    try {
      const result = await processPaymentAccountingOutbox();
      if (result.claimed > 0) {
        logger.info(result, "[scheduler] Payment accounting outbox processed");
      }
    } catch (err) {
      logger.error({ err }, "[scheduler] Payment accounting outbox processing failed");
    }
    try {
      const result = await processCentralFinance();
      if (result.claimed > 0) {
        logger.info(result, "[scheduler] Central Finance events processed");
      }
    } catch (err) {
      logger.error({ err }, "[scheduler] Central Finance processing failed");
    }
  }, 5 * 60 * 1000);

  // Every 60 minutes: auto-sync confirmed payments to BizPortal so both sides stay balanced.
  // Also prune the error-dedup cache so stale entries don't accumulate in memory.
  setInterval(async () => {
    prunePaymentSyncErrorCache();
    try {
      const result = await bulkPushPaymentsToBizportal();
      if (result.pushed > 0) {
        logger.info(
          { pushed: result.pushed, skipped: result.skipped, failed: result.failed },
          "[scheduler] Auto BizPortal payment sync: pushed new payments",
        );
      }
    } catch (err) {
      logger.error({ err }, "[scheduler] Auto BizPortal payment sync failed");
    }
  }, 60 * 60 * 1000);
}
