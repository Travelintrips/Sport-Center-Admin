import { Router } from "express";
import {
  db,
  bookingsTable,
  facilitiesTable,
  paymentsTable,
  bookingHistoryTable,
  settingsTable,
  waBookingSessionsTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, desc, or, sql, ilike } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit, logAccountingError } from "../lib/auditLog";
import { createJournalEntry, createPublicAccountingEntry } from "../lib/accounting";
import { createWaToken } from "../lib/waTokens";
import {
  notifyWaBookingApproved,
  notifyWaBookingRejectedByAdmin,
  notifyWaBookingConfirmed,
  notifyWaStaffCheckin,
} from "../lib/notifications";

const router = Router();
const APP_URL = process.env.APP_URL ?? "";

function formatIDR(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

async function sendWAMsg(phone: string, message: string): Promise<void> {
  const token = process.env.FONNTE_TOKEN || "";
  if (!token || !phone) return;
  try {
    await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message }),
    });
  } catch {}
}

// ─── GET /api/admin/wa-bookings ───────────────────────────────────────────────
router.get("/admin/wa-bookings", adminMiddleware, async (req, res) => {
  const { status, search, page = "1", limit = "30" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, parseInt(limit) || 30);
  const offset = (pageNum - 1) * limitNum;

  const conditions: ReturnType<typeof eq>[] = [
    or(
      eq(bookingsTable.source, "whatsapp_chat"),
      eq(bookingsTable.source, "whatsapp")
    ) as any,
  ];
  if (status && status !== "all") {
    conditions.push(eq(bookingsTable.status, status as any));
  }
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      or(
        ilike(bookingsTable.customerName, like),
        ilike(bookingsTable.customerPhone, like),
        ilike(bookingsTable.orderNumber, like)
      ) as any
    );
  }

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: bookingsTable.id,
        orderNumber: bookingsTable.orderNumber,
        customerName: bookingsTable.customerName,
        customerPhone: bookingsTable.customerPhone,
        facilityId: bookingsTable.facilityId,
        facilityName: facilitiesTable.name,
        bookingDate: bookingsTable.bookingDate,
        startTime: bookingsTable.startTime,
        endTime: bookingsTable.endTime,
        durationHours: bookingsTable.durationHours,
        totalPrice: bookingsTable.totalPrice,
        grandTotal: bookingsTable.grandTotal,
        status: bookingsTable.status,
        source: bookingsTable.source,
        adminNotes: bookingsTable.adminNotes,
        approvedByAdminPhone: bookingsTable.approvedByAdminPhone,
        approvedAt: bookingsTable.approvedAt,
        rejectedReason: bookingsTable.rejectedReason,
        paidAt: bookingsTable.paidAt,
        paymentDeadline: bookingsTable.paymentDeadline,
        createdAt: bookingsTable.createdAt,
        updatedAt: bookingsTable.updatedAt,
      })
      .from(bookingsTable)
      .leftJoin(facilitiesTable, eq(bookingsTable.facilityId, facilitiesTable.id))
      .where(and(...conditions))
      .orderBy(desc(bookingsTable.createdAt))
      .limit(limitNum)
      .offset(offset),

    db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(bookingsTable)
      .where(and(...conditions)),
  ]);

  const total = totals[0]?.total ?? 0;
  res.json({ bookings: rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
});

// ─── GET /api/admin/wa-bookings/:orderNumber/detail ───────────────────────────
router.get("/admin/wa-bookings/:orderNumber/detail", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber))
    .limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId))
    .limit(1);

  const session = await db
    .select()
    .from(waBookingSessionsTable)
    .where(eq(waBookingSessionsTable.phone, booking.customerPhone))
    .orderBy(desc(waBookingSessionsTable.createdAt))
    .limit(1);

  const history = await db
    .select()
    .from(bookingHistoryTable)
    .where(eq(bookingHistoryTable.bookingId, booking.id))
    .orderBy(bookingHistoryTable.createdAt);

  const logs = await db
    .select()
    .from(auditLogsTable)
    .where(and(eq(auditLogsTable.entity, "booking"), eq(auditLogsTable.entityId, booking.id)))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(30);

  res.json({
    booking,
    facility: facility ?? null,
    session: session[0] ?? null,
    messages: (session[0] as any)?.messages ?? [],
    history,
    auditLogs: logs,
  });
});

