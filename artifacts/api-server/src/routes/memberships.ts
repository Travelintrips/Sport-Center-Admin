import { Router, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  db,
  usersTable,
  gymMembershipsTable,
  membershipPaymentsTable,
  publicMembershipsTable,
  gymCheckinsTable,
  bookingsTable,
  bookingHistoryTable,
  facilitiesTable,
} from "@workspace/db";
import { eq, and, ilike, desc, inArray, or, sql } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import {
  syncMembershipToBizportal,
  syncBookingToBizportal,
  pushMembershipPaymentAsBankMutation,
} from "../lib/bizportalSync";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";
import { notifyMembershipPaymentProofUploaded } from "../lib/notifications";
import { getBaseUrl } from "../lib/appUrl";
import { generateBookingOrderNumber } from "../lib/orderNumber";
import { downloadFromStorageUrl } from "../lib/supabaseStorage";
import { uploadFile, BUCKETS } from "../lib/storage";
import { isWithinGymGracePeriod, resolveGymRenewalStart } from "../services/gymMembershipEntitlement";
import { x904PaymentConfirmedEventKey } from "../services/x904AutomationDecision";

const router = Router();

const PRICE_PER_MONTH = 300000;

const MEMBERSHIP_PROOF_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

const membershipProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

class MembershipProofError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function jakartaDateOnly(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizePaymentDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  const paymentDate = raw || jakartaDateOnly();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new MembershipProofError(400, "Tanggal pembayaran harus berformat YYYY-MM-DD");
  }
  const parsed = new Date(paymentDate + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== paymentDate) {
    throw new MembershipProofError(400, "Tanggal pembayaran tidak valid");
  }
  if (paymentDate > jakartaDateOnly()) {
    throw new MembershipProofError(400, "Tanggal pembayaran tidak boleh di masa depan");
  }
  return paymentDate;
}

function paymentDateToInstant(paymentDate: string | null | undefined, fallback: Date): Date {
  if (!paymentDate) return fallback;
  return new Date(paymentDate + "T12:00:00+07:00");
}

function membershipProofSecret(): string {
  const secret = String(process.env.SESSION_SECRET ?? "").trim();
  if (!secret) throw new Error("SESSION_SECRET is required for membership proof uploads");
  return secret;
}

function createMembershipProofToken(membershipId: number, paymentId: number): string {
  const expiresAt = Date.now() + MEMBERSHIP_PROOF_TOKEN_TTL_MS;
  const payload = `${membershipId}:${paymentId}:${expiresAt}`;
  const signature = createHmac("sha256", membershipProofSecret()).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ m: membershipId, p: paymentId, e: expiresAt, s: signature }))
    .toString("base64url");
}

function verifyMembershipProofToken(
  token: string,
  membershipId: number,
): { paymentId: number } | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      m?: unknown;
      p?: unknown;
      e?: unknown;
      s?: unknown;
    };
    const tokenMembershipId = Number(decoded.m);
    const paymentId = Number(decoded.p);
    const expiresAt = Number(decoded.e);
    const signature = String(decoded.s ?? "");
    if (
      !Number.isInteger(tokenMembershipId) ||
      tokenMembershipId !== membershipId ||
      !Number.isInteger(paymentId) ||
      paymentId <= 0 ||
      !Number.isFinite(expiresAt) ||
      expiresAt < Date.now() ||
      !/^[a-f0-9]{64}$/i.test(signature)
    ) return null;

    const payload = `${tokenMembershipId}:${paymentId}:${expiresAt}`;
    const expected = createHmac("sha256", membershipProofSecret()).update(payload).digest("hex");
    const actualBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) return null;

    return { paymentId };
  } catch {
    return null;
  }
}

async function applyMembershipPaymentProof(
  id: number,
  paymentId: number,
  paymentMethod: string,
  paymentProofUrl: string,
  paymentDateInput?: unknown,
  reqLog?: { error: (obj: unknown, msg?: string) => void },
  notifyAdminGroup = true,
) {
  if (!["qris", "transfer"].includes(paymentMethod)) {
    throw new MembershipProofError(400, "Metode pembayaran tidak valid");
  }
  if (!paymentProofUrl) {
    throw new MembershipProofError(400, "Bukti pembayaran wajib diisi");
  }

  const [existing] = await db
    .select()
    .from(gymMembershipsTable)
    .where(eq(gymMembershipsTable.id, id))
    .limit(1);
  if (!existing) throw new MembershipProofError(404, "Membership tidak ditemukan");
  const [pendingPayment] = await db
    .select()
    .from(membershipPaymentsTable)
    .where(
      and(
        eq(membershipPaymentsTable.id, paymentId),
        eq(membershipPaymentsTable.membershipId, id),
        eq(membershipPaymentsTable.status, "pending_payment"),
      ),
    )
    .limit(1);
  if (!pendingPayment) {
    throw new MembershipProofError(409, "Sesi pembayaran membership sudah tidak aktif");
  }

  const paymentDate = normalizePaymentDate(paymentDateInput);
  const submittedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(membershipPaymentsTable)
      .set({
        paymentMethod,
        paymentProofUrl,
        paymentDate,
        status: "waiting_confirmation",
        submittedAt,
        updatedAt: submittedAt,
      })
      .where(eq(membershipPaymentsTable.id, paymentId));
  });

  const [membership] = await db
    .select()
    .from(gymMembershipsTable)
    .where(eq(gymMembershipsTable.id, id))
    .limit(1);
  if (!membership) throw new MembershipProofError(404, "Membership tidak ditemukan");

  const paymentBooking = await ensureMembershipPaymentBooking(membership, {
    ...pendingPayment,
    paymentMethod,
    paymentProofUrl,
    paymentDate,
    status: "waiting_confirmation",
    submittedAt,
    updatedAt: submittedAt,
  });
  syncMembershipToBizportal(membership).catch(() => {});
  syncBookingRecordToBizportal(paymentBooking).catch((err) =>
    reqLog?.error({ err }, "[membership] Gagal sync booking payment proof ke Bizportal"),
  );
  await syncToPublic(membership);

  if (notifyAdminGroup) {
    const appUrl = await getBaseUrl();
    notifyMembershipPaymentProofUploaded({
      membershipId: membership.id,
      customerName: membership.name,
      startDate: membership.startDate,
      endDate: membership.endDate,
      totalPrice: Number(membership.totalPrice).toLocaleString("id-ID"),
      reviewUrl: appUrl ? `${appUrl}/admin/memberships` : undefined,
    }).catch((err) =>
      reqLog?.error({ err }, "[WA] notifyMembershipPaymentProofUploaded error"),
    );
  }

  return membership;
}

type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;

function addHours(time: string, hours: number): string {
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = hour * 60 + (minute || 0) + hours * 60;
  const endHour = Math.floor(totalMinutes / 60) % 24;
  const endMinute = totalMinutes % 60;
  return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
}

function membershipBookingStatus(
  paymentStatus: string,
): "pending_payment" | "waiting_confirmation" | "confirmed" | "cancelled" {
  if (paymentStatus === "waiting_confirmation") return "waiting_confirmation";
  if (paymentStatus === "confirmed") return "confirmed";
  if (paymentStatus === "cancelled") return "cancelled";
  return "pending_payment";
}

function membershipTaxBreakdown(amount: number) {
  // Gym memberships are personal transactions: no PPN/PPH is collected.
  return { dpp: amount, ppnAmount: 0 };
}

async function getGymFacility(executor: DbExecutor = db) {
  const [gymFacility] = await executor.select().from(facilitiesTable)
    .where(or(
      eq(facilitiesTable.bookingMode, "walk_in"),
      ilike(facilitiesTable.name, "%gym%"),
      ilike(facilitiesTable.name, "%fitness%"),
      ilike(facilitiesTable.category, "%gym%"),
      ilike(facilitiesTable.category, "%fitness%"),
    ))
    .limit(1);
  return gymFacility;
}

