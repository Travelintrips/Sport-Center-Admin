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
import { eq, and, desc, or, sql, ilike, inArray, like } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { logAudit } from "../lib/auditLog";

const router = Router();

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

// ─── GET /api/admin/wa-ai/sessions ────────────────────────────────────────────
router.get("/admin/wa-ai/sessions", adminMiddleware, async (req, res) => {
  const { page = "1", limit = "30", search = "" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, parseInt(limit) || 30);
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [];
  if (search) {
    const like_ = `%${search}%`;
    conditions.push(
      or(
        ilike(waBookingSessionsTable.phone, like_),
        ilike(waBookingSessionsTable.customerName, like_)
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totals] = await Promise.all([
    db.select({
      id: waBookingSessionsTable.id,
      phone: waBookingSessionsTable.phone,
      customerName: waBookingSessionsTable.customerName,
      currentStep: waBookingSessionsTable.currentStep,
      facilityId: waBookingSessionsTable.facilityId,
      facilityName: facilitiesTable.name,
      bookingDate: waBookingSessionsTable.bookingDate,
      startTime: waBookingSessionsTable.startTime,
      durationMinutes: waBookingSessionsTable.durationMinutes,
      status: waBookingSessionsTable.status,
      expiredAt: waBookingSessionsTable.expiredAt,
      createdAt: waBookingSessionsTable.createdAt,
      updatedAt: waBookingSessionsTable.updatedAt,
      messageCount: sql<number>`jsonb_array_length(${waBookingSessionsTable.rawMessages})`,
    })
      .from(waBookingSessionsTable)
      .leftJoin(facilitiesTable, eq(waBookingSessionsTable.facilityId, facilitiesTable.id))
      .where(where)
      .orderBy(desc(waBookingSessionsTable.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: sql<number>`cast(count(*) as int)` })
      .from(waBookingSessionsTable)
      .where(where),
  ]);

  const total = totals[0]?.total ?? 0;
  res.json({ sessions: rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
});

// ─── GET /api/admin/wa-ai/sessions/:id ────────────────────────────────────────
router.get("/admin/wa-ai/sessions/:id", adminMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const [session] = await db.select().from(waBookingSessionsTable).where(eq(waBookingSessionsTable.id, id)).limit(1);
  if (!session) return res.status(404).json({ error: "Session tidak ditemukan" });

  const facility = session.facilityId
    ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null
    : null;

  const booking = await db.select({
    id: bookingsTable.id,
    orderNumber: bookingsTable.orderNumber,
    status: bookingsTable.status,
    source: bookingsTable.source,
    totalPrice: bookingsTable.totalPrice,
    grandTotal: bookingsTable.grandTotal,
    createdAt: bookingsTable.createdAt,
  })
    .from(bookingsTable)
    .where(and(eq(bookingsTable.customerPhone, session.phone), eq(bookingsTable.source, "whatsapp_ai")))
    .orderBy(desc(bookingsTable.createdAt))
    .limit(1);

  const aiLogs = await db.select()
    .from(auditLogsTable)
    .where(
      and(
        like(auditLogsTable.action, "ai_%"),
        sql`${auditLogsTable.after}->>'phone' = ${session.phone}`
      )
    )
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(50);

  res.json({
    session,
    messages: (session as any).rawMessages ?? [],
    facility: facility ?? null,
    latestBooking: booking[0] ?? null,
    aiLogs,
  });
});

// ─── GET /api/admin/wa-ai/bookings ────────────────────────────────────────────
router.get("/admin/wa-ai/bookings", adminMiddleware, async (req, res) => {
  const { status, search, page = "1", limit = "30" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, parseInt(limit) || 30);
  const offset = (pageNum - 1) * limitNum;

  const conditions: any[] = [eq(bookingsTable.source, "whatsapp_ai")];
  if (status && status !== "all") {
    conditions.push(eq(bookingsTable.status, status as any));
  }
  if (search) {
    const like_ = `%${search}%`;
    conditions.push(
      or(
        ilike(bookingsTable.customerName, like_),
        ilike(bookingsTable.customerPhone, like_),
        ilike(bookingsTable.orderNumber, like_)
      ) as any
    );
  }

  const [rows, totals] = await Promise.all([
    db.select({
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
    })
      .from(bookingsTable)
      .leftJoin(facilitiesTable, eq(bookingsTable.facilityId, facilitiesTable.id))
      .where(and(...conditions))
      .orderBy(desc(bookingsTable.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: sql<number>`cast(count(*) as int)` })
      .from(bookingsTable)
      .where(and(...conditions)),
  ]);

  const total = totals[0]?.total ?? 0;
  res.json({ bookings: rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
});

// ─── GET /api/admin/wa-ai/intent-logs ─────────────────────────────────────────
router.get("/admin/wa-ai/intent-logs", adminMiddleware, async (req, res) => {
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, parseInt(limit) || 50);
  const offset = (pageNum - 1) * limitNum;

  const [rows, totals] = await Promise.all([
    db.select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "ai_intent_detected"))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: sql<number>`cast(count(*) as int)` })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "ai_intent_detected")),
  ]);

  const total = totals[0]?.total ?? 0;
  res.json({ logs: rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
});

