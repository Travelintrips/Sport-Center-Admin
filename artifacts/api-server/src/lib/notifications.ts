import { db, notificationTemplatesTable, settingsTable, waNotifLogsTable, bookingsTable, bookingGroupsTable, facilitiesTable } from "@workspace/db";
import { renderDocumentText } from "./documentRenderer";
import { eq } from "drizzle-orm";
import { trackSentMessage } from "./waSentTracker";
import { logger } from "./logger";
import { signKwitansiToken } from "./kwitansiToken";
import { getBaseUrl } from "./appUrl";

const ENV_FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
const ENV_FONNTE_CUSTOMER_TOKEN = process.env.FONNTE_CUSTOMER_TOKEN || "";
const ENV_FONNTE_ADMIN_WA = process.env.FONNTE_ADMIN_WA || "";
const ENV_ADMIN_WA_PHONES = process.env.ADMIN_WA_PHONES || "";
const ENV_ADMIN_WA_GROUP = process.env.ADMIN_WA_GROUP || "";

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// getBaseUrl() imported from ./appUrl — reads paymentDomain from settings DB with 5-min cache

async function getWaConfig(): Promise<{ token: string; customerToken: string; adminPhones: string[] }> {
  try {
    const [s] = await db.select().from(settingsTable).limit(1);
    const token = s?.fonnteToken || ENV_FONNTE_TOKEN;
    const rawCustomerToken = (s as any)?.fonnteCustomerToken || ENV_FONNTE_CUSTOMER_TOKEN;
    // Warning #3: jika customer token tidak dikonfigurasi, fallback ke token admin
    if (!rawCustomerToken) {
      logger.warn(
        "[WA] ⚠️  FONNTE_CUSTOMER_TOKEN tidak di-set. Pesan ke customer menggunakan token admin sebagai fallback. " +
        "Set FONNTE_CUSTOMER_TOKEN di env atau settings DB untuk pengirim terpisah ke customer.",
      );
    }
    const customerToken = rawCustomerToken || token;
    const phonesRaw = s?.adminWaPhones || ENV_ADMIN_WA_PHONES;
    const adminWa = s?.fonnteAdminWa || ENV_FONNTE_ADMIN_WA;
    const adminPhones = phonesRaw
      ? phonesRaw.split(",").map((p) => p.trim()).filter(Boolean)
      : adminWa
      ? [adminWa]
      : [];
    // Selalu sertakan grup WA admin (env ADMIN_WA_GROUP) sebagai penerima
    // tambahan — bukan hanya fallback. Dedup agar tidak double-kirim.
    if (ENV_ADMIN_WA_GROUP && !adminPhones.includes(ENV_ADMIN_WA_GROUP)) {
      adminPhones.push(ENV_ADMIN_WA_GROUP);
    }
    return { token, customerToken, adminPhones };
  } catch {
    const adminPhones = ENV_ADMIN_WA_PHONES
      ? ENV_ADMIN_WA_PHONES.split(",").map((p) => p.trim()).filter(Boolean)
      : ENV_FONNTE_ADMIN_WA
      ? [ENV_FONNTE_ADMIN_WA]
      : [];
    // Selalu sertakan grup WA dari env — bukan hanya fallback.
    if (ENV_ADMIN_WA_GROUP && !adminPhones.includes(ENV_ADMIN_WA_GROUP)) {
      adminPhones.push(ENV_ADMIN_WA_GROUP);
    }
    const fallbackToken = ENV_FONNTE_TOKEN;
    const fallbackCustomerToken = ENV_FONNTE_CUSTOMER_TOKEN || fallbackToken;
    return { token: fallbackToken, customerToken: fallbackCustomerToken, adminPhones };
  }
}

function cleanPhoneNumber(raw: string): string {
  // Grup WA — biarkan apa adanya (format: XXXXXXXX@g.us)
  if (raw.includes("@g.us")) return raw.trim();
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p && !p.startsWith("62")) p = "62" + p;
  return p;
}

function isValidPhone(phone: string): boolean {
  // Grup WA: format XXXXXXXX@g.us
  if (phone.endsWith("@g.us")) return /^\d+@g\.us$/.test(phone);
  // Pribadi: 62 + 8-13 digit
  return /^62\d{8,13}$/.test(phone);
}

