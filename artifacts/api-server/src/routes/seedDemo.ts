import { Router } from "express";
import { db } from "@workspace/db";
import {
  facilitiesTable,
  bookingsTable,
  paymentsTable,
  bookingReviewsTable,
  promoRegistrationsTable,
  promosTable,
  usersTable,
} from "@workspace/db";
import { adminMiddleware } from "../lib/auth";
import { sql } from "drizzle-orm";
import { resolveRequiredPaymentEnrichment } from "../lib/paymentEnrichment";

const router = Router();

function addDays(base: Date, n: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
}

function orderNum(n: number) {
  return `SC-DEMO${String(n).padStart(4, "0")}`;
}

router.post("/admin/seed-demo", adminMiddleware, async (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Tidak tersedia di production" });
    return;
  }

  try {
    // ── 1. Hapus semua data transaksi dulu ──────────────────────────
    const tablesToClear = [
      "promo_registrations", "booking_reviews", "payments",
      "wa_action_tokens", "wa_booking_sessions",
      "booking_cancellations", "booking_extension_requests",
      "reschedule_requests", "booking_history", "booking_groups",
      "bookings", "gym_memberships", "audit_logs",
      "tax_transactions", "bank_mutations", "bank_journal_entries",
      "bank_reconciliation_matches", "bank_reconciliation_closing",
      "bank_account_balances", "bank_reconciliation_account_rules",
      "accounting_journals", "tenant_payments", "tenant_bookings",
      "company_invoice_items", "company_invoices",
      "company_verification_tokens", "company_verifications",
      "verification_logs", "admin_notes", "maintenance_schedules",
    ];
    const tableList = tablesToClear.map((t) => `sport_center."${t}"`).join(", ");
    await db.execute(sql.raw(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`));

    // ── 2. Ambil fasilitas yang aktif ───────────────────────────────
    const facilities = await db
      .select({ id: facilitiesTable.id, name: facilitiesTable.name, pricePerHour: facilitiesTable.pricePerHour })
      .from(facilitiesTable)
      .limit(10);

    if (facilities.length === 0) {
      res.status(400).json({ error: "Tidak ada fasilitas aktif. Seed fasilitas dulu." });
      return;
    }

    const today = new Date();

    // Definisi demo pelanggan
    const customers = [
      { name: "Budi Santoso",    email: "budi@example.com",    phone: "081234567890" },
      { name: "Siti Rahayu",     email: "siti@example.com",    phone: "082345678901" },
      { name: "Ahmad Fauzi",     email: "ahmad@example.com",   phone: "083456789012" },
      { name: "Dewi Kusuma",     email: "dewi@example.com",    phone: "084567890123" },
      { name: "Rizky Pratama",   email: "rizky@example.com",   phone: "085678901234" },
      { name: "Linda Wijaya",    email: "linda@example.com",   phone: "086789012345" },
      { name: "Hendra Gunawan",  email: "hendra@example.com",  phone: "087890123456" },
      { name: "Maya Sari",       email: "maya@example.com",    phone: "088901234567" },
      { name: "Doni Firmansyah", email: "doni@example.com",    phone: "089012345678" },
      { name: "Rina Oktavia",    email: "rina@example.com",    phone: "081122334455" },
    ];

    function pick<T>(arr: T[]): T {
      return arr[Math.floor(Math.random() * arr.length)];
    }
    function fac(i: number) {
      return facilities[i % facilities.length];
    }

    // ── 3. Seed bookings ────────────────────────────────────────────
    type BookingStatus =
      | "confirmed" | "pending_payment" | "waiting_confirmation"
      | "completed" | "cancelled" | "expired" | "paid" | "rejected";

    interface BookingDef {
      dayOffset: number;
      startHour: number;
      duration: number;
      customerIdx: number;
      facilityIdx: number;
      status: BookingStatus;
      notes?: string;
    }

    const defs: BookingDef[] = [
      { dayOffset: -10, startHour:  8, duration: 2, customerIdx: 0, facilityIdx: 0, status: "completed" },
      { dayOffset:  -9, startHour: 10, duration: 1, customerIdx: 1, facilityIdx: 1, status: "completed" },
      { dayOffset:  -8, startHour: 14, duration: 2, customerIdx: 2, facilityIdx: 2, status: "completed" },
      { dayOffset:  -7, startHour:  9, duration: 3, customerIdx: 3, facilityIdx: 3, status: "completed" },
      { dayOffset:  -6, startHour: 16, duration: 1, customerIdx: 4, facilityIdx: 0, status: "cancelled",  notes: "Pelanggan membatalkan" },
      { dayOffset:  -5, startHour:  7, duration: 2, customerIdx: 5, facilityIdx: 1, status: "completed" },
      { dayOffset:  -4, startHour: 11, duration: 1, customerIdx: 6, facilityIdx: 2, status: "confirmed" },
      { dayOffset:  -3, startHour: 15, duration: 2, customerIdx: 7, facilityIdx: 3, status: "confirmed" },
      { dayOffset:  -2, startHour:  8, duration: 1, customerIdx: 8, facilityIdx: 0, status: "completed" },
      { dayOffset:  -1, startHour: 10, duration: 2, customerIdx: 9, facilityIdx: 1, status: "waiting_confirmation" },
      { dayOffset:   0, startHour:  9, duration: 1, customerIdx: 0, facilityIdx: 2, status: "confirmed" },
      { dayOffset:   0, startHour: 14, duration: 2, customerIdx: 1, facilityIdx: 3, status: "pending_payment" },
      { dayOffset:   1, startHour: 10, duration: 1, customerIdx: 2, facilityIdx: 0, status: "confirmed" },
      { dayOffset:   1, startHour: 16, duration: 2, customerIdx: 3, facilityIdx: 1, status: "pending_payment" },
      { dayOffset:   2, startHour:  8, duration: 3, customerIdx: 4, facilityIdx: 2, status: "confirmed" },
      { dayOffset:   3, startHour: 11, duration: 1, customerIdx: 5, facilityIdx: 3, status: "pending_payment" },
      { dayOffset:   4, startHour:  9, duration: 2, customerIdx: 6, facilityIdx: 0, status: "pending_payment" },
      { dayOffset:  -7, startHour: 13, duration: 1, customerIdx: 7, facilityIdx: 1, status: "expired" },
      { dayOffset:  -6, startHour: 17, duration: 2, customerIdx: 8, facilityIdx: 2, status: "rejected",   notes: "Slot tidak tersedia" },
      { dayOffset:   5, startHour: 10, duration: 1, customerIdx: 9, facilityIdx: 3, status: "confirmed" },
    ];

    const insertedBookings: Array<{ id: number; status: BookingStatus; totalPrice: string; facilityId: number; customerName: string }> = [];

    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const f = fac(d.facilityIdx);
      const c = customers[d.customerIdx];
      const bookingDate = addDays(today, d.dayOffset);
      const sh = d.startHour;
      const eh = sh + d.duration;
      const startTime = `${String(sh).padStart(2, "0")}:00`;
      const endTime   = `${String(eh).padStart(2, "0")}:00`;
      const totalPrice = (Number(f.pricePerHour) * d.duration).toFixed(2);

      const deadline = new Date(today);
      deadline.setDate(deadline.getDate() + d.dayOffset);
      deadline.setHours(deadline.getHours() + 24);

      const [b] = await db.insert(bookingsTable).values({
        orderNumber: orderNum(i + 1),
        customerName: c.name,
        customerEmail: c.email,
        customerPhone: c.phone,
        facilityId: f.id,
        bookingDate,
        startTime,
        endTime,
        durationHours: d.duration,
        totalPrice,
        discountAmount: "0",
        status: d.status,
        notes: d.notes ?? null,
        paymentDeadline: deadline,
        source: "demo",
      }).returning({ id: bookingsTable.id, status: bookingsTable.status, totalPrice: bookingsTable.totalPrice });

      insertedBookings.push({ id: b.id, status: d.status as BookingStatus, totalPrice, facilityId: f.id, customerName: c.name });
    }

    // ── 4. Seed payments untuk booking yang sudah dibayar ───────────
    const paidStatuses: BookingStatus[] = ["confirmed", "completed", "waiting_confirmation", "paid"];
    let paymentCount = 0;
    for (const b of insertedBookings) {
      if (paidStatuses.includes(b.status)) {
        const [booking] = await db.select().from(bookingsTable)
          .where(eq(bookingsTable.id, b.id)).limit(1);
        if (!booking) throw new Error(`Demo booking ${b.id} not found`);
        const paymentEnrichment = await resolveRequiredPaymentEnrichment(booking, "unknown", new Date());
        await db.insert(paymentsTable).values({
          bookingId: b.id,
          amount: b.totalPrice,
          paymentMethod: pick(["Transfer Bank", "Transfer Bank", "Transfer Bank", "QRIS"]),
          companyId: paymentEnrichment.companyId,
          bankAccountId: paymentEnrichment.bankAccountId,
          expectedSettlementDate: paymentEnrichment.expectedSettlementDate,
          paidAt: paymentEnrichment.paidAt,
          status: b.status === "waiting_confirmation" ? "pending" : "confirmed",
          confirmedAt: b.status !== "waiting_confirmation" ? new Date() : null,
        });
        paymentCount++;
      }
    }

    // ── 5. Seed reviews untuk booking completed ─────────────────────
    const reviewTexts = [
      "Fasilitas sangat bagus, bersih, dan terawat. Pasti balik lagi!",
      "Lapangan dalam kondisi prima, petugasnya ramah. Rekomen!",
      "Harga terjangkau, fasilitas memuaskan. Cocok untuk latihan rutin.",
      "Pengalaman booking sangat mudah. Fasilitasnya top!",
      "Tempatnya nyaman, AC dingin, lantai bersih. Mantap!",
    ];
    let reviewCount = 0;
    const completedBookings = insertedBookings.filter(b => b.status === "completed");
    for (let i = 0; i < completedBookings.length; i++) {
      if (Math.random() > 0.3) {
        await db.insert(bookingReviewsTable).values({
          bookingId: completedBookings[i].id,
          facilityId: completedBookings[i].facilityId,
          reviewerName: completedBookings[i].customerName,
          rating: pick([4, 4, 5, 5, 5]),
          comment: reviewTexts[i % reviewTexts.length],
        });
        reviewCount++;
      }
    }

    // ── 6. Seed promo registrations ─────────────────────────────────
    let promoRegCount = 0;
    try {
      const promos = await db.select({ id: promosTable.id }).from(promosTable).limit(3);
      if (promos.length > 0) {
        for (let i = 0; i < Math.min(5, customers.length); i++) {
          const c = customers[i];
          const p = promos[i % promos.length];
          await db.insert(promoRegistrationsTable).values({
            promoId: p.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
          }).onConflictDoNothing();
          promoRegCount++;
        }
      }
    } catch (_) {}

    res.json({
      success: true,
      message: "Data demo berhasil di-seed!",
      summary: {
        bookings: insertedBookings.length,
        payments: paymentCount,
        reviews: reviewCount,
        promoRegistrations: promoRegCount,
      },
    });
  } catch (err: any) {
    console.error("Seed demo error:", err);
    res.status(500).json({ error: err.message ?? "Terjadi kesalahan" });
  }
});

export default router;