async function syncBookingRecordToBizportal(booking: typeof bookingsTable.$inferSelect) {
  const [facility] = await db
    .select({ name: facilitiesTable.name, category: facilitiesTable.category })
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId))
    .limit(1);
  if (!facility) return;
  await syncBookingToBizportal({
    booking,
    facilityName: facility.name,
    facilityCategory: facility.category,
  });
}

/**
 * Membership payment and gym usage are deliberately two different booking
 * sources:
 * - gym_membership_payment: one financial booking per registration/renewal
 * - gym_membership: one zero-value booking per daily check-in
 *
 * The payment booking is the order candidate used by Bizportal
 * reconciliation. It never creates a second membership payment.
 */
async function ensureMembershipPaymentBooking(
  membership: typeof gymMembershipsTable.$inferSelect,
  payment: typeof membershipPaymentsTable.$inferSelect,
  executor: DbExecutor = db,
  allocatedOrderNumber?: string,
) {
  const [existing] = await executor
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.membershipPaymentId, payment.id))
    .limit(1);

  const gymFacility = existing ? undefined : await getGymFacility(executor);
  if (!existing && !gymFacility) {
    throw new Error("Fasilitas Gym belum tersedia");
  }

  const amount = Math.round(Number(payment.amount));
  const { dpp, ppnAmount } = membershipTaxBreakdown(amount);
  const status = membershipBookingStatus(payment.status);
  const isConfirmed = status === "confirmed";
  const values = {
    customerName: membership.name,
    customerEmail: membership.email,
    customerPhone: membership.phone,
    bookingDate: payment.periodStart,
    startTime: gymFacility?.openTime ?? "00:00",
    endTime: gymFacility ? addHours(gymFacility.openTime, 1) : "01:00",
    durationHours: 1,
    totalPrice: String(amount),
    basePrice: String(amount),
    discountAmount: "0",
    apDiscountAmount: "0",
    grandTotal: String(amount),
    dpp: String(dpp),
    ppnRate: "0",
    ppnAmount: String(ppnAmount),
    status,
    paymentRequiredNow: !isConfirmed,
    billingStatus: isConfirmed ? "paid" as const : "unbilled" as const,
    paymentDeadline: null,
    paymentReminderSentAt: null,
    source: "gym_membership_payment",
    membershipId: membership.id,
    membershipPaymentId: payment.id,
    paidAt: isConfirmed ? paymentDateToInstant(payment.paymentDate, payment.confirmedAt ?? new Date()) : null,
    notes: `Pembayaran membership gym #${membership.id} | Payment #${payment.id} | Periode ${payment.periodStart} s/d ${payment.periodEnd}`,
    updatedAt: new Date(),
  };

  if (existing) {
    const [updated] = await executor
      .update(bookingsTable)
      .set(values)
      .where(eq(bookingsTable.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const orderNumber = allocatedOrderNumber ?? await generateBookingOrderNumber();
  const [created] = await executor
    .insert(bookingsTable)
    .values({
      orderNumber,
      customerId: null,
      customerName: values.customerName,
      customerEmail: values.customerEmail,
      customerPhone: values.customerPhone,
      facilityId: gymFacility!.id,
      bookingDate: values.bookingDate,
      startTime: values.startTime,
      endTime: values.endTime,
      durationHours: values.durationHours,
      totalPrice: values.totalPrice,
      discountAmount: values.discountAmount,
      customerType: "umum",
      verificationStatus: "not_required",
      basePrice: values.basePrice,
      apDiscountAmount: values.apDiscountAmount,
      bookingType: "regular",
      membershipId: values.membershipId,
      membershipPaymentId: values.membershipPaymentId,
      status: values.status,
      source: values.source,
      numberOfPeople: 1,
      notes: values.notes,
      paymentRequiredNow: values.paymentRequiredNow,
      payerType: "personal",
      billingStatus: values.billingStatus,
      dpp: values.dpp,
      ppnRate: values.ppnRate,
      ppnAmount: values.ppnAmount,
      grandTotal: values.grandTotal,
      paidAt: values.paidAt,
    })
    .returning();

  if (!created) throw new Error("Gagal membuat booking pembayaran membership");

  await executor.insert(bookingHistoryTable).values({
    bookingId: created.id,
    fromStatus: null,
    toStatus: status,
    changedByName: membership.name,
    note: `Booking pembayaran membership dibuat dari payment #${payment.id}`,
  });
  return created;
}

async function syncMembershipPaymentBookings(membership: typeof gymMembershipsTable.$inferSelect) {
  const payments = await db
    .select()
    .from(membershipPaymentsTable)
    .where(eq(membershipPaymentsTable.membershipId, membership.id));

  for (const payment of payments) {
    const booking = await ensureMembershipPaymentBooking(membership, payment);
    syncBookingRecordToBizportal(booking).catch((err) =>
      console.error("[membership] Gagal sync booking payment ke Bizportal:", err),
    );
  }
}

async function syncToPublic(m: typeof gymMembershipsTable.$inferSelect) {
  try {
    await db
      .insert(publicMembershipsTable)
      .values({
        sourceId: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        startDate: m.startDate,
        endDate: m.endDate,
        months: m.months,
        totalPrice: m.totalPrice,
        status: m.status,
        notes: m.notes,
        paymentMethod: m.paymentMethod,
        paymentProofUrl: m.paymentProofUrl,
        source: "sport_center",
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })
      .onConflictDoUpdate({
        target: publicMembershipsTable.sourceId,
        set: {
          name: m.name,
          email: m.email,
          phone: m.phone,
          startDate: m.startDate,
          endDate: m.endDate,
          months: m.months,
          totalPrice: m.totalPrice,
          status: m.status,
          notes: m.notes,
          paymentMethod: m.paymentMethod,
          paymentProofUrl: m.paymentProofUrl,
          updatedAt: m.updatedAt,
        },
      });
  } catch (err) {
    console.warn("[sync-public-memberships] Non-fatal sync error:", err);
  }
}

async function deleteFromPublic(sourceId: number) {
  try {
    await db.delete(publicMembershipsTable).where(eq(publicMembershipsTable.sourceId, sourceId));
  } catch (err) {
    console.warn("[sync-public-memberships] Non-fatal delete error:", err);
  }
}

async function sendMembershipProof(
  paymentProofUrl: string | null,
  res: Response,
) {
  if (!paymentProofUrl) {
    res.status(404).json({ error: "Bukti pembayaran tidak ditemukan" });
    return;
  }

  const file = await downloadFromStorageUrl(paymentProofUrl);
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.buffer);
}

router.get("/memberships/:id/payment-proof-file", adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "ID member tidak valid" });
      return;
    }
    const [membership] = await db
      .select({ paymentProofUrl: gymMembershipsTable.paymentProofUrl })
      .from(gymMembershipsTable)
      .where(eq(gymMembershipsTable.id, id))
      .limit(1);
    if (!membership) {
      res.status(404).json({ error: "Membership tidak ditemukan" });
      return;
    }
    await sendMembershipProof(membership.paymentProofUrl, res);
  } catch (err) {
    req.log.error({ err, membershipId: req.params.id }, "Read membership payment proof error");
    res.status(404).json({ error: "File bukti pembayaran tidak tersedia di Storage" });
  }
});

router.get("/memberships/:id/payments/:paymentId/proof-file", adminMiddleware, async (req, res) => {
  try {
    const membershipId = Number(req.params.id);
    const paymentId = Number(req.params.paymentId);
    if (!Number.isInteger(membershipId) || !Number.isInteger(paymentId)) {
      res.status(400).json({ error: "ID pembayaran tidak valid" });
      return;
    }
    const [payment] = await db
      .select({ paymentProofUrl: membershipPaymentsTable.paymentProofUrl })
      .from(membershipPaymentsTable)
      .where(and(
        eq(membershipPaymentsTable.id, paymentId),
        eq(membershipPaymentsTable.membershipId, membershipId),
      ))
      .limit(1);
    if (!payment) {
      res.status(404).json({ error: "Pembayaran membership tidak ditemukan" });
      return;
    }
    await sendMembershipProof(payment.paymentProofUrl, res);
  } catch (err) {
    req.log.error(
      { err, membershipId: req.params.id, paymentId: req.params.paymentId },
      "Read membership payment history proof error",
    );
    res.status(404).json({ error: "File bukti pembayaran tidak tersedia di Storage" });
  }
});