async function sendWA(
  phone: string,
  message: string,
  ctx?: { bookingId?: number; orderNumber?: string; event?: string },
  useCustomerToken = false,
): Promise<void> {
  const cleanPhone = cleanPhoneNumber(phone);
  if (!cleanPhone || !isValidPhone(cleanPhone)) {
    logger.warn({ phone, cleanPhone }, "[WA] sendWA: nomor tidak valid, pesan tidak dikirim");
    if (ctx) logWaSend(cleanPhone || phone, message, "failed", "Nomor tidak valid", ctx).catch(() => {});
    return;
  }
  // Warning #4 guard: jika NODE_ENV bukan production, log peringatan
  if (process.env.NODE_ENV !== "production") {
    logger.warn(
      { target: cleanPhone, event: ctx?.event },
      "[WA] ⚠️  PERINGATAN: Mengirim WA di lingkungan non-production. Set WA_DRY_RUN=true di env DEV untuk mencegah pengiriman nyata.",
    );
  }
  // Dry-run mode: log pesan tapi tidak kirim ke Fonnte (set WA_DRY_RUN=true di env DEV)
  if (process.env.WA_DRY_RUN === "true") {
    logger.warn({ target: cleanPhone, event: ctx?.event }, "[WA] DRY RUN — pesan tidak dikirim ke Fonnte");
    logger.info({ target: cleanPhone, preview: message.slice(0, 200) }, "[WA] DRY RUN message preview");
    if (ctx) logWaSend(cleanPhone, message, "sent", "DRY RUN — tidak dikirim ke Fonnte", ctx).catch(() => {});
    return;
  }
  // Catat SEGERA sebelum await apapun — Fonnte echo bisa datang saat getWaConfig() pending
  trackSentMessage(message);
  const config = await getWaConfig();
  const token = useCustomerToken ? config.customerToken : config.token;
  if (!token) {
    logger.error("[WA] sendWA: FONNTE_TOKEN kosong — pesan tidak dikirim ke " + cleanPhone);
    if (ctx) logWaSend(cleanPhone, message, "failed", "FONNTE_TOKEN kosong", ctx).catch(() => {});
    return;
  }
  logger.info({ target: cleanPhone, sender: useCustomerToken ? "customer" : "admin" }, "[WA] Mengirim pesan WA via Fonnte");
  try {
    const resp = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target: cleanPhone, message }),
    });
    const body = await resp.text().catch(() => "(no body)");
    if (!resp.ok) {
      logger.error({ status: resp.status, target: cleanPhone, body }, "[WA] Fonnte HTTP error");
      if (ctx) logWaSend(cleanPhone, message, "failed", `HTTP ${resp.status}: ${body.slice(0, 200)}`, ctx).catch(() => {});
    } else {
      let json: Record<string, unknown> | null = null;
      try { json = JSON.parse(body); } catch { /* non-json */ }
      if (json && json["status"] === false) {
        logger.error({ target: cleanPhone, response: json }, "[WA] Fonnte gagal kirim pesan");
        if (ctx) logWaSend(cleanPhone, message, "failed", JSON.stringify(json).slice(0, 200), ctx).catch(() => {});
      } else {
        logger.info({ target: cleanPhone, id: json?.["id"] }, "[WA] Pesan berhasil masuk queue Fonnte");
        if (ctx) logWaSend(cleanPhone, message, "sent", null, ctx).catch(() => {});
      }
    }
  } catch (err) {
    logger.error({ err: (err as Error).message, target: cleanPhone }, "[WA] sendWA exception");
    if (ctx) logWaSend(cleanPhone, message, "failed", (err as Error).message, ctx).catch(() => {});
  }
}

export async function sendWAToAdmins(message: string): Promise<void> {
  const { adminPhones } = await getWaConfig();
  const isDev = process.env.NODE_ENV !== "production";
  // Deduplikasi: normalize nomor lalu kirim sekali per nomor unik
  const seen = new Set<string>();
  for (const phone of adminPhones) {
    const clean = cleanPhoneNumber(phone);
    if (!clean || seen.has(clean)) continue;
    // Di non-production: skip grup WA (format XXXXXXXX@g.us) agar notif dev tidak masuk grup produksi
    if (isDev && clean.endsWith("@g.us")) {
      logger.info({ target: clean }, "[WA] DEV — skip kirim ke grup WA (hanya production)");
      continue;
    }
    seen.add(clean);
    await sendWA(phone, message);
  }
}

async function sendWAToCustomer(
  phone: string,
  message: string,
  ctx?: { bookingId?: number; orderNumber?: string; event?: string },
): Promise<void> {
  return sendWA(phone, message, ctx, true);
}

async function getTemplate(key: string): Promise<string | null> {
  const [tpl] = await db
    .select()
    .from(notificationTemplatesTable)
    .where(eq(notificationTemplatesTable.key, key))
    .limit(1);
  if (!tpl || !tpl.isActive) return null;
  return tpl.body;
}

async function logWaSend(
  phone: string,
  message: string,
  status: "sent" | "failed",
  errorMessage: string | null,
  ctx?: { bookingId?: number; orderNumber?: string; event?: string },
): Promise<void> {
  try {
    await db.insert(waNotifLogsTable).values({
      bookingId: ctx?.bookingId ?? null,
      orderNumber: ctx?.orderNumber ?? null,
      event: ctx?.event ?? null,
      recipientPhone: phone,
      messagePreview: message.slice(0, 4000),
      status,
      errorMessage,
    });
  } catch (err) {
    logger.warn({ err }, "[WA] Gagal menyimpan WA log");
  }
}

async function getBankInfo(): Promise<Record<string, string>> {
  try {
    const [s] = await db.select().from(settingsTable).limit(1);
    return {
      bankName: s?.bankName ?? "",
      bankAccount: s?.bankAccount ?? "",
      bankAccountName: s?.bankAccountName ?? "",
    };
  } catch {
    return { bankName: "", bankAccount: "", bankAccountName: "" };
  }
}

export interface BookingNotifData {
  customerName: string;
  customerPhone: string;
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice: string;
  paymentDeadline?: string;
  reason?: string;
  reviewUrl?: string;
  bookingId?: number;
  uploadProofUrl?: string;
  statusUrl?: string;
  groupRef?: string | null;
}

