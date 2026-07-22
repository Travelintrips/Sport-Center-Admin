/**
 * Script sekali jalan — cek & pulihkan booking yang di-expire terlalu cepat di PRODUCTION.
 * Jalankan dengan: NODE_ENV=production scripts/node_modules/.bin/tsx scripts/recover_expired_bookings_prod.ts
 */

import { db } from "../lib/db/src/index.js";
import { bookingsTable } from "../lib/db/src/schema/bookings.js";
import { eq, and, sql, gte } from "drizzle-orm";

const now = new Date();

console.log(`[recovery-prod] DB source akan muncul di bawah...`);
console.log(`[recovery-prod] Referensi waktu: ${now.toISOString()}`);

// Cari semua booking expired yang booking_date + 7 hari >= sekarang
const candidates = await db
  .select({
    id: bookingsTable.id,
    orderNumber: bookingsTable.orderNumber,
    bookingDate: bookingsTable.bookingDate,
    customerName: bookingsTable.customerName,
    groupRef: bookingsTable.groupRef,
  })
  .from(bookingsTable)
  .where(
    and(
      eq(bookingsTable.status, "expired"),
      gte(sql`(${bookingsTable.bookingDate}::date + interval '7 days')`, now)
    )
  );

if (!candidates.length) {
  console.log("[recovery-prod] ✅ Tidak ada booking yang perlu dipulihkan di production.");
  process.exit(0);
}

console.log(`[recovery-prod] Ditemukan ${candidates.length} booking yang akan dipulihkan:`);
for (const b of candidates) {
  console.log(`  - ${b.orderNumber} | ${b.customerName} | tanggal main: ${b.bookingDate}${b.groupRef ? ` | grup: ${b.groupRef}` : ""}`);
}

const updated = await db
  .update(bookingsTable)
  .set({ status: "pending_payment", updatedAt: new Date() })
  .where(
    and(
      eq(bookingsTable.status, "expired"),
      gte(sql`(${bookingsTable.bookingDate}::date + interval '7 days')`, now)
    )
  )
  .returning({ id: bookingsTable.id, orderNumber: bookingsTable.orderNumber });

console.log(`[recovery-prod] ✅ ${updated.length} booking berhasil dipulihkan ke pending_payment.`);
process.exit(0);
