import { db, notificationTemplatesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
const FONNTE_ADMIN_WA = process.env.FONNTE_ADMIN_WA || "";
const ADMIN_WA_PHONES = process.env.ADMIN_WA_PHONES || "";

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

async function sendWA(phone: string, message: string): Promise<void> {
  if (!FONNTE_TOKEN || !phone) return;
  try {
    const cleanPhone = phone.replace(/^0/, "62").replace(/\D/g, "");
    await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: FONNTE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target: cleanPhone, message }),
    });
  } catch {
    // Non-critical — swallow error
  }
}

async function sendWAToAdmins(message: string): Promise<void> {
  const phones = ADMIN_WA_PHONES
    ? ADMIN_WA_PHONES.split(",").map((p) => p.trim()).filter(Boolean)
    : FONNTE_ADMIN_WA
    ? [FONNTE_ADMIN_WA]
    : [];
  for (const phone of phones) {
    await sendWA(phone, message);
  }
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
}

export async function notifyBookingCreated(data: BookingNotifData): Promise<void> {
  const bankInfo = await getBankInfo();
  const vars = { ...data, ...bankInfo, paymentDeadline: data.paymentDeadline ?? "" };

  const customerTpl = await getTemplate("booking_created");
  if (customerTpl) await sendWA(data.customerPhone, interpolate(customerTpl, vars));

  const adminTpl = await getTemplate("admin_new_booking");
  if (adminTpl) await sendWAToAdmins(interpolate(adminTpl, vars));
}

export async function notifyPaymentConfirmed(data: BookingNotifData): Promise<void> {
  const tpl = await getTemplate("payment_confirmed");
  if (tpl) await sendWA(data.customerPhone, interpolate(tpl, data as Record<string, string>));
}

export async function notifyBookingCancelled(data: BookingNotifData): Promise<void> {
  const tpl = await getTemplate("booking_cancelled");
  if (tpl) await sendWA(data.customerPhone, interpolate(tpl, { ...data, reason: data.reason ?? "" }));
}

export async function notifyBookingCompleted(data: BookingNotifData): Promise<void> {
  const appUrl = process.env.APP_URL ?? "";
  const tpl = await getTemplate("booking_completed");
  if (tpl) await sendWA(data.customerPhone, interpolate(tpl, { ...data, reviewUrl: `${appUrl}/booking/${data.orderNumber}` }));
}

export async function notifyBookingExpired(data: BookingNotifData): Promise<void> {
  const customerTpl = await getTemplate("booking_expired");
  if (customerTpl) await sendWA(data.customerPhone, interpolate(customerTpl, data as Record<string, string>));

  const adminTpl = await getTemplate("admin_booking_expired");
  if (adminTpl) await sendWAToAdmins(interpolate(adminTpl, data as Record<string, string>));
}

export async function notifyPaymentProofUploaded(data: BookingNotifData): Promise<void> {
  const tpl = await getTemplate("admin_payment_proof");
  if (tpl) await sendWAToAdmins(interpolate(tpl, data as Record<string, string>));
}

export async function notifyReminderH1(data: BookingNotifData): Promise<void> {
  const tpl = await getTemplate("reminder_h1");
  if (tpl) await sendWA(data.customerPhone, interpolate(tpl, data as Record<string, string>));
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

export async function notifyRescheduleApproved(data: RescheduleNotifData): Promise<void> {
  const tpl = await getTemplate("reschedule_approved");
  const message = tpl
    ? interpolate(tpl, { ...data, reviewNote: data.reviewNote ?? "" })
    : `Halo ${data.customerName}, permintaan reschedule booking *${data.orderNumber}* untuk ${data.facilityName} telah *DISETUJUI* ✅.\n\nJadwal baru: *${data.newDate}* pukul *${data.newStartTime}–${data.newEndTime}*.\n\nSampai jumpa di lapangan! 🏆`;
  await sendWA(data.customerPhone, message);
}

export async function notifyRescheduleRejected(data: RescheduleNotifData): Promise<void> {
  const tpl = await getTemplate("reschedule_rejected");
  const message = tpl
    ? interpolate(tpl, { ...data, reviewNote: data.reviewNote ?? "" })
    : `Halo ${data.customerName}, permintaan reschedule booking *${data.orderNumber}* untuk ${data.facilityName} *DITOLAK* ❌.${data.reviewNote ? `\n\nCatatan admin: ${data.reviewNote}` : ""}\n\nSilakan hubungi admin jika ada pertanyaan.`;
  await sendWA(data.customerPhone, message);
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
  await sendWA(data.customerPhone, msg);
}

export interface WaProofUploadedData extends BookingNotifData {
  proofUrl: string;
  approveUrl: string;
  rejectUrl: string;
}

export async function notifyWaProofUploaded(data: WaProofUploadedData): Promise<void> {
  const msg =
    `🔔 *Bukti Pembayaran Masuk*\n\n` +
    `Booking: *${data.orderNumber}*\n` +
    `Customer: *${data.customerName}*\n` +
    `Fasilitas: *${data.facilityName}*\n` +
    `Tanggal: *${data.bookingDate}* pukul *${data.startTime}–${data.endTime}*\n` +
    `Total: *Rp ${data.totalPrice}*\n\n` +
    `📎 Bukti: ${data.proofUrl}\n\n` +
    `✅ Approve: ${data.approveUrl}\n` +
    `❌ Tolak: ${data.rejectUrl}`;
  await sendWAToAdmins(msg);
}

export interface WaBookingConfirmedData extends BookingNotifData {
  statusUrl: string;
}

export async function notifyWaBookingConfirmed(data: WaBookingConfirmedData): Promise<void> {
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
    `🔍 Detail booking: ${data.statusUrl}`;
  await sendWA(data.customerPhone, msg);
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
  await sendWA(data.customerPhone, msg);
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
  await sendWA(data.customerPhone, msg);
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
