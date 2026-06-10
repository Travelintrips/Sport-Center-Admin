import { db, notificationTemplatesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const DEFAULT_TEMPLATES = [
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