// ─── POST /api/admin/wa-bookings/:orderNumber/approve ─────────────────────────
router.post("/admin/wa-bookings/:orderNumber/approve", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
  if (booking.status !== "waiting_admin_approval") {
    res.status(400).json({ error: `Status tidak valid: ${booking.status}` }); return;
  }

  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [settings] = await db.select().from(settingsTable).limit(1);
  const paymentDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.update(bookingsTable).set({
    status: "pending_payment",
    paymentDeadline,
    approvedByAdminPhone: adminName,
    approvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: "waiting_admin_approval",
    toStatus: "pending_payment",
    changedByName: adminName,
    note: "Booking disetujui admin via BizPortal. Customer diminta melakukan pembayaran.",
  });

  const proofToken = await createWaToken(booking.id, "upload_proof", 7);
  const deadlineStr = paymentDeadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
  const amountToPay = Number(booking.grandTotal ?? booking.totalPrice);

  notifyWaBookingApproved({
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    orderNumber: booking.orderNumber,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: amountToPay.toLocaleString("id-ID"),
    paymentDeadline: deadlineStr,
    statusUrl: `${APP_URL}/wa/status/${booking.orderNumber}`,
    uploadProofUrl: `${APP_URL}/wa/proof/${proofToken}`,
    bankName: settings?.bankName ?? "",
    bankAccount: settings?.bankAccount ?? "",
    bankAccountName: settings?.bankAccountName ?? "",
  });

  await logAudit({
    action: "admin_approved_via_wa",
    entity: "booking",
    entityId: booking.id,
    before: { status: "waiting_admin_approval" },
    after: { status: "pending_payment", approvedBy: adminName },
    userName: adminName,
  });

  res.json({ success: true, status: "pending_payment" });
});

// ─── POST /api/admin/wa-bookings/:orderNumber/reject ─────────────────────────
router.post("/admin/wa-bookings/:orderNumber/reject", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const { reason = "" } = req.body;
  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
  if (["cancelled", "rejected", "refunded", "completed"].includes(booking.status)) {
    res.status(400).json({ error: `Status tidak valid: ${booking.status}` }); return;
  }

  const [facility] = await db.select({ name: facilitiesTable.name })
    .from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

  await db.update(bookingsTable).set({
    status: "rejected",
    adminNotes: reason || null,
    rejectedReason: reason || null,
    updatedAt: new Date(),
  }).where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: "rejected",
    changedByName: adminName,
    note: reason ? `Ditolak admin via BizPortal. Alasan: ${reason}` : "Ditolak admin via BizPortal.",
  });

  notifyWaBookingRejectedByAdmin({
    customerPhone: booking.customerPhone,
    customerName: booking.customerName,
    orderNumber: booking.orderNumber,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    reason,
  });

  await logAudit({
    action: "admin_rejected_via_wa",
    entity: "booking",
    entityId: booking.id,
    before: { status: booking.status },
    after: { status: "rejected", reason },
    userName: adminName,
  });

  res.json({ success: true, status: "rejected" });
});

