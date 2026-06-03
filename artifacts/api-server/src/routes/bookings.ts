import { Router } from "express";
import { db, bookingsTable, facilitiesTable, paymentsTable, promosTable, discountSettingsTable, apMembersTable, bookingHistoryTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { adminMiddleware, authMiddleware } from "../lib/auth";
import { broadcastAvailabilityChange } from "../lib/supabase";
import { notifyBookingCreated, notifyPaymentConfirmed, notifyBookingCancelled } from "../lib/notifications";
import { logAudit, getClientInfo, getUserFromReq } from "../lib/auditLog";
import { syncBookingToBizportal, syncStatusToBizportal } from "../lib/bizportalSync";

const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];

const router = Router();

async function generateOrderNumber(): Promise<string> {
  const rows = await db.select({ orderNumber: bookingsTable.orderNumber }).from(bookingsTable);
  let maxNum = 0;
  for (const row of rows) {
    const match = row.orderNumber.match(/^SC-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = maxNum + 1;
  return `SC-${String(next).padStart(4, "0")}`;
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMinutes = h * 60 + (m || 0) + hours * 60;
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}

async function getBookingWithPayment(id: number) {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
  if (!booking) return null;
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, id)).limit(1);
  // idCardNumber adalah PII — jangan ekspos di endpoint publik (customer invoice).
  const { idCardNumber: _redacted, ...rest } = booking;
  return {
    ...rest,
    idCardNumber: null,
    totalPrice: Number(booking.totalPrice),
    discountAmount: Number(booking.discountAmount),
    basePrice: booking.basePrice == null ? null : Number(booking.basePrice),
    apDiscountAmount: Number(booking.apDiscountAmount),
    facilityName: facility?.name ?? "",
    facilityCategory: facility?.category ?? "",
    payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
  };
}