// Jika booking ini bagian dari keranjang multi-lapangan (groupRef), rangkum semua sesi
// lain dalam grup supaya customer tahu bookingan lain yang menyertai — bukan cuma 1 link.
async function buildGroupSummary(groupRef: string | null | undefined, currentOrderNumber: string): Promise<string> {
  if (!groupRef) return "";
  try {
    const rows = await db
      .select({
        orderNumber: bookingsTable.orderNumber,
        bookingDate: bookingsTable.bookingDate,
        startTime: bookingsTable.startTime,
        endTime: bookingsTable.endTime,
        totalPrice: bookingsTable.totalPrice,
        facilityName: facilitiesTable.name,
      })
      .from(bookingsTable)
      .leftJoin(facilitiesTable, eq(bookingsTable.facilityId, facilitiesTable.id))
      .where(eq(bookingsTable.groupRef, groupRef));

    if (rows.length <= 1) return "";

    const [group] = await db.select().from(bookingGroupsTable).where(eq(bookingGroupsTable.groupRef, groupRef)).limit(1);

    const lines = rows
      .map((r) => {
        const marker = r.orderNumber === currentOrderNumber ? "👉" : "•";
        return `${marker} *${r.orderNumber}* — ${r.facilityName ?? "-"} | ${r.bookingDate} ${r.startTime}–${r.endTime} | Rp ${Number(r.totalPrice).toLocaleString("id-ID")}`;
      })
      .join("\n");

    const totalStr = group ? `Rp ${Number(group.totalPayment).toLocaleString("id-ID")}` : "";

    return (
      `\n\n📦 *Booking ini bagian dari keranjang ${rows.length} lapangan:*\n${lines}` +
      (totalStr ? `\n\n💰 *Total Semua Sesi: ${totalStr}*` : "")
    );
  } catch (err) {
    logger.error({ err, groupRef }, "[WA] buildGroupSummary failed");
    return "";
  }
}

export async function notifyBookingCreated(data: BookingNotifData): Promise<void> {
  const bankInfo = await getBankInfo();
  const vars = {
    ...data,
    ...bankInfo,
    paymentDeadline: data.paymentDeadline ?? "",
    uploadProofUrl: data.uploadProofUrl ?? "",
    statusUrl: data.statusUrl ?? "",
  };

  const groupSummary = await buildGroupSummary(data.groupRef, data.orderNumber);

  const customerTpl = await getTemplate("booking_created");
  if (customerTpl) {
    let msg = interpolate(customerTpl, vars as unknown as Record<string, string>);
    // Append link jika template tidak menyertakan placeholder-nya
    if (data.uploadProofUrl && !msg.includes(data.uploadProofUrl)) {
      msg += `\n\n📎 Upload bukti transfer:\n${data.uploadProofUrl}`;
    }
    if (data.statusUrl && !msg.includes(data.statusUrl)) {
      msg += `\n🔍 Cek status booking:\n${data.statusUrl}`;
    }
    msg += groupSummary;
    await sendWAToCustomer(data.customerPhone, msg, { bookingId: data.bookingId, orderNumber: data.orderNumber, event: "booking_created" });
  } else {
    // Fallback: pesan hardcoded jika template belum di-set
    const msg =
      `✅ *Booking Berhasil Dibuat!*\n\n` +
      `Halo *${data.customerName}*,\n` +
      `Booking *${data.facilityName}* kamu sudah kami terima.\n\n` +
      `📋 *Detail Booking:*\n` +
      `• No. Order: *${data.orderNumber}*\n` +
      `• Tanggal: *${data.bookingDate}*\n` +
      `• Jam: *${data.startTime} – ${data.endTime}*\n` +
      `• Total: *Rp ${data.totalPrice}*\n\n` +
      `💳 *Pembayaran via Transfer Bank:*\n` +
      `Bank: *${bankInfo.bankName}*\n` +
      `Rekening: *${bankInfo.bankAccount}*\n` +
      `Atas Nama: *${bankInfo.bankAccountName}*\n\n` +
      (data.paymentDeadline ? `⏰ Batas pembayaran: *${data.paymentDeadline}*\n\n` : "") +
      (data.uploadProofUrl ? `📎 Upload bukti transfer:\n${data.uploadProofUrl}\n\n` : "") +
      (data.statusUrl ? `🔍 Cek status booking:\n${data.statusUrl}\n\n` : "") +
      groupSummary +
      `\n\nTerima kasih! 🏆`;
    await sendWAToCustomer(data.customerPhone, msg, { bookingId: data.bookingId, orderNumber: data.orderNumber, event: "booking_created" });
  }

  const adminTpl = await getTemplate("admin_new_booking");
  if (adminTpl) {
    await sendWAToAdmins(interpolate(adminTpl, vars as unknown as Record<string, string>));
  } else {
    // Fallback: notifikasi admin hardcoded
    const adminMsg =
      `🏅 *BOOKING BARU — ${data.orderNumber}*\n\n` +
      `Customer: *${data.customerName}*\n` +
      `WA: *${data.customerPhone}*\n` +
      `Fasilitas: *${data.facilityName}*\n` +
      `Tanggal: *${data.bookingDate}*\n` +
      `Jam: *${data.startTime} – ${data.endTime}*\n` +
      `Total: *Rp ${data.totalPrice}*\n` +
      (data.paymentDeadline ? `Batas bayar: ${data.paymentDeadline}` : "");
    await sendWAToAdmins(adminMsg);
  }
}

export interface RecurringBookingSessionNotif {
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: number;
}

export async function notifyRecurringBookingGroupCreated(data: {
  customerName: string;
  customerPhone: string;
  groupRef?: string | null;
  totalPayment: number;
  sessions: RecurringBookingSessionNotif[];
  skippedDates?: string[];
}): Promise<void> {
  if (data.sessions.length === 0) return;

  const sessionLines = data.sessions
    .map((session, index) =>
      `${index + 1}. *${session.orderNumber}* — ${session.facilityName}\n` +
      `   ${session.bookingDate} | ${session.startTime}–${session.endTime} | ${session.durationHours} jam | Rp ${session.totalPrice.toLocaleString("id-ID")}`,
    )
    .join("\n");

  const skippedLine = data.skippedDates?.length
    ? `\n\n⚠️ Tidak dibuat karena slot bentrok: ${data.skippedDates.join(", ")}`
    : "";

  const message =
    `🏅 *BOOKING GRUP / BERULANG BARU*\n\n` +
    `Customer: *${data.customerName}*\n` +
    `WA: *${data.customerPhone}*\n` +
    (data.groupRef ? `Grup: *${data.groupRef}*\n` : "") +
    `Jumlah sesi: *${data.sessions.length}*\n\n` +
    `📋 *Daftar sesi:*\n${sessionLines}\n\n` +
    `💰 *Total semua sesi: Rp ${data.totalPayment.toLocaleString("id-ID")}*` +
    `${skippedLine}\n\n` +
    `Status: *Menunggu pembayaran* ⏳`;

  await sendWAToAdmins(message);
}