// ─── POST /api/admin/wa-bookings/:orderNumber/paid ────────────────────────────
router.post("/admin/wa-bookings/:orderNumber/paid", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
  if (!["pending_payment", "waiting_confirmation", "waiting_admin_approval"].includes(booking.status)) {
    res.status(400).json({ error: `Status tidak valid untuk mark paid: ${booking.status}` }); return;
  }

  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

  const [existingPay] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.bookingId, booking.id)).limit(1);
  if (existingPay) {
    await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(paymentsTable.bookingId, booking.id));
  } else {
    await db.insert(paymentsTable).values({
      bookingId: booking.id,
      amount: String(Number(booking.grandTotal ?? booking.totalPrice)),
      paymentMethod: "Manual (Admin BizPortal)",
      status: "confirmed",
      confirmedAt: new Date(),
    });
  }

  await db.update(bookingsTable).set({
    status: "confirmed",
    paidAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: "confirmed",
    changedByName: adminName,
    note: "Pembayaran dikonfirmasi dan booking disetujui via BizPortal.",
  });

  const checkinToken = await createWaToken(booking.id, "checkin", 30);
  const finishToken = await createWaToken(booking.id, "finish", 30);

  notifyWaBookingConfirmed({
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    orderNumber: booking.orderNumber,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
    statusUrl: `${APP_URL}/wa/status/${booking.orderNumber}`,
  });

  notifyWaStaffCheckin({
    orderNumber: booking.orderNumber,
    customerName: booking.customerName,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    checkinUrl: `${APP_URL}/wa/action/${checkinToken}`,
    finishUrl: `${APP_URL}/wa/action/${finishToken}`,
  });

  await logAudit({
    action: "admin_paid_via_wa",
    entity: "booking",
    entityId: booking.id,
    before: { status: booking.status },
    after: { status: "confirmed", paidAt: new Date() },
    userName: adminName,
  });

  const today = new Date().toISOString().split("T")[0];
  const subtotal = Number(booking.totalPrice);
  const ppnAmount = booking.ppnAmount != null ? Number(booking.ppnAmount) : 0;
  createJournalEntry(booking.id, booking.orderNumber, subtotal, ppnAmount, today).catch((err) =>
    logAccountingError({ operation: "createJournalEntry", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
  );
  createPublicAccountingEntry(booking.id, booking.orderNumber, subtotal, ppnAmount, booking.facilityId, today).catch((err) =>
    logAccountingError({ operation: "createPublicAccountingEntry", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
  );

  res.json({ success: true, status: "confirmed" });
});

// ─── POST /api/admin/wa-bookings/:orderNumber/resend ─────────────────────────
router.post("/admin/wa-bookings/:orderNumber/resend", adminMiddleware, async (req, res) => {
  const orderNumber = String(req.params.orderNumber);
  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [settings] = await db.select().from(settingsTable).limit(1);
  const amountToPay = Number(booking.grandTotal ?? booking.totalPrice);
  let sentTo = "";

  if (booking.status === "waiting_admin_approval") {
    const adminWaRaw = settings?.adminWaPhones ?? process.env.ADMIN_WA_PHONES ?? "";
    const adminList = adminWaRaw.split(",").map((p: string) => p.trim().replace(/\D/g, "").replace(/^0/, "62")).filter(Boolean);
    const msg =
      `🏅 *Booking WA Menunggu Persetujuan (Resend)*\n\n` +
      `Order: *${booking.orderNumber}*\nCustomer: *${booking.customerName}* (${booking.customerPhone})\n` +
      `Fasilitas: *${facility?.name ?? ""}*\nTanggal: *${booking.bookingDate}* pukul *${booking.startTime}–${booking.endTime}*\n` +
      `Total: *${formatIDR(amountToPay)}*\n\n` +
      `Ketik *APPROVE ${booking.orderNumber}* untuk menyetujui\nKetik *REJECT ${booking.orderNumber} [alasan]* untuk menolak`;
    for (const p of adminList) await sendWAMsg(p, msg);
    sentTo = `admins (${adminList.length})`;
  } else if (booking.status === "pending_payment") {
    const proofToken = await createWaToken(booking.id, "upload_proof", 7);
    const deadline = booking.paymentDeadline
      ? new Date(booking.paymentDeadline).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })
      : "-";
    notifyWaBookingApproved({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: amountToPay.toLocaleString("id-ID"),
      paymentDeadline: deadline,
      statusUrl: `${APP_URL}/wa/status/${booking.orderNumber}`,
      uploadProofUrl: `${APP_URL}/wa/proof/${proofToken}`,
      bankName: settings?.bankName ?? "",
      bankAccount: settings?.bankAccount ?? "",
      bankAccountName: settings?.bankAccountName ?? "",
    });
    sentTo = "customer (instruksi pembayaran)";
  } else if (booking.status === "confirmed") {
    notifyWaBookingConfirmed({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      statusUrl: `${APP_URL}/wa/status/${booking.orderNumber}`,
    });
    sentTo = "customer (konfirmasi booking)";
  } else {
    res.status(400).json({ error: `Tidak bisa resend untuk status: ${booking.status}` }); return;
  }

  await logAudit({
    action: "payment_link_sent",
    entity: "booking",
    entityId: booking.id,
    after: { orderNumber, resendTo: sentTo, resendBy: adminName },
    userName: adminName,
  });

  res.json({ success: true, sentTo });
});

export default router;
