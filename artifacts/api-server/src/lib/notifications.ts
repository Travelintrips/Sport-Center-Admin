import { db, notificationTemplatesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
const FONNTE_ADMIN_WA = process.env.FONNTE_ADMIN_WA || "";

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
  if (adminTpl && FONNTE_ADMIN_WA) await sendWA(FONNTE_ADMIN_WA, interpolate(adminTpl, vars));
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
  if (adminTpl && FONNTE_ADMIN_WA) await sendWA(FONNTE_ADMIN_WA, interpolate(adminTpl, data as Record<string, string>));
}

export async function notifyPaymentProofUploaded(data: BookingNotifData): Promise<void> {
  const tpl = await getTemplate("admin_payment_proof");
  if (tpl && FONNTE_ADMIN_WA) await sendWA(FONNTE_ADMIN_WA, interpolate(tpl, data as Record<string, string>));
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