export async function notifyPaymentConfirmed(data: BookingNotifData): Promise<void> {
  const groupSummary = await buildGroupSummary(data.groupRef, data.orderNumber);

  // Attempt to render WA message from company document template engine (kwitansi)
  if (data.bookingId) {
    try {
      const rendered = await renderDocumentText({ documentType: "kwitansi", entityId: data.bookingId });
      if (rendered) {
        // Optionally append preview link if app URL is configured
        let msg = rendered;
        try {
          const [s] = await db.select().from(settingsTable).limit(1).catch(() => [null]);
          const appUrl = await getBaseUrl() || (s as { appUrl?: string } | null)?.appUrl || "";
          if (appUrl && data.orderNumber) msg += `\n\n🧾 Lihat & cetak kwitansi digital:\n${appUrl}/kwitansi/${data.orderNumber}?t=${signKwitansiToken(data.orderNumber)}`;
        } catch { /* non-fatal */ }
        msg += groupSummary;
        await sendWAToCustomer(data.customerPhone, msg, { bookingId: data.bookingId, orderNumber: data.orderNumber, event: "payment_confirmed" });
        return;
      }
    } catch { /* non-fatal — fall through to legacy template */ }
  }

  // Fallback: legacy notification template
  const tpl = await getTemplate("payment_confirmed");
  if (tpl) {
    const tplMsg = interpolate(tpl, data as unknown as Record<string, string>) + groupSummary;
    await sendWAToCustomer(data.customerPhone, tplMsg, { bookingId: data.bookingId, orderNumber: data.orderNumber, event: "payment_confirmed" });
    return;
  }

  // Final hardcoded fallback — selalu kirim meski template tidak ada di DB
  const bankInfo = await getBankInfo();
  const appUrl = await getBaseUrl();
  const kwitansiUrl = appUrl && data.orderNumber ? `${appUrl}/kwitansi/${data.orderNumber}?t=${signKwitansiToken(data.orderNumber)}` : "";
  const msg =
    `🎉 *Pembayaran Dikonfirmasi!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Pembayaran booking *${data.orderNumber}* untuk *${data.facilityName}* sudah kami verifikasi dan booking *DIKONFIRMASI* ✅\n\n` +
    `📋 *Detail Booking:*\n` +
    `• Tanggal: *${data.bookingDate}*\n` +
    `• Jam: *${data.startTime} – ${data.endTime}*\n` +
    `• Total: *Rp ${data.totalPrice}*\n\n` +
    `📄 *Kwitansi Pembayaran*\n` +
    `Fasilitas: ${data.facilityName}\n` +
    `✅ Pembayaran telah dikonfirmasi\n\n` +
    (kwitansiUrl ? `🧾 Lihat & cetak kwitansi digital:\n${kwitansiUrl}\n\n` : "") +
    groupSummary +
    `Sampai jumpa di lapangan! 🏆`;
  await sendWAToCustomer(data.customerPhone, msg, { bookingId: data.bookingId, orderNumber: data.orderNumber, event: "payment_confirmed" });
}

export async function notifyBookingCancelled(data: BookingNotifData): Promise<void> {
  const tpl = await getTemplate("booking_cancelled");
  if (tpl) await sendWAToCustomer(data.customerPhone, interpolate(tpl, { ...data as unknown as Record<string, string>, reason: data.reason ?? "" }), { bookingId: data.bookingId, orderNumber: data.orderNumber, event: "booking_cancelled" });
}

export async function notifyBookingCompleted(data: BookingNotifData): Promise<void> {
  const [s] = await db.select().from(settingsTable).limit(1).catch(() => [null]);
  const appUrl = s?.appUrl || await getBaseUrl();
  const tpl = await getTemplate("booking_completed");
  if (tpl) await sendWAToCustomer(data.customerPhone, interpolate(tpl, { ...data, reviewUrl: `${appUrl}/booking/${data.orderNumber}` } as unknown as Record<string, string>));
}

export async function notifyBookingExpired(data: BookingNotifData): Promise<void> {
  const customerTpl = await getTemplate("booking_expired");
  if (customerTpl) await sendWAToCustomer(data.customerPhone, interpolate(customerTpl, data as unknown as Record<string, string>));

  const adminTpl = await getTemplate("admin_booking_expired");
  if (adminTpl) await sendWAToAdmins(interpolate(adminTpl, data as unknown as Record<string, string>));
}

export async function notifyPaymentProofUploaded(data: BookingNotifData & { reviewUrl?: string }): Promise<void> {
  if (data.reviewUrl) {
    const msg =
      `🔔 *Bukti Pembayaran Masuk*\n\n` +
      `Booking: *${data.orderNumber}*\n` +
      `Customer: *${data.customerName}*\n` +
      `Fasilitas: *${data.facilityName}*\n` +
      `Tanggal: *${data.bookingDate}* pukul *${data.startTime}–${data.endTime}*\n` +
      `Total: *Rp ${data.totalPrice}*\n\n` +
      `📎 Tap link untuk lihat bukti & konfirmasi:\n${data.reviewUrl}`;
    await sendWAToAdmins(msg);
    return;
  }
  const tpl = await getTemplate("admin_payment_proof");
  if (tpl) await sendWAToAdmins(interpolate(tpl, data as unknown as Record<string, string>));
}

