import { db, notificationTemplatesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const DEFAULT_TEMPLATES = [
  {
    key: "booking_created",
    name: "Booking Berhasil Dibuat (Customer)",
    channel: "whatsapp",
    body: "✅ *Booking Berhasil Dibuat!*\n\nHalo *{{customerName}}*,\nBooking *{{facilityName}}* kamu sudah kami terima.\n\n📋 *Detail Booking:*\n• No. Order: *{{orderNumber}}*\n• Tanggal: *{{bookingDate}}*\n• Jam: *{{startTime}} – {{endTime}}*\n• Total: *Rp {{totalPrice}}*\n\n💳 *Pembayaran via Transfer Bank:*\nBank: *{{bankName}}*\nRekening: *{{bankAccount}}*\nAtas Nama: *{{bankAccountName}}*\n\n⏰ Batas pembayaran: *{{paymentDeadline}}*\n\nSetelah transfer, segera upload bukti pembayaran di halaman booking kamu.\n\nTerima kasih! 🏆",
    isActive: true,
  },
  {
    key: "admin_new_booking",
    name: "Booking Baru (Notif Admin)",
    channel: "whatsapp",
    body: "🏅 *BOOKING BARU — {{orderNumber}}*\n\nCustomer: *{{customerName}}*\nWA: *{{customerPhone}}*\nFasilitas: *{{facilityName}}*\nTanggal: *{{bookingDate}}*\nJam: *{{startTime}} – {{endTime}}*\nTotal: *Rp {{totalPrice}}*\nBatas bayar: {{paymentDeadline}}",
    isActive: true,
  },
  {
    key: "payment_confirmed",
    name: "Pembayaran Dikonfirmasi (Customer)",
    channel: "whatsapp",
    body: "🎉 *Pembayaran Dikonfirmasi!*\n\nHalo *{{customerName}}*,\nPembayaran booking *{{orderNumber}}* untuk *{{facilityName}}* sudah kami verifikasi dan booking *DIKONFIRMASI* ✅\n\n📋 *Detail:*\n• Tanggal: *{{bookingDate}}*\n• Jam: *{{startTime}} – {{endTime}}*\n\nSampai jumpa di lapangan! 🏆",
    isActive: true,
  },
  {
    key: "booking_cancelled",
    name: "Booking Dibatalkan (Customer)",
    channel: "whatsapp",
    body: "❌ *Booking Dibatalkan*\n\nHalo *{{customerName}}*,\nBooking *{{orderNumber}}* untuk *{{facilityName}}* pada *{{bookingDate}}* telah dibatalkan.{{reason}}\n\nJika ada pertanyaan, silakan hubungi admin kami.",
    isActive: true,
  },
  {
    key: "reschedule_approved",
    name: "Reschedule Disetujui (Customer)",
    channel: "whatsapp",
    body: "Halo {{customerName}}, permintaan reschedule booking *{{orderNumber}}* untuk {{facilityName}} telah *DISETUJUI* ✅.\n\nJadwal baru: *{{newDate}}* pukul *{{newStartTime}}–{{newEndTime}}*.\n\nSampai jumpa di lapangan! 🏆",
    isActive: true,
  },
  {
    key: "reschedule_rejected",
    name: "Reschedule Ditolak (Customer)",
    channel: "whatsapp",
    body: "Halo {{customerName}}, permintaan reschedule booking *{{orderNumber}}* untuk {{facilityName}} *DITOLAK* ❌.{{reviewNote}}\n\nSilakan hubungi admin jika ada pertanyaan.",
    isActive: true,
  },
];

export async function ensureDefaultTemplates(): Promise<void> {
  try {
    for (const tpl of DEFAULT_TEMPLATES) {
      await db
        .insert(notificationTemplatesTable)
        .values(tpl)
        .onConflictDoNothing({ target: notificationTemplatesTable.key });
    }
  } catch {
    // Non-critical
  }
}