router.get("/bookings", adminMiddleware, async (req, res) => {
  try {
    const { status, date, facilityId, customerId } = req.query;
    let bookings = await db.select().from(bookingsTable);
    if (status) bookings = bookings.filter((b) => b.status === status);
    if (date) bookings = bookings.filter((b) => b.bookingDate === date);
    if (facilityId) bookings = bookings.filter((b) => b.facilityId === Number(facilityId));
    if (customerId) bookings = bookings.filter((b) => b.customerId === Number(customerId));

    const facilityIds = [...new Set(bookings.map((b) => b.facilityId))];
    const facilities = facilityIds.length > 0
      ? await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category })
          .from(facilitiesTable)
      : [];

    const bookingIds = bookings.map((b) => b.id);
    const payments = bookingIds.length > 0 ? await db.select().from(paymentsTable) : [];

    const result = bookings.map((b) => {
      const facility = facilities.find((f) => f.id === b.facilityId);
      const payment = payments.find((p) => p.bookingId === b.id);
      return {
        ...b,
        totalPrice: Number(b.totalPrice),
        discountAmount: Number(b.discountAmount),
        basePrice: b.basePrice == null ? null : Number(b.basePrice),
        apDiscountAmount: Number(b.apDiscountAmount),
        facilityName: facility?.name ?? "",
        facilityCategory: facility?.category ?? "",
        payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

function timeToMinutesLocal(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function getTodayWIB(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().split("T")[0];
}

function getNowMinutesWIB(): number {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

router.post("/bookings", async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, facilityId, bookingDate, notes, promoCode, discountAmount, customerType } = req.body;
    let { startTime, durationHours } = req.body;
    const activityType = req.body.activityType || null;
    const numberOfPeople = req.body.numberOfPeople ? Number(req.body.numberOfPeople) : null;
    const idCardNumber = String(req.body?.idCardNumber || "").trim().toUpperCase() || null;

    const isAp = customerType === "angkasa_pura";
    if (isAp && !idCardNumber) {
      res.status(400).json({ error: "Nomor ID Card wajib untuk customer Angkasa Pura" });
      return;
    }

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, Number(facilityId))).limit(1);
    if (!facility) {
      res.status(404).json({ error: "Facility not found" });
      return;
    }

    const isWalkIn = facility.bookingMode === "walk_in";

    if (isWalkIn) {
      // Gym walk-in: no time slot required, flat rate per visit
      startTime = facility.openTime;
      durationHours = 1;
    } else {
      // Time slot booking validations
      if (!startTime || !durationHours) {
        res.status(400).json({ error: "startTime and durationHours required" });
        return;
      }

      // Validate slot is not in the past
      const todayWIB = getTodayWIB();
      if (bookingDate === todayWIB) {
        const slotMinutes = timeToMinutesLocal(startTime);
        const nowMinutes = getNowMinutesWIB();
        if (slotMinutes <= nowMinutes) {
          res.status(400).json({ error: "Tidak dapat booking slot yang sudah lewat" });
          return;
        }
      }

      // Validate within operating hours
      const openMin = timeToMinutesLocal(facility.openTime);
      const closeMin = timeToMinutesLocal(facility.closeTime);
      const startMin = timeToMinutesLocal(startTime);
      const endMin = startMin + durationHours * 60;
      if (startMin < openMin || endMin > closeMin) {
        res.status(400).json({ error: `Booking harus dalam jam operasional ${facility.openTime}–${facility.closeTime}` });
        return;
      }

      // Conflict check
      const endTime = addHours(startTime, durationHours);
      const conflicting = await db.select().from(bookingsTable).where(
        and(eq(bookingsTable.facilityId, Number(facilityId)), eq(bookingsTable.bookingDate, bookingDate))
      );
      const active = conflicting.filter((b) => !INACTIVE_STATUSES.includes(b.status));
      const conflict = active.some((b) => {
        const bStart = timeToMinutesLocal(b.startTime);
        const bEnd = timeToMinutesLocal(b.endTime);
        const sMin = timeToMinutesLocal(startTime);
        const eMin = timeToMinutesLocal(endTime);
        return sMin < bEnd && eMin > bStart;
      });
      if (conflict) {
        res.status(409).json({ error: "Slot waktu ini sudah dipesan. Pilih jam lain." });
        return;
      }
    }

    const endTime = addHours(startTime, durationHours);
    const basePrice = Number(facility.pricePerHour) * (isWalkIn ? 1 : durationHours);
    const discount = isAp ? 0 : Math.min(Number(discountAmount) || 0, basePrice);
    const totalPrice = basePrice - discount;
    const orderNumber = await generateOrderNumber();

    const [booking] = await db.insert(bookingsTable).values({
      orderNumber,
      customerName,
      customerEmail,
      customerPhone,
      facilityId: Number(facilityId),
      bookingDate,
      startTime,
      endTime,
      durationHours: isWalkIn ? 1 : durationHours,
      totalPrice: String(totalPrice),
      promoCode: isAp ? null : (promoCode || null),
      discountAmount: String(discount),
      customerType: isAp ? "angkasa_pura" : "umum",
      idCardNumber: idCardNumber || null,
      verificationStatus: isAp ? "pending" : "not_required",
      basePrice: String(basePrice),
      activityType,
      numberOfPeople,
      notes,
      paymentDeadline: new Date(Date.now() + 30 * 60 * 1000),
    }).returning();

    if (promoCode && !isAp) {
      await db.update(promosTable)
        .set({ usedCount: sql`${promosTable.usedCount} + 1` })
        .where(eq(promosTable.code, String(promoCode).toUpperCase()));
    }

    // Record history
    await db.insert(bookingHistoryTable).values({
      bookingId: booking.id,
      fromStatus: null,
      toStatus: "pending_payment",
      changedByName: customerName,
      note: "Booking dibuat",
    });

    broadcastAvailabilityChange(Number(facilityId), bookingDate);

    // Sync to Bizportal (non-blocking)
    syncBookingToBizportal({ booking, facilityName: facility.name }).catch(() => {});

    // Send WA notification (non-blocking)
    const deadline = new Date(Date.now() + 30 * 60 * 1000);
    const deadlineStr = deadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
    notifyBookingCreated({
      customerName,
      customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility.name,
      bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: totalPrice.toLocaleString("id-ID"),
      paymentDeadline: deadlineStr,
    });

    res.status(201).json({
      ...booking,
      totalPrice: Number(booking.totalPrice),
      discountAmount: Number(booking.discountAmount),
      basePrice: booking.basePrice == null ? null : Number(booking.basePrice),
      apDiscountAmount: Number(booking.apDiscountAmount),
      facilityName: facility.name,
      facilityCategory: facility.category,
      payment: null,
    });
  } catch (err) {
    req.log.error({ err }, "Create booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- RECURRING BOOKING HELPERS ---

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function generateRecurringDates(
  startDate: string,
  repeatType: "weekly" | "monthly",
  repeatCount: number
): string[] {
  const dates: string[] = [];
  const base = new Date(startDate);
  for (let i = 0; i < repeatCount; i++) {
    const d = new Date(base);
    if (repeatType === "weekly") {
      d.setDate(d.getDate() + i * 7);
    } else {
      d.setMonth(d.getMonth() + i);
    }
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

async function checkSlotConflict(
  facilityId: number,
  bookingDate: string,
  startTime: string,
  endTime: string
): Promise<boolean> {
  const existing = await db.select().from(bookingsTable).where(
    and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, bookingDate))
  );
  const active = existing.filter((b) => !["cancelled", "expired", "rejected", "refunded"].includes(b.status));
  const sMin = timeToMinutes(startTime);
  const eMin = timeToMinutes(endTime);
  return active.some((b) => {
    const bStart = timeToMinutes(b.startTime);
    const bEnd = timeToMinutes(b.endTime);
    return sMin < bEnd && eMin > bStart;
  });
}

// POST /bookings/recurring/check
router.post("/bookings/recurring/check", async (req, res) => {
  try {
    const { facilityId, startDate, startTime, durationHours, repeatType, repeatCount } = req.body;

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, Number(facilityId))).limit(1);
    if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }

    const endTime = addHours(startTime, durationHours);
    const dates = generateRecurringDates(startDate, repeatType, repeatCount);

    const results = await Promise.all(
      dates.map(async (date) => {
        const conflict = await checkSlotConflict(Number(facilityId), date, startTime, endTime);
        return { date, available: !conflict, reason: conflict ? "Slot already booked" : null };
      })
    );

    const pricePerSession = Number(facility.pricePerHour) * durationHours;
    const validCount = results.filter((r) => r.available).length;

    res.json({
      dates: results,
      pricePerSession,
      validCount,
      totalPrice: pricePerSession * validCount,
    });
  } catch (err) {
    req.log.error({ err }, "Check recurring error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /bookings/recurring — create all valid (non-conflicting) bookings
router.post("/bookings/recurring", async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, facilityId, startDate, startTime, durationHours, notes, repeatType, repeatCount, specificDates, promoCode, discountAmountPerSession } = req.body;

    const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, Number(facilityId))).limit(1);
    if (!facility) { res.status(404).json({ error: "Facility not found" }); return; }

    const endTime = addHours(startTime, durationHours);
    const dates: string[] = Array.isArray(specificDates) && specificDates.length > 0
      ? specificDates
      : generateRecurringDates(startDate, repeatType, repeatCount);
    const basePrice = Number(facility.pricePerHour) * durationHours;
    const discount = Math.min(Number(discountAmountPerSession) || 0, basePrice);
    const totalPrice = basePrice - discount;

    const created: any[] = [];
    const skipped: string[] = [];

    for (const bookingDate of dates) {
      const conflict = await checkSlotConflict(Number(facilityId), bookingDate, startTime, endTime);
      if (conflict) {
        skipped.push(bookingDate);
        continue;
      }
      const orderNumber = await generateOrderNumber();
      const [booking] = await db.insert(bookingsTable).values({
        orderNumber,
        customerName,
        customerEmail,
        customerPhone,
        facilityId: Number(facilityId),
        bookingDate,
        startTime,
        endTime,
        durationHours,
        totalPrice: String(totalPrice),
        promoCode: promoCode || null,
        discountAmount: String(discount),
        notes,
      }).returning();
      broadcastAvailabilityChange(Number(facilityId), bookingDate);
      created.push({ ...booking, totalPrice: Number(booking.totalPrice), discountAmount: Number(booking.discountAmount), facilityName: facility.name, facilityCategory: facility.category, payment: null });
    }

    if (promoCode && created.length > 0) {
      await db.update(promosTable)
        .set({ usedCount: sql`${promosTable.usedCount} + ${created.length}` })
        .where(eq(promosTable.code, String(promoCode).toUpperCase()));
    }

    res.status(201).json({ created, skipped, totalBookings: created.length, grandTotal: totalPrice * created.length });
  } catch (err) {
    req.log.error({ err }, "Create recurring booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/my", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId as number;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const bookings = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.customerEmail, user.email));

    const facilities = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name, category: facilitiesTable.category }).from(facilitiesTable);
    const payments = await db.select().from(paymentsTable);

    const result = bookings.map((b) => {
      const facility = facilities.find((f) => f.id === b.facilityId);
      const payment = payments.filter((p) => p.bookingId === b.id).at(-1);
      return {
        ...b,
        facilityName: facility?.name ?? "",
        facilityCategory: facility?.category ?? "",
        paymentStatus: payment?.status ?? null,
        paymentProofUrl: payment?.proofUrl ?? null,
      };
    }).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get my bookings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/order/:orderNumber", async (req, res) => {
  try {
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, req.params.orderNumber)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const result = await getBookingWithPayment(booking.id);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get booking by order error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/:id", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const result = await getBookingWithPayment(id);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/bookings/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db.delete(paymentsTable).where(eq(paymentsTable.bookingId, id));
    await db.delete(bookingsTable).where(eq(bookingsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const ADMIN_ONLY_STATUSES = ["completed", "cancelled", "refunded"] as const;

router.patch("/bookings/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const { status, adminNotes } = req.body;

    const validStatuses = ["pending_payment", "paid", "confirmed", "completed", "cancelled", "refunded"];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status: ${status}` });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    const [beforeUpdate] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    await db.update(bookingsTable).set(updateData).where(eq(bookingsTable.id, id));
    const result = await getBookingWithPayment(id);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }

    if (status && beforeUpdate) {
      const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, id)).limit(1);
      syncStatusToBizportal(beforeUpdate.orderNumber, status, payment?.proofUrl, status === "confirmed" ? new Date() : null).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Update booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /bookings/:id/verify — verifikasi ID Card Angkasa Pura & terapkan diskon (admin)
router.post("/bookings/:id/verify", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const idCardNumber = String(req.body?.idCardNumber || "").trim().toUpperCase();
    if (!idCardNumber) {
      res.status(400).json({ error: "Nomor ID Card wajib diisi" });
      return;
    }

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }

    if (booking.customerType !== "angkasa_pura" || booking.verificationStatus !== "pending") {
      res.json({
        success: false,
        result: "not_pending",
        message: `Booking sudah berstatus '${booking.verificationStatus}', tidak perlu verifikasi.`,
      });
      return;
    }

    // ID Card di-scan harus cocok dengan yang diisi customer saat booking (jika ada)
    if (booking.idCardNumber && booking.idCardNumber !== idCardNumber) {
      res.json({
        success: false,
        result: "mismatch",
        message: `ID Card hasil scan (${idCardNumber}) tidak cocok dengan data booking (${booking.idCardNumber}).`,
      });
      return;
    }

    // Cocokkan ke daftar member Angkasa Pura yang aktif
    const [member] = await db.select().from(apMembersTable)
      .where(and(eq(apMembersTable.idCardNumber, idCardNumber), eq(apMembersTable.isActive, true)))
      .limit(1);

    if (!member) {
      await db.update(bookingsTable)
        .set({ verificationStatus: "rejected" })
        .where(eq(bookingsTable.id, id));
      res.json({
        success: false,
        result: "invalid_card",
        message: "ID Card tidak valid atau bukan member Angkasa Pura aktif.",
      });
      return;
    }

    const [setting] = await db.select().from(discountSettingsTable)
      .where(eq(discountSettingsTable.customerType, "angkasa_pura"))
      .limit(1);
    const discountEnabled = !!setting && setting.isActive;
    const discountPct = discountEnabled ? setting.discountPercentage : 0;
    const basePrice = booking.basePrice == null ? Number(booking.totalPrice) : Number(booking.basePrice);
    const discountAmount = Math.round((basePrice * discountPct) / 100);
    const finalPrice = basePrice - discountAmount;

    await db.update(bookingsTable).set({
      verificationStatus: "verified",
      idCardNumber,
      apDiscountAmount: String(discountAmount),
      totalPrice: String(finalPrice),
    }).where(eq(bookingsTable.id, id));

    const updated = await getBookingWithPayment(id);

    res.json({
      success: true,
      result: "verified",
      message: discountEnabled
        ? `Verifikasi berhasil. Diskon ${discountPct}% diterapkan. Harga akhir Rp ${finalPrice.toLocaleString("id-ID")}.`
        : "ID Card valid. Terverifikasi (diskon Angkasa Pura sedang nonaktif).",
      discountApplied: discountEnabled,
      discountPercentage: discountPct,
      discountAmount,
      finalPrice,
      memberName: member.name,
      booking: updated,
    });
  } catch (err) {
    req.log.error({ err }, "Verify booking error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