// ─── Gym Check-in Endpoints ───────────────────────────────────────────────────

// POST /memberships/lookup — public, cari membership by phone atau name
router.post("/memberships/lookup", async (req, res) => {
  try {
    const phone = String(req.body?.phone || "").trim();
    const name  = String(req.body?.name  || "").trim();

    if (!phone && !name) {
      res.status(400).json({ error: "phone atau name wajib diisi" });
      return;
    }

    let rows: (typeof gymMembershipsTable.$inferSelect)[] = [];

    if (phone) {
      // Cari exact match by phone
      rows = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.phone, phone));
    } else {
      // Cari by nama (case-insensitive, partial match)
      rows = await db.select().from(gymMembershipsTable).where(ilike(gymMembershipsTable.name, `%${name}%`));
    }

    const candidates = rows
      .filter((m) => m.status !== "cancelled")
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());

    if (candidates.length === 0) {
      res.status(404).json({ error: "Membership tidak ditemukan" });
      return;
    }

    const result = candidates.map((m) => ({
      id: m.id,
      name: m.name,
      phone: m.phone,
      email: m.email,
      status: m.status,
      startDate: m.startDate,
      endDate: m.endDate,
      months: m.months,
      totalPrice: Number(m.totalPrice),
    }));

    // Jika cari by phone → kembalikan 1 hasil (backward compat); by name → array
    if (phone) {
      res.json(result[0]);
    } else {
      res.json(result);
    }
  } catch (err) {
    req.log.error({ err }, "Lookup membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /memberships/checkins?date=YYYY-MM-DD
router.get("/memberships/checkins", adminMiddleware, async (req, res) => {
  try {
    const date = String(req.query.date || new Date().toISOString().split("T")[0]);
    const checkins = await db
      .select({
        id: gymCheckinsTable.id,
        membershipId: gymCheckinsTable.membershipId,
        checkinDate: gymCheckinsTable.checkinDate,
        checkedInAt: gymCheckinsTable.checkedInAt,
        notes: gymCheckinsTable.notes,
        memberName: gymMembershipsTable.name,
        memberPhone: gymMembershipsTable.phone,
      })
      .from(gymCheckinsTable)
      .leftJoin(gymMembershipsTable, eq(gymCheckinsTable.membershipId, gymMembershipsTable.id))
      .where(eq(gymCheckinsTable.checkinDate, date));
    res.json(checkins);
  } catch (err) {
    req.log.error({ err }, "List checkins error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /memberships/:id/checkin
router.post("/memberships/:id/checkin", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const today = new Date().toISOString().split("T")[0]!;
    const checkinDate = String(req.body.checkinDate || today);
    const notes = req.body.notes ?? null;

    const [member] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!member) { res.status(404).json({ error: "Member tidak ditemukan" }); return; }
    if (member.status !== "active") { res.status(400).json({ error: "Member tidak aktif" }); return; }

    // Respect the seven-day grace period. Check-in must never mutate membership
    // status; only the guarded payment reconciliation scheduler may do that.
    const todayStr = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split("T")[0]!;
    const paidPeriods = await db.select({
      id: membershipPaymentsTable.id,
      periodStart: membershipPaymentsTable.periodStart,
      periodEnd: membershipPaymentsTable.periodEnd,
      status: membershipPaymentsTable.status,
      amount: membershipPaymentsTable.amount,
    }).from(membershipPaymentsTable).where(eq(membershipPaymentsTable.membershipId, id));
    const hasConfirmedCoverage = paidPeriods.some(p =>
      p.status === "confirmed" && Number(p.amount) > 0 &&
      /^\\d{4}-\\d{2}-\\d{2}$/.test(p.periodStart) &&
      /^\\d{4}-\\d{2}-\\d{2}$/.test(p.periodEnd) &&
      p.periodStart <= todayStr && p.periodEnd >= todayStr);
    if (!hasConfirmedCoverage && !isWithinGymGracePeriod(member.endDate, todayStr)) {
      res.status(400).json({ error: "Masa membership dan tenggang 7 hari sudah berakhir; periksa pembayaran perpanjangan" }); return;
    }

    const [existing] = await db.select().from(gymCheckinsTable)
      .where(and(eq(gymCheckinsTable.membershipId, id), eq(gymCheckinsTable.checkinDate, checkinDate)))
      .limit(1);
    if (existing) { res.status(409).json({ error: "Sudah check-in pada tanggal ini", checkin: existing }); return; }

    // Every member visit is also a booking record so it appears in the
    // central booking list. It is prepaid by the membership and must never
    // enter the regular payment queue.
    const gymFacility = await getGymFacility();
    if (!gymFacility) {
      res.status(409).json({ error: "Fasilitas Gym belum tersedia" });
      return;
    }

    const orderNumber = await generateBookingOrderNumber();
    const checkedInAt = new Date();
    const bookingNote = [
      `Pemakaian member gym #${member.id}`,
      notes ? `Catatan check-in: ${String(notes).trim()}` : "",
    ].filter(Boolean).join(" — ");

    const result = await db.transaction(async (tx) => {
      // Serialize manual and X904 check-ins on the same membership row.
      // The X904 processor takes this same lock, so exactly one route wins.
      await tx.execute(sql`SELECT id FROM sport_center.sport_memberships
        WHERE id=${id} FOR UPDATE`);
      const [existingUnderLock] = await tx.select({ id: gymCheckinsTable.id })
        .from(gymCheckinsTable)
        .where(and(eq(gymCheckinsTable.membershipId, id), eq(gymCheckinsTable.checkinDate, checkinDate)))
        .limit(1);
      if (existingUnderLock) throw new Error("GYM_ALREADY_CHECKED_IN");
      const [newCheckin] = await tx.insert(gymCheckinsTable)
        .values({ membershipId: id, checkinDate, notes })
        .returning();

      const [newBooking] = await tx.insert(bookingsTable).values({
        orderNumber,
        customerId: null,
        customerName: member.name,
        customerEmail: member.email,
        customerPhone: member.phone,
        facilityId: gymFacility.id,
        bookingDate: checkinDate,
        startTime: gymFacility.openTime,
        endTime: addHours(gymFacility.openTime, 1),
        durationHours: 1,
        totalPrice: "0",
        discountAmount: "0",
        customerType: "umum",
        verificationStatus: "not_required",
        basePrice: "0",
        apDiscountAmount: "0",
        bookingType: "regular",
        membershipId: member.id,
        status: "confirmed",
        source: "gym_membership",
        numberOfPeople: 1,
        notes: bookingNote,
        paymentRequiredNow: false,
        payerType: "personal",
        billingStatus: "paid",
        dpp: "0",
        grandTotal: "0",
        checkedInAt,
      }).returning();

      await tx.insert(bookingHistoryTable).values({
        bookingId: newBooking.id,
        fromStatus: null,
        toStatus: "confirmed",
        changedByName: member.name,
        note: `Pemakaian member gym dicatat dari check-in membership #${member.id}`,
      });

      return { checkin: newCheckin, booking: newBooking };
    });

    res.status(201).json(result);

    syncBookingRecordToBizportal(result.booking).catch((err) =>
      req.log.error({ err }, "[checkin] Gagal sync booking membership ke Bizportal")
    );

    // Fire-and-forget: kirim rekap WA hari ini ke grup admin
    sendRekapPemakaianToAdmin(checkinDate).catch((err) =>
      req.log.error({ err }, "[checkin] Gagal kirim rekap WA setelah check-in")
    );
  } catch (err) {
    // Both manual and automatic paths share the unique member/day constraint.
    // A concurrent winner is an already-recorded visit, not a server failure.
    if ((err instanceof Error && err.message === "GYM_ALREADY_CHECKED_IN") ||
        (typeof err === "object" && err !== null &&
          ("code" in err && err.code === "23505"))) {
      res.status(409).json({ error: "Sudah check-in pada tanggal ini" });
      return;
    }
    req.log.error({ err }, "Check-in member error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /memberships/checkins/:checkinId  — undo check-in (harus sebelum /:id)
router.delete("/memberships/checkins/:checkinId", adminMiddleware, async (req, res) => {
  try {
    const checkinId = parseInt(String(req.params.checkinId));

    // Ambil tanggal dulu sebelum dihapus, untuk rekap
    const [existing] = await db.select().from(gymCheckinsTable).where(eq(gymCheckinsTable.id, checkinId)).limit(1);
    await db.delete(gymCheckinsTable).where(eq(gymCheckinsTable.id, checkinId));
    if (existing) {
      // Keep the booking for audit purposes, but make the cancelled check-in
      // disappear from active booking totals.
      const [cancelledBooking] = await db.update(bookingsTable)
        .set({
          status: "cancelled",
          notes: "Pemakaian member gym dibatalkan bersama check-in.",
          updatedAt: new Date(),
        })
        .where(and(
          eq(bookingsTable.membershipId, existing.membershipId),
          eq(bookingsTable.bookingDate, existing.checkinDate),
          eq(bookingsTable.source, "gym_membership"),
        ))
        .returning();
      if (cancelledBooking) {
        syncBookingRecordToBizportal(cancelledBooking).catch((err) =>
          req.log.error({ err }, "[checkin] Gagal sync pembatalan booking membership ke Bizportal")
        );
      }
    }
    res.status(204).send();

    // Fire-and-forget: kirim rekap WA hari ini ke grup admin
    const checkinDate = existing?.checkinDate ?? new Date().toISOString().split("T")[0]!;
    sendRekapPemakaianToAdmin(checkinDate).catch((err) =>
      req.log.error({ err }, "[checkin] Gagal kirim rekap WA setelah batal check-in")
    );
  } catch (err) {
    req.log.error({ err }, "Delete checkin error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

router.get("/memberships", adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let memberships = await db.select().from(gymMembershipsTable).orderBy(gymMembershipsTable.createdAt);
    if (status) memberships = memberships.filter((m) => m.status === status);
    res.json(memberships.map((m) => ({ ...m, totalPrice: Number(m.totalPrice) })));
  } catch (err) {
    req.log.error({ err }, "List memberships error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/memberships/export", adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let memberships = await db.select().from(gymMembershipsTable).orderBy(gymMembershipsTable.startDate);

    if (startDate) memberships = memberships.filter((m) => m.startDate >= (startDate as string));
    if (endDate) memberships = memberships.filter((m) => m.startDate <= (endDate as string));

    const statusLabel: Record<string, string> = {
      active: "Aktif",
      expired: "Kadaluarsa",
      cancelled: "Dibatalkan",
      waiting_confirmation: "Menunggu Konfirmasi",
      pending_payment: "Menunggu Bayar",
    };

    const header = "Nama,Email,Telepon,Tanggal Mulai,Tanggal Selesai,Durasi (bulan),Total Harga,Status,Metode Bayar,Catatan,Tanggal Daftar\n";
    const rows = memberships.map((m) =>
      [
        m.name,
        m.email ?? "",
        m.phone ?? "",
        m.startDate,
        m.endDate,
        m.months,
        Number(m.totalPrice),
        statusLabel[m.status] ?? m.status,
        m.paymentMethod ?? "",
        m.notes ?? "",
        new Date(m.createdAt).toISOString(),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );

    const csv = header + rows.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=members-gym.csv");
    res.send(csv);
  } catch (err) {
    req.log.error({ err }, "Export memberships error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/memberships/:id/payments", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID membership tidak valid" });
      return;
    }

    const payments = await db
      .select()
      .from(membershipPaymentsTable)
      .where(eq(membershipPaymentsTable.membershipId, id))
      .orderBy(desc(membershipPaymentsTable.id));

    res.json(payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })));
  } catch (err) {
    req.log.error({ err }, "List membership payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [membership] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!membership) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...membership, totalPrice: Number(membership.totalPrice) });
  } catch (err) {
    req.log.error({ err }, "Get membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});


// Admin-only, single-request registration for an already-paid Gym member.
// All customer, membership, payment, booking and X904 entitlement writes are
// transactional. An uploaded proof is never treated as payment verification.
router.post("/memberships/admin-register-paid", adminMiddleware, membershipProofUpload.single("proof"), async (req, res) => {
  try {
    const role = String((req as any).user?.role ?? "");
    if (!["owner", "admin", "super_admin", "finance", "admin_booking"].includes(role)) {
      res.status(403).json({ error: "Konfirmasi pembayaran memerlukan admin/finance berwenang" });
      return;
    }
    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const phone = String(req.body?.phone ?? "").trim();
    const phoneKey = phone.replace(/\D/g, "").replace(/^0/, "62");
    const months = Number(req.body?.months);
    const startDate = String(req.body?.startDate ?? "").trim();
    const paymentMethod = String(req.body?.paymentMethod ?? "").trim();
    const paymentDate = normalizePaymentDate(req.body?.paymentDate);
    const notes = String(req.body?.notes ?? "").trim();
    const x904Pin = String(req.body?.x904Pin ?? "").trim();
    const x904VerifiedName = String(req.body?.x904VerifiedName ?? "").trim();
    const x904IdentityConfirmed = req.body?.x904IdentityConfirmed === "true";
    if (!/^[0-9]{1,8}$/.test(x904Pin)) {
      res.status(400).json({ error: "Pilih PIN X904 yang valid sebelum mendaftarkan member baru." }); return;
    }
    const proof = req.file;
    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phoneKey.length < 10 || phoneKey.length > 15) {
      res.status(400).json({ error: "Nama, email, dan nomor WhatsApp yang valid wajib diisi" }); return;
    }
    if (!Number.isInteger(months) || ![1,2,3,6,12].includes(months)) {
      res.status(400).json({ error: "Paket membership tidak valid" }); return;
    }
    const parsedStartDate = new Date(startDate + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(parsedStartDate.getTime()) || parsedStartDate.toISOString().slice(0,10) !== startDate) {
      res.status(400).json({ error: "Tanggal mulai membership tidak valid" }); return;
    }
    if (!["qris", "transfer"].includes(paymentMethod)) {
      res.status(400).json({ error: "Pilih QRIS atau Transfer Bank" }); return;
    }
    const mime = proof?.mimetype.toLowerCase();
    const extensions: Record<string,string> = {"image/jpeg":".jpg","image/png":".png","image/webp":".webp","image/heic":".heic","image/heif":".heif"};
    if (!proof || !mime || !extensions[mime]) {
      res.status(400).json({ error: "Unggah bukti pembayaran berupa gambar" }); return;
    }

    // Do not create a customer/login with a predictable default password.
    // A customer record without credentials is safe to invite later.
    const objectName = `membership-paid-intake-${randomUUID()}${extensions[mime]}`;
    const proofUrl = await uploadFile(BUCKETS.proof, objectName, proof.buffer, mime);
    const orderNumber = await generateBookingOrderNumber();
    const today = new Date();
    const end = new Date(startDate + "T00:00:00Z");
    end.setUTCMonth(end.getUTCMonth() + months);
    const endDate = end.toISOString().slice(0,10);
    const amount = String(months * PRICE_PER_MONTH);
    const result = await db.transaction(async tx => {
      // Lock the selected device identity in the same atomic registration transaction.
      // Never trust the browser-only identity lookup for entitlement mapping.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"TDBD234200545:" + x904Pin}))`);
      const machineUsers = await tx.execute(sql`
        SELECT user_pin,device_uid,display_name,device_role
        FROM sport_center.gym_x904_lan_users
        WHERE device_serial='TDBD234200545' AND user_pin=${x904Pin}
      `);
      if (machineUsers.rows.length !== 1 || Number(machineUsers.rows[0].device_role) !== 0 ||
          !String(machineUsers.rows[0].display_name ?? "").trim()) {
        throw new MembershipProofError(409,"PIN X904 tidak valid atau bukan pengguna biasa.");
      }
      // Admin must confirm the device identity shown in the form; the server
      // compares it against its own inventory lookup, not browser lookup alone.
      if (!x904IdentityConfirmed || !x904VerifiedName ||
          x904VerifiedName !== String(machineUsers.rows[0].display_name).trim()) {
        throw new MembershipProofError(409,"Konfirmasi identitas PIN X904 tidak cocok. Verifikasi ulang nama di mesin.");
      }
      const mappings = await tx.execute(sql`
        SELECT membership_id,status FROM sport_center.gym_x904_member_mapping
        WHERE device_serial='TDBD234200545' AND user_pin=${x904Pin}
      `);
      if (mappings.rows.length && mappings.rows[0].membership_id != null) {
        throw new MembershipProofError(409,"PIN X904 sudah dipetakan ke membership lain. Periksa pemetaan sebelum mendaftar.");
      }
      // Serialize attempts for the same phone, including simultaneous double-clicks.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${phoneKey}))`);
      const conflicts = await tx.select({ id:gymMembershipsTable.id }).from(gymMembershipsTable)
        .where(sql`regexp_replace(${gymMembershipsTable.phone}, '[^0-9]', '', 'g') IN (${phoneKey}, ${phone.replace(/\D/g, "")}) AND ${gymMembershipsTable.status} IN ('active','pending_payment','waiting_confirmation')`)
        .limit(1);
      if (conflicts.length) throw new MembershipProofError(409, "Nomor ini sudah memiliki membership aktif atau tagihan yang belum selesai; periksa riwayat member");
      // Reuse by verified email, but never silently create a second customer
      // against an existing WhatsApp identity.
      const existingPhoneUsers = await tx.select().from(usersTable)
        .where(sql`regexp_replace(${usersTable.phone}, '[^0-9]', '', 'g') IN (${phoneKey}, ${phone.replace(/\D/g, "")})`)
        .limit(2);
      if (existingPhoneUsers.some(user => String(user.email ?? "").toLowerCase() !== email)) {
        throw new MembershipProofError(409, "Nomor WhatsApp sudah digunakan customer lain; verifikasi identitas dahulu");
      }
      const existingUsers = await tx.select().from(usersTable).where(ilike(usersTable.email,email)).limit(1);
      let customer = existingUsers[0];
      if (customer) {
        const userPhone = String(customer.phone ?? "").replace(/\D/g, "").replace(/^0/, "62");
        if (customer.role !== "customer" || (userPhone && userPhone !== phoneKey)) {
          throw new MembershipProofError(409, "Email sudah digunakan akun lain; verifikasi identitas customer");
        }
      } else {
        const [createdCustomer] = await tx.insert(usersTable).values({
          name, email, phone, role:"customer", accountType:"personal",
          registrationSource:"admin_gym_membership", passwordHash:null,
        }).returning();
        if (!createdCustomer) throw new Error("CUSTOMER_INSERT_FAILED");
        customer = createdCustomer;
      }
      const [membership] = await tx.insert(gymMembershipsTable).values({
        name,email,phone,startDate,endDate,months,totalPrice:amount,
        notes:notes||null,status:"pending_payment",
      }).returning();
      if (!membership) throw new Error("MEMBERSHIP_INSERT_FAILED");
      const mapped = await tx.execute(sql`
        INSERT INTO sport_center.gym_x904_member_mapping
          (device_serial,user_pin,membership_id,status,verified_at,verified_by,review_reason,updated_at)
        VALUES ('TDBD234200545',${x904Pin},${membership.id},'verified',now(),
          'admin_paid_registration','PIN selected and inventory validated during paid registration',now())
        ON CONFLICT (device_serial,user_pin) DO UPDATE SET
          membership_id=EXCLUDED.membership_id,status=EXCLUDED.status,
          verified_at=EXCLUDED.verified_at,verified_by=EXCLUDED.verified_by,
          review_reason=EXCLUDED.review_reason,updated_at=now()
        WHERE sport_center.gym_x904_member_mapping.membership_id IS NULL
        RETURNING membership_id,user_pin,status
      `);
      if (mapped.rows.length !== 1 ||
          String(mapped.rows[0].membership_id) !== String(membership.id) ||
          String(mapped.rows[0].user_pin) !== x904Pin ||
          String(mapped.rows[0].status) !== "verified") {
        throw new MembershipProofError(409,"Pemetaan PIN X904 gagal atau berubah bersamaan. Pendaftaran dibatalkan.");
      }
      const [pending] = await tx.insert(membershipPaymentsTable).values({
        membershipId:membership.id,periodStart:startDate,periodEnd:endDate,
        months,amount,status:"waiting_confirmation",paymentMethod,paymentProofUrl:proofUrl,
        paymentDate,submittedAt:today,
      }).returning();
      if (!pending) throw new Error("PAYMENT_INSERT_FAILED");
      // The canonical payment mirror trigger checks for EXACTLY ONE booking
      // before it permits a confirmed payment. Create it while still pending.
      const pendingBooking = await ensureMembershipPaymentBooking(membership,pending,tx,orderNumber);
      const [payment] = await tx.update(membershipPaymentsTable).set({
        status:"confirmed",confirmedAt:today,settlementProviderCode:"mandiri_direct",
        mutationKey:`SC-MBP-${pending.id}`,accountingRef:`MB-${membership.id}-P${pending.id}`,
        updatedAt:today,
      }).where(eq(membershipPaymentsTable.id,pending.id)).returning();
      if (!payment) throw new Error("PAYMENT_CONFIRM_FAILED");
      const booking = await ensureMembershipPaymentBooking(membership,payment,tx,orderNumber);
      if (booking.id !== pendingBooking.id) throw new Error("MEMBERSHIP_BOOKING_DUPLICATE");
      const [linkedBooking] = await tx.update(bookingsTable).set({customerId:customer.id})
        .where(eq(bookingsTable.id,booking.id)).returning();
      if (!linkedBooking) throw new Error("CUSTOMER_BOOKING_LINK_FAILED");
      const [active] = await tx.update(gymMembershipsTable).set({
        status:"active",paymentMethod,paymentProofUrl:proofUrl,updatedAt:today,
      }).where(eq(gymMembershipsTable.id,membership.id)).returning();
      if (!active) throw new Error("MEMBERSHIP_ACTIVATION_FAILED");
      const entitlementEvent = await tx.execute(sql`
        INSERT INTO sport_center.x904_automatic_entitlement_events
          (membership_id,payment_id,reason,event_key)
        VALUES (${active.id},${payment.id},'PAYMENT_CONFIRMED',${x904PaymentConfirmedEventKey(payment.id)})
        ON CONFLICT (event_key) DO NOTHING
        RETURNING event_id,membership_id,payment_id
      `);
      if (entitlementEvent.rows.length !== 1 ||
          String(entitlementEvent.rows[0].membership_id) !== String(active.id) ||
          String(entitlementEvent.rows[0].payment_id) !== String(payment.id)) {
        throw new Error("X904_PAYMENT_ENTITLEMENT_EVENT_NOT_PERSISTED");
      }
      return {customerId:customer.id,membership:active,payment,booking:linkedBooking};
    });
    syncMembershipToBizportal(result.membership).catch(err => req.log.error({err},"Paid membership sync failed"));
    syncBookingRecordToBizportal(result.booking).catch(err => req.log.error({err},"Paid membership booking sync failed"));
    pushMembershipPaymentAsBankMutation(result.membership,result.payment,today,result.booking)
      .catch(err => req.log.error({err},"Paid membership mutation sync failed"));
    await syncToPublic(result.membership);
    res.status(201).json({
      customerId:result.customerId, membershipId:result.membership.id,
      paymentId:result.payment.id, bookingId:result.booking.id,
      status:"active", paymentStatus:"confirmed", amount:Number(result.payment.amount),
      x904Status:"pending_device_ack",
    });
  } catch (err) {
    if (err instanceof MembershipProofError) {res.status(err.status).json({error:err.message});return;}
    req.log.error({err},"Register paid Gym membership failed");
    res.status(500).json({error:"Pendaftaran atau konfirmasi pembayaran gagal. Periksa riwayat sebelum mencoba lagi."});
  }
});

router.post("/memberships", async (req, res) => {
  try {
    const { name, email, phone, startDate, months, notes } = req.body ?? {};
    const nameNorm = String(name ?? "").trim();
    const emailNorm = String(email ?? "").trim();
    const phoneNorm = String(phone ?? "").trim();
    const startDateNorm = String(startDate ?? "").trim();

    if (!nameNorm || !emailNorm || !phoneNorm || !startDateNorm) {
      res.status(400).json({ error: "name, email, phone, dan startDate wajib diisi" });
      return;
    }

    const isDateOnly = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    if (!isDateOnly(startDateNorm)) {
      res.status(400).json({ error: "Tanggal mulai harus berformat YYYY-MM-DD yang valid" });
      return;
    }

    const monthsNum = Number(months ?? 1);
    if (!Number.isInteger(monthsNum) || monthsNum < 1 || monthsNum > 12) {
      res.status(400).json({ error: "Durasi membership harus berupa bilangan bulat 1 sampai 12 bulan" });
      return;
    }

    // ── Cegah duplikat: tolak jika phone sudah punya membership aktif/pending ──
    const BLOCK_STATUSES = ["active", "pending_payment", "waiting_confirmation"];
    const existingAll = await db
      .select()
      .from(gymMembershipsTable)
      .where(eq(gymMembershipsTable.phone, phoneNorm));

    const conflict = existingAll.find((m) => BLOCK_STATUSES.includes(m.status));
    if (conflict) {
      const sameRegistrant =
        String(conflict.email ?? "").trim().toLowerCase() === emailNorm.toLowerCase() &&
        String(conflict.name ?? "").trim().toLowerCase() === nameNorm.toLowerCase();

      if (conflict.status === "pending_payment" && sameRegistrant) {
        const [pendingPayment] = await db
          .select()
          .from(membershipPaymentsTable)
          .where(
            and(
              eq(membershipPaymentsTable.membershipId, conflict.id),
              eq(membershipPaymentsTable.status, "pending_payment"),
            ),
          )
          .orderBy(desc(membershipPaymentsTable.id))
          .limit(1);

        if (pendingPayment) {
          res.status(409).json({
            error: "Pendaftaran sebelumnya masih menunggu pembayaran. Lanjutkan pembayaran yang sama.",
            conflictStatus: conflict.status,
            conflictId: conflict.id,
            resumePayment: {
              id: conflict.id,
              name: conflict.name,
              endDate: conflict.endDate,
              totalPrice: Number(conflict.totalPrice),
              months: conflict.months,
              startDate: conflict.startDate,
              paymentProofToken: createMembershipProofToken(conflict.id, pendingPayment.id),
            },
          });
          return;
        }
      }

      res.status(409).json({
        error: "Nomor HP ini sudah terdaftar sebagai member aktif atau sedang menunggu konfirmasi. Gunakan fitur Perpanjang untuk memperpanjang membership Anda.",
        conflictStatus: conflict.status,
        conflictId: conflict.id,
      });
      return;
    }

    const totalPrice = PRICE_PER_MONTH * monthsNum;

    const start = new Date(`${startDateNorm}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + monthsNum);
    const endDate = end.toISOString().split("T")[0];

    // Allocate the order number before the transaction because the sequence
    // helper owns its transaction. A sequence gap is harmless; partial member
    // records are not, so the member/payment/booking writes stay atomic below.
    const orderNumber = await generateBookingOrderNumber();
    const { membership, payment, paymentBooking } = await db.transaction(async (tx) => {
      const [createdMembership] = await tx
        .insert(gymMembershipsTable)
        .values({
          name: nameNorm,
          email: emailNorm,
          phone: phoneNorm,
          startDate: startDateNorm,
          endDate,
          months: monthsNum,
          totalPrice: String(totalPrice),
          notes: notes ? String(notes).trim() : null,
          status: "pending_payment",
        })
        .returning();

      if (!createdMembership) throw new Error("Gagal membuat data membership");

      const [createdPayment] = await tx.insert(membershipPaymentsTable).values({
        membershipId: createdMembership.id,
        periodStart: createdMembership.startDate,
        periodEnd: createdMembership.endDate,
        months: createdMembership.months,
        amount: createdMembership.totalPrice,
        status: "pending_payment",
      }).returning();

      if (!createdPayment) throw new Error("Gagal membuat data pembayaran membership");

      const createdPaymentBooking = await ensureMembershipPaymentBooking(
        createdMembership,
        createdPayment,
        tx,
        orderNumber,
      );
      return {
        membership: createdMembership,
        payment: createdPayment,
        paymentBooking: createdPaymentBooking,
      };
    });

    syncMembershipToBizportal(membership).catch((err) =>
      req.log.error({ err }, "[membership] Gagal sync membership ke Bizportal"),
    );
    syncBookingRecordToBizportal(paymentBooking).catch((err) =>
      req.log.error({ err }, "[membership] Gagal sync booking pembayaran ke Bizportal")
    );
    await syncToPublic(membership);
    res.status(201).json({ ...membership, totalPrice: Number(membership.totalPrice), paymentProofToken: createMembershipProofToken(membership.id, payment.id) });
  } catch (err) {
    if (process.env.SPORT_CENTER_E2E_PAYMENT_EVENTS === "true") {
      const e = err as any;
      const root = e?.cause ?? e;
      const message = String(root?.message ?? "");
      const category = /does not exist/i.test(message) ? "MISSING_OBJECT"
        : /duplicate|constraint|violates/i.test(message) ? "CONSTRAINT"
        : /permission denied/i.test(message) ? "PERMISSION"
        : /transaction/i.test(message) ? "TRANSACTION"
        : "OTHER";
      console.error("MEMBERSHIP_DEV_DIAG", JSON.stringify({
        code: String(root?.code ?? "UNKNOWN").slice(0, 12),
        category,
        object: String(root?.table ?? root?.constraint ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 64),
      }));
    }
    req.log.error({ err }, "Create membership error");
    if (process.env.SPORT_CENTER_E2E_PAYMENT_EVENTS === "true" && process.env.NODE_ENV === "development") {
      const e = err as any;
      res.status(500).json({ error: "DEV_MEMBERSHIP_CREATION_FAILED", dbCode: String(e?.cause?.code ?? e?.code ?? "unknown"), dbConstraint: String(e?.cause?.constraint ?? e?.constraint ?? "unknown").slice(0,80) });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /memberships/:id/renew — public, perpanjang membership yang ada (update record, bukan buat baru)
router.post("/memberships/:id/renew", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const months = Math.max(1, parseInt(String(req.body?.months || 1)));

    const [existing] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Membership tidak ditemukan" }); return; }
    if (existing.status === "pending_payment" || existing.status === "waiting_confirmation") {
      res.status(400).json({ error: "Selesaikan pembayaran yang sedang berjalan sebelum memperpanjang. Status saat ini: " + existing.status }); return;
    }

    // Renew every member from the prior expiry, including the seven-day grace.
    // Jakarta-local calendar date avoids a midnight UTC rollover on Hostinger.
    const todayStr = jakartaDateOnly();
    const newStartDate = resolveGymRenewalStart(existing.status, existing.endDate, todayStr);

    const startD = new Date(`${newStartDate}T00:00:00Z`);
    const targetMonthIndex = startD.getUTCMonth() + months;
    const targetYear = startD.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const targetDay = Math.min(startD.getUTCDate(), lastDayOfTargetMonth);
    const newEndDate = new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().split("T")[0]!;
    const totalPrice = String(months * 300000);

    const [payment] = await db.insert(membershipPaymentsTable).values({
      membershipId: existing.id,
      periodStart: newStartDate,
      periodEnd: newEndDate,
      months,
      amount: totalPrice,
      status: "pending_payment",
    }).returning();

    const paymentBooking = await ensureMembershipPaymentBooking(existing, payment!);
    syncBookingRecordToBizportal(paymentBooking).catch((err) =>
      req.log.error({ err }, "[membership] Gagal sync booking renewal ke Bizportal")
    );
    res.json({
      ...existing,
      totalPrice: Number(existing.totalPrice),
      renewal: {
        paymentId: payment!.id,
        periodStart: payment!.periodStart,
        periodEnd: payment!.periodEnd,
        months: payment!.months,
        amount: Number(payment!.amount),
        status: payment!.status,
      },
      paymentProofToken: createMembershipProofToken(existing.id, payment!.id),
    });
  } catch (err) {
    req.log.error({ err }, "Renew membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin-only proof submission resolves the current pending payment by membership ID.
// It never confirms or activates membership; existing verification controls remain authoritative.
router.post("/memberships/:id/admin-payment-proof-upload", adminMiddleware, membershipProofUpload.single("proof"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({error:"ID tidak valid"}); return; }
    if (!req.file || !["image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(req.file.mimetype.toLowerCase())) {
      res.status(400).json({error:"Bukti pembayaran wajib berupa gambar yang didukung"}); return;
    }
    const [pending] = await db.select().from(membershipPaymentsTable).where(
      and(eq(membershipPaymentsTable.membershipId,id),eq(membershipPaymentsTable.status,"pending_payment"))
    ).orderBy(desc(membershipPaymentsTable.id)).limit(1);
    if (!pending) {res.status(409).json({error:"Tidak ada tagihan membership yang menunggu pembayaran"});return;}
    const safeExt: Record<string,string> = {"image/jpeg":".jpg","image/png":".png","image/webp":".webp","image/heic":".heic","image/heif":".heif"};
    const objectName = `membership-${id}-payment-${pending.id}-${randomUUID()}${safeExt[req.file.mimetype.toLowerCase()]}`;
    const proofUrl = await uploadFile(BUCKETS.proof,objectName,req.file.buffer,req.file.mimetype);
    const actorRole = String((req as any).user?.role ?? "");
    const hasSelfConfirmationAuthority = ["owner", "admin", "super_admin", "finance", "admin_booking"].includes(actorRole);
    const membership = await applyMembershipPaymentProof(
      id,
      pending.id,
      String(req.body?.paymentMethod ?? ""),
      proofUrl,
      req.body?.paymentDate,
      req.log,
      !hasSelfConfirmationAuthority,
    );
    res.json({...membership,totalPrice:Number(membership.totalPrice)});
  } catch(err) {
    if(err instanceof MembershipProofError) {res.status(err.status).json({error:err.message});return;}
    req.log.error({err},"Admin membership payment proof upload failed");
    res.status(500).json({error:"Gagal mengunggah bukti pembayaran"});
  }
});

router.post(
  "/memberships/:id/payment-proof-upload",
  membershipProofUpload.single("proof"),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "ID membership tidak valid" });
        return;
      }

      const paymentProofToken = String(req.body?.paymentProofToken ?? "");
      const tokenPayload = verifyMembershipProofToken(paymentProofToken, id);
      if (!tokenPayload) {
        res.status(401).json({ error: "Sesi upload bukti tidak valid atau sudah kedaluwarsa" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "Foto bukti pembayaran wajib dipilih" });
        return;
      }

      const paymentMethod = String(req.body?.paymentMethod ?? "");
      const extByMime: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/heic": ".heic",
        "image/heif": ".heif",
      };
      const safeExt =
        extByMime[req.file.mimetype.toLowerCase()] ||
        path.extname(req.file.originalname).toLowerCase() ||
        ".jpg";
      const objectName =
        `membership-${id}-payment-${tokenPayload.paymentId}-${randomUUID()}${safeExt}`;
      const paymentProofUrl = await uploadFile(
        BUCKETS.proof,
        objectName,
        req.file.buffer,
        req.file.mimetype,
      );

      const membership = await applyMembershipPaymentProof(
        id,
        tokenPayload.paymentId,
        paymentMethod,
        paymentProofUrl,
        req.body?.paymentDate,
        req.log,
      );
      res.json({ ...membership, totalPrice: Number(membership.totalPrice) });
    } catch (err) {
      if (err instanceof MembershipProofError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      req.log.error({ err }, "Submit membership payment proof upload error");
      res.status(500).json({ error: "Upload bukti pembayaran gagal" });
    }
  },
);

// Compatibility JSON endpoint: still supported for API clients, but no longer
// accepts an unauthenticated arbitrary proof URL.
router.post("/memberships/:id/payment-proof", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const paymentMethod = String(req.body?.paymentMethod ?? "");
    const paymentProofUrl = String(req.body?.paymentProofUrl ?? "");
    const paymentProofToken = String(req.body?.paymentProofToken ?? "");
    const tokenPayload = verifyMembershipProofToken(paymentProofToken, id);
    if (!tokenPayload) {
      res.status(401).json({ error: "Sesi upload bukti tidak valid atau sudah kedaluwarsa" });
      return;
    }

    const membership = await applyMembershipPaymentProof(
      id,
      tokenPayload.paymentId,
      paymentMethod,
      paymentProofUrl,
      req.body?.paymentDate,
      req.log,
    );
    res.json({ ...membership, totalPrice: Number(membership.totalPrice) });
  } catch (err) {
    if (err instanceof MembershipProofError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Submit payment proof error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/memberships/:id", adminMiddleware, async (req, res) => {
  let confirmationStage = "load_membership";
  let confirmingPaymentId: number | null = null;
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(gymMembershipsTable).where(eq(gymMembershipsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const { status, notes, startDate, endDate } = req.body ?? {};
    const data: {
      status?: typeof existing.status;
      notes?: string | null;
      startDate?: string;
      endDate?: string;
      paymentMethod?: string | null;
      paymentProofUrl?: string | null;
      months?: number;
      totalPrice?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    let paymentToConfirm: typeof membershipPaymentsTable.$inferSelect | undefined;
    if (status === "active") {
      [paymentToConfirm] = await db.select().from(membershipPaymentsTable)
        .where(and(eq(membershipPaymentsTable.membershipId,id),eq(membershipPaymentsTable.status,"waiting_confirmation")))
        .orderBy(desc(membershipPaymentsTable.id)).limit(1);

      if (paymentToConfirm) {
        const role = String((req as any).user?.role ?? "");
        if (!["owner", "admin", "super_admin", "finance", "admin_booking"].includes(role)) {
          res.status(403).json({error:"Staff hanya dapat mengirim bukti untuk verifikasi; konfirmasi membership memerlukan role non-staff yang berwenang."});
          return;
        }
        if (!paymentToConfirm.paymentProofUrl || !paymentToConfirm.paymentMethod || !["qris","transfer"].includes(paymentToConfirm.paymentMethod)) {
          res.status(409).json({error:"Konfirmasi memerlukan bukti dan metode pembayaran yang telah dikirim untuk verifikasi"});
          return;
        }

        // Sport Center membership accepts Mandiri QRIS and Mandiri bank transfer only.
        // An omitted provider is safe here because the merchant has a single authorized settlement path.
        const requestedProvider = String(req.body?.settlementProviderCode ?? "mandiri_direct").trim().toLowerCase();
        if (requestedProvider !== "mandiri_direct") {
          res.status(409).json({ error: "Provider tersebut tidak aktif untuk pembayaran membership Sport Center" });
          return;
        }
        paymentToConfirm = { ...paymentToConfirm, settlementProviderCode: "mandiri_direct" };
        data.status = "active";
        data.startDate = paymentToConfirm.periodStart;
        data.endDate = paymentToConfirm.periodEnd;
      }
    }
    if (status !== undefined && !paymentToConfirm) data.status = status;
    if (paymentToConfirm) {
      data.paymentMethod = paymentToConfirm.paymentMethod;
      data.paymentProofUrl = paymentToConfirm.paymentProofUrl;
      data.months = paymentToConfirm.months;
      data.totalPrice = paymentToConfirm.amount;
    }
    if (notes !== undefined) data.notes = notes;
    if (startDate !== undefined || endDate !== undefined) {
      const nextStartDate = String(startDate ?? existing.startDate);
      const nextEndDate = String(endDate ?? existing.endDate);
      const isDateOnly = (value: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      };

      if (!isDateOnly(nextStartDate) || !isDateOnly(nextEndDate)) {
        res.status(400).json({ error: "Tanggal mulai dan berakhir harus berformat YYYY-MM-DD yang valid" });
        return;
      }
      if (nextStartDate > nextEndDate) {
        res.status(400).json({ error: "Tanggal mulai tidak boleh setelah tanggal berakhir" });
        return;
      }

      data.startDate = nextStartDate;
      data.endDate = nextEndDate;
    }

    if (Object.keys(data).length === 1) {
      res.status(400).json({ error: "Tidak ada data yang diperbarui" });
      return;
    }

    let membership: typeof existing;
    let confirmedBundle: {
      payment: typeof membershipPaymentsTable.$inferSelect;
      booking: typeof bookingsTable.$inferSelect;
      confirmedAt: Date;
    } | null = null;
    if (paymentToConfirm) {
      confirmingPaymentId = paymentToConfirm.id;
      confirmationStage = "atomic_payment_confirmation";
      // Trigger-driven payment mirroring, canonical payment, booking and entitlement
      // must commit together. A failed provider/booking trigger rolls back ALL changes.
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(gymMembershipsTable)
          .where(eq(gymMembershipsTable.id, id)).for("update").limit(1);
        const [pending] = await tx.select().from(membershipPaymentsTable)
          .where(and(eq(membershipPaymentsTable.id, paymentToConfirm!.id), eq(membershipPaymentsTable.status, "waiting_confirmation")))
          .for("update").limit(1);
        if (!current || !pending) throw new Error("MEMBERSHIP_PAYMENT_STATE_CHANGED");
        const confirmedAt = new Date();
        const [updatedPayment] = await tx.update(membershipPaymentsTable).set({
          status: "confirmed",
          paymentMethod: pending.paymentMethod,
          paymentProofUrl: pending.paymentProofUrl,
          paymentDate: pending.paymentDate ?? jakartaDateOnly(confirmedAt),
          confirmedAt,
          settlementProviderCode: paymentToConfirm!.settlementProviderCode,
          mutationKey: `SC-MBP-${pending.id}`,
          accountingRef: `MB-${id}-P${pending.id}`,
          updatedAt: confirmedAt,
        }).where(eq(membershipPaymentsTable.id, pending.id)).returning();
        // The canonical trigger executes during this update; any rejection aborts
        // the transaction before the entitlement changes.
        const paymentBooking = await ensureMembershipPaymentBooking(current, updatedPayment, tx);
        const [updatedMembership] = await tx.update(gymMembershipsTable).set(data)
          .where(eq(gymMembershipsTable.id, id)).returning();
        if (!updatedMembership || !paymentBooking) throw new Error("MEMBERSHIP_ATOMIC_CONFIRM_FAILED");
        // Durable membership-to-X904 receipt in the SAME payment transaction.
        // Do not enqueue physical commands or touch other mapped users here.
        await tx.execute(sql`
          INSERT INTO sport_center.x904_automatic_entitlement_events
            (membership_id,payment_id,reason,event_key)
          VALUES (${id},${updatedPayment.id},'PAYMENT_CONFIRMED',
            ${x904PaymentConfirmedEventKey(updatedPayment.id)})
          ON CONFLICT (event_key) DO NOTHING
        `);
        return { membership: updatedMembership, payment: updatedPayment, booking: paymentBooking, confirmedAt };
      });
      membership = result.membership;
      confirmedBundle = result;
      confirmationStage = "post_commit_projection";
    } else {
      await db.update(gymMembershipsTable).set(data).where(eq(gymMembershipsTable.id, id));
      const [updatedMembership] = await db.select().from(gymMembershipsTable)
        .where(eq(gymMembershipsTable.id, id)).limit(1);
      if (!updatedMembership) { res.status(404).json({ error: "Not found" }); return; }
      membership = updatedMembership;
    if ((data.startDate !== undefined || data.endDate !== undefined) && !paymentToConfirm) {
      await db
        .update(membershipPaymentsTable)
        .set({
          periodStart: membership.startDate,
          periodEnd: membership.endDate,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(membershipPaymentsTable.membershipId, membership.id),
            inArray(membershipPaymentsTable.status, ["pending_payment", "waiting_confirmation"]),
          ),
        );
    }

    if (membership.status === "cancelled" && existing.status !== "cancelled") {
      await db
        .update(membershipPaymentsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(membershipPaymentsTable.membershipId, membership.id),
            inArray(membershipPaymentsTable.status, ["pending_payment", "waiting_confirmation"]),
          ),
        );
    }

    }
    // External projections are never sent before the database transaction commits.
    syncMembershipToBizportal(membership).catch(() => {});
    if (confirmedBundle) {
      syncBookingRecordToBizportal(confirmedBundle.booking).catch((err) =>
        req.log.error({ err }, "[membership] Gagal sync booking konfirmasi ke Bizportal")
      );
      pushMembershipPaymentAsBankMutation(membership, confirmedBundle.payment, confirmedBundle.confirmedAt, confirmedBundle.booking).catch(() => {});
    }
    // Also repair/sync payment bookings when an admin changes the membership
    // dates or cancels it. This keeps the order mirror consistent with the
    // immutable membership payment events.
    // After a successful atomic commit, best-effort projections must not
    // report payment confirmation as failed. The canonical payment and X904
    // entitlement event have already been durably committed.
    try {
      await syncMembershipPaymentBookings(membership);
    } catch (projectionError) {
      req.log.error({ err: projectionError, membershipId: membership.id, paymentId: confirmingPaymentId },
        "Membership payment booking post-commit projection failed");
    }
    await syncToPublic(membership);
    res.json({ ...membership, totalPrice: Number(membership.totalPrice) });
  } catch (err) {
    const dbError = err as { code?: string; constraint?: string; message?: string; cause?: { code?: string; constraint?: string; message?: string } };
    const sqlState = dbError.cause?.code ?? dbError.code ?? null;
    const constraint = dbError.cause?.constraint ?? dbError.constraint ?? null;
    req.log.error({ err, confirmationStage, membershipId: req.params.id, paymentId: confirmingPaymentId, sqlState, constraint },
      "Update membership error");
    // Do not expose raw SQL, schema, credentials or user data to the client.
    // A stable stage/code helps support diagnose failed confirmations even
    // when the hosting provider's runtime log viewer is unavailable.
    res.status(500).json({
      error: "Konfirmasi pembayaran gagal. Transaksi belum berhasil disimpan; jangan unggah bukti atau membuat tagihan ulang.",
      code: "MEMBERSHIP_CONFIRMATION_FAILED",
      stage: confirmationStage,
      ...(sqlState ? { sqlState } : {}),
    });
  }
});

router.delete("/memberships/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    await db.delete(gymMembershipsTable).where(eq(gymMembershipsTable.id, id));
    await deleteFromPublic(id);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete membership error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