export interface MembershipPaymentProofData {
  membershipId: number;
  customerName: string;
  startDate: string;
  endDate: string;
  totalPrice: string;
  reviewUrl?: string;
}

export async function notifyMembershipPaymentProofUploaded(data: MembershipPaymentProofData): Promise<void> {
  const msg =
    `🔔 *Bukti Pembayaran Masuk*\n\n` +
    `Booking: *MB-${data.membershipId}*\n` +
    `Customer: *${data.customerName}*\n` +
    `Fasilitas: *Gym Member*\n` +
    `Tanggal mulai : *${data.startDate}*\n` +
    `tanggal akhir : *${data.endDate}*\n` +
    `Total: *Rp ${data.totalPrice}*` +
    (data.reviewUrl ? `\n\n📎 Tap link untuk cek & konfirmasi:\n${data.reviewUrl}` : "");
  await sendWAToAdmins(msg);
}

export async function notifyReminderH1(data: BookingNotifData): Promise<void> {
  const tpl = await getTemplate("reminder_h1");
  if (tpl) await sendWAToCustomer(data.customerPhone, interpolate(tpl, data as unknown as Record<string, string>));
}

export interface PaymentReminderData extends BookingNotifData {
  uploadProofUrl: string;
  hoursLeft: number;
}

export async function notifyPaymentReminder(data: PaymentReminderData): Promise<void> {
  const tpl = await getTemplate("payment_reminder");
  if (tpl) {
    await sendWAToCustomer(data.customerPhone, interpolate(tpl, { ...data, hoursLeft: String(data.hoursLeft) } as unknown as Record<string, string>));
    return;
  }
  const bankInfo = await getBankInfo();
  const msg =
    `⏰ *Pengingat Pembayaran!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Booking *${data.orderNumber}* untuk *${data.facilityName}* belum dibayar.\n\n` +
    `📅 Jadwal: *${data.bookingDate}* pukul *${data.startTime}–${data.endTime}*\n` +
    `💰 Total: *Rp ${data.totalPrice}*\n\n` +
    `⚠️ Batas bayar tersisa *${data.hoursLeft} jam* lagi — jangan sampai expired!\n\n` +
    `💳 Transfer ke:\n` +
    `Bank: *${bankInfo.bankName}*\n` +
    `Rekening: *${bankInfo.bankAccount}*\n` +
    `Atas Nama: *${bankInfo.bankAccountName}*\n\n` +
    `📎 Upload bukti transfer:\n${data.uploadProofUrl}`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export interface RescheduleNotifData {
  customerName: string;
  customerPhone: string;
  orderNumber: string;
  facilityName: string;
  newDate: string;
  newStartTime: string;
  newEndTime: string;
  reviewNote?: string;
}

export interface CompanyBookingNotifData {
  customerName: string;
  customerPhone: string;
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice: string;
  companyName: string;
  periodMonth: string;
  picPhone?: string;
}

export async function notifyCompanyBookingCreated(data: CompanyBookingNotifData): Promise<void> {
  const customerMsg = `Halo ${data.customerName},\n\nBooking Anda *${data.orderNumber}* untuk *${data.facilityName}* pada *${data.bookingDate}* pukul *${data.startTime}–${data.endTime}* telah *DIKONFIRMASI* ✅\n\nPembayaran akan ditagihkan melalui *Tagihan Bulanan Perusahaan* periode ${data.periodMonth}.\n\nTerima kasih! 🏆`;
  await sendWAToCustomer(data.customerPhone, customerMsg);

  const adminMsg = `📋 *Booking Perusahaan Baru*\nOrder: *${data.orderNumber}*\nPerusahaan: ${data.companyName}\nFasilitas: ${data.facilityName}\nTanggal: ${data.bookingDate} | ${data.startTime}–${data.endTime}\nTagihan: Bulanan ${data.periodMonth}\nNilai: Rp${data.totalPrice}`;
  await sendWAToAdmins(adminMsg);

  if (data.picPhone) {
    const picMsg = `📋 *Notifikasi Booking Perusahaan*\n\nHalo PIC *${data.companyName}*,\n\nAda booking baru atas nama perusahaan Anda.\n\nOrder: *${data.orderNumber}*\nPemesan: ${data.customerName}\nFasilitas: ${data.facilityName}\nTanggal: *${data.bookingDate}* | ${data.startTime}–${data.endTime}\nTagihan: Bulanan ${data.periodMonth}\nNilai: Rp ${data.totalPrice}\n\nBooking ini akan masuk dalam tagihan bulanan perusahaan. Terima kasih!`;
    await sendWAToCustomer(data.picPhone, picMsg);
  }
}

export async function notifyRescheduleApproved(data: RescheduleNotifData): Promise<void> {
  const tpl = await getTemplate("reschedule_approved");
  const message = tpl
    ? interpolate(tpl, { ...data, reviewNote: data.reviewNote ?? "" })
    : `Halo ${data.customerName}, permintaan reschedule booking *${data.orderNumber}* untuk ${data.facilityName} telah *DISETUJUI* ✅.\n\nJadwal baru: *${data.newDate}* pukul *${data.newStartTime}–${data.newEndTime}*.\n\nSampai jumpa di lapangan! 🏆`;
  await sendWAToCustomer(data.customerPhone, message);
}

export async function notifyRescheduleRejected(data: RescheduleNotifData): Promise<void> {
  const tpl = await getTemplate("reschedule_rejected");
  const message = tpl
    ? interpolate(tpl, { ...data, reviewNote: data.reviewNote ?? "" })
    : `Halo ${data.customerName}, permintaan reschedule booking *${data.orderNumber}* untuk ${data.facilityName} *DITOLAK* ❌.${data.reviewNote ? `\n\nCatatan admin: ${data.reviewNote}` : ""}\n\nSilakan hubungi admin jika ada pertanyaan.`;
  await sendWAToCustomer(data.customerPhone, message);
}

// ─── WhatsApp Booking Flow Notifications ──────────────────────────────────────

export interface WaBookingCreatedData extends BookingNotifData {
  statusUrl: string;
  uploadProofUrl: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
}

export async function notifyWaBookingCreated(data: WaBookingCreatedData): Promise<void> {
  const msg =
    `✅ *Booking Berhasil Dibuat!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Booking lapangan *${data.facilityName}* kamu sudah kami terima.\n\n` +
    `📋 *Detail Booking:*\n` +
    `• Order: *${data.orderNumber}*\n` +
    `• Tanggal: *${data.bookingDate}*\n` +
    `• Jam: *${data.startTime} – ${data.endTime}*\n` +
    `• Total: *Rp ${data.totalPrice}*\n\n` +
    `💳 *Pembayaran:*\n` +
    `Transfer ke:\n` +
    `Bank: *${data.bankName}*\n` +
    `Rekening: *${data.bankAccount}*\n` +
    `Atas Nama: *${data.bankAccountName}*\n\n` +
    `📎 Upload bukti transfer di sini:\n${data.uploadProofUrl}\n\n` +
    `🔍 Cek status booking:\n${data.statusUrl}\n\n` +
    `⏰ Deadline bayar: *${data.paymentDeadline ?? "-"}*`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export interface WaProofUploadedData extends BookingNotifData {
  proofUrl: string;
  reviewUrl: string;
}

export async function notifyWaProofUploaded(data: WaProofUploadedData): Promise<void> {
  const msg =
    `🔔 *Bukti Pembayaran Masuk*\n\n` +
    `Booking: *${data.orderNumber}*\n` +
    `Customer: *${data.customerName}*\n` +
    `Fasilitas: *${data.facilityName}*\n` +
    `Tanggal: *${data.bookingDate}* pukul *${data.startTime}–${data.endTime}*\n` +
    `Total: *Rp ${data.totalPrice}*\n\n` +
    `📎 Tap link untuk lihat bukti & konfirmasi:\n${data.reviewUrl}`;
  await sendWAToAdmins(msg);
}

export interface WaBookingConfirmedData extends BookingNotifData {
  statusUrl: string;
}

export async function notifyWaBookingConfirmed(data: WaBookingConfirmedData): Promise<void> {
  const appUrl = await getBaseUrl();
  const kwitansiUrl = appUrl && data.orderNumber ? `${appUrl}/kwitansi/${data.orderNumber}?t=${signKwitansiToken(data.orderNumber)}` : data.statusUrl;
  const msg =
    `🎉 *Booking Dikonfirmasi!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Pembayaran kamu sudah kami verifikasi. Booking *DIKONFIRMASI* ✅\n\n` +
    `📋 *Detail:*\n` +
    `• Order: *${data.orderNumber}*\n` +
    `• Fasilitas: *${data.facilityName}*\n` +
    `• Tanggal: *${data.bookingDate}*\n` +
    `• Jam: *${data.startTime} – ${data.endTime}*\n\n` +
    `Sampai jumpa di lapangan! 🏆\n\n` +
    `🧾 Kwitansi: ${kwitansiUrl}`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export interface WaPaymentRejectedData extends BookingNotifData {
  uploadProofUrl: string;
  reason?: string;
}

export async function notifyWaPaymentRejected(data: WaPaymentRejectedData): Promise<void> {
  const msg =
    `❌ *Bukti Pembayaran Ditolak*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Maaf, bukti pembayaran booking *${data.orderNumber}* ditolak.\n` +
    (data.reason ? `Alasan: _${data.reason}_\n\n` : "\n") +
    `Silakan upload ulang bukti yang benar:\n${data.uploadProofUrl}\n\n` +
    `Jika ada pertanyaan, hubungi admin kami.`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export interface WaDayReminderData extends BookingNotifData {
  statusUrl: string;
}

export async function notifyWaDayReminder(data: WaDayReminderData): Promise<void> {
  const msg =
    `⏰ *Pengingat Booking Hari Ini!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Booking lapangan *${data.facilityName}* kamu adalah *HARI INI*! 🏅\n\n` +
    `• Tanggal: *${data.bookingDate}*\n` +
    `• Jam: *${data.startTime} – ${data.endTime}*\n\n` +
    `Hadir tepat waktu ya! Sampai jumpa 👋\n\n` +
    `🔍 Detail: ${data.statusUrl}`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export interface WaCustomerRegisteredData {
  customerName: string;
  customerPhone: string;
  customerCode: string;
  facilitiesUrl: string;
}

export async function notifyWaCustomerRegistered(data: WaCustomerRegisteredData): Promise<void> {
  const msg =
    `🎉 *Registrasi Berhasil!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Akun kamu di *Sport Center Bandara Soekarno Hatta* sudah aktif ✅\n\n` +
    `👤 *Kode Customer:* \`${data.customerCode}\`\n\n` +
    `Simpan kode ini untuk referensi ya!\n\n` +
    `Sekarang kamu bisa langsung booking fasilitas:\n` +
    `🏟️ ${data.facilitiesUrl}\n\n` +
    `Ketik *booking* di sini untuk memulai pemesanan via WhatsApp 🏅`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export interface DpNotifData {
  customerName: string;
  customerPhone: string;
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  dpAmount: string;
  remainingAmount: string;
  paymentDeadline?: string;
}

export async function notifyDpPaid(data: DpNotifData): Promise<void> {
  const msg =
    `💳 *Pembayaran DP Diterima!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Booking *${data.orderNumber}* sudah kami terima dengan pembayaran DP.\n\n` +
    `🏟️ *Fasilitas:* ${data.facilityName}\n` +
    `📅 *Tanggal:* ${data.bookingDate}\n` +
    `⏰ *Jam:* ${data.startTime} – ${data.endTime}\n\n` +
    `💰 *DP Dibayar:* Rp ${data.dpAmount}\n` +
    `⚠️ *Sisa yang harus dilunasi:* Rp ${data.remainingAmount}\n` +
    (data.paymentDeadline ? `📆 *Batas Pelunasan:* ${data.paymentDeadline}\n\n` : "\n") +
    `Harap segera lunasi sebelum batas waktu agar booking dikonfirmasi. Terima kasih! 🙏`;
  await sendWAToCustomer(data.customerPhone, msg);

  const adminMsg =
    `💳 *DP Diterima — ${data.orderNumber}*\n` +
    `Customer: *${data.customerName}*\n` +
    `Fasilitas: ${data.facilityName} (${data.bookingDate} ${data.startTime}–${data.endTime})\n` +
    `DP: Rp ${data.dpAmount} | Sisa: Rp ${data.remainingAmount}`;
  await sendWAToAdmins(adminMsg);
}

export interface WaStaffCheckinData {
  orderNumber: string;
  customerName: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  checkinUrl: string;
  finishUrl: string;
}

export async function notifyWaStaffCheckin(data: WaStaffCheckinData): Promise<void> {
  const msg =
    `📲 *Booking Siap Check-In*\n\n` +
    `• Order: *${data.orderNumber}*\n` +
    `• Customer: *${data.customerName}*\n` +
    `• Fasilitas: *${data.facilityName}*\n` +
    `• Jam: *${data.startTime} – ${data.endTime}*\n\n` +
    `✅ Check-In sekarang:\n${data.checkinUrl}\n\n` +
    `🏁 Selesai main:\n${data.finishUrl}`;
  await sendWAToAdmins(msg);
}

export interface WaBookingPendingApprovalData {
  customerName: string;
  customerPhone: string;
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: string;
  statusUrl: string;
}

export async function notifyWaBookingPendingApproval(data: WaBookingPendingApprovalData): Promise<void> {
  const msg =
    `⏳ *Booking Diterima — Menunggu Persetujuan Admin*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Permintaan booking kamu sudah kami terima dan sedang dalam proses persetujuan admin.\n\n` +
    `📋 *Detail Booking:*\n` +
    `• Kode: *${data.orderNumber}*\n` +
    `• Fasilitas: *${data.facilityName}*\n` +
    `• Tanggal: *${data.bookingDate}*\n` +
    `• Jam: *${data.startTime} – ${data.endTime}*\n` +
    `• Durasi: *${data.durationHours} jam*\n` +
    `• Total: *Rp ${data.totalPrice}*\n\n` +
    `Status: *Menunggu approval admin* ⏳\n\n` +
    `Kamu akan segera mendapat notifikasi jika booking disetujui. Terima kasih! 🙏\n\n` +
    `🔍 Cek status: ${data.statusUrl}`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export interface WaAdminNewBookingData {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: string;
  isWeekend: boolean;
  appliedRules?: string;
  statusUrl: string;
}

export async function notifyWaAdminNewBooking(data: WaAdminNewBookingData): Promise<void> {
  const dayType = data.isWeekend ? "Weekend" : "Weekday";
  const msg =
    `🏅 *BOOKING BARU SPORT CENTER*\n\n` +
    `Kode: *${data.orderNumber}*\n` +
    `Customer: *${data.customerName}*\n` +
    `WA: *${data.customerPhone}*\n` +
    `Fasilitas: *${data.facilityName}*\n` +
    `Tanggal: *${data.bookingDate}* (${dayType})\n` +
    `Jam: *${data.startTime} – ${data.endTime}*\n` +
    `Durasi: *${data.durationHours} jam*\n` +
    `Total: *Rp ${data.totalPrice}*\n` +
    (data.appliedRules ? `Harga: ${data.appliedRules}\n` : "") +
    `Status: *Menunggu approval admin* ⏳\n\n` +
    `Balas:\n` +
    `✅ *APPROVE ${data.orderNumber}*\n` +
    `❌ *REJECT ${data.orderNumber} alasan*\n\n` +
    `🔗 ${data.statusUrl}`;
  await sendWAToAdmins(msg);
}

export async function notifyWaBookingApproved(data: WaBookingCreatedData): Promise<void> {
  const msg =
    `✅ *Booking Disetujui!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Booking kamu sudah *DISETUJUI* admin! 🎉\n\n` +
    `📋 *Detail:*\n` +
    `• Order: *${data.orderNumber}*\n` +
    `• Fasilitas: *${data.facilityName}*\n` +
    `• Tanggal: *${data.bookingDate}*\n` +
    `• Jam: *${data.startTime} – ${data.endTime}*\n` +
    `• Total: *Rp ${data.totalPrice}*\n\n` +
    `💳 *Langkah selanjutnya — Lakukan pembayaran:*\n` +
    `Bank: *${data.bankName}*\n` +
    `Rekening: *${data.bankAccount}*\n` +
    `Atas Nama: *${data.bankAccountName}*\n\n` +
    `📎 Upload bukti transfer:\n${data.uploadProofUrl}\n\n` +
    `⏰ Deadline bayar: *${data.paymentDeadline ?? "-"}*\n\n` +
    `🔍 Status: ${data.statusUrl}`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export async function notifyWaBookingRejectedByAdmin(params: {
  customerPhone: string;
  customerName: string;
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  reason?: string;
}): Promise<void> {
  const msg =
    `❌ *Booking Ditolak Admin*\n\n` +
    `Halo *${params.customerName}*,\n` +
    `Maaf, permintaan booking *${params.orderNumber}* untuk *${params.facilityName}* pada *${params.bookingDate}* pukul *${params.startTime}–${params.endTime}* tidak dapat disetujui.\n\n` +
    (params.reason ? `Alasan: _${params.reason}_\n\n` : "") +
    `Silakan ketik *booking* untuk membuat booking baru dengan jadwal berbeda.\n` +
    `Terima kasih atas pengertiannya. 🙏`;
  await sendWA(params.customerPhone, msg);
}

export interface AuditNotifData {
  critical: number;
  warning: number;
  info: number;
  findings: Array<{ severity: string; category: string; message: string; count: number }>;
  auditTimestamp: string;
}

export async function notifyAdminBookingApprovalRequest(data: {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: string;
  approvalUrl: string;
  source?: string;
}): Promise<void> {
  const dayOfWeek = new Date(data.bookingDate + "T00:00:00+07:00").getDay();
  const dayType = (dayOfWeek === 0 || dayOfWeek === 6) ? "Weekend" : "Weekday";
  const sourceTag = data.source && data.source !== "portal" ? ` [${data.source.toUpperCase()}]` : "";
  const msg =
    `🔔 *BOOKING BARU — PERLU APPROVAL*${sourceTag}\n\n` +
    `Order: *${data.orderNumber}*\n` +
    `Customer: *${data.customerName}*\n` +
    `WA: *${data.customerPhone}*\n` +
    `Fasilitas: *${data.facilityName}*\n` +
    `Tanggal: *${data.bookingDate}* (${dayType})\n` +
    `Jam: *${data.startTime} – ${data.endTime}*\n` +
    `Durasi: *${data.durationHours} jam*\n` +
    `Total: *Rp ${data.totalPrice}*\n\n` +
    `👇 *Approve / Reject via link:*\n${data.approvalUrl}`;
  await sendWAToAdmins(msg);
}

export async function notifyCustomerBookingApproved(data: {
  customerPhone: string;
  customerName: string;
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
  uploadProofUrl: string;
  paymentDeadline?: string;
  statusUrl: string;
}): Promise<void> {
  const msg =
    `✅ *Booking Disetujui!*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Booking *${data.orderNumber}* sudah *DISETUJUI* admin! 🎉\n\n` +
    `📋 *${data.facilityName}*\n` +
    `📅 ${data.bookingDate} | ${data.startTime} – ${data.endTime}\n` +
    `💰 Total: *Rp ${data.totalPrice}*\n\n` +
    `💳 *Lakukan pembayaran ke:*\n` +
    `Bank: *${data.bankName}*\n` +
    `Rekening: *${data.bankAccount}*\n` +
    `Atas Nama: *${data.bankAccountName}*\n\n` +
    `📎 Upload bukti: ${data.uploadProofUrl}\n` +
    (data.paymentDeadline ? `⏰ Deadline: *${data.paymentDeadline}*\n\n` : "\n") +
    `🔍 Status: ${data.statusUrl}`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export async function notifyCustomerBookingRejectedByAdmin(data: {
  customerPhone: string;
  customerName: string;
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  reason?: string;
}): Promise<void> {
  const msg =
    `❌ *Booking Ditolak*\n\n` +
    `Halo *${data.customerName}*,\n` +
    `Maaf, booking *${data.orderNumber}* untuk *${data.facilityName}* pada *${data.bookingDate}* ` +
    `pukul *${data.startTime}–${data.endTime}* tidak dapat disetujui.\n\n` +
    (data.reason ? `📝 Alasan: _${data.reason}_\n\n` : "") +
    `Silakan buat booking baru dengan jadwal lain.\n` +
    `Terima kasih atas pengertiannya. 🙏`;
  await sendWAToCustomer(data.customerPhone, msg);
}

export async function notifyAuditCritical(data: AuditNotifData): Promise<void> {
  const criticalLines = data.findings
    .filter((f) => f.severity === "critical")
    .map((f) => `🔴 *${f.category}* — ${f.message}`)
    .join("\n");
  const warningLines = data.findings
    .filter((f) => f.severity === "warning")
    .map((f) => `🟡 *${f.category}* — ${f.message}`)
    .join("\n");

  const ts = new Date(data.auditTimestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

  const msg =
    `🚨 *[Bank Recon Audit Malam]* ${ts} WIB\n\n` +
    `❌ *${data.critical} Critical* | ⚠️ ${data.warning} Warning | ℹ️ ${data.info} Info\n\n` +
    (criticalLines ? `*Temuan Critical:*\n${criticalLines}\n\n` : "") +
    (warningLines ? `*Temuan Warning:*\n${warningLines}\n\n` : "") +
    `Buka Admin → Bank Rekonsiliasi → Dashboard → Jalankan Audit untuk detail lengkap.`;

  await sendWAToAdmins(msg);
}
