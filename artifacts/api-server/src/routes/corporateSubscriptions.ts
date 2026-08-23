import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import {
  db, usersTable, facilitiesTable, bookingsTable, bookingHistoryTable,
  corporateSubscriptionsTable, corporateOccurrencesTable, usageProofsTable,
} from "@workspace/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { getUserFromReq, logAudit } from "../lib/auditLog";
import { uploadToStorage, BUCKETS } from "../lib/supabaseStorage";
import { timeToMinutes } from "../lib/availability";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function datesForDay(start: string, end: string, dayOfWeek: number): string[] {
  const first = parseDate(start);
  const last = parseDate(end);
  if (!first || !last || first > last) return [];
  const result: string[] = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (cursor.getUTCDay() === dayOfWeek) result.push(dateString(cursor));
  }
  return result;
}

router.post("/corporate-subscriptions", adminMiddleware, async (req, res) => {
  try {
    const {
      companyId, facilityId, dayOfWeek, startTime, endTime, effectiveStartDate,
      billingPeriod = "monthly", pricePerHour, customerName, customerPhone,
    } = req.body ?? {};
    const company = Number(companyId);
    const facility = Number(facilityId);
    const day = Number(dayOfWeek);
    if (!company || !facility || !Number.isInteger(day) || day < 0 || day > 6 ||
        !effectiveStartDate || !startTime || !endTime || timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      res.status(400).json({ error: "companyId, facilityId, dayOf_week, schedule, effectiveStartDate wajib valid" });
      return;
    }
    const [companyRow] = await db.select({ id: usersTable.id, name: usersTable.name, companyName: usersTable.companyName })
      .from(usersTable).where(and(eq(usersTable.id, company), eq(usersTable.accountType, "company"))).limit(1);
    if (!companyRow) { res.status(404).json({ error: "Perusahaan tidak ditemukan" }); return; }
    const [facilityRow] = await db.select({ id: facilitiesTable.id }).from(facilitiesTable)
      .where(and(eq(facilitiesTable.id, facility), eq(facilitiesTable.isActive, true))).limit(1);
    if (!facilityRow) { res.status(404).json({ error: "Fasilitas tidak ditemukan" }); return; }
    const actor = getUserFromReq(req);
    const [subscription] = await db.insert(corporateSubscriptionsTable).values({
      companyId: company, facilityId: facility, dayOfWeek: day, startTime, endTime,
      effectiveStartDate, billingPeriod, createdBy: actor.userId ?? null,
    }).returning();
    await logAudit({ ...actor, action: "CORPORATE_SUBSCRIPTION_CREATED", entity: "corporate_subscription", entityId: subscription.id, after: subscription });
    res.status(201).json(subscription);
  } catch (err) {
    req.log.error({ err }, "Create corporate subscription error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/corporate-subscriptions", adminMiddleware, async (_req, res) => {
  const rows = await db.select().from(corporateSubscriptionsTable);
  res.json(rows);
});

router.get("/corporate-subscriptions/:id/occurrences", adminMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(corporateOccurrencesTable)
    .where(eq(corporateOccurrencesTable.subscriptionId, id));
  res.json(rows);
});

router.post("/corporate-subscriptions/:id/generate", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const from = String(req.body?.from ?? "");
    const to = String(req.body?.to ?? from);
    const [subscription] = await db.select().from(corporateSubscriptionsTable)
      .where(eq(corporateSubscriptionsTable.id, id)).limit(1);
    if (!subscription) { res.status(404).json({ error: "Subscription tidak ditemukan" }); return; }
    if (subscription.status === "stopped" || subscription.status === "stop_requested") {
      res.status(409).json({ error: "Subscription sudah dihentikan dan tidak dapat membuat occurrence baru" });
      return;
    }
    const start = from || subscription.effectiveStartDate;
    const dates = datesForDay(start, to, subscription.dayOfWeek);
    const actor = getUserFromReq(req);
    let created = 0;
    for (const occurrenceDate of dates) {
      const result = await db.transaction(async (tx) => {
        const [occurrence] = await tx.insert(corporateOccurrencesTable).values({
          subscriptionId: id, occurrenceDate,
        }).onConflictDoNothing().returning();
        if (!occurrence) return false;
        const [company] = await tx.select({ name: usersTable.name, companyName: usersTable.companyName })
          .from(usersTable).where(eq(usersTable.id, subscription.companyId)).limit(1);
        const durationHours = (timeToMinutes(subscription.endTime) - timeToMinutes(subscription.startTime)) / 60;
        const totalPrice = Number(req.body?.pricePerHour ?? 0) * durationHours;
        const [booking] = await tx.insert(bookingsTable).values({
          orderNumber: `CORP-${subscription.id}-${occurrenceDate.replaceAll("-", "")}`,
          customerName: String(req.body?.customerName ?? company?.companyName ?? company?.name ?? "Corporate"),
          customerEmail: String(req.body?.customerEmail ?? "corporate@local"),
          customerPhone: String(req.body?.customerPhone ?? "-"),
          facilityId: subscription.facilityId, bookingDate: occurrenceDate,
          startTime: subscription.startTime, endTime: subscription.endTime, durationHours,
          totalPrice: String(totalPrice), basePrice: String(totalPrice), status: "confirmed",
          payerType: "company", companyCustomerId: subscription.companyId,
          paymentRequiredNow: false, billingStatus: "unbilled", bookingType: "regular",
          subscriptionId: id, occurrenceId: occurrence.id, bookedForName: req.body?.customerName ?? null,
        }).returning({ id: bookingsTable.id });
        await tx.update(corporateOccurrencesTable).set({ bookingId: booking.id, status: "scheduled" })
          .where(eq(corporateOccurrencesTable.id, occurrence.id));
        return true;
      });
      if (result) created++;
    }
    await logAudit({ ...actor, action: "CORPORATE_OCCURRENCES_GENERATED", entity: "corporate_subscription", entityId: id, after: { from: start, to, created } });
    res.json({ subscriptionId: id, generated: created, requested: dates.length });
  } catch (err) {
    req.log.error({ err }, "Generate corporate occurrences error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/corporate-subscriptions/:id/stop", adminMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const actor = getUserFromReq(req);
  const [updated] = await db.update(corporateSubscriptionsTable).set({
    status: "stopped", stoppedAt: new Date(), stoppedBy: actor.userId ?? null,
    stopReason: req.body?.reason ?? null, updatedAt: new Date(),
  }).where(and(eq(corporateSubscriptionsTable.id, id), eq(corporateSubscriptionsTable.status, "active"))).returning();
  if (!updated) { res.status(404).json({ error: "Subscription tidak ditemukan atau sudah dihentikan" }); return; }
  await logAudit({ ...actor, action: "CORPORATE_SUBSCRIPTION_STOPPED", entity: "corporate_subscription", entityId: id, after: updated });
  res.json(updated);
});

router.post("/events", adminMiddleware, async (req, res) => {
  try {
    const {
      facilityId, bookingDate, startTime, endTime, customerName, customerEmail,
      customerPhone, totalPrice, payerType = "personal", companyCustomerId,
      numberOfPeople, notes,
    } = req.body ?? {};
    const durationHours = (timeToMinutes(String(endTime)) - timeToMinutes(String(startTime))) / 60;
    if (!facilityId || !bookingDate || !startTime || !endTime || !customerName ||
        !Number.isInteger(durationHours) || durationHours < 1 || Number(totalPrice) < 0) {
      res.status(400).json({ error: "facility, tanggal, waktu, customer, durasi, dan totalPrice wajib valid" });
      return;
    }
    const [facility] = await db.select({ id: facilitiesTable.id }).from(facilitiesTable)
      .where(and(eq(facilitiesTable.id, Number(facilityId)), eq(facilitiesTable.isActive, true))).limit(1);
    if (!facility) { res.status(404).json({ error: "Fasilitas tidak ditemukan" }); return; }
    const orderNumber = `EVENT-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const actor = getUserFromReq(req);
    const [event] = await db.insert(bookingsTable).values({
      orderNumber, customerName, customerEmail: customerEmail ?? "-", customerPhone: customerPhone ?? "-",
      facilityId: Number(facilityId), bookingDate, startTime, endTime, durationHours,
      totalPrice: String(totalPrice), basePrice: String(totalPrice), bookingType: "event",
      payerType: payerType === "company" ? "company" : "personal",
      companyCustomerId: payerType === "company" ? Number(companyCustomerId) : null,
      paymentRequiredNow: payerType !== "company", billingStatus: payerType === "company" ? "unbilled" : null,
      numberOfPeople: numberOfPeople ? Number(numberOfPeople) : null, notes: notes ?? null,
      status: payerType === "company" ? "confirmed" : "pending_payment",
    }).returning();
    await logAudit({ ...actor, action: "EVENT_CREATED", entity: "booking", entityId: event.id, after: { bookingType: "event", bookingDate, startTime, endTime } });
    res.status(201).json(event);
  } catch (err) {
    req.log.error({ err }, "Create event error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/events", adminMiddleware, async (req, res) => {
  const rows = await db.select().from(bookingsTable).where(eq(bookingsTable.bookingType, "event"));
  res.json(rows);
});

router.post("/bookings/:id/usage-proof", adminMiddleware, upload.single("photo"), async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    if (!req.file) { res.status(400).json({ error: "photo wajib diupload" }); return; }
    const path = `usage-proofs/${bookingId}/${randomUUID()}.jpg`;
    const photoUrl = await uploadToStorage(BUCKETS.proof, path, req.file.buffer, req.file.mimetype);
    const actor = getUserFromReq(req);
    const [proof] = await db.insert(usageProofsTable).values({
      bookingId, storagePath: path, photoUrl, uploadedBy: actor.userId ?? null,
    }).returning();
    res.status(201).json(proof);
  } catch (err) {
    req.log.error({ err }, "Upload usage proof error");
    res.status(500).json({ error: "Upload proof gagal" });
  }
});

export default router;