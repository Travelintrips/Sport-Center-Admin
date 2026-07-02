import { db, bookingsTable, facilitiesTable, bankReconciliationMatchesTable, waActionTokensTable } from "@workspace/db";
import { eq, and, lt, lte, isNotNull, isNull, inArray, sql } from "drizzle-orm";
import { notifyBookingExpired, notifyReminderH1, notifyWaDayReminder, notifyWaStaffCheckin, notifyAuditCritical, notifyPaymentReminder } from "./notifications";
import { createWaToken } from "./waTokens";
import { reverseTaxTransaction } from "./tax";
import { reverseJournalEntry } from "./accounting";
import { runBankAudit } from "./bankAudit";
import { runConnectionHealthCheck } from "./connectionHealth";
import { logger } from "./logger";

function getAppUrl(): string {
  if (process.env.NODE_ENV !== "production" && process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}
const APP_URL = getAppUrl();

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

async function expireOverdueBookings(): Promise<void> {
  try {
    const now = new Date();
    const overdue = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.status, "pending_payment"),
          isNotNull(bookingsTable.paymentDeadline),
          lt(bookingsTable.paymentDeadline, now)
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
      JOIN sport_center.payments bp ON bp.id = brm.candidate_id AND brm.candidate_type = 'payment'
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
    const facilityMap: Record<number, string> = {};
    for (const f of facilities) facilityMap[f.id] = f.name;

    for (const booking of confirmed) {
      // Mark as sent FIRST to prevent race conditions / server restarts
      await db
        .update(bookingsTable)
        .set({ reminderDaySentAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));

      const statusUrl = `${APP_URL}/status/${booking.orderNumber}`;
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
          checkinUrl: `${APP_URL}/wa/action/${checkinToken}`,
          finishUrl: `${APP_URL}/wa/action/${finishToken}`,
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
      const uploadProofUrl = `${APP_URL}/bukti/${proofToken}`;
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
      .where(and(eq(bookingsTable.status, "confirmed"), lte(bookingsTable.bookingDate, todayWIB)));

    for (const booking of confirmed) {
      const isPastDay = booking.bookingDate < todayWIB;
      const [endH, endM] = booking.endTime.split(":").map(Number);
      const endMinutes = endH * 60 + endM;

      // Selesaikan jika: hari sudah lewat, ATAU hari ini & jam sudah lewat
      if (isPastDay || nowMinutes >= endMinutes) {
        await db
          .update(bookingsTable)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(bookingsTable.id, booking.id));
        logger.info(`[scheduler] Auto-completed booking ${booking.orderNumber}`);
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

export function startScheduler(): void {
  logger.info("[scheduler] Starting background scheduler...");

  // Run immediately on startup
  expireOverdueBookings();
  autoCompleteBookings();
  checkConnections();

  // Every 5 minutes: expire overdue bookings + auto-complete + reminders + nightly audit + connection health
  setInterval(async () => {
    await expireOverdueBookings();
    await autoCompleteBookings();
    await sendPaymentReminder();
    await sendReminderH1();
    await sendDayOfReminder();
    await runNightlyBankAudit();
    await checkConnections();
  }, 5 * 60 * 1000);
}