// ─── GET /api/admin/wa-ai/error-logs ──────────────────────────────────────────
router.get("/admin/wa-ai/error-logs", adminMiddleware, async (req, res) => {
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, parseInt(limit) || 50);
  const offset = (pageNum - 1) * limitNum;

  const AI_ERROR_ACTIONS = [
    "ai_fallback_to_admin",
    "ai_error",
    "ai_reply_failed",
    "ai_talk_to_admin_handled",
    "unauthorized_admin_command",
  ];

  const [rows, totals] = await Promise.all([
    db.select()
      .from(auditLogsTable)
      .where(inArray(auditLogsTable.action, AI_ERROR_ACTIONS))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: sql<number>`cast(count(*) as int)` })
      .from(auditLogsTable)
      .where(inArray(auditLogsTable.action, AI_ERROR_ACTIONS)),
  ]);

  const total = totals[0]?.total ?? 0;
  res.json({ logs: rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
});

// ─── GET /api/admin/wa-ai/stats ───────────────────────────────────────────────
router.get("/admin/wa-ai/stats", adminMiddleware, async (req, res) => {
  const [
    totalSessions,
    activeSessions,
    totalAiBookings,
    pendingApproval,
    intentCounts,
    errorCount,
  ] = await Promise.all([
    db.select({ c: sql<number>`cast(count(*) as int)` }).from(waBookingSessionsTable),
    db.select({ c: sql<number>`cast(count(*) as int)` }).from(waBookingSessionsTable)
      .where(eq(waBookingSessionsTable.status, "active")),
    db.select({ c: sql<number>`cast(count(*) as int)` }).from(bookingsTable)
      .where(eq(bookingsTable.source, "whatsapp_ai")),
    db.select({ c: sql<number>`cast(count(*) as int)` }).from(bookingsTable)
      .where(and(eq(bookingsTable.source, "whatsapp_ai"), eq(bookingsTable.status, "waiting_admin_approval"))),
    db.select({
      intent: sql<string>`${auditLogsTable.after}->>'intent'`,
      count: sql<number>`cast(count(*) as int)`,
    })
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, "ai_intent_detected"))
      .groupBy(sql`${auditLogsTable.after}->>'intent'`)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db.select({ c: sql<number>`cast(count(*) as int)` }).from(auditLogsTable)
      .where(eq(auditLogsTable.action, "ai_fallback_to_admin")),
  ]);

  res.json({
    totalSessions: totalSessions[0]?.c ?? 0,
    activeSessions: activeSessions[0]?.c ?? 0,
    totalAiBookings: totalAiBookings[0]?.c ?? 0,
    pendingApproval: pendingApproval[0]?.c ?? 0,
    errorCount: errorCount[0]?.c ?? 0,
    topIntents: intentCounts.filter((r) => r.intent),
  });
});

// ─── POST /api/admin/wa-ai/sessions/:id/takeover ──────────────────────────────
router.post("/admin/wa-ai/sessions/:id/takeover", adminMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const { message } = req.body as { message?: string };
  if (!message?.trim()) return res.status(400).json({ error: "Pesan kosong" });

  const [session] = await db.select().from(waBookingSessionsTable).where(eq(waBookingSessionsTable.id, id)).limit(1);
  if (!session) return res.status(404).json({ error: "Session tidak ditemukan" });

  const adminUser = (req as any).user;
  const adminName = adminUser?.email ?? "admin";

  await sendWAMsg(session.phone, `👨‍💼 *Admin Sport Center:*\n\n${message.trim()}`);

  await db.update(waBookingSessionsTable).set({
    status: "admin_takeover",
    updatedAt: new Date(),
  }).where(eq(waBookingSessionsTable.id, id));

  await logAudit({
    action: "admin_takeover_chat",
    entity: "wa_session",
    after: { sessionId: id, phone: session.phone, message: message.trim(), adminName },
    userName: adminName,
  });

  res.json({ success: true, sentTo: session.phone });
});

export default router;
