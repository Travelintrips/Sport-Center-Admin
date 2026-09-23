import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, auditLogsTable, bookingsTable, facilitiesTable, paymentsTable, paymentAllocationsTable, bookingGroupsTable, bookingHistoryTable, waActionTokensTable, settingsTable, usersTable, blockedSchedulesTable, waBookingSessionsTable } from "@workspace/db";
import { eq, and, desc, isNotNull, inArray, or, ne, lt, gt, sql } from "drizzle-orm";
import { createWaToken, verifyWaToken, consumeWaToken, getWaTokenRow } from "../lib/waTokens";
import { getBaseUrl } from "../lib/appUrl";
import {
  parseIntent,
  detectFacilityKeyword,
  getNextStep,
  getActiveSession,
  createSession,
  updateSession,
  appendMessage,
  getRegisteredCustomer,
  formatSessionSummary,
  formatIDR,
  todayWIB,
  resolveBookingCustomerName,
  type WaStep,
  type WaBookingSessionRow,
} from "../lib/waBookingSession";
import {
  notifyWaBookingCreated,
  notifyWaProofUploaded,
  notifyWaBookingConfirmed,
  notifyWaPaymentRejected,
  notifyWaStaffCheckin,
  notifyWaCustomerRegistered,
  notifyWaBookingPendingApproval,
  notifyWaBookingPaymentRequired,
  notifyWaProofReceived,
  notifyWaAdminNewBooking,
  notifyWaBookingApproved,
  notifyWaBookingRejectedByAdmin,
  notifyCustomerBookingApproved,
  notifyCustomerBookingRejectedByAdmin,
} from "../lib/notifications";
import { calculatePrice } from "../lib/pricing";
import { calculateBookingWithholdingTax } from "../lib/tax";
import { logAudit, logAccountingError } from "../lib/auditLog";
import { extractBookingDpp, postConfirmedPaymentAccounting } from "../lib/accounting";
import { hashPassword } from "../lib/auth";
import { syncStatusToBizportal, pushConfirmedPaymentAsBankMutation } from "../lib/bizportalSync";
import { recordTaxTransaction, resolveCustomerTax } from "../lib/tax";
import { generateBookingOrderNumber } from "../lib/orderNumber";
import {
  checkInBooking,
  completeBooking,
  isBookingConfirmableStatus,
} from "../lib/bookingLifecycle";
import { ensurePaymentBankAccount, resolveRequiredPaymentEnrichment } from "../lib/paymentEnrichment";
import { createPaymentProviderId, createPaymentProviderOrderId, normalizeProviderName } from "../lib/paymentMetadata";
import { broadcastAvailabilityChange } from "../lib/supabase";
import { logger } from "../lib/logger";
import { uploadProofWithFallback } from "./storage";
import {
  generateAiReply,
  logAiMessageReceived,
  logAiIntentDetected,
  detectIntent,
} from "../services/aiSportCenterService";
import {
  trackSentMessage,
  isBotEcho,
  isMinaGreetingEcho,
  isFonnteProviderEcho,
} from "../lib/waSentTracker";
import { allowWhatsAppProviderSend } from "../lib/whatsappSafety";
import {
  getFonnteConfig,
  selectFonnteToken,
  validateMinaFonnteWebhookDevice,
} from "../lib/fonnteConfig";
import { getHistory, appendTurn, clearHistory } from "../lib/aiConversationMemory";
import {
  paymentMethodMatchesOcr,
  paymentProofDateMatchesBooking,
  scanPaymentProof,
  storedPaymentProofOcr,
} from "../lib/paymentProofOcr";
import { insertGroupPaymentAllocations } from "../lib/paymentAllocations";
import {
  getNearestAvailableSlots,
  hasSlotConflict,
  isRecentMessageDuplicate,
  switchBookingFacility,
  formatAlternativeFacilityOptions,
  getAlternativeBookingDraftPatch,
  parseAlternativeBookingChoice,
} from "../lib/waBookingFlow";

const router = Router();

type FonnteReplyContext = {
  inboxId?: string;
};

const fonnteReplyContext = new AsyncLocalStorage<FonnteReplyContext>();

function resolveFonnteInboxId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const payload = body as Record<string, unknown>;
  const raw = payload.inboxid ?? payload.inboxId ?? payload.inbox_id;
  if (raw === null || raw === undefined || raw === "") return undefined;
  const value = String(raw).trim();
  return /^\d+$/.test(value) ? value : undefined;
}

// Base URL for WA links is always resolved fresh via getBaseUrl():
// dev environments always use the Replit dev domain (never a prod domain
// saved in settings), production uses APP_URL / settings.paymentDomain / settings.appUrl.
// See lib/appUrl.ts — single source of truth, shared with bookings.ts, payments.ts, notifications.ts.

const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];

// ─── Registration token helpers (HMAC-signed, 1 hour TTL) ─────────────────────
function generateRegToken(phone: string): string {
  const ts = Date.now();
  const data = `${phone}|${ts}`;
  const sig = createHmac("sha256", process.env.SESSION_SECRET ?? "secret").update(data).digest("hex");
  return Buffer.from(JSON.stringify({ p: phone, t: ts, s: sig })).toString("base64url");
}

function verifyRegToken(raw: string): { phone: string } | null {
  try {
    const { p, t, s } = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (!p || !t || !s) return null;
    if (Date.now() - Number(t) > 3_600_000) return null; // 1 jam
    const expected = createHmac("sha256", process.env.SESSION_SECRET ?? "secret")
      .update(`${p}|${t}`).digest("hex");
    const eBuf = Buffer.from(expected, "hex");
    const sBuf = Buffer.from(s, "hex");
    if (eBuf.length !== sBuf.length || !timingSafeEqual(eBuf, sBuf)) return null;
    return { phone: p };
  } catch { return null; }
}

// ─── Webhook deduplication — cegah Fonnte retry/outgoing loop ─────────────────
const _processedMsgIds = new Set<string>();

function isOutgoingMessage(body: Record<string, unknown>): boolean {
  // Semua variasi field Fonnte untuk pesan outgoing (balasan bot sendiri)
  if (body.me === true || body.me === "true") return true;
  if (body.is_me === true || body.is_me === "true") return true;
  if (body.from_me === true || body.from_me === "true") return true;
  if (body.is_from_me === true || body.is_from_me === "true") return true;
  if (body.outgoing === true || body.outgoing === "true") return true;
  // Fonnte kadang kirim type "outgoing" atau "sent"
  const type = String(body.type ?? body.message_type ?? "").toLowerCase();
  if (type === "outgoing" || type === "sent") return true;
  return false;
}

function isDuplicateWebhook(body: Record<string, unknown>): boolean {
  // Skip pesan outgoing (balasan bot sendiri)
  if (isOutgoingMessage(body)) return true;

  // Cek message ID unik — Fonnte kadang retry dengan id yang sama
  const id = body.id ?? body.message_id ?? body.msg_id ?? body.msgId;
  if (id) {
    const key = String(id);
    if (_processedMsgIds.has(key)) return true;
    _processedMsgIds.add(key);
    // Bersihkan setelah 10 menit agar tidak memory leak
    const cleanupTimer = setTimeout(() => _processedMsgIds.delete(key), 10 * 60 * 1000);
    cleanupTimer.unref?.();
  }
  return false;
}

// ─── Multer for proof upload (memory → Storage) ───────────────────────────────
const uploadProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Accept all image types + PDF. Some mobile browsers (especially WhatsApp
    // on Android/iOS) may send image/heic, image/heif, or even
    // application/octet-stream for camera photos — accept broadly.
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/octet-stream";
    cb(null, ok);
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function addHours(time: string, hours: number): string {
  const total = timeToMinutes(time) + hours * 60;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

async function generateCustomerCode(): Promise<string> {
  const rows = await db.select({ customerCode: usersTable.customerCode }).from(usersTable).where(isNotNull(usersTable.customerCode));
  let maxNum = 0;
  for (const row of rows) {
    const match = row.customerCode?.match(/^SC-CUST-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `SC-CUST-${String(maxNum + 1).padStart(6, "0")}`;
}

async function checkConflict(facilityId: number, bookingDate: string, startTime: string, endTime: string): Promise<boolean> {
  const [existing, blocked] = await Promise.all([
    db.select().from(bookingsTable)
      .where(and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, bookingDate))),
    db.select({
      startTime: blockedSchedulesTable.startTime,
      endTime: blockedSchedulesTable.endTime,
    }).from(blockedSchedulesTable)
      .where(and(eq(blockedSchedulesTable.facilityId, facilityId), eq(blockedSchedulesTable.date, bookingDate))),
  ]);
  const active = existing.filter((b) => !INACTIVE_STATUSES.includes(b.status));
  const sMin = timeToMinutes(startTime);
  const eMin = timeToMinutes(endTime);
  const bookingConflict = active.some((b) => {
    const bS = timeToMinutes(b.startTime);
    const bE = timeToMinutes(b.endTime);
    return sMin < bE && eMin > bS;
  });
  if (bookingConflict) return true;

  return blocked.some((schedule) => {
    const blockStart = timeToMinutes(schedule.startTime);
    const blockEnd = timeToMinutes(schedule.endTime);
    return sMin < blockEnd && eMin > blockStart;
  });
}

async function getBookingFull(id: number) {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
  if (!booking) return null;
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const groupBookingIds = booking.groupRef
    ? (await db.select({ id: bookingsTable.id }).from(bookingsTable)
        .where(eq(bookingsTable.groupRef, booking.groupRef))).map((row) => row.id)
    : [id];
  const groupPayments = await db.select().from(paymentsTable)
    .where(inArray(paymentsTable.bookingId, groupBookingIds))
    .orderBy(desc(paymentsTable.createdAt));
  const payment = groupPayments[0] ?? null;
  const paymentAllocations = booking.groupRef
    ? await db.select().from(paymentAllocationsTable)
      .where(inArray(paymentAllocationsTable.bookingId, groupBookingIds))
    : [];
  return {
    ...booking,
    totalPrice: Number(booking.totalPrice),
    discountAmount: Number(booking.discountAmount),
    basePrice: booking.basePrice == null ? null : Number(booking.basePrice),
    apDiscountAmount: Number(booking.apDiscountAmount),
    ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
    dpp: booking.dpp == null ? null : Number(booking.dpp),
    ppnAmount: booking.ppnAmount == null ? null : Number(booking.ppnAmount),
    grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
    facilityName: facility?.name ?? "",
    facilityCategory: facility?.category ?? "",
    payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
    payments: groupPayments.map((p) => ({ ...p, amount: Number(p.amount) })),
    paymentAllocations: paymentAllocations.map((allocation) => ({
      ...allocation,
      amount: Number(allocation.amount),
    })),
  };
}

// ─── Keyword detection ────────────────────────────────────────────────────────
const FACILITY_KEYWORDS: Record<string, string[]> = {
  serbaguna: ["serbaguna", "multiguna", "hall", "aula", "futsal", "sepak bola", "bola", "mini soccer"],
  basket: ["basket", "basketball", "bola basket"],
  badminton: ["badminton", "bulutangkis", "bulu tangkis", "shuttle"],
  tennis: ["tennis", "tenis"],
  gym: ["gym", "fitness", "fitnes"],
  voli: ["voli", "volley", "volleyball", "bola voli"],
  renang: ["renang", "kolam", "swimming"],
  squash: ["squash"],
  golf: ["golf", "driving range"],
  billiard: ["billiard", "biliar", "bilyard"],
};


function isBookingIntent(msg: string): boolean {
  const lower = msg.toLowerCase();
  return ["booking", "pesan", "mau book", "mau pesen", "sewa", "daftar", "reserv"].some((kw) => lower.includes(kw));
}

function isStatusIntent(msg: string): boolean {
  const lower = msg.toLowerCase();
  return ["status", "cek", "check", "order", "booking saya", "pesanan"].some((kw) => lower.includes(kw));
}

function cleanPhone(phone: string): string {
  return phone.replace(/@.*$/, "").replace(/\D/g, "").replace(/^0/, "62");
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/wa/facilities — list active facilities for webhook menu
router.get("/wa/facilities", async (req, res) => {
  try {
    const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));
    res.json(facilities.map((f) => ({
      id: f.id,
      name: f.name,
      category: f.category,
      pricePerHour: Number(f.pricePerHour),
      openTime: f.openTime,
      closeTime: f.closeTime,
      bookingMode: f.bookingMode,
      minDuration: f.minDuration,
      maxDuration: f.maxDuration,
    })));
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/wa/facility/:facilityId — mini form data
router.get("/wa/facility/:facilityId", async (req, res) => {
  try {
    const [facility] = await db.select().from(facilitiesTable)
      .where(and(eq(facilitiesTable.id, Number(req.params.facilityId)), eq(facilitiesTable.isActive, true)))
      .limit(1);
    if (!facility) { res.status(404).json({ error: "Fasilitas tidak ditemukan" }); return; }
    res.json({
      id: facility.id,
      name: facility.name,
      category: facility.category,
      pricePerHour: Number(facility.pricePerHour),
      openTime: facility.openTime,
      closeTime: facility.closeTime,
      bookingMode: facility.bookingMode,
      minDuration: facility.minDuration,
      maxDuration: facility.maxDuration,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/wa/customer/check/:phone — cek apakah nomor WA sudah terdaftar
router.get("/wa/customer/check/:phone", async (req, res) => {
  try {
    const cleaned = cleanPhone(req.params.phone);
    const [user] = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      customerCode: usersTable.customerCode,
      registrationSource: usersTable.registrationSource,
    }).from(usersTable).where(eq(usersTable.phone, cleaned)).limit(1);

    if (!user) {
      res.json({ registered: false });
      return;
    }
    res.json({ registered: true, name: user.name, customerCode: user.customerCode, registrationSource: user.registrationSource });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wa/customer/register — registrasi customer baru via WA (public)
router.post("/wa/customer/register", async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (!name || !phone) {
      res.status(400).json({ error: "Nama dan nomor WhatsApp wajib diisi" });
      return;
    }

    const cleanedPhone = cleanPhone(phone);

    // Cek duplikat nomor
    const [existing] = await db.select({ id: usersTable.id, name: usersTable.name, customerCode: usersTable.customerCode })
      .from(usersTable).where(eq(usersTable.phone, cleanedPhone)).limit(1);
    let createdPayment: typeof paymentsTable.$inferSelect | undefined;
    if (existing) {
      res.status(409).json({
        error: "Nomor WhatsApp sudah terdaftar",
        customerCode: existing.customerCode,
        alreadyRegistered: true,
      });
      return;
    }

    // Generate customer code
    const customerCode = await generateCustomerCode();

    // Auto-generate email jika tidak diisi
    const finalEmail = email?.trim() || `wa_${cleanedPhone}@sportcenter.wa`;

    // Cek duplikat email
    const [emailExists] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, finalEmail)).limit(1);
    if (emailExists) {
      res.status(409).json({ error: "Email sudah digunakan. Silakan gunakan email lain." });
      return;
    }

    // Password random untuk WA users
    const passwordHash = await hashPassword(randomBytes(16).toString("hex"));

    const [user] = await db.insert(usersTable).values({
      name: name.trim(),
      email: finalEmail,
      passwordHash,
      phone: cleanedPhone,
      role: "customer",
      customerCode,
      registrationSource: "whatsapp",
    }).returning();

    // Notifikasi WA selamat datang
    notifyWaCustomerRegistered({
      customerName: user.name,
      customerPhone: cleanedPhone,
      customerCode,
      facilitiesUrl: `${await getBaseUrl()}/facilities`,
    });

    // Audit log
    await logAudit({
      action: "CUSTOMER_REGISTERED_VIA_WA",
      entity: "user",
      entityId: user.id,
      after: { customerCode, phone: cleanedPhone, name: user.name, registrationSource: "whatsapp" },
    });

    res.status(201).json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      customerCode,
      registrationSource: "whatsapp",
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("[wa/customer/register] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/wa/register/:token — verifikasi token pendaftaran first-time
router.get("/wa/register/:token", async (req, res) => {
  const payload = verifyRegToken(req.params.token);
  if (!payload) {
    return res.status(200).json({ valid: false, message: "Link sudah kedaluwarsa atau tidak valid. Ketik 'booking' di WhatsApp untuk mendapatkan link baru." });
  }
  // Masking nomor HP: hanya tampilkan 4 digit terakhir
  const masked = payload.phone.replace(/(\d{4,})(\d{4})$/, (_, prefix, last) => "*".repeat(prefix.length) + last);
  return res.json({ valid: true, phone: masked });
});

// POST /api/wa/register/:token — simpan data member, kirim konfirmasi WA
router.post("/wa/register/:token", async (req, res) => {
  const payload = verifyRegToken(req.params.token);
  if (!payload) {
    return res.status(400).json({ error: "Link sudah kedaluwarsa. Ketik 'booking' di WhatsApp untuk mendapatkan link baru." });
  }

  const { name, email } = req.body as { name?: string; email?: string };
  if (!name?.trim()) {
    return res.status(400).json({ error: "Nama lengkap wajib diisi." });
  }

  const phone = payload.phone;
  try {
    // Cek apakah sudah terdaftar (idempotent)
    const [existing] = await db.select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable).where(eq(usersTable.phone, phone)).limit(1);

    let customerCode: string | undefined;
    let userId: number;
    if (existing) {
      userId = existing.id;
      // Buat akun baru
      customerCode = await generateCustomerCode();

      const baseEmail = email?.trim() || `wa_${phone}@whatsapp.local`;
      const [emailConflict] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.email, baseEmail)).limit(1);
      const finalEmail = emailConflict ? `wa_${phone}_${Date.now()}@whatsapp.local` : baseEmail;
       const passwordHash = await hashPassword(randomBytes(16).toString("hex"));

      const [user] = await db.insert(usersTable).values({
        name: name.trim(),
        email: finalEmail,
        passwordHash,
        phone,
        role: "customer",
        customerCode,
        registrationSource: "whatsapp",
      }).returning({ id: usersTable.id });
      userId = user.id;

      await logAudit({
        action: "CUSTOMER_REGISTERED_VIA_WA_FORM",
        entity: "user",
        entityId: userId,
        after: { customerCode, phone, name: name.trim(), email: finalEmail, registrationSource: "whatsapp_reg_form" },
      });
    }

    // Expire session wait_registration yang masih aktif
    await db.update(waBookingSessionsTable)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(
        eq(waBookingSessionsTable.phone, phone),
        eq(waBookingSessionsTable.currentStep, "wait_registration"),
        eq(waBookingSessionsTable.status, "active"),
      ));

    // Kirim konfirmasi via WhatsApp
    const firstName = name.trim().split(" ")[0];
    await sendWAMsg(phone, `✅ Pendaftaran berhasil, *${firstName}*! 🎉\n\nData Anda sudah tersimpan. Sekarang ketik *booking* untuk mulai membuat pesanan. 🏅`, true);

    return res.json({ success: true, name: name.trim() });
  } catch (err) {
    console.error("[wa/register] error:", err);
    return res.status(500).json({ error: "Terjadi kesalahan. Silakan coba lagi." });
  }
});

// POST /api/wa/webhook — legacy handler kept only under a private compatibility
// path. The public compatibility path is registered with the canonical Mina
// handler below, so it gets the same natural-language booking UX.
router.post("/wa/webhook-legacy", async (req, res) => {
  res.status(200).json({ status: "ok" });

  try {
    const deviceCheck = await validateMinaFonnteWebhookDevice(req.body);
    if (!deviceCheck.accepted) {
      req.log?.warn?.(
        { providedDevice: deviceCheck.providedDevice, path: "/api/wa/webhook" },
        "[wa-webhook] inbound device is not the configured Mina device; message ignored",
      );
      await logAudit({
        action: "mina_webhook_device_rejected",
        entity: "wa_session",
        after: { providedDevice: deviceCheck.providedDevice, path: "/api/wa/webhook" },
      });
      return;
    }

    if (isDuplicateWebhook(req.body)) return;
    const { sender, message = "", name = "" } = req.body;
    if (!sender || !message) return;

    const senderPhone = cleanPhone(String(sender));
    const msg = String(message).trim();

    // ── Fast-path: cek status booking terakhir ────────────────────────────────
    if (isStatusIntent(msg)) {
      const bookings = await db.select().from(bookingsTable)
        .where(eq(bookingsTable.customerPhone, senderPhone))
        .orderBy(desc(bookingsTable.createdAt))
        .limit(1);

      if (bookings.length > 0) {
        const b = bookings[0];
        const [fac] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
          .where(eq(facilitiesTable.id, b.facilityId)).limit(1);
        const statusUrl = `${await getBaseUrl()}/status/${b.orderNumber}`;
        await sendWAReply(senderPhone,
          `🔍 *Status Booking Terakhir*\n\n` +
          `Order: *${b.orderNumber}*\n` +
          `Fasilitas: *${fac?.name ?? ""}*\n` +
          `Tanggal: *${b.bookingDate}* pukul *${b.startTime}–${b.endTime}*\n` +
          `Status: *${b.status.replace(/_/g, " ").toUpperCase()}*\n\n` +
          `Detail lengkap: ${statusUrl}`
        );
      } else {
        await sendWAReply(senderPhone,
          `Tidak ada booking yang terdaftar untuk nomor ini.\n\nKetik *booking* untuk membuat booking baru. 🏅`
        );
      }
      appendTurn(senderPhone, "user", msg);
      return;
    }

    // ── Fast-path: booking intent → cek registrasi dulu ──────────────────────
    if (isBookingIntent(msg)) {
      const [registeredUser] = await db.select({ id: usersTable.id, name: usersTable.name, customerCode: usersTable.customerCode })
        .from(usersTable).where(eq(usersTable.phone, senderPhone)).limit(1);
    if (!isBookingIntent(msg)) {
      // Fallback: balas semua pesan dengan menu utama
      await sendWAReply(senderPhone,
        `👋 Halo! Selamat datang di *Sport Center Bandara Soekarno Hatta*.\n\n` +
        `Ketik salah satu perintah berikut:\n` +
        `🏅 *booking* — Buat booking fasilitas\n` +
        `🔍 *status* — Cek status booking\n\n` +
        `Atau ketik nama fasilitas (badminton, futsal, gym, dll.)`
      );
      return;
    }

      if (!registeredUser) {
        const regToken = generateRegToken(senderPhone);
        const registerUrl = `${await getBaseUrl()}/wa/register/${regToken}`;
        await sendWAReply(senderPhone,
          `👋 Halo! Untuk booking fasilitas, kamu perlu *daftar dulu* sebagai customer.\n\n` +
          `📝 *Daftar gratis sekarang (hanya 1 menit):*\n${registerUrl}\n\n` +
          `Setelah mengisi, ketik *booking* lagi di sini dan kita langsung bantu! 🏅`
        );
        appendTurn(senderPhone, "user", msg);
        return;
      }

      const keyword = detectFacilityKeyword(msg);
      const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));

      if (keyword) {
        type FacilityRow = typeof facilities[number];
        const matched = facilities.find((f: FacilityRow) =>
          f.name.toLowerCase().includes(keyword) ||
          f.category.toLowerCase().includes(keyword) ||
          keyword === f.category.toLowerCase()
        ) ?? facilities.find((f: FacilityRow) =>
          Object.entries(FACILITY_KEYWORDS).some(([k, kws]) =>
            k === keyword && (kws.some((kw) => f.name.toLowerCase().includes(kw)) || kws.some((kw) => f.category.toLowerCase().includes(kw)))
          )
        );

        if (matched) {
          const formUrl = `${await getBaseUrl()}/wa/booking/${matched.id}?phone=${senderPhone}`;
          const reply =
            `🏅 *Booking ${matched.name}*\n\n` +
            `Harga: *Rp ${Number(matched.pricePerHour).toLocaleString("id-ID")}/jam*\n` +
            `Jam operasional: *${matched.openTime} – ${matched.closeTime}*\n\n` +
            `Silakan isi form booking di sini:\n${formUrl}\n\n` +
            `Form hanya berlaku 30 menit setelah dibuka. ⏰`;
          await sendWAReply(senderPhone, reply);
          appendTurn(senderPhone, "user", msg);
          appendTurn(senderPhone, "assistant", reply);
          return;
        }
      }

      const list = facilities.map((f: typeof facilities[number], i: number) =>
        `${i + 1}. *${f.name}* — Rp ${Number(f.pricePerHour).toLocaleString("id-ID")}/jam`
      ).join("\n");
      const reply =
        `🏟️ *Fasilitas Sport Center*\n\n${list}\n\n` +
        `Sebutkan fasilitas yang ingin kamu booking, contoh:\n` +
        `_"mau booking lapangan basket"_\n_"booking futsal"_`;
      await sendWAReply(senderPhone, reply);
      appendTurn(senderPhone, "user", msg);
      appendTurn(senderPhone, "assistant", reply);
      return;
    }

    // ── AI reply untuk semua pesan lainnya ───────────────────────────────────
    const history = getHistory(senderPhone);
    appendTurn(senderPhone, "user", msg);

    try {
      const aiResult = await generateAiReply(senderPhone, msg, history);

      // Jika AI minta handoff ke booking flow
      if (aiResult.shouldHandoffToBookingFlow) {
        const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));
        const list = facilities.map((f: typeof facilities[number], i: number) =>
          `${i + 1}. *${f.name}* — Rp ${Number(f.pricePerHour).toLocaleString("id-ID")}/jam`
        ).join("\n");
        const reply =
          `🏟️ *Fasilitas Sport Center*\n\n${list}\n\n` +
          `Sebutkan fasilitas yang ingin kamu booking, contoh:\n` +
          `_"mau booking lapangan basket"_\n_"booking futsal"_`;
        await sendWAReply(senderPhone, reply);
        appendTurn(senderPhone, "assistant", reply);
        return;
      }

      if (aiResult.reply) {
        await sendWAReply(senderPhone, aiResult.reply);
        appendTurn(senderPhone, "assistant", aiResult.reply);
      }
    } catch (aiErr) {
      // ── Fallback statis jika DB / AI sedang gangguan ──────────────────────
      console.error("[wa/webhook] AI error, using static fallback:", aiErr);
      const fallback =
        `Halo! 👋 Terima kasih sudah menghubungi *Sport Center Soekarno-Hatta*.\n\n` +
        `🕐 *Jam Operasional:* 06:00 – 22:00 WIB\n` +
        `📍 *Lokasi:* Kawasan Bandara Soekarno-Hatta\n\n` +
        `Untuk info fasilitas & booking, kunjungi:\n` +
        `🔗 ${await getBaseUrl()}/facilities\n\n` +
        `Atau ketik:\n` +
        `• *booking* — untuk pesan lapangan\n` +
        `• *status* — untuk cek status pesanan\n\n` +
        `Admin kami akan segera membantu. 🙏`;
      await sendWAReply(senderPhone, fallback);
      appendTurn(senderPhone, "assistant", fallback);
    }
  } catch (err) {
    console.error("[wa/webhook] error:", err);
  }
});

async function sendWAReply(phone: string, message: string): Promise<void> {
  await sendWAMsg(phone, message, true);
}

// POST /api/wa/booking — create booking from mini form
router.post("/wa/booking", async (req, res) => {
  try {
    const { customerName, customerPhone, facilityId, bookingDate, startTime, durationHours, notes } = req.body;

    if (!customerName || !customerPhone || !facilityId || !bookingDate || !startTime || !durationHours) {
      res.status(400).json({ error: "Semua field wajib diisi" });
      return;
    }

    const [facility] = await db.select().from(facilitiesTable)
      .where(and(eq(facilitiesTable.id, Number(facilityId)), eq(facilitiesTable.isActive, true)))
      .limit(1);
    if (!facility) { res.status(404).json({ error: "Fasilitas tidak ditemukan" }); return; }

    const endTime = addHours(startTime, Number(durationHours));

    // Operating hours validation
    const openMin = timeToMinutes(facility.openTime);
    const closeMin = timeToMinutes(facility.closeTime);
    const startMin = timeToMinutes(startTime);
    const endMin = timeToMinutes(endTime);
    if (startMin < openMin || endMin > closeMin) {
      res.status(400).json({ error: `Booking harus dalam jam operasional ${facility.openTime}–${facility.closeTime}` });
      return;
    }

    // Conflict check
    const conflict = await checkConflict(Number(facilityId), bookingDate, startTime, endTime);
    if (conflict) {
      res.status(409).json({ error: "Slot waktu ini sudah dipesan. Pilih jam lain." });
      return;
    }

    const totalPrice = Number(facility.pricePerHour) * Number(durationHours);
    const customer = await ensureCustomer(customerPhone, customerName);
    const taxCalc = await resolveCustomerTax(totalPrice, {
      customerId: customer.id,
      bookingDate,
    });
    const orderNumber = await generateBookingOrderNumber();
    const paymentDeadline = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const [booking] = await db.insert(bookingsTable).values({
      orderNumber,
      customerName,
      customerEmail: customer.email,
      customerPhone,
      customerId: customer.id,
      facilityId: Number(facilityId),
      bookingDate,
      startTime,
      endTime,
      durationHours: Number(durationHours),
      totalPrice: String(totalPrice),
      discountAmount: "0",
      apDiscountAmount: "0",
      basePrice: String(totalPrice),
      source: "whatsapp",
      notes: notes || null,
      paymentDeadline,
      status: "pending_payment",
      ppnRate: taxCalc.taxRate > 0 ? String(taxCalc.taxRate) : null,
      dpp: String(taxCalc.dpp),
      ppnAmount: String(taxCalc.taxAmount),
      grandTotal: String(taxCalc.grandTotal),
      ppnTreatment: taxCalc.ppnTreatment,
      ppnCollectedByCustomer: taxCalc.ppnCollectedByCustomer,
    }).returning();

    // History
    await db.insert(bookingHistoryTable).values({
      bookingId: booking.id,
      fromStatus: null,
      toStatus: "pending_payment",
      changedByName: customerName,
      note: "Booking dibuat via WhatsApp",
    });

    broadcastAvailabilityChange(Number(facilityId), bookingDate);

    // Record tax transaction (non-blocking)
    if (taxCalc.taxCode) {
      recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, bookingDate).catch(() => {});
    }

    // Create proof upload token (multi-use, 7 days)
    const proofToken = await createWaToken(booking.id, "upload_proof", 7);

    // Get bank info
    const settingsRows = await db.select().from(settingsTable).limit(1);
    const settings = settingsRows[0];

    // Send WA to customer — kirim grandTotal (termasuk PPN) sebagai jumlah transfer
    const amountToPay = taxCalc.taxAmount > 0 ? taxCalc.grandTotal : totalPrice;
    const statusUrl = `${await getBaseUrl()}/status/${orderNumber}`;
    const uploadProofUrl = `${await getBaseUrl()}/bukti/${proofToken}`;

    const deadlineStr = paymentDeadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });

    notifyWaBookingCreated({
      customerName,
      customerPhone,
      orderNumber,
      facilityName: facility.name,
      bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: amountToPay.toLocaleString("id-ID"),
      paymentDeadline: deadlineStr,
      statusUrl,
      uploadProofUrl,
      bankName: settings?.bankName ?? "",
      bankAccount: settings?.bankAccount ?? "",
      bankAccountName: settings?.bankAccountName ?? "",
    });

    await logAudit({
      action: "wa_booking_created",
      entity: "booking",
      entityId: booking.id,
      after: { orderNumber, source: "whatsapp", facilityId, bookingDate, startTime, endTime },
    });

    res.status(201).json({
      ...booking,
      totalPrice: Number(booking.totalPrice),
      discountAmount: Number(booking.discountAmount),
      facilityName: facility.name,
      statusUrl,
      uploadProofUrl,
    });
  } catch (err) {
    console.error("[wa/booking] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/wa/status/:orderNumber — public booking status
router.get("/wa/status/:orderNumber", async (req, res) => {
  try {
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, req.params.orderNumber)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const [facility] = await db.select().from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
    const [payment] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.bookingId, booking.id)).limit(1);

    // Get upload proof token (non-consumed upload_proof token)
    const tokens = await db.select().from(waActionTokensTable)
      .where(and(eq(waActionTokensTable.bookingId, booking.id), eq(waActionTokensTable.action, "upload_proof")))
      .orderBy(desc(waActionTokensTable.createdAt))
      .limit(1);
    const proofToken = tokens[0]?.token ?? null;

    const baseUrl = await getBaseUrl();
    const withholding = calculateBookingWithholdingTax(booking);
    res.json({
      orderNumber: booking.orderNumber,
      customerName: booking.customerName,
      facilityName: facility?.name ?? "",
      facilityCategory: facility?.category ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      durationHours: booking.durationHours,
      totalPrice: Number(booking.totalPrice),
      ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
      dpp: booking.dpp == null ? null : Number(booking.dpp),
      ppnAmount: booking.ppnAmount == null ? null : Number(booking.ppnAmount),
      grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
      pphRate: withholding.enabled ? withholding.rate : null,
      pphAmount: withholding.enabled ? withholding.amount : null,
      netAmount: withholding.netAmount,
      status: booking.status,
      source: booking.source,
      notes: booking.notes,
      paymentDeadline: booking.paymentDeadline,
      checkedInAt: booking.checkedInAt,
      completedAt: booking.completedAt,
      createdAt: booking.createdAt,
      payment: payment ? {
        status: payment.status,
        proofUrl: payment.proofUrl,
        confirmedAt: payment.confirmedAt,
      } : null,
      uploadProofUrl: proofToken ? `${baseUrl}/bukti/${proofToken}` : null,
      invoicePdfUrl: ["confirmed", "completed"].includes(booking.status)
        ? `${baseUrl}/api/public/invoices/${booking.orderNumber}/pdf`
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/wa/action/:token — get action details (no auth)
router.get("/wa/action/:token", async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(Array.isArray(req.params.token) ? req.params.token[0] : req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "Link tidak valid" }); return; }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa" }); return;
    }
    if (tokenRow.usedAt) {
      res.status(409).json({ error: "Link ini sudah digunakan", usedAt: tokenRow.usedAt }); return;
    }

    const booking = await getBookingFull(tokenRow.bookingId);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    if (
      tokenRow.action === "upload_proof" &&
      !["pending_payment", "expired"].includes(booking.status)
    ) {
      res.status(409).json({
        error: "Bukti pembayaran sudah diterima dan sedang menunggu verifikasi admin.",
      });
      return;
    }

    let paymentOptions: {
      transferBank: { bankName: string; bankAccount: string; bankAccountName: string } | null;
      qris: { imageUrl: string } | null;
    } | undefined;
    if (tokenRow.action === "upload_proof") {
      const [settings] = await db.select({
        bankName: settingsTable.bankName,
        bankAccount: settingsTable.bankAccount,
        bankAccountName: settingsTable.bankAccountName,
        qrisImageUrl: settingsTable.qrisImageUrl,
      }).from(settingsTable).limit(1);
      paymentOptions = {
        transferBank: settings?.bankName && settings.bankAccount
          ? {
              bankName: settings.bankName,
              bankAccount: settings.bankAccount,
              bankAccountName: settings.bankAccountName ?? "",
            }
          : null,
        qris: settings?.qrisImageUrl ? { imageUrl: settings.qrisImageUrl } : null,
      };
    }

    const adminPhones = tokenRow.action === "upload_proof" ? await getAdminPhones() : [];
    const supportWhatsapp = adminPhones[0] ?? null;

    res.json({
      action: tokenRow.action,
      booking,
      expiresAt: tokenRow.expiresAt,
      paymentOptions,
      supportWhatsapp,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wa/action/:token — execute action
router.post("/wa/action/:token", async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(Array.isArray(req.params.token) ? req.params.token[0] : req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "Link tidak valid" }); return; }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa" }); return;
    }
    if (tokenRow.usedAt) {
      res.status(409).json({ error: "Aksi ini sudah dilakukan", usedAt: tokenRow.usedAt }); return;
    }

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, tokenRow.bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    const { notes: adminNotes } = req.body;

    switch (tokenRow.action) {
      case "approve_payment": {
        if (!isBookingConfirmableStatus(booking.status)) {
          res.status(409).json({
            error: `Booking dengan status ${booking.status} tidak dapat dikonfirmasi melalui WhatsApp.`,
          });
          return;
        }
        let [payment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.bookingId, booking.id)).limit(1);
        if (!payment) { res.status(400).json({ error: "Tidak ada bukti pembayaran" }); return; }
        const ocrScan = storedPaymentProofOcr(payment);
        if (paymentMethodMatchesOcr(payment.paymentMethod, ocrScan) === false) {
          res.status(422).json({
            error: `Metode pembayaran tidak sesuai dengan bukti. OCR mendeteksi ${ocrScan?.paymentMethod}.`,
            code: "PAYMENT_METHOD_PROOF_MISMATCH",
          });
          return;
        }
        if (paymentProofDateMatchesBooking(ocrScan?.date, booking.createdAt) === false) {
          res.status(422).json({
            error: `Tanggal transaksi pada bukti (${ocrScan?.date}) tidak valid untuk booking ini.`,
            code: "PAYMENT_DATE_PROOF_MISMATCH",
          });
          return;
        }
        payment = await ensurePaymentBankAccount(payment, booking);

        await consumeWaToken(req.params.token);

        await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
          .where(eq(paymentsTable.bookingId, booking.id));
        await db.update(bookingsTable).set({ status: "confirmed", updatedAt: new Date() })
          .where(eq(bookingsTable.id, booking.id));
        await db.insert(bookingHistoryTable).values({
          bookingId: booking.id, fromStatus: booking.status, toStatus: "confirmed",
          changedByName: "admin (WhatsApp)", note: "Pembayaran dikonfirmasi via WhatsApp",
        });

        const statusUrl = `${await getBaseUrl()}/status/${booking.orderNumber}`;
        notifyWaBookingConfirmed({
          customerName: booking.customerName, customerPhone: booking.customerPhone,
          orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
          bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
          totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"), statusUrl,
        });

        // Send staff check-in + finish links
        const checkinToken = await createWaToken(booking.id, "checkin", 30);
        const finishToken = await createWaToken(booking.id, "finish", 30);
        notifyWaStaffCheckin({
          orderNumber: booking.orderNumber, customerName: booking.customerName,
          facilityName: facility?.name ?? "", bookingDate: booking.bookingDate,
          startTime: booking.startTime, endTime: booking.endTime,
          checkinUrl: `${await getBaseUrl()}/wa/action/${checkinToken}`,
          finishUrl: `${await getBaseUrl()}/wa/action/${finishToken}`,
        });

        syncStatusToBizportal(booking.orderNumber, "confirmed", payment.proofUrl, new Date(), booking).catch(() => {});
        pushConfirmedPaymentAsBankMutation(booking, new Date()).catch(() => {});

        await logAudit({
          action: "wa_approve_payment",
          entity: "booking",
          entityId: booking.id,
          before: { status: booking.status },
          after: { status: "confirmed" },
          userName: "admin (WhatsApp)",
        });

        const _today = new Date().toISOString().split("T")[0];
        const {
          dpp: _dpp,
          ppnAmount: _ppnAmount,
          ppnCollectedByCustomer: _ppnCollectedByCustomer,
        } = extractBookingDpp(booking);
        const _paymentMethod = payment?.paymentMethod ?? "Transfer Bank";
        postConfirmedPaymentAccounting({
          bookingId: booking.id,
          orderNumber: booking.orderNumber,
          dpp: _dpp,
          ppnAmount: _ppnAmount,
          ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
          ppnTreatment: booking.ppnTreatment,
          ppnCollectedByCustomer: _ppnCollectedByCustomer,
          facilityId: booking.facilityId,
          journalDate: _today,
          paymentMethod: _paymentMethod,
          paymentId: payment.id,
        }).catch((err) =>
          logAccountingError({ operation: "postConfirmedPaymentAccounting", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
        );

        res.json({ success: true, message: "Pembayaran dikonfirmasi. Customer diberitahu." });
        break;
      }

      case "reject_payment": {
        const [payment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.bookingId, booking.id)).limit(1);

        await consumeWaToken(req.params.token);

        await db.update(paymentsTable).set({ status: "rejected" })
          .where(eq(paymentsTable.bookingId, booking.id));
        await db.update(bookingsTable).set({ status: "pending_payment", updatedAt: new Date() })
          .where(eq(bookingsTable.id, booking.id));
        await db.insert(bookingHistoryTable).values({
          bookingId: booking.id, fromStatus: booking.status, toStatus: "pending_payment",
          changedByName: "admin (WhatsApp)", note: `Pembayaran ditolak via WhatsApp. ${adminNotes ?? ""}`,
        });

        // New upload token for re-upload
        const newUploadToken = await createWaToken(booking.id, "upload_proof", 7);
        notifyWaPaymentRejected({
          customerName: booking.customerName, customerPhone: booking.customerPhone,
          orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
          bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
          totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
          uploadProofUrl: `${await getBaseUrl()}/bukti/${newUploadToken}`,
          reason: adminNotes,
        });

        await logAudit({
          action: "wa_reject_payment",
          entity: "booking",
          entityId: booking.id,
          before: { status: booking.status },
          after: { status: "pending_payment" },
          userName: "admin (WhatsApp)",
        });

        res.json({ success: true, message: "Pembayaran ditolak. Customer diminta upload ulang." });
        break;
      }

      case "checkin": {
        const checkIn = await checkInBooking(booking.id, { userName: "staff (WhatsApp)" });
        if (!checkIn.ok) { res.status(400).json({ error: checkIn.reason }); return; }
        await consumeWaToken(req.params.token);

        res.json({ success: true, message: `Customer ${booking.customerName} berhasil check-in.` });
        break;
      }

      case "finish": {
        const completion = await completeBooking(booking.id, { userName: "staff (WhatsApp)" });
        if (!completion.ok) { res.status(400).json({ error: completion.reason }); return; }
        await consumeWaToken(req.params.token);

        res.json({ success: true, message: "Sesi selesai. Booking ditandai completed." });
        break;
      }

      default:
        res.status(400).json({ error: "Aksi tidak dikenali" });
    }
  } catch (err) {
    console.error("[wa/action] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/wa/get-proof-token/:orderNumber — cari token upload bukti aktif untuk order (no auth)
router.get("/wa/get-proof-token/:orderNumber", async (req, res) => {
  try {
    const { orderNumber } = req.params as { orderNumber: string };
    const [booking] = await db
      .select({ id: bookingsTable.id, status: bookingsTable.status, orderNumber: bookingsTable.orderNumber })
      .from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, orderNumber))
      .limit(1);

    if (!booking) {
      res.status(404).json({ error: "Booking tidak ditemukan" });
      return;
    }
    if (!["pending_payment", "expired"].includes(booking.status)) {
      res.status(404).json({ error: "Link upload tidak tersedia untuk status booking ini" });
      return;
    }

    const [tokenRow] = await db
      .select({ token: waActionTokensTable.token, expiresAt: waActionTokensTable.expiresAt })
      .from(waActionTokensTable)
      .where(and(eq(waActionTokensTable.bookingId, booking.id), eq(waActionTokensTable.action, "upload_proof")))
      .orderBy(desc(waActionTokensTable.createdAt))
      .limit(1);

    if (tokenRow?.token) {
      res.json({ token: tokenRow.token, orderNumber: booking.orderNumber });
      return;
    }

    if (["pending_payment", "expired"].includes(booking.status)) {
      const newToken = await createWaToken(booking.id, "upload_proof", 7);
      res.json({ token: newToken, orderNumber: booking.orderNumber });
      return;
    }

    res.status(404).json({ error: "Link upload tidak tersedia untuk status booking ini" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wa/proof/scan — preview OCR before the customer submits the proof.
// The final submit endpoint always scans again and never trusts this preview.
router.post("/wa/proof/scan", uploadProof.single("proof"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Tidak ada file" });
      return;
    }
    const scan = await scanPaymentProof(req.file.buffer, req.file.mimetype);
    res.json({
      ocrScan: {
        paymentMethod: scan.paymentMethod,
        confidence: scan.confidence,
        signals: scan.signals,
        amount: scan.amount,
        date: scan.date,
        engine: scan.engine,
      },
    });
  } catch (err) {
    req.log?.error?.({ err }, "Proof OCR preview error");
    res.status(500).json({ error: "Pengecekan bukti gagal" });
  }
});

// POST /api/wa/proof/upload — legacy upload helper, returns URL
router.post("/wa/proof/upload", uploadProof.single("proof"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "Tidak ada file" }); return; }
    const publicUrl = await uploadProofWithFallback(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: "Upload gagal" });
  }
});

// POST /api/wa/proof/:token — submit proof (tokenized, no login)
router.post("/wa/proof/:token", uploadProof.single("proof"), async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(Array.isArray(req.params.token) ? req.params.token[0] : req.params.token);
    if (!tokenRow || tokenRow.action !== "upload_proof") {
      res.status(404).json({ error: "Link tidak valid" }); return;
    }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa" }); return;
    }

    let proofUrl: string | undefined = req.body?.proofUrl;
    let proofOcr = null;
    if (req.file) {
      proofOcr = await scanPaymentProof(req.file.buffer, req.file.mimetype);
    }
    if (!req.file && !proofUrl) {
      res.status(400).json({ error: "Tidak ada bukti yang diupload" });
      return;
    }

    const bookingId = tokenRow.bookingId;
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    if (!["pending_payment", "expired"].includes(booking.status)) {
      res.status(409).json({
        error: "Bukti pembayaran sudah diterima dan sedang menunggu verifikasi admin.",
      });
      return;
    }

    const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    const groupBookings = booking.groupRef
      ? await db.select({
          id: bookingsTable.id,
          totalPrice: bookingsTable.totalPrice,
          grandTotal: bookingsTable.grandTotal,
        }).from(bookingsTable).where(eq(bookingsTable.groupRef, booking.groupRef))
      : [{
          id: booking.id,
          totalPrice: booking.totalPrice,
          grandTotal: booking.grandTotal,
        }];
    const groupBookingIds = groupBookings.map((row) => row.id);
    const [bookingGroup] = booking.groupRef
      ? await db.select({ totalPayment: bookingGroupsTable.totalPayment })
        .from(bookingGroupsTable)
        .where(eq(bookingGroupsTable.groupRef, booking.groupRef))
        .limit(1)
      : [];
    const payableTotal = Number(bookingGroup?.totalPayment ?? booking.grandTotal ?? booking.totalPrice);
    const groupPayments = await db.select().from(paymentsTable)
      .where(inArray(paymentsTable.bookingId, groupBookingIds))
      .orderBy(desc(paymentsTable.createdAt));
    // A confirmed DP is historical and must remain untouched; a new proof is
    // the next payment event. Only a pending proof may be replaced.
    const [existing] = groupPayments.filter((candidate) =>
      candidate.status === "pending" || candidate.status === "waiting_confirmation",
    );
    const requestedPaymentMethod = String(req.body?.paymentMethod ?? "").trim();
    const selectedPaymentMethod =
      /qris/i.test(requestedPaymentMethod) ? "QRIS" :
      /transfer|bank|va/i.test(requestedPaymentMethod) ? "Transfer Bank" :
      null;
    // Keep the legacy upload page working when it does not send a selection,
    // while the new payment page always sends one and therefore fails closed.
    const detectedQris = proofOcr?.paymentMethod === "QRIS";
    const resolvedPaymentMethod = selectedPaymentMethod ?? (detectedQris ? "QRIS" : "Transfer Bank");
    const resolvedProvider = resolvedPaymentMethod === "QRIS" ? "mandiri_direct" : "unknown";
    const ocrMethodMatch = paymentMethodMatchesOcr(resolvedPaymentMethod, proofOcr);
    const methodMismatch = ocrMethodMatch === false;
    const amountMatch =
      proofOcr?.engine === "tesseract" &&
      proofOcr.amount != null &&
      Number(proofOcr.amount) === payableTotal;
    const amountMismatch =
      proofOcr?.engine === "tesseract" &&
      proofOcr.amount != null &&
      Number(proofOcr.amount) !== payableTotal;
    const dateMatch =
      proofOcr?.engine === "tesseract"
        ? paymentProofDateMatchesBooking(proofOcr.date, booking.createdAt)
        : null;
    const dateMismatch = dateMatch === false;

    // A confident contradiction is rejected before creating/replacing a
    // payment. Unknown/unreadable OCR is allowed through to manual review.
    if (methodMismatch || amountMismatch || dateMismatch) {
      const reasons = [
        methodMismatch
          ? `metode pembayaran tidak sesuai (terbaca ${proofOcr?.paymentMethod})`
          : null,
        amountMismatch
          ? `nominal pada bukti Rp ${Number(proofOcr?.amount).toLocaleString("id-ID")} tidak sama dengan tagihan Rp ${payableTotal.toLocaleString("id-ID")}`
          : null,
        dateMismatch
          ? `tanggal transaksi ${proofOcr?.date} lebih lama dari tanggal booking dibuat atau berada di masa depan`
          : null,
      ].filter(Boolean);
      res.status(422).json({
        error: `Bukti pembayaran belum dapat diterima: ${reasons.join(" dan ")}. Silakan upload bukti yang benar.`,
        code: methodMismatch
          ? "PAYMENT_METHOD_PROOF_MISMATCH"
          : amountMismatch
            ? "PAYMENT_AMOUNT_PROOF_MISMATCH"
            : "PAYMENT_DATE_PROOF_MISMATCH",
        ocrScan: {
          paymentMethod: proofOcr?.paymentMethod,
          confidence: proofOcr?.confidence,
          amount: proofOcr?.amount,
          date: proofOcr?.date,
          signals: proofOcr?.signals,
        },
      });
      return;
    }

    if (req.file) {
      proofUrl = await uploadProofWithFallback(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
    }
    if (!proofUrl) {
      res.status(400).json({ error: "Tidak ada bukti yang diupload" });
      return;
    }
    let paymentForFlow: typeof paymentsTable.$inferSelect | undefined;

    if (existing) {
      const paymentBooking = groupBookings.find((member) => member.id === existing.bookingId) ?? booking;
      await ensurePaymentBankAccount(existing, paymentBooking as typeof booking);
      await db.update(paymentsTable).set({
        proofUrl,
        paymentMethod: resolvedPaymentMethod,
        paymentProvider: resolvedProvider,
        ocrName: proofOcr?.name ?? null,
        ocrAmount: proofOcr?.amount == null ? null : String(proofOcr.amount),
        ocrDate: proofOcr?.date ?? null,
        ocrRaw: proofOcr?.rawText ?? null,
        ocrData: proofOcr ? {
          paymentMethod: proofOcr.paymentMethod,
          confidence: proofOcr.confidence,
          signals: proofOcr.signals,
          engine: proofOcr.engine,
          scannedAt: proofOcr.scannedAt,
          methodMatch: ocrMethodMatch,
          amountMatch,
          dateMatch,
        } : null,
        status: "pending",
        updatedAt: new Date(),
      })
        .where(eq(paymentsTable.id, existing.id));
      paymentForFlow = {
        ...existing,
        proofUrl,
        paymentMethod: resolvedPaymentMethod,
        paymentProvider: resolvedProvider,
        ocrName: proofOcr?.name ?? null,
        ocrAmount: proofOcr?.amount == null ? null : String(proofOcr.amount),
        ocrDate: proofOcr?.date ?? null,
        ocrRaw: proofOcr?.rawText ?? null,
        ocrData: proofOcr ? {
          paymentMethod: proofOcr.paymentMethod,
          confidence: proofOcr.confidence,
          signals: proofOcr.signals,
          engine: proofOcr.engine,
          scannedAt: proofOcr.scannedAt,
          methodMatch: ocrMethodMatch,
          amountMatch,
          dateMatch,
        } : null,
        status: "pending",
      };
    } else {
      const paymentEnrichment = await resolveRequiredPaymentEnrichment(booking, resolvedProvider, new Date());
      [paymentForFlow] = await db.insert(paymentsTable).values({
        bookingId,
        amount: String(payableTotal),
        proofUrl,
        paymentMethod: resolvedPaymentMethod,
        paymentProvider: resolvedProvider,
        providerName: normalizeProviderName(resolvedProvider),
        providerId: createPaymentProviderId(resolvedProvider, `wa-${bookingId}`),
        providerOrderId: createPaymentProviderOrderId(resolvedProvider, `wa-order-${bookingId}`),
        companyId: paymentEnrichment.companyId,
        bankAccountId: paymentEnrichment.bankAccountId,
        expectedSettlementDate: paymentEnrichment.expectedSettlementDate,
        paidAt: paymentEnrichment.paidAt,
        ocrName: proofOcr?.name ?? null,
        ocrAmount: proofOcr?.amount == null ? null : String(proofOcr.amount),
        ocrDate: proofOcr?.date ?? null,
        ocrRaw: proofOcr?.rawText ?? null,
        ocrData: proofOcr ? {
          paymentMethod: proofOcr.paymentMethod,
          confidence: proofOcr.confidence,
          signals: proofOcr.signals,
          engine: proofOcr.engine,
          scannedAt: proofOcr.scannedAt,
          methodMatch: ocrMethodMatch,
          amountMatch,
          dateMatch,
        } : null,
        status: "pending",
      }).returning();
    }
    const allocationPaymentId = paymentForFlow?.id;
    if (booking.groupRef && allocationPaymentId) {
      await insertGroupPaymentAllocations(allocationPaymentId, groupBookings, payableTotal);
    }

    const methodMatch = ocrMethodMatch === true;
    // OCR is evidence for the admin, not an automatic payment confirmation.
    // Every accepted proof waits in the same review state, including a proof
    // whose OCR fields are unreadable.
    const nextStatus = "waiting_confirmation" as const;
    await db.update(bookingsTable).set({
      status: nextStatus,
      paidAt: null,
      updatedAt: new Date(),
    })
      .where(eq(bookingsTable.id, bookingId));

    await db.insert(bookingHistoryTable).values({
      bookingId, fromStatus: booking.status, toStatus: nextStatus,
      changedByName: booking.customerName,
      note: "Bukti pembayaran diterima dan menunggu verifikasi admin. OCR hanya digunakan sebagai bukti pendukung.",
    });

    if (booking.groupRef) {
      const siblings = await db.select().from(bookingsTable).where(and(
        eq(bookingsTable.groupRef, booking.groupRef),
        ne(bookingsTable.id, bookingId),
      ));
      for (const sibling of siblings) {
        if (INACTIVE_STATUSES.includes(sibling.status)) continue;
      await db.update(bookingsTable).set({
          status: nextStatus,
          updatedAt: new Date(),
        }).where(eq(bookingsTable.id, sibling.id));
        await db.insert(bookingHistoryTable).values({
          bookingId: sibling.id,
          fromStatus: sibling.status,
          toStatus: nextStatus,
          changedByName: booking.customerName,
          note: `Bukti pembayaran diupload via WhatsApp (grup ${booking.groupRef})`,
        });
      }
    }

    // Every accepted proof gets a review link. Admin approval is mandatory even
    // when OCR found a matching method and amount.
    const reviewToken = await createWaToken(bookingId, "review_payment", 7);

    const fullProofUrl = proofUrl;
    const ocrNote = methodMatch && amountMatch && dateMatch === true
      ? "OCR mendeteksi metode, nominal, dan tanggal transaksi sesuai. Tetap wajib diverifikasi admin."
      : "OCR belum dapat memastikan seluruh detail termasuk tanggal transaksi. Bukti menunggu pemeriksaan admin.";
    notifyWaProofUploaded({
      customerName: booking.customerName, customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
      totalPrice: Number(booking.grandTotal ?? booking.totalPrice).toLocaleString("id-ID"),
      proofUrl: fullProofUrl,
      reviewUrl: `${await getBaseUrl()}/ulasan/${reviewToken}`,
      note: ocrNote,
    });
    notifyWaProofReceived({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: Number(booking.grandTotal ?? booking.totalPrice).toLocaleString("id-ID"),
      statusUrl: `${await getBaseUrl()}/status/${booking.orderNumber}`,
    });

    await logAudit({
      action: "wa_proof_uploaded",
      entity: "booking",
      entityId: bookingId,
      after: {
        proofUrl,
        status: nextStatus,
        ocrMatched: methodMatch && amountMatch && dateMatch === true,
        methodMatch,
        amountMatch,
        dateMatch,
      },
    });

    syncStatusToBizportal(booking.orderNumber, nextStatus, proofUrl, null, booking).catch(() => {});

    res.json({
      success: true,
      orderNumber: booking.orderNumber,
      status: nextStatus,
      ocrPassed: methodMatch && amountMatch && dateMatch === true,
      message: "Bukti pembayaran diterima dan menunggu verifikasi admin.",
    });
  } catch (err) {
    console.error("[wa/proof] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Review Payment — single link with proof + approve/reject ─────────────────

// GET /api/wa/review/:token — return booking data for review page (read-only)
router.get("/wa/review/:token", async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(Array.isArray(req.params.token) ? req.params.token[0] : req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "Link tidak valid" }); return; }
    if (tokenRow.action !== "review_payment") { res.status(400).json({ error: "Token tidak valid untuk review" }); return; }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa" }); return;
    }
    if (tokenRow.usedAt) {
      res.status(409).json({ error: "Aksi ini sudah dilakukan", usedAt: tokenRow.usedAt }); return;
    }
    const booking = await getBookingFull(tokenRow.bookingId);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    res.json({ booking, expiresAt: tokenRow.expiresAt });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wa/review/:token — perform approve or reject
router.post("/wa/review/:token", async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(Array.isArray(req.params.token) ? req.params.token[0] : req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "Link tidak valid" }); return; }
    if (tokenRow.action !== "review_payment") { res.status(400).json({ error: "Token tidak valid untuk review" }); return; }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa" }); return;
    }
    if (tokenRow.usedAt) {
      res.status(409).json({ error: "Aksi ini sudah dilakukan", usedAt: tokenRow.usedAt }); return;
    }

    const { action, notes: adminNotes } = req.body as { action: "approve" | "reject"; notes?: string };
    if (action !== "approve" && action !== "reject") {
      res.status(400).json({ error: "action harus 'approve' atau 'reject'" }); return;
    }

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, tokenRow.bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    if (action === "approve") {
      if (!isBookingConfirmableStatus(booking.status)) {
        res.status(409).json({
          error: `Booking dengan status ${booking.status} tidak dapat dikonfirmasi melalui WhatsApp.`,
        });
        return;
      }
      let [payment] = await db.select().from(paymentsTable)
        .where(eq(paymentsTable.bookingId, booking.id)).limit(1);
      if (!payment) { res.status(400).json({ error: "Tidak ada bukti pembayaran" }); return; }
      const ocrScan = storedPaymentProofOcr(payment);
      if (paymentMethodMatchesOcr(payment.paymentMethod, ocrScan) === false) {
        res.status(422).json({
          error: `Metode pembayaran tidak sesuai dengan bukti. OCR mendeteksi ${ocrScan?.paymentMethod}.`,
          code: "PAYMENT_METHOD_PROOF_MISMATCH",
        });
        return;
      }
      payment = await ensurePaymentBankAccount(payment, booking);

      await consumeWaToken(req.params.token);

      await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(paymentsTable.bookingId, booking.id));
      await db.update(bookingsTable).set({ status: "confirmed", updatedAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));
      await db.insert(bookingHistoryTable).values({
        bookingId: booking.id, fromStatus: booking.status, toStatus: "confirmed",
        changedByName: "admin (WhatsApp)", note: "Pembayaran dikonfirmasi via WA Review Link",
      });

      const statusUrl = `${await getBaseUrl()}/status/${booking.orderNumber}`;
      notifyWaBookingConfirmed({
        customerName: booking.customerName, customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
        bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"), statusUrl,
      });

      const checkinToken = await createWaToken(booking.id, "checkin", 30);
      const finishToken = await createWaToken(booking.id, "finish", 30);
      notifyWaStaffCheckin({
        orderNumber: booking.orderNumber, customerName: booking.customerName,
        facilityName: facility?.name ?? "", bookingDate: booking.bookingDate,
        startTime: booking.startTime, endTime: booking.endTime,
        checkinUrl: `${await getBaseUrl()}/wa/action/${checkinToken}`,
        finishUrl: `${await getBaseUrl()}/wa/action/${finishToken}`,
      }).catch(() => {});

      syncStatusToBizportal(booking.orderNumber, "confirmed", payment.proofUrl, new Date(), booking).catch(() => {});
      pushConfirmedPaymentAsBankMutation(booking, new Date()).catch(() => {});

      await logAudit({
        action: "wa_approve_payment",
        entity: "booking",
        entityId: booking.id,
        before: { status: booking.status },
        after: { status: "confirmed" },
        userName: "admin (WhatsApp Review)",
      });

      const _today = new Date().toISOString().split("T")[0];
      const {
        dpp: _dpp,
        ppnAmount: _ppnAmount,
        ppnCollectedByCustomer: _ppnCollectedByCustomer,
      } = extractBookingDpp(booking);
      const _paymentMethod = payment?.paymentMethod ?? "Transfer Bank";
      postConfirmedPaymentAccounting({
        bookingId: booking.id,
        orderNumber: booking.orderNumber,
        dpp: _dpp,
        ppnAmount: _ppnAmount,
        ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
        ppnTreatment: booking.ppnTreatment,
        ppnCollectedByCustomer: _ppnCollectedByCustomer,
        facilityId: booking.facilityId,
        journalDate: _today,
        paymentMethod: _paymentMethod,
        paymentId: payment.id,
      }).catch((err) =>
        logAccountingError({ operation: "postConfirmedPaymentAccounting", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
      );

      res.json({ success: true, message: "Pembayaran dikonfirmasi. Customer diberitahu." });

      await consumeWaToken(req.params.token);

      await db.update(paymentsTable).set({ status: "rejected" })
        .where(eq(paymentsTable.bookingId, booking.id));
      await db.update(bookingsTable).set({ status: "pending_payment", updatedAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));
      await db.insert(bookingHistoryTable).values({
        bookingId: booking.id, fromStatus: booking.status, toStatus: "pending_payment",
        changedByName: "admin (WhatsApp)", note: `Pembayaran ditolak via WA Review Link. ${adminNotes ?? ""}`,
      });

      const newUploadToken = await createWaToken(booking.id, "upload_proof", 7);
      notifyWaPaymentRejected({
        customerName: booking.customerName, customerPhone: booking.customerPhone,
        orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
        bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),

        uploadProofUrl: `${await getBaseUrl()}/bukti/${newUploadToken}`,

        reason: adminNotes,
      });

      await logAudit({
        action: "wa_reject_payment",
        entity: "booking",
        entityId: booking.id,
        before: { status: booking.status },
        after: { status: "pending_payment" },
        userName: "admin (WhatsApp Review)",
      });

      res.json({ success: true, message: "Pembayaran ditolak. Customer diminta upload ulang." });
    }
  } catch (err) {
    const errorCode = err instanceof Error ? err.message : String(err);
    logger.error({ errorCode, token: req.params.token }, "[wa/review] action gagal");

    // Keep configuration/data validation failures actionable for the admin.
    // Do not expose raw database/provider errors to the public review link.
    if (errorCode === "RECEIVING_BANK_ACCOUNT_NOT_CONFIGURED") {
      res.status(422).json({
        error: "Rekening penerima Sport Center belum dikonfigurasi. Isi rekening penerimaan di Pengaturan Pembayaran lalu coba lagi.",
        code: errorCode,
      });
      return;
    }
    if (errorCode.startsWith("PAYMENT_BANK_ACCOUNT_REQUIRED:")) {
      res.status(422).json({
        error: "Data rekening penerima pada pembayaran belum lengkap. Lengkapi Pengaturan Pembayaran lalu upload ulang bukti.",
        code: "PAYMENT_BANK_ACCOUNT_REQUIRED",
      });
      return;
    }

    res.status(500).json({
      error: "Konfirmasi pembayaran gagal diproses. Silakan coba lagi atau hubungi administrator.",
      code: "WA_REVIEW_FAILED",
    });
  }
});

// ─── Helpers for Fonnte webhook ───────────────────────────────────────────────

function splitFonnteTextMessage(message: string, maxLength = 420): string[] {
  const text = message.trim();
  if (!text || text.length <= maxLength) return text ? [text] : [];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = "";
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    pushCurrent();

    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    // Long slot lists or menu blocks are split on line boundaries first.
    const lines = paragraph.split("\n");
    for (const line of lines) {
      const lineCandidate = current ? `${current}\n${line}` : line;
      if (lineCandidate.length <= maxLength) {
        current = lineCandidate;
        continue;
      }

      pushCurrent();

      // Last-resort hard split keeps the provider request below the free-tier
      // rejection threshold without dropping any customer-visible content.
      let remaining = line;
      while (remaining.length > maxLength) {
        chunks.push(remaining.slice(0, maxLength));
        remaining = remaining.slice(maxLength);
      }
      current = remaining;
    }
  }

  pushCurrent();
  return chunks;
}

function sanitizeFonnteFreePackageMessage(message: string): string {
  return message
    .replace(/[🏟️🏸✅❌👤📅⏱️⏰🟢⚠️❓🏅🎉👋🔍📋🙏🔗•]/gu, "")
    .replace(/\*/g, "")
    .replace(/\s*\|\s*/g, ", ")
    .replace(/[–—]/g, "-")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function sendWAMsg(phone: string, message: string, useCustomerToken = false): Promise<boolean> {
  if (!phone) return false;
  const fonnte = await getFonnteConfig();
  if (useCustomerToken && !fonnte.customerDevice) {
    logger.warn("[wa] Device Mina/customer belum dikonfigurasi; pesan customer tidak dikirim");
    await logAudit({
      action: "wa_outbound_skipped_missing_device",
      entity: "wa_outbound",
      after: { recipient: phone, channel: "mina", deviceSource: fonnte.customerDeviceSource },
    }).catch(() => {});
    return false;
  }
  const token = selectFonnteToken(fonnte, useCustomerToken);
  if (!token) {
    logger.warn(
      { sender: useCustomerToken ? "customer" : "admin" },
      `[wa] ${useCustomerToken ? "FONNTE_CUSTOMER_TOKEN" : "FONNTE_TOKEN"} kosong; pesan tidak dikirim`,
    );
    await logAudit({
      action: "wa_outbound_skipped_missing_token",
      entity: "wa_outbound",
      after: {
        recipient: phone,
        channel: useCustomerToken ? "mina" : "admin",
        customerTokenConfigured: Boolean(fonnte.customerToken),
      },
    }).catch(() => {});
    return false;
  }
  if (!allowWhatsAppProviderSend({
    channel: useCustomerToken ? "mina" : "admin",
    recipient: phone,
    customerTokenConfigured: useCustomerToken ? Boolean(fonnte.customerToken) : false,
  })) return true;

  const chunks = splitFonnteTextMessage(message);
  if (chunks.length === 0) return false;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    // Track every actual outbound chunk so Fonnte echoes cannot re-enter Mina.
    trackSentMessage(chunk);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const form = new FormData();
      form.append("target", phone);
      form.append("message", chunk);
      const replyInboxId = useCustomerToken
        ? fonnteReplyContext.getStore()?.inboxId
        : undefined;
      if (replyInboxId) {
        // Fonnte uses inboxid to classify an API send as a reply to the
        // incoming webhook message instead of a new push message.
        form.append("inboxid", replyInboxId);
      }

      // Keep the free-package request minimal. Optional send parameters can
      // cause Fonnte to answer HTTP 200 with status=false/"invalid message
      // request on free package".
      const response = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { Authorization: token },
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const providerText = await response.text().catch(() => "");
      let providerBody: Record<string, unknown> | null = null;
      try {
        providerBody = providerText ? JSON.parse(providerText) as Record<string, unknown> : null;
      } catch {
        providerBody = null;
      }
      const providerStatus = providerBody?.status ?? providerBody?.Status;
      const providerReason = providerBody?.reason ?? providerBody?.detail;
      const providerRequestId = providerBody?.requestid ?? providerBody?.requestId;

      if (!response.ok || providerStatus === false) {
        const reasonText = providerReason == null ? "" : String(providerReason);
        const isFreePackageContentRejection =
          response.ok &&
          providerStatus === false &&
          /invalid message request on free package/i.test(reasonText);

        if (isFreePackageContentRejection) {
          const fallbackMessage = sanitizeFonnteFreePackageMessage(chunk);
          if (fallbackMessage && fallbackMessage !== chunk) {
            const fallbackForm = new FormData();
            fallbackForm.append("target", phone);
            fallbackForm.append("message", fallbackMessage);
            if (replyInboxId) fallbackForm.append("inboxid", replyInboxId);

            const fallbackController = new AbortController();
            const fallbackTimeout = setTimeout(() => fallbackController.abort(), 15_000);
            try {
              const fallbackResponse = await fetch("https://api.fonnte.com/send", {
                method: "POST",
                headers: { Authorization: token },
                body: fallbackForm,
                signal: fallbackController.signal,
              });
              clearTimeout(fallbackTimeout);

              const fallbackText = await fallbackResponse.text().catch(() => "");
              let fallbackBody: Record<string, unknown> | null = null;
              try {
                fallbackBody = fallbackText
                  ? JSON.parse(fallbackText) as Record<string, unknown>
                  : null;
              } catch {
                fallbackBody = null;
              }

              const fallbackStatus = fallbackBody?.status ?? fallbackBody?.Status;
              const fallbackReason = fallbackBody?.reason ?? fallbackBody?.detail;
              const fallbackRequestId = fallbackBody?.requestid ?? fallbackBody?.requestId;
              const fallbackAccepted = fallbackResponse.ok && fallbackStatus !== false;

              await logAudit({
                action: fallbackAccepted
                  ? "mina_reply_free_package_fallback_accepted"
                  : "mina_reply_free_package_fallback_rejected",
                entity: "wa_outbound",
                after: {
                  recipient: phone,
                  channel: useCustomerToken ? "mina" : "admin",
                  originalMessageLength: chunk.length,
                  fallbackMessageLength: fallbackMessage.length,
                  httpStatus: fallbackResponse.status,
                  providerStatus: fallbackStatus,
                  providerReason: fallbackReason == null ? null : String(fallbackReason),
                  providerRequestId: fallbackRequestId == null ? null : String(fallbackRequestId),
                  inboxIdPresent: Boolean(replyInboxId),
                },
              }).catch(() => {});

              if (fallbackAccepted) {
                trackSentMessage(fallbackMessage);
                continue;
              }
            } catch (fallbackError) {
              clearTimeout(fallbackTimeout);
              await logAudit({
                action: "mina_reply_free_package_fallback_error",
                entity: "wa_outbound",
                after: {
                  recipient: phone,
                  channel: useCustomerToken ? "mina" : "admin",
                  error: fallbackError instanceof Error
                    ? fallbackError.message
                    : String(fallbackError),
                },
              }).catch(() => {});
            }
          }
        }

        logger.error(
          {
            channel: useCustomerToken ? "mina" : "admin",
            recipient: phone,
            httpStatus: response.status,
            providerStatus,
            providerReason,
            providerRequestId,
            messageLength: chunk.length,
            chunkIndex: chunkIndex + 1,
            chunkCount: chunks.length,
            inboxIdPresent: Boolean(replyInboxId),
          },
          "[wa] Fonnte outbound rejected",
        );
        await logAudit({
          action: "mina_reply_provider_rejected",
          entity: "wa_outbound",
          after: {
            recipient: phone,
            channel: useCustomerToken ? "mina" : "admin",
            httpStatus: response.status,
            providerStatus,
            providerReason: providerReason == null ? null : String(providerReason),
            providerRequestId: providerRequestId == null ? null : String(providerRequestId),
            messageLength: chunk.length,
            chunkIndex: chunkIndex + 1,
            chunkCount: chunks.length,
            inboxIdPresent: Boolean(replyInboxId),
          },
        }).catch(() => {});
        return false;
      }

      logger.info(
        {
          channel: useCustomerToken ? "mina" : "admin",
          recipient: phone,
          httpStatus: response.status,
          providerRequestId,
          chunkIndex: chunkIndex + 1,
          chunkCount: chunks.length,
          inboxIdPresent: Boolean(replyInboxId),
        },
        "[wa] Fonnte outbound accepted",
      );
    } catch (err) {
      logger.error(
        {
          channel: useCustomerToken ? "mina" : "admin",
          recipient: phone,
          error: err instanceof Error ? err.message : String(err),
          chunkIndex: chunkIndex + 1,
          chunkCount: chunks.length,
        },
        "[wa] Fonnte outbound request failed",
      );
      await logAudit({
        action: "mina_reply_provider_error",
        entity: "wa_outbound",
        after: {
          recipient: phone,
          channel: useCustomerToken ? "mina" : "admin",
          error: err instanceof Error ? err.message : String(err),
          chunkIndex: chunkIndex + 1,
          chunkCount: chunks.length,
        },
      }).catch(() => {});
      return false;
    }
  }

  return true;
}

async function getAdminPhones(): Promise<string[]> {
  try {
    const [s] = await db.select().from(settingsTable).limit(1);
    const raw = s?.adminWaPhones
      || process.env.FONNTE_ADMIN_PHONES
      || process.env.ADMIN_WA_PHONES
      || process.env.FONNTE_ADMIN_WA
      || "";
    return raw.split(",").map((p: string) => cleanPhone(p)).filter(Boolean);
  } catch {
    const raw = process.env.FONNTE_ADMIN_PHONES
      || process.env.ADMIN_WA_PHONES
      || process.env.FONNTE_ADMIN_WA
      || "";
    return raw.split(",").map((p: string) => cleanPhone(p)).filter(Boolean);
  }
}

async function buildFacilityList(): Promise<string> {
  const facilities = await db.select({
    name: facilitiesTable.name,
    category: facilitiesTable.category,
    pricePerHour: facilitiesTable.pricePerHour,
  }).from(facilitiesTable).where(eq(facilitiesTable.isActive, true));
  const lines = facilities.map((f: typeof facilities[number], i: number) =>
    `${i + 1}. *${f.name}* — ${formatIDR(Number(f.pricePerHour))}/jam`
  ).join("\n");
  return `🏟️ *Fasilitas tersedia:*\n${lines}\n\nSebutkan nama fasilitas yang ingin kamu booking.`;
}

async function getFacilityByKeyword(keyword: string) {
  const candidates = await getFacilityCandidatesByKeyword(keyword);
  return candidates[0] ?? null;
}

async function getFacilityCandidatesByKeyword(keyword: string) {
  const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));
  const FACILITY_KEYWORDS: Record<string, string[]> = {
    basket: ["basket", "basketball"],
    futsal: ["futsal", "sepak bola", "mini soccer"],
    badminton: ["badminton", "bulutangkis", "shuttle"],
    tennis: ["tennis", "tenis"],
    gym: ["gym", "fitness", "fitnes"],
    voli: ["voli", "volley", "volleyball"],
    renang: ["renang", "kolam", "swimming"],
    squash: ["squash"],
    golf: ["golf"],
    serbaguna: ["serbaguna", "multiguna", "hall", "aula", "futsal", "sepak bola", "bola", "mini soccer"],
    billiard: ["billiard", "biliar", "bilyard"],
  };
  const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, " ").trim();
  const kws = FACILITY_KEYWORDS[keyword] ?? [keyword];
  type FRow = typeof facilities[number];
  // Explicit facility names/variants must win over category matching. This
  // prevents "badminton court b" from resolving to the first badminton row.
  const exact = facilities.find((f: FRow) =>
    f.name.toLowerCase().replace(/\s+/g, " ").trim() === normalizedKeyword
  );
  if (exact) return [exact];

  return facilities.filter((f: FRow) =>
    kws.some((kw) =>
      f.name.toLowerCase().includes(kw) ||
      f.category.toLowerCase().includes(kw),
    ),
  );
}

// Parse facility from raw message text (search by name or keyword)
async function resolveFacilityFromMsg(msg: string, session?: WaBookingSessionRow) {
  const kw = detectFacilityKeyword(msg);
  if (kw) {
    const candidates = await getFacilityCandidatesByKeyword(kw);
    // A generic sport name is not enough to choose a physical court. The
    // customer must select a specific variant when more than one exists.
    return candidates.length === 1 ? candidates[0] : null;
  }
  // Direct name search
  const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));
  const number = msg.trim().match(/^(\d+)$/);
  if (number) {
    const lastBotMessage = [...(session?.rawMessages ?? [])]
      .reverse()
      .find((message) => message.role === "bot")?.text ?? "";
    if (/lapangan badminton/i.test(lastBotMessage)) {
      const badmintonFacilities = await getFacilityCandidatesByKeyword("badminton");
      return badmintonFacilities[Number(number[1]) - 1] ?? null;
    }
    return facilities[Number(number[1]) - 1] ?? null;
  }
  const lower = msg.toLowerCase();
  return facilities.find((f: typeof facilities[number]) => f.name.toLowerCase().includes(lower)) ?? null;
}

function buildFacilityChoiceReply(
  sportName: string,
  facilities: Array<{ name: string; pricePerHour: unknown }>,
): string {
  const options = facilities
    .map((facility, index) =>
      `${index + 1}. *${facility.name}* — ${formatIDR(Number(facility.pricePerHour))}/jam`,
    )
    .join("\n");
  return [
    `🏸 Ada beberapa lapangan ${sportName} yang bisa dipilih:`,
    ``,
    options,
    ``,
    `Ketik nomor atau nama lapangan, misalnya *1* untuk ${facilities[0]?.name ?? "Court A"}.`,
  ].join("\n");
}

function addHoursToTime(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMin = h * 60 + (m || 0) + hours * 60;
  const rh = Math.floor(totalMin / 60) % 24;
  const rm = totalMin % 60;
  return `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
}

function minutesToHours(min: number): number {
  return Math.max(1, Math.round(min / 60));
}

/**
 * Accept the time formats Mina displays in the slot list.
 *
 * The natural-language parser intentionally does not treat a bare number as
 * a time because the same input is used for facility/menu choices elsewhere.
 * At the ask_time step, however, `11` is an unambiguous answer to a displayed
 * `11:00` slot.
 */
function parseSlotStartTime(msg: string): string | null {
  const parsed = parseIntent(msg).startTime;
  if (parsed) return parsed;

  const bareHour = msg.trim().toLowerCase().match(
    /^(?:pilih\s+)?(?:jam\s*)?([01]?\d|2[0-3])(?:\s*:?\s*00)?(?:\s*wib)?$/,
  );
  if (!bareHour) return null;
  return `${String(Number(bareHour[1])).padStart(2, "0")}:00`;
}

function hasDisplayedAlternativeFacilityMenu(session: WaBookingSessionRow): boolean {
  const lastBotMessage = [...(session.rawMessages ?? [])]
    .reverse()
    .find((message) => message.role === "bot")?.text ?? "";
  return /1\.\s+Lihat\s+(?:slot|fasilitas)/i.test(lastBotMessage);
}

function isYes(msg: string): boolean {
  return /^ya$/i.test(msg.trim());
}

function isNo(msg: string): boolean {
  // Require end-of-string ($) so "tidak ada catatan", "gak bisa jam 10", dll. tidak ikut cancel
  return /^(tidak|batal|cancel|hapus|no|ga|gak|nggak|ngga)$/i.test(msg.trim());
}

// Kata yang PASTI bermaksud batalkan — lebih ketat dari isNo
// Dipakai di global cancel agar tidak salah cancel di step awal
function isExplicitCancel(msg: string): boolean {
  return /^(batal|cancel|hapus|batalkan|stop|keluar|quit|abort)$/i.test(msg.trim());
}

function isMinaGreeting(msg: string): boolean {
  return /^(halo|hallo|hi|hai)(?:\s+(?:mina|kak|ka))?$/i.test(msg.replace(/\s+/g, " ").trim());
}

function isBookingRequest(msg: string): boolean {
  return /^(?:mau|mao)\s+(?:pesan|booking|boking)(?:\s+(?:kak|ka))?$/i.test(msg.replace(/\s+/g, " ").trim());
}

function isContinueHere(msg: string): boolean {
  // Accept both natural WhatsApp spellings: "lanjut di sini" and
  // "lanjut disini". Keep the match strict so unrelated messages do not
  // accidentally advance the booking flow.
  return /^(?:1|lanjut(?:\s+di\s*sini)?|lanjutkan(?:\s+di\s*sini)?)$/i.test(msg.replace(/\s+/g, " ").trim());
}

function isMakeForm(msg: string): boolean {
  return /^(?:2|buat(?:kan)?\s+form|form(?:ulir)?|buatkan form)$/i.test(msg.trim());
}

// ─── Admin command handler ─────────────────────────────────────────────────────

async function handleAdminCommand(adminPhone: string, msg: string): Promise<boolean> {
  const upper = msg.trim().toUpperCase();

  // APPROVE SC-XXXX / KONFIRMASI SC-XXXX
  const approveMatch = upper.match(/^(APPROVE|KONFIRMASI|SETUJU)\s+(SC-\d+)/);
  if (approveMatch) {
    const orderNumber = approveMatch[2].toUpperCase();
    await execAdminApprove(adminPhone, orderNumber);
    return true;
  }

  // REJECT SC-XXXX [reason]
  const rejectMatch = msg.trim().match(/^(?:REJECT|TOLAK|BATALKAN)\s+(SC-\d+)(?:\s+(.+))?/i);
  if (rejectMatch) {
    const orderNumber = rejectMatch[1].toUpperCase();
    const reason = rejectMatch[2]?.trim() ?? "";
    await execAdminReject(adminPhone, orderNumber, reason);
    return true;
  }

  // STATUS SC-XXXX — admin checking a booking
  const statusMatch = msg.trim().match(/^STATUS\s+(SC-\d+)/i);
  if (statusMatch) {
    const orderNumber = statusMatch[1].toUpperCase();
    await execAdminStatus(adminPhone, orderNumber);
    return true;
  }

  // PAID SC-XXXX — konfirmasi pembayaran manual
  const paidMatch = upper.match(/^(PAID|LUNAS|BAYAR)\s+(SC-\d+)/);
  if (paidMatch) {
    const orderNumber = paidMatch[2].toUpperCase();
    await execAdminPaid(adminPhone, orderNumber);
    return true;
  }

  // CANCEL SC-XXXX [reason]
  const cancelMatch = msg.trim().match(/^(CANCEL|BATALKAN)\s+(SC-\d+)(?:\s+(.+))?/i);
  if (cancelMatch) {
    const orderNumber = cancelMatch[2].toUpperCase();
    const reason = cancelMatch[3]?.trim() ?? "";
    await execAdminCancel(adminPhone, orderNumber, reason);
    return true;
  }

  // RESEND SC-XXXX — kirim ulang notifikasi WA
  const resendMatch = msg.trim().match(/^RESEND\s+(SC-\d+)/i);
  if (resendMatch) {
    const orderNumber = resendMatch[1].toUpperCase();
    await execAdminResend(adminPhone, orderNumber);
    return true;
  }

  // BLOCK [phone] [alasan] — blokir nomor manual
  const blockMatch = msg.trim().match(/^BLOCK\s+(\d+)(?:\s+(.+))?/i);
  if (blockMatch) {
    const targetPhone = cleanPhone(blockMatch[1]);
    const reason = blockMatch[2]?.trim() || "Diblokir oleh admin";
    await db.execute(
      sql`INSERT INTO sport_center.wa_blocked_phones (phone, reason, blocked_by)
          VALUES (${targetPhone}, ${reason}, ${adminPhone})
          ON CONFLICT (phone) DO UPDATE
            SET is_active = true, reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, updated_at = NOW()`
    );
    await logAudit({ action: "phone_blocked_by_admin", entity: "wa_session", after: { targetPhone, reason, adminPhone } });
    await sendWAMsg(adminPhone, `🚫 Nomor *${targetPhone}* berhasil diblokir.\nAlasan: _${reason}_`);
    return true;
  }

  // UNBLOCK [phone] — buka blokir nomor
  const unblockMatch = msg.trim().match(/^UNBLOCK\s+(\d+)/i);
  if (unblockMatch) {
    const targetPhone = cleanPhone(unblockMatch[1]);
    await db.execute(
      sql`UPDATE sport_center.wa_blocked_phones SET is_active = false, updated_at = NOW() WHERE phone = ${targetPhone}`
    );
    await logAudit({ action: "phone_unblocked_by_admin", entity: "wa_session", after: { targetPhone, adminPhone } });
    await sendWAMsg(adminPhone, `✅ Nomor *${targetPhone}* berhasil dibuka blokirnya.`);
    return true;
  }

  // HELP — tampilkan daftar perintah admin
  if (/^HELP$/i.test(upper)) {
    await sendWAMsg(adminPhone,
      `🏅 *Perintah Admin Sport Center*\n\n` +
      `📋 *APPROVE SC-xxxx*\n   Setujui booking\n\n` +
      `🚫 *REJECT SC-xxxx [alasan]*\n   Tolak booking\n\n` +
      `✅ *PAID SC-xxxx*\n   Konfirmasi pembayaran\n\n` +
      `❌ *CANCEL SC-xxxx [alasan]*\n   Batalkan booking\n\n` +
      `🔁 *RESEND SC-xxxx*\n   Kirim ulang notifikasi WA\n\n` +
      `🔍 *STATUS SC-xxxx*\n   Cek detail booking\n\n` +
      `🚫 *BLOCK 628xxx [alasan]*\n   Blokir nomor HP\n\n` +
      `✅ *UNBLOCK 628xxx*\n   Buka blokir nomor HP\n\n` +
      `ℹ️ *HELP*\n   Tampilkan menu ini\n\n` +
      `_Contoh: APPROVE SC-0012_`
    );
    return true;
  }

  return false;
}

async function execAdminApprove(adminPhone: string, orderNumber: string) {
  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) {
    await sendWAMsg(adminPhone, `❌ Order *${orderNumber}* tidak ditemukan.`);
    return;
  }

  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

  // ── Handle waiting_admin_approval: ubah ke pending_payment + kirim instruksi bayar ──
  if (booking.status === "waiting_admin_approval") {
    const paymentDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 jam
    await db.update(bookingsTable)
      .set({ status: "pending_payment", paymentDeadline, approvedByAdminPhone: adminPhone, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(bookingsTable.id, booking.id));

    await db.insert(bookingHistoryTable).values({
      bookingId: booking.id,
      fromStatus: "waiting_admin_approval",
      toStatus: "pending_payment",
      changedByName: `admin (WA: ${adminPhone})`,
      note: "Booking disetujui admin via WhatsApp. Customer diminta melakukan pembayaran.",
    });

    const proofToken = await createWaToken(booking.id, "upload_proof", 7);
    const settingsRows = await db.select().from(settingsTable).limit(1);
    const settings = settingsRows[0];
    const amountToPay = booking.grandTotal ? Number(booking.grandTotal) : Number(booking.totalPrice);
    const statusUrl = `${await getBaseUrl()}/status/${booking.orderNumber}`;
    const uploadProofUrl = `${await getBaseUrl()}/bukti/${proofToken}`;
    const deadlineStr = paymentDeadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });

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
      statusUrl,
      uploadProofUrl,
      bankName: settings?.bankName ?? "",
      bankAccount: settings?.bankAccount ?? "",
      bankAccountName: settings?.bankAccountName ?? "",
    });

    await logAudit({
      action: "wa_admin_approve_booking",
      entity: "booking",
      entityId: booking.id,
      before: { status: "waiting_admin_approval" },
      after: { status: "pending_payment" },
      userName: `admin (WA: ${adminPhone})`,
    });

    await sendWAMsg(adminPhone,
      `✅ *${orderNumber}* disetujui!\n` +
      `Customer: *${booking.customerName}*\n` +
      `${facility?.name ?? ""} | ${booking.bookingDate} ${booking.startTime}–${booking.endTime}\n\n` +
      `Customer diberitahu untuk melakukan pembayaran dalam 24 jam.`
    );
    return;
  }

  // ── Handle waiting_confirmation / pending_payment: konfirmasi pembayaran ──
  if (!["waiting_confirmation", "pending_payment"].includes(booking.status)) {
    await sendWAMsg(adminPhone, `⚠️ Order *${orderNumber}* tidak bisa dikonfirmasi. Status saat ini: *${booking.status.replace(/_/g, " ").toUpperCase()}*.`);
    return;
  }

  const [existingPay] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.bookingId, booking.id)).limit(1);
  let paymentForConfirmation = existingPay
    ? await ensurePaymentBankAccount(existingPay, booking)
    : null;
  if (paymentForConfirmation) {
    await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(paymentsTable.bookingId, booking.id));
  } else {
    const paymentEnrichment = await resolveRequiredPaymentEnrichment(booking, "unknown", new Date());
    const [createdPayment] = await db.insert(paymentsTable).values({
      bookingId: booking.id,
      amount: String(Number(booking.grandTotal ?? booking.totalPrice)),
      paymentMethod: "Manual (Admin WA)",
      paymentProvider: "unknown",
      providerName: normalizeProviderName("unknown"),
      providerId: createPaymentProviderId("unknown", `wa-admin-${booking.id}`),
      providerOrderId: createPaymentProviderOrderId("unknown", `wa-admin-order-${booking.id}`),
      companyId: paymentEnrichment.companyId,
      bankAccountId: paymentEnrichment.bankAccountId,
      expectedSettlementDate: paymentEnrichment.expectedSettlementDate,
      paidAt: paymentEnrichment.paidAt,
      status: "confirmed",
      confirmedAt: new Date(),
    }).returning();
    paymentForConfirmation = createdPayment;
  }

  await db.update(bookingsTable)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: "confirmed",
    changedByName: `admin (WA: ${adminPhone})`,
    note: "Pembayaran dikonfirmasi admin via WhatsApp command",
  });

  const checkinToken = await createWaToken(booking.id, "checkin", 30);
  const finishToken = await createWaToken(booking.id, "finish", 30);
  const statusUrl = `${await getBaseUrl()}/status/${booking.orderNumber}`;

  notifyWaBookingConfirmed({
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    orderNumber: booking.orderNumber,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
    statusUrl,
  });

  notifyWaStaffCheckin({
    orderNumber: booking.orderNumber,
    customerName: booking.customerName,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    checkinUrl: `${await getBaseUrl()}/wa/action/${checkinToken}`,
    finishUrl: `${await getBaseUrl()}/wa/action/${finishToken}`,
  });

  syncStatusToBizportal(booking.orderNumber, "confirmed", null, new Date(), booking).catch(() => {});
  pushConfirmedPaymentAsBankMutation(booking, new Date()).catch(() => {});

  await logAudit({
    action: "wa_admin_approve",
    entity: "booking",
    entityId: booking.id,
    before: { status: booking.status },
    after: { status: "confirmed" },
    userName: `admin (WA: ${adminPhone})`,
  });

  await sendWAMsg(adminPhone,
    `✅ *${orderNumber}* berhasil dikonfirmasi!\n` +
    `Customer: *${booking.customerName}*\n` +
    `${facility?.name ?? ""} | ${booking.bookingDate} ${booking.startTime}–${booking.endTime}\n\n` +
    `Customer sudah diberitahu via WA.`
  );
}

async function execAdminReject(adminPhone: string, orderNumber: string, reason: string) {
  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) {
    await sendWAMsg(adminPhone, `❌ Order *${orderNumber}* tidak ditemukan.`);
    return;
  }
  if (["cancelled", "rejected", "refunded", "completed"].includes(booking.status)) {
    await sendWAMsg(adminPhone, `⚠️ Order *${orderNumber}* sudah dalam status *${booking.status.replace(/_/g, " ").toUpperCase()}*, tidak bisa ditolak.`);
    return;
  }
  const [facility] = await db.select({ name: facilitiesTable.name })
    .from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

  await db.update(paymentsTable).set({ status: "rejected" })
    .where(eq(paymentsTable.bookingId, booking.id));
  await db.update(bookingsTable)
    .set({ status: "rejected", adminNotes: reason || null, rejectedReason: reason || null, updatedAt: new Date() })
    .where(eq(bookingsTable.id, booking.id));
  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: "rejected",
    changedByName: `admin (WA: ${adminPhone})`,
    note: reason ? `Ditolak admin via WA. Alasan: ${reason}` : "Ditolak admin via WA.",
  });

  // Kalau dari waiting_admin_approval: kirim notif penolakan booking (bukan pembayaran)
  if (booking.status === "waiting_admin_approval") {
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
  } else {
    // Penolakan pembayaran — customer perlu upload ulang
    const newUploadToken = await createWaToken(booking.id, "upload_proof", 7);
    notifyWaPaymentRejected({
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber,
      facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      uploadProofUrl: `${await getBaseUrl()}/bukti/${newUploadToken}`,
      reason,
    });
  }

  await logAudit({
    action: "wa_admin_reject",
    entity: "booking",
    entityId: booking.id,
    before: { status: booking.status },
    after: { status: "rejected", reason },
    userName: `admin (WA: ${adminPhone})`,
  });

  await sendWAMsg(adminPhone,
    `🚫 *${orderNumber}* berhasil ditolak.\n` +
    `Customer: *${booking.customerName}*\n` +
    (reason ? `Alasan: _${reason}_\n` : "") +
    `\nCustomer sudah diberitahu via WA.`
  );
}

async function execAdminStatus(adminPhone: string, orderNumber: string) {
  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) {
    await sendWAMsg(adminPhone, `❌ Order *${orderNumber}* tidak ditemukan.`);
    return;
  }
  const [facility] = await db.select({ name: facilitiesTable.name })
    .from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [payment] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.bookingId, booking.id)).limit(1);

  await sendWAMsg(adminPhone,
    `📋 *Detail Booking ${orderNumber}*\n\n` +
    `Customer: *${booking.customerName}*\n` +
    `Telp: *${booking.customerPhone}*\n` +
    `Fasilitas: *${facility?.name ?? "-"}*\n` +
    `Tanggal: *${booking.bookingDate}* | *${booking.startTime}–${booking.endTime}*\n` +
    `Total: *${formatIDR(Number(booking.grandTotal ?? booking.totalPrice))}*\n` +
    `Status: *${booking.status.replace(/_/g, " ").toUpperCase()}*\n` +
    (payment ? `Bukti: ${payment.proofUrl ?? "-"}\n` : "") +
    `\n🔗 ${await getBaseUrl()}/status/${orderNumber}`
  );
}

async function execAdminPaid(adminPhone: string, orderNumber: string) {
  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) {
    await sendWAMsg(adminPhone, `❌ Order *${orderNumber}* tidak ditemukan.`);
    return;
  }
  if (!["pending_payment", "waiting_confirmation", "waiting_admin_approval"].includes(booking.status)) {
    await sendWAMsg(adminPhone, `⚠️ Order *${orderNumber}* tidak bisa dikonfirmasi pembayaran. Status: *${booking.status.replace(/_/g, " ").toUpperCase()}*.`);
    return;
  }
  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

  const [existingPay] = await db.select().from(paymentsTable)
    .where(eq(paymentsTable.bookingId, booking.id)).limit(1);
  let paymentForAccounting = existingPay
    ? await ensurePaymentBankAccount(existingPay, booking)
    : null;
  if (paymentForAccounting) {
    await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(paymentsTable.bookingId, booking.id));
  } else {
    const paymentEnrichment = await resolveRequiredPaymentEnrichment(booking, "unknown", new Date());
    const [createdPayment] = await db.insert(paymentsTable).values({
      bookingId: booking.id,
      amount: String(Number(booking.grandTotal ?? booking.totalPrice)),
      paymentMethod: "Manual (Admin WA)",
      paymentProvider: "unknown",
      providerName: normalizeProviderName("unknown"),
      providerId: createPaymentProviderId("unknown", `wa-admin-${booking.id}`),
      providerOrderId: createPaymentProviderOrderId("unknown", `wa-admin-order-${booking.id}`),
      companyId: paymentEnrichment.companyId,
      bankAccountId: paymentEnrichment.bankAccountId,
      expectedSettlementDate: paymentEnrichment.expectedSettlementDate,
      paidAt: paymentEnrichment.paidAt,
      status: "confirmed",
      confirmedAt: new Date(),
    }).returning();
    paymentForAccounting = createdPayment;
  }

  await db.update(bookingsTable)
    .set({ status: "confirmed", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: "confirmed",
    changedByName: `admin (WA: ${adminPhone})`,
    note: "Pembayaran dikonfirmasi admin via WhatsApp — PAID command",
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
    statusUrl: `${await getBaseUrl()}/status/${booking.orderNumber}`,
  });

  notifyWaStaffCheckin({
    orderNumber: booking.orderNumber,
    customerName: booking.customerName,
    facilityName: facility?.name ?? "",
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    checkinUrl: `${await getBaseUrl()}/wa/action/${checkinToken}`,
    finishUrl: `${await getBaseUrl()}/wa/action/${finishToken}`,
  });

  await logAudit({
    action: "admin_paid_via_wa",
    entity: "booking",
    entityId: booking.id,
    before: { status: booking.status },
    after: { status: "confirmed", paidAt: new Date() },
    userName: `admin (WA: ${adminPhone})`,
  });

  const _paidToday = new Date().toISOString().split("T")[0];
  const {
    dpp: _paidDpp,
    ppnAmount: _paidPpnAmount,
    ppnCollectedByCustomer: _paidPpnCollectedByCustomer,
  } = extractBookingDpp(booking);
  const _paidPaymentMethod = paymentForAccounting?.paymentMethod ?? "Transfer Bank";
  postConfirmedPaymentAccounting({
    bookingId: booking.id,
    orderNumber: booking.orderNumber,
    dpp: _paidDpp,
    ppnAmount: _paidPpnAmount,
    ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
    ppnTreatment: booking.ppnTreatment,
    ppnCollectedByCustomer: _paidPpnCollectedByCustomer,
    facilityId: booking.facilityId,
    journalDate: _paidToday,
    paymentMethod: _paidPaymentMethod,
    paymentId: paymentForAccounting?.id,
  }).catch((err) =>
    logAccountingError({ operation: "postConfirmedPaymentAccounting", orderNumber: booking.orderNumber, bookingId: booking.id, error: err }),
  );

  await sendWAMsg(adminPhone,
    `💰 *${orderNumber}* berhasil dikonfirmasi LUNAS!\n` +
    `Customer: *${booking.customerName}*\n` +
    `${facility?.name ?? ""} | ${booking.bookingDate} ${booking.startTime}–${booking.endTime}\n\n` +
    `Customer sudah diberitahu via WA.`
  );
}

async function execAdminCancel(adminPhone: string, orderNumber: string, reason: string) {
  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) {
    await sendWAMsg(adminPhone, `❌ Order *${orderNumber}* tidak ditemukan.`);
    return;
  }
  if (["confirmed", "completed", "cancelled", "rejected", "refunded"].includes(booking.status)) {
    await sendWAMsg(adminPhone, `⚠️ Order *${orderNumber}* tidak bisa dibatalkan. Status: *${booking.status.replace(/_/g, " ").toUpperCase()}*.`);
    return;
  }
  const [facility] = await db.select({ name: facilitiesTable.name })
    .from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

  await db.update(bookingsTable)
    .set({ status: "cancelled", adminNotes: reason || null, updatedAt: new Date() })
    .where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: "cancelled",
    changedByName: `admin (WA: ${adminPhone})`,
    note: reason ? `Dibatalkan admin via WA. Alasan: ${reason}` : "Dibatalkan admin via WA.",
  });

  await sendWAMsg(booking.customerPhone,
    `❌ *Booking Dibatalkan*\n\n` +
    `Order: *${booking.orderNumber}*\n` +
    `Fasilitas: *${facility?.name ?? ""}*\n` +
    `Tanggal: *${booking.bookingDate}* pukul *${booking.startTime}–${booking.endTime}*\n\n` +
    (reason ? `Alasan: _${reason}_\n\n` : "") +
    `Hubungi kami untuk info lebih lanjut.`,
    true,
  );

  await logAudit({
    action: "booking_cancelled_via_wa",
    entity: "booking",
    entityId: booking.id,
    before: { status: booking.status },
    after: { status: "cancelled", reason },
    userName: `admin (WA: ${adminPhone})`,
  });

  await sendWAMsg(adminPhone,
    `🚫 *${orderNumber}* berhasil dibatalkan.\n` +
    `Customer: *${booking.customerName}*\n` +
    (reason ? `Alasan: _${reason}_` : "")
  );
}

async function execAdminResend(adminPhone: string, orderNumber: string) {
  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);
  if (!booking) {
    await sendWAMsg(adminPhone, `❌ Order *${orderNumber}* tidak ditemukan.`);
    return;
  }
  const [facility] = await db.select().from(facilitiesTable)
    .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [settings] = await db.select().from(settingsTable).limit(1);
  const amountToPay = Number(booking.grandTotal ?? booking.totalPrice);

  if (booking.status === "waiting_admin_approval") {
    const adminPhonesList = await getAdminPhones();
    const msg =
      `🏅 *Booking WA Menunggu Persetujuan (Resend)*\n\n` +
      `Order: *${booking.orderNumber}*\n` +
      `Customer: *${booking.customerName}* (${booking.customerPhone})\n` +
      `Fasilitas: *${facility?.name ?? ""}*\n` +
      `Tanggal: *${booking.bookingDate}* pukul *${booking.startTime}–${booking.endTime}*\n` +
      `Total: *${formatIDR(amountToPay)}*\n\n` +
      `Ketik *APPROVE ${booking.orderNumber}* untuk menyetujui\n` +
      `Ketik *REJECT ${booking.orderNumber} [alasan]* untuk menolak`;
    for (const p of adminPhonesList) await sendWAMsg(p, msg);
    await sendWAMsg(adminPhone, `✅ Notifikasi approval dikirim ulang ke ${adminPhonesList.length} admin.`);
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
      statusUrl: `${await getBaseUrl()}/status/${booking.orderNumber}`,
      uploadProofUrl: `${await getBaseUrl()}/bukti/${proofToken}`,
      bankName: settings?.bankName ?? "",
      bankAccount: settings?.bankAccount ?? "",
      bankAccountName: settings?.bankAccountName ?? "",
    });
    await sendWAMsg(adminPhone, `✅ Instruksi pembayaran dikirim ulang ke customer *${booking.customerName}*.`);
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
      statusUrl: `${await getBaseUrl()}/status/${booking.orderNumber}`,
    });
    await sendWAMsg(adminPhone, `✅ Konfirmasi booking dikirim ulang ke customer *${booking.customerName}*.`);
  } else {
    await sendWAMsg(adminPhone, `⚠️ Tidak bisa resend untuk status *${booking.status.replace(/_/g, " ").toUpperCase()}*.`);
    return;
  }

  await logAudit({
    action: "payment_link_sent",
    entity: "booking",
    entityId: booking.id,
    after: { orderNumber, resendBy: adminPhone, status: booking.status },
    userName: `admin (WA: ${adminPhone})`,
  });
}

// ─── Session conversation handlers ────────────────────────────────────────────

function extractMentionedNote(msg: string): string | null {
  const match = msg.match(/(?:catatan|note|keterangan)\s*[:\-]?\s*(.+)$/i);
  return match?.[1]?.trim().slice(0, 300) || null;
}

async function mergeSessionFromMessage(
  session: WaBookingSessionRow,
  msg: string,
): Promise<{ session: WaBookingSessionRow; changed: boolean }> {
  const parsed = parseIntent(msg);
  const patch: Parameters<typeof updateSession>[1] = {};

  if (parsed.facilityKeyword) {
    const facilityCandidates = await getFacilityCandidatesByKeyword(parsed.facilityKeyword);
    // Never let a generic sport keyword silently switch to the first physical
    // court. Explicit variants (e.g. "badminton court b") still resolve.
    if (facilityCandidates.length === 1 && facilityCandidates[0].id !== session.facilityId) {
      patch.facilityId = facilityCandidates[0].id;
    }
  }
  if (parsed.bookingDate && parsed.bookingDate !== session.bookingDate) patch.bookingDate = parsed.bookingDate;
  if (parsed.startTime && parsed.startTime !== session.startTime) patch.startTime = parsed.startTime;
  if (parsed.durationMinutes && parsed.durationMinutes !== session.durationMinutes) {
    patch.durationMinutes = parsed.durationMinutes;
  }
  if (parsed.personName && parsed.personName !== session.customerName) patch.customerName = parsed.personName;

  const note = extractMentionedNote(msg);
  if (note && note !== session.notes) patch.notes = note;
  if (Object.keys(patch).length === 0) return { session, changed: false };

  const candidate = { ...session, ...patch };
  patch.currentStep =
    session.currentStep === "ask_facility" && patch.facilityId
      ? "choose_mode"
      : getNextStep({
          facilityId: candidate.facilityId,
          bookingDate: candidate.bookingDate,
          startTime: candidate.startTime,
          durationMinutes: candidate.durationMinutes,
          customerName: candidate.customerName,
        });
  const updated = await updateSession(session.id, patch);
  await logAudit({
    action: "booking_session_updated",
    entity: "wa_booking_session",
    entityId: session.id,
    after: { source: "natural_language_merge", ...patch },
  });
  return { session: updated, changed: true };
}

async function presentBookingSession(
  session: WaBookingSessionRow,
  phone: string,
  useCustomerToken = false,
): Promise<void> {
  const sendReply = (message: string) => sendWAMsg(phone, message, useCustomerToken);
  const facility = session.facilityId
    ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null
    : null;
  const nextStep = session.currentStep === "choose_mode"
    ? "choose_mode"
    : getNextStep({
      facilityId: session.facilityId,
      bookingDate: session.bookingDate,
      startTime: session.startTime,
      durationMinutes: session.durationMinutes,
      customerName: session.customerName,
    });
  let current = session;
  if (current.currentStep !== nextStep) {
    current = await updateSession(current.id, { currentStep: nextStep });
  }

  if (nextStep !== "confirm") {
    let reply = await buildStepQuestion(nextStep, current, facility?.name ?? "", Number(facility?.pricePerHour ?? 0));
    if (nextStep === "ask_time" && facility && current.bookingDate && facility.bookingMode !== "walk_in") {
      const slots = await getAvailableSlotsForDay(
        current.facilityId!,
        current.bookingDate,
        facility.openTime,
        facility.closeTime,
        current.durationMinutes ?? 60,
      );
      const alternatives = await getAlternativeFacilitySlotOptions(
        current.facilityId!,
        current.bookingDate,
        current.durationMinutes ?? 60,
      );
      if (slots.length > 0) {
        reply =
          `Jam berapa mau mulai?\n` +
          `Contoh: jam 8 pagi, jam 20.00, 19:00`;
      } else if (alternatives.length > 0) {
        current = await updateSession(current.id, {
          startTime: null,
          currentStep: "choose_alternative_facility",
        });
        reply = buildAlternativeFacilitySlotPrompt({
          currentFacilityName: facility.name,
          bookingDate: current.bookingDate!,
          durationMinutes: current.durationMinutes ?? 60,
          options: alternatives,
          reason: "full",
        });
      } else {
        reply += `\n\n⚠️ Tidak ada slot yang sesuai durasi di *${facility.name}* maupun fasilitas sejenis pada tanggal *${current.bookingDate}*.\n\nKetik *ganti tanggal* atau *ganti durasi*.`;
      }
    }
    await appendMessage(current.id, "bot", reply);
    await sendReply(reply);
    return;
  }

  const durationHours = minutesToHours(current.durationMinutes!);
  const endTime = addHoursToTime(current.startTime!, durationHours);
  if (facility && facility.bookingMode !== "walk_in") {
    const available = await checkSlotAvailable(current.facilityId!, current.bookingDate!, current.startTime!, durationHours);
    if (!available) {
      const alternatives = await getAlternativeSlots(
        current.facilityId!, current.bookingDate!, current.startTime!, durationHours, facility.openTime, facility.closeTime,
      );
      let reply = `❌ Slot *${current.startTime}–${endTime}* pada *${current.bookingDate}* untuk *${facility.name}* tidak tersedia.`;
      reply += alternatives.length
        ? `\n\n🕐 *Alternatif terdekat:*\n${alternatives.map((slot, i) => `${i + 1}. *${slot}*`).join("\n")}\n\nKetik jam pilihan kamu.`
        : `\n\nTidak ada alternatif pada tanggal tersebut. Ketik tanggal lain.`;
      current = await updateSession(current.id, { currentStep: "ask_time" });
      await appendMessage(current.id, "bot", reply);
      await sendReply(reply);
      return;
    }
  }

  const priceCalc = await calculatePrice(
    facility!.id, current.bookingDate!, current.startTime!, endTime, durationHours,
  );
  const taxCalc = await resolveCustomerTax(priceCalc.finalPrice, {
    customerId: current.customerId,
    bookingDate: current.bookingDate!,
  });
  const reply = formatSessionSummary({
    facilityName: facility!.name,
    bookingDate: current.bookingDate!,
    startTime: current.startTime!,
    endTime,
    durationHours,
    customerName: current.customerName!,
    pricePerHour: Number(facility!.pricePerHour),
    totalPrice: taxCalc.grandTotal,
    notes: current.notes,
  });
  await appendMessage(current.id, "bot", reply);
  await sendReply(reply);
}

async function startGreetingSession(
  phone: string,
  msg: string,
  waName: string,
  useCustomerToken = false,
): Promise<void> {
  const customer = await getRegisteredCustomer(phone);
  const greeting = "Halo! Aku Mina asisten Sport Center Ada yang bisa Mina bantu hari ini?";
  const greetingSession = await createSession({
    phone,
    customerId: customer?.id ?? null,
    bookerName: String(waName) || null,
    customerName: customer?.name ?? (String(waName) || null),
    currentStep: "ask_facility",
  });
  await appendMessage(greetingSession.id, "customer", msg);
  await appendMessage(greetingSession.id, "bot", greeting);
  await sendWAMsg(phone, greeting, useCustomerToken);
}

async function startBookingSession(
  phone: string,
  msg: string,
  waName: string,
  useCustomerToken = false,
): Promise<void> {
  const intent = parseIntent(msg);
  const customer = await getRegisteredCustomer(phone);

  let facilityId: number | null = null;
  let ambiguousFacilities: Awaited<ReturnType<typeof getFacilityCandidatesByKeyword>> = [];

  if (intent.facilityKeyword) {
    const candidates = await getFacilityCandidatesByKeyword(intent.facilityKeyword);
    if (candidates.length > 1) {
      ambiguousFacilities = candidates;
    } else if (candidates[0]) {
      facilityId = candidates[0].id;
    }
  }

  // Prefer an explicit person/company name, then the verified customer profile,
  // then the WhatsApp profile name. A name is only asked when none is usable.
  const resolvedName = resolveBookingCustomerName(
    intent.personName,
    customer?.name,
    waName,
  );
  const notes = extractMentionedNote(msg);

  const step = facilityId
    ? "choose_mode"
    : getNextStep({
    facilityId,
    bookingDate: intent.bookingDate,
    startTime: intent.startTime,
    durationMinutes: intent.durationMinutes,
    customerName: resolvedName,
    });

  const session = await createSession({
    phone,
    customerId: customer?.id ?? null,
    facilityId,
    bookingDate: intent.bookingDate,
    startTime: intent.startTime,
    durationMinutes: intent.durationMinutes,
    bookerName: waName || null,
    customerName: resolvedName,
    notes,
    currentStep: step,
  });

  await appendMessage(session.id, "customer", msg);

  await logAudit({
    action: "booking_session_started",
    entity: "wa_booking_session",
    entityId: session.id,
    after: { phone, step, facilityId, bookingDate: intent.bookingDate, startTime: intent.startTime },
  });

  if (ambiguousFacilities.length > 1) {
    const sportName = intent.facilityKeyword?.replace(/^badminton$/, "badminton") ?? "fasilitas";
    const reply = buildFacilityChoiceReply(sportName, ambiguousFacilities);
    await appendMessage(session.id, "bot", reply);
    await sendWAMsg(phone, reply, useCustomerToken);
    return;
  }

  await presentBookingSession(session, phone, useCustomerToken);
}

async function continueSession(
  session: WaBookingSessionRow,
  phone: string,
  msg: string,
  useCustomerToken = false,
  appendCustomerMessage = true,
): Promise<void> {
  const sendReply = (message: string) => sendWAMsg(phone, message, useCustomerToken);
  if (appendCustomerMessage) {
    await appendMessage(session.id, "customer", msg);
  }

  const step = session.currentStep as WaStep;
  const lower = msg.toLowerCase().trim();

  // Hanya kata eksplisit batal/cancel yang boleh cancel di semua step
  // "tidak"/"no"/"ga" saja tidak cukup — terlalu ambigu (bisa jawaban dari pertanyaan opsional)
  if (isExplicitCancel(lower)) {
    logger.info({ phone, step }, "[continueSession] explicit cancel");
    await updateSession(session.id, { status: "cancelled" });
    await sendReply(`❌ Booking dibatalkan. Ketik *booking* kapan saja untuk memulai lagi. 🏅`);
    return;
  }

  switch (step) {
    case "wait_registration": {
      // Kirim ulang link registrasi — belum selesai mengisi form
      const regToken = generateRegToken(phone);
      const regUrl = `${await getBaseUrl()}/wa/register/${regToken}`;
      const reply = [
        `📋 Silakan isi formulir pendaftaran terlebih dahulu:`,
        ``,
        regUrl,
        ``,
        `Setelah mengisi, ketik *booking* untuk mulai memesan. 🏅`,
      ].join("\n");
      await appendMessage(session.id, "bot", reply);
      await sendReply(reply);
      break;
    }

    case "ask_facility": {
      const fac = await resolveFacilityFromMsg(msg, session);
      if (!fac) {
        const keyword = detectFacilityKeyword(msg);
        const candidates = keyword
          ? await getFacilityCandidatesByKeyword(keyword)
          : [];
        const reply = candidates.length > 1
          ? buildFacilityChoiceReply(keyword === "badminton" ? "badminton" : (keyword ?? "fasilitas"), candidates)
          : isMinaGreeting(msg) || isBookingRequest(msg)
            ? await buildFacilityList()
            : `Fasilitas tidak ditemukan. ${await buildFacilityList()}`;
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }
      const updated = await updateSession(session.id, {
        facilityId: fac.id,
        currentStep: "choose_mode",
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_facility", facilityId: fac.id } });
      const reply = await buildStepQuestion(updated.currentStep as WaStep, updated, fac.name, Number(fac.pricePerHour));
      await appendMessage(session.id, "bot", reply);
      await sendReply(reply);
      break;
    }

    case "choose_mode": {
      const fac = session.facilityId
        ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null
        : null;

      if (isContinueHere(lower)) {
        // The new Mina flow explicitly asks for the booking name even when a
        // registered WhatsApp profile already has one.
        const updated = await updateSession(session.id, {
          customerName: null,
          currentStep: "ask_name",
        });
        const reply = await buildStepQuestion("ask_name", updated, fac?.name ?? "", Number(fac?.pricePerHour ?? 0));
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      if (isMakeForm(lower)) {
        if (!fac) {
          const reply = await buildFacilityList();
          await updateSession(session.id, { currentStep: "ask_facility" });
          await appendMessage(session.id, "bot", reply);
          await sendReply(reply);
          return;
        }
        const query = new URLSearchParams({ phone });
        if (session.bookingDate) query.set("date", session.bookingDate);
        if (session.startTime) query.set("startTime", session.startTime);
        if (session.durationMinutes) query.set("duration", String(minutesToHours(session.durationMinutes)));
        const formUrl = `${await getBaseUrl()}/wa/booking/${fac.id}?${query.toString()}`;
        const reply =
          `📝 Baik, silakan isi form booking berikut:\n\n${formUrl}\n\n` +
          `Detail yang sudah kamu sebutkan akan kami isi otomatis jika tersedia.`;
        await updateSession(session.id, { status: "completed", currentStep: "done" });
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      const reply = `Pilih salah satu:\n\n1. *Lanjut di sini*\n2. *Buatkan form*`;
      await appendMessage(session.id, "bot", reply);
      await sendReply(reply);
      return;
    }

    case "choose_alternative_facility": {
      if (!session.facilityId || !session.bookingDate || !session.durationMinutes) {
        const reply = `Data fasilitas atau jadwal belum lengkap. Ketik *batal* lalu mulai booking lagi.`;
        await updateSession(session.id, { currentStep: "ask_facility" });
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      // This state is also used when the customer rejects every Court A slot
      // before naming a specific time. In that case there is no requested
      // startTime yet; show the sibling court's schedule and ask explicitly
      // whether it is acceptable.
      if (!session.startTime) {
        const alternativeSlotOptions = await getAlternativeFacilitySlotOptions(
          session.facilityId,
          session.bookingDate,
          session.durationMinutes,
        );
        const directTime = parseSlotStartTime(msg);
        const numericChoice = lower.match(/^\d+$/)?.[0];
        const isAlternativeMenuChoice = numericChoice === "1";
        const requestedDirectTime = directTime && !isAlternativeMenuChoice ? directTime : null;
        const alternativeChoice = isAlternativeMenuChoice
          ? "facility"
          : parseAlternativeBookingChoice(
              msg,
              alternativeSlotOptions.map(({ facility }) => facility.name),
              { allowNumericMenu: false },
            );
        const explicitAlternative = alternativeSlotOptions.find(({ facility }) => {
          const candidateName = facility.name.toLowerCase();
          return lower.includes(candidateName) || /(?:court|lapangan)\s*b\b/i.test(lower);
        });
        const acceptsAlternative =
          /^(?:ya|iya|yes|cocok|setuju|oke|ok|boleh|mau)$/i.test(lower) &&
          alternativeSlotOptions.length === 1;
        const keepCurrentFacility =
          /^(?:tetap|kembali|pilih)\s+(?:di\s+)?(?:court|lapangan)\s*a\b/i.test(lower);
        const rejectsAlternative =
          /^(?:tidak|nggak|ngga|gak|ga)(?:\s+(?:cocok|mau|setuju|pas))?$/i.test(lower);

        if (
          (alternativeChoice === "facility" && alternativeSlotOptions.length > 0) ||
          explicitAlternative ||
          acceptsAlternative ||
          (requestedDirectTime && alternativeSlotOptions.length === 1)
        ) {
          const selected = explicitAlternative ?? alternativeSlotOptions[0];
          if (selected) {
            const switchedDraft = switchBookingFacility(session, selected.facility.id);
            const updated = await updateSession(session.id, {
              facilityId: switchedDraft.facilityId,
              startTime: null,
              currentStep: "ask_time",
            });
            if (requestedDirectTime) {
              await continueSession(updated, phone, msg, useCustomerToken, false);
              return;
            }
            const reply =
              `✅ Baik, saya cek *${selected.facility.name}*.\n\n` +
              `⏰ Apakah salah satu jam berikut cocok untuk durasi *${minutesToHours(session.durationMinutes)} jam* pada tanggal *${session.bookingDate}*?\n\n` +
              `🟢 Slot tersedia:\n${selected.slots.join("  |  ")}\n\n` +
              `Balas *ya* jika cocok, lalu pilih jamnya dengan format *11*, *11:00*, atau *jam 11*.`;
            await appendMessage(updated.id, "bot", reply);
            await sendReply(reply);
            return;
          }
        }

        if (alternativeChoice === "date" || rejectsAlternative) {
          const updated = await updateSession(session.id, {
            ...getAlternativeBookingDraftPatch("date"),
            currentStep: "ask_date",
          });
          const reply =
            `📅 Baik, Court B juga belum cocok. Kita cari tanggal lain.\n\n` +
            `Silakan sebutkan tanggal lain, misalnya *lusa* atau *tanggal 21*.\n` +
            `Ketik *batal* jika ingin menghentikan booking.`;
          await appendMessage(updated.id, "bot", reply);
          await sendReply(reply);
          return;
        }

        const [currentFacility] = await db
          .select()
          .from(facilitiesTable)
          .where(eq(facilitiesTable.id, session.facilityId))
          .limit(1);
        const currentSlots = currentFacility
          ? await getAvailableSlotsForDay(
            currentFacility.id,
            session.bookingDate,
            currentFacility.openTime,
            currentFacility.closeTime,
            session.durationMinutes,
          )
          : [];
        if (alternativeChoice === "duration") {
          const updated = await updateSession(session.id, {
            ...getAlternativeBookingDraftPatch(alternativeChoice),
            currentStep: "ask_duration",
          });
          const reply =
            `⏱️ Baik, kita ganti durasi untuk *${currentFacility?.name ?? "fasilitas ini"}*.\n\n` +
            `Berapa lama durasi booking yang baru?\nContoh: *1 jam*, *2 jam*, *3 jam*.`;
          await appendMessage(updated.id, "bot", reply);
          await sendReply(reply);
          return;
        }
        const updated = await updateSession(session.id, {
          currentStep: "ask_time",
          startTime: null,
        });
        const reply = keepCurrentFacility && currentSlots.length > 0
          ? `⏰ Baik, tetap di *${currentFacility?.name ?? "Court A"}*. Jam berapa yang cocok?\n\n` +
            `🟢 Slot tersedia:\n${currentSlots.join("  |  ")}\n\n` +
            `Balas *11*, *11:00*, atau *jam 11*.`
          : alternativeSlotOptions.length > 0
            ? buildAlternativeFacilitySlotPrompt({
              currentFacilityName: currentFacility?.name ?? "Court A",
              bookingDate: session.bookingDate,
              durationMinutes: session.durationMinutes,
              options: alternativeSlotOptions,
            })
            : `⚠️ Tidak ada slot alternatif di lapangan lain pada tanggal tersebut.\n\n` +
              `Ketik *tanggal lain* atau *batal*.`;
        await appendMessage(updated.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      const alternatives = await getAvailableAlternativeFacilities(
        session.facilityId,
        session.bookingDate,
        session.startTime,
        minutesToHours(session.durationMinutes),
      );
      const numericChoice = lower.match(/^\d+$/)?.[0];
      const isAlternativeMenuChoice = numericChoice === "1";
      const alternativeChoice = isAlternativeMenuChoice
        ? "facility"
        : parseAlternativeBookingChoice(
            msg,
            alternatives.map((candidate) => candidate.name),
            { allowNumericMenu: false },
          );

      // After Mina offers Court B, accept a direct replacement time as well
      // (including a bare displayed hour such as "11"). Only option 1 keeps
      // menu meaning because date/duration are no longer shown as menu items.
      const directTime = parseSlotStartTime(msg);
      if (directTime && !isAlternativeMenuChoice) {
        const timeStep = await updateSession(session.id, {
          startTime: null,
          currentStep: "ask_time",
        });
        await continueSession(timeStep, phone, msg, useCustomerToken, false);
        return;
      }

      const wantsAnotherTime =
        /^(tetap|pilih|ganti).*(jam|waktu)|jam lain|pilih jam lain/i.test(lower);
      const wantsAnotherDate =
        alternativeChoice === "date" ||
        /tanggal lain|ganti tanggal|pilih tanggal lain/i.test(lower);
      const wantsAnotherDuration = alternativeChoice === "duration";

      if (wantsAnotherTime) {
        const updated = await updateSession(session.id, {
          startTime: null,
          currentStep: "ask_time",
        });
        // Re-enter ask_time so a generic rejection checks sibling courts too.
        // Do not keep showing the same Court A list indefinitely.
        await continueSession(updated, phone, msg, useCustomerToken, false);
        return;
      }

      if (wantsAnotherDate) {
        const updated = await updateSession(session.id, {
          ...getAlternativeBookingDraftPatch("date"),
          currentStep: "ask_date",
        });
        const reply = `📅 Baik, silakan pilih tanggal lain untuk *${minutesToHours(session.durationMinutes)} jam* di fasilitas yang sama.`;
        await appendMessage(updated.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      if (wantsAnotherDuration) {
        const updated = await updateSession(session.id, {
          ...getAlternativeBookingDraftPatch("duration"),
          currentStep: "ask_duration",
        });
        const currentFacility = (await db
          .select({ name: facilitiesTable.name })
          .from(facilitiesTable)
          .where(eq(facilitiesTable.id, session.facilityId))
          .limit(1))[0];
        const reply =
          `⏱️ Baik, kita ganti durasi untuk *${currentFacility?.name ?? "fasilitas ini"}*.\n\n` +
          `Berapa lama durasi booking yang baru?\nContoh: *1 jam*, *2 jam*, *3 jam*.`;
        await appendMessage(updated.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      const selected = alternativeChoice === "facility"
        ? alternatives.find((candidate) => {
          const requestedName = lower.replace(/^(pilih|mau|ambil)\s+/, "").trim();
          return candidate.name.toLowerCase() === requestedName ||
            candidate.name.toLowerCase().includes(requestedName) ||
            requestedName.includes(candidate.name.toLowerCase());
        }) ?? alternatives[0]
        : alternatives.find((candidate) => {
          const candidateName = candidate.name.toLowerCase();
          const requestedName = lower.replace(/^(pilih|mau|ambil)\s+/, "").trim();
          return candidateName === requestedName || candidateName.includes(requestedName) || requestedName.includes(candidateName);
        }) ?? (isYes(lower) && alternatives.length === 1 ? alternatives[0] : null);

      if (!selected) {
        const reply = alternatives.length > 0
          ? buildAlternativeFacilityChoiceReply({
            facilityName: (await db
              .select({ name: facilitiesTable.name })
              .from(facilitiesTable)
              .where(eq(facilitiesTable.id, session.facilityId))
              .limit(1))[0]?.name ?? "fasilitas pilihan",
            bookingDate: session.bookingDate,
            startTime: session.startTime,
            endTime: addHoursToTime(session.startTime, minutesToHours(session.durationMinutes)),
            alternatives,
          })
          : `Maaf, slot tersebut sudah tidak tersedia di lapangan lain. Silakan ketik jam lain atau *batal*.`;
        if (alternatives.length === 0) {
          await updateSession(session.id, { startTime: null, currentStep: "ask_time" });
        }
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      const switchedDraft = switchBookingFacility(session, selected.id);
      const updated = await updateSession(session.id, {
        facilityId: switchedDraft.facilityId,
        currentStep: getNextStep({ ...session, facilityId: selected.id }),
      });
      const reply = `✅ Baik, saya pindahkan ke *${selected.name}* untuk slot yang sama.\n\n`;
      await appendMessage(session.id, "bot", reply);
      await sendReply(reply);
      await presentBookingSession(updated, phone, useCustomerToken);
      return;
    }

    case "ask_date": {
      const parsed = parseIntent(msg);
      if (!parsed.bookingDate) {
        const reply = `📅 Tidak bisa mengenali tanggal. Coba format:\n• *besok*\n• *15 Juni*\n• *Senin*\n• *tanggal 20*`;
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }
      if (parsed.bookingDate < todayWIB()) {
        const reply = `📅 Tanggal *${parsed.bookingDate}* sudah lewat. Pilih tanggal hari ini atau yang akan datang.`;
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }
      const updated = await updateSession(session.id, {
        bookingDate: parsed.bookingDate,
        currentStep: getNextStep({ ...session, bookingDate: parsed.bookingDate }),
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_date", bookingDate: parsed.bookingDate } });
      const fac = session.facilityId ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null : null;

      const baseQuestion = await buildStepQuestion(updated.currentStep as WaStep, updated, fac?.name ?? "", Number(fac?.pricePerHour ?? 0));
      const reply = baseQuestion;
      await appendMessage(session.id, "bot", reply);
      await sendReply(reply);
      break;
    }

    case "ask_time": {
      const parsed = parseIntent(msg);
      const alternativeMenuDisplayed = hasDisplayedAlternativeFacilityMenu(session);
      const numericChoice = lower.match(/^\d+$/)?.[0];
      const isAlternativeMenuChoice =
        alternativeMenuDisplayed && numericChoice === "1";
      const alternativeChoice = isAlternativeMenuChoice
        ? "facility"
        : parseAlternativeBookingChoice(msg, [], { allowNumericMenu: false });
      const requestedStartTime = isAlternativeMenuChoice ? null : parseSlotStartTime(msg);

      // Natural replies such as "tidak cocok", "ada lapangan lain?", or
      // "Court B" must work even if an older client/runtime did not render the
      // numeric alternative menu. Bare 1/2/3 remain contextual to that menu.
      const wantsAnotherDate =
        alternativeChoice === "date" ||
        /(?:tanggal|hari).*(?:lain|berbeda|berikutnya)|(?:ganti|pilih|mau).*(?:tanggal|hari)/i.test(lower);
      const wantsAnotherDuration = alternativeChoice === "duration";
      const wantsAnotherTime =
        /(?:jam|waktu).*(?:lain|berbeda)|(?:ganti|pilih|mau|cari).*(?:jam|waktu)/i.test(lower) ||
        /^(?:tidak|nggak|ngga|gak|ga)\b/i.test(lower);
      const wantsAlternativeFacility = alternativeChoice === "facility";

      if (!requestedStartTime && (wantsAnotherDate || wantsAnotherDuration || wantsAnotherTime || wantsAlternativeFacility)) {
        if (wantsAnotherDate) {
          const updated = await updateSession(session.id, {
            ...getAlternativeBookingDraftPatch("date"),
            currentStep: "ask_date",
          });
          const reply = `📅 Baik, kita cari tanggal lain untuk *${session.facilityId ? "fasilitas yang sama" : "booking ini"}*.\n\n` +
            `Silakan sebutkan tanggal lain, misalnya *lusa* atau *tanggal 21*.`;
          await appendMessage(updated.id, "bot", reply);
          await sendReply(reply);
          return;
        }

        if (wantsAnotherDuration) {
          const updated = await updateSession(session.id, {
            ...getAlternativeBookingDraftPatch("duration"),
            currentStep: "ask_duration",
          });
          const reply = `⏱️ Baik, kita ganti durasi tanpa mengubah nama, tanggal, atau fasilitas.\n\nBerapa lama durasi booking yang baru?\nContoh: *1 jam*, *2 jam*, *3 jam*.`;
          await appendMessage(updated.id, "bot", reply);
          await sendReply(reply);
          return;
        }

        const fac = session.facilityId
          ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null
          : null;
        const slots = fac && session.bookingDate
          ? await getAvailableSlotsForDay(
            fac.id,
            session.bookingDate,
            fac.openTime,
            fac.closeTime,
            session.durationMinutes ?? 60,
          )
          : [];
        const alternativeSlotOptions = fac && session.bookingDate
          ? await getAlternativeFacilitySlotOptions(
            fac.id,
            session.bookingDate,
            session.durationMinutes ?? 60,
          )
          : [];
        const updated = await updateSession(session.id, {
          startTime: null,
          currentStep: alternativeSlotOptions.length > 0
            ? "choose_alternative_facility"
            : "ask_time",
        });
        const reply = alternativeSlotOptions.length > 0
          ? buildAlternativeFacilitySlotPrompt({
            currentFacilityName: fac?.name ?? "Court A",
            bookingDate: session.bookingDate!,
            durationMinutes: session.durationMinutes ?? 60,
            options: alternativeSlotOptions,
          })
          : fac && slots.length > 0
            ? `Coba salah satu jam berikut: ${slots.slice(0, 3).join(", ")}.\n` +
              `Atau ketik jam lain yang kamu inginkan.`
            : `Tidak ada jam lain yang tersedia di ${fac?.name ?? "fasilitas ini"} pada tanggal tersebut.\n` +
              `Ketik tanggal lain atau batal.`;
        await appendMessage(updated.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      if (!requestedStartTime) {
        const reply = `⏰ Tidak bisa mengenali jam. Coba format:\n• *jam 8 pagi*\n• *jam 20.00*\n• *19:00*\n• *jam 7 malam*`;
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      // Cek ketersediaan slot dari DB (booking + blocked schedules)
      if (session.facilityId && session.bookingDate) {
        const fac = (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null;
        if (fac && fac.bookingMode !== "walk_in") {
          // Cek jam operasional dulu
           const reqMin = timeToMinutes(requestedStartTime);
          const openMin = timeToMinutes(fac.openTime);
          const rawCloseMin = timeToMinutes(fac.closeTime);
          const closeMin = rawCloseMin === 0 ? 24 * 60 : rawCloseMin;
          const durationMinutes = session.durationMinutes ?? 60;
          const requestedEndMin = reqMin + durationMinutes;
          if (reqMin < openMin || requestedEndMin > closeMin) {
            const availSlots = await getAvailableSlotsForDay(
              session.facilityId,
              session.bookingDate,
              fac.openTime,
              fac.closeTime,
              durationMinutes,
            );
            const slotsStr = availSlots.length > 0
              ? ` Coba: ${availSlots.slice(0, 3).join(", ")}.`
              : ` Tidak ada slot tersedia di tanggal ini.`;
             const reason = reqMin < openMin
               ? `Jam mulai ${requestedStartTime} berada sebelum jam buka`
             : `Booking ${durationMinutes / 60} jam dari ${requestedStartTime} melewati jam tutup`;
            const reply = `${reason} ${fac.openTime}-${fac.closeTime}.${slotsStr}`;
            await appendMessage(session.id, "bot", reply);
            await sendReply(reply);
            return;
          }

          // Cek seluruh rentang sesuai durasi yang dipilih customer.
          const durationHours = minutesToHours(session.durationMinutes ?? 60);
           const isAvail = await checkSlotAvailable(session.facilityId, session.bookingDate, requestedStartTime, durationHours);
          if (!isAvail) {
            const alternativeFacilities = await getAvailableAlternativeFacilities(
              session.facilityId,
              session.bookingDate,
             requestedStartTime,
              durationHours,
            );
            const availSlots = await getAvailableSlotsForDay(
              session.facilityId,
              session.bookingDate,
              fac.openTime,
              fac.closeTime,
              session.durationMinutes ?? 60,
            );
            const slotsStr = availSlots.length > 0
             ? ` Coba jam ${availSlots.slice(0, 3).join(", ")} atau ketik jam lain.`
              : ` Tidak ada slot lain yang tersedia. Pilih tanggal berbeda atau ketik batal.`;
            const reply = alternativeFacilities.length > 0
              ? buildAlternativeFacilityChoiceReply({
                facilityName: fac.name,
                bookingDate: session.bookingDate,
                 startTime: requestedStartTime,
                 endTime: addHoursToTime(requestedStartTime, durationHours),
                alternatives: alternativeFacilities,
                sameFacilitySlots: availSlots,
              })
               : `❌ Slot jam *${requestedStartTime}* pada *${session.bookingDate}* sudah terisi di *${fac.name}*.${slotsStr}`;
            await updateSession(session.id, {
               startTime: requestedStartTime,
              currentStep: alternativeFacilities.length > 0 ? "choose_alternative_facility" : "ask_time",
            });
            await appendMessage(session.id, "bot", reply);
            await sendReply(reply);
            return;
          }
        }
      }

      const updated = await updateSession(session.id, {
         startTime: requestedStartTime,
         currentStep: getNextStep({ ...session, startTime: requestedStartTime }),
      });
       await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_time", startTime: requestedStartTime } });
      const fac2 = session.facilityId ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null : null;

      // Konfirmasi slot tersedia ke customer
      const availConfirm = session.facilityId && session.bookingDate
         ? `✅ Slot jam *${requestedStartTime}* tersedia!\n\n`
        : "";
      const nextQ = await buildStepQuestion(updated.currentStep as WaStep, updated, fac2?.name ?? "", Number(fac2?.pricePerHour ?? 0));
      const reply = availConfirm + nextQ;
      await appendMessage(session.id, "bot", reply);
      await sendReply(reply);
      break;
    }

    case "ask_duration": {
      const parsed = parseIntent(msg);
      // Also handle simple number input like "2" (hours)
      const directNum = lower.match(/^(\d+(?:[.,]\d+)?)$/);
      let durationMinutes = parsed.durationMinutes;
      if (!durationMinutes && directNum) {
        durationMinutes = Math.round(parseFloat(directNum[1].replace(",", ".")) * 60);
      }
      if (!durationMinutes) {
        const reply = `⏱️ Tidak bisa mengenali durasi. Coba:\n• *1 jam*\n• *2 jam*\n• *3 jam*`;
        await appendMessage(session.id, "bot", reply);
        await sendReply(reply);
        return;
      }

      // Persist the entered duration, but do not advance the conversation step
      // until Fonnte has accepted Mina's next prompt. This prevents the session
      // from becoming ask_time while the customer never received the slot list.
      const nextStep = getNextStep({ ...session, durationMinutes });
      const durationDraft = await updateSession(session.id, {
        durationMinutes,
        currentStep: "ask_duration",
      });
      await logAudit({
        action: "booking_session_updated",
        entity: "wa_booking_session",
        entityId: session.id,
        after: { step: "ask_duration", durationMinutes, pendingNextStep: nextStep },
      });

      const fac = session.facilityId
        ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null
        : null;
      const responseSession = { ...durationDraft, currentStep: nextStep } as WaBookingSessionRow;
      let deliveredStep: WaStep = nextStep;
      let reply = await buildStepQuestion(
        nextStep,
        responseSession,
        fac?.name ?? "",
        Number(fac?.pricePerHour ?? 0),
      );

      if (fac && durationDraft.bookingDate && fac.bookingMode !== "walk_in" && nextStep === "ask_time") {
        const slots = await getAvailableSlotsForDay(
          fac.id,
          durationDraft.bookingDate,
          fac.openTime,
          fac.closeTime,
          durationDraft.durationMinutes ?? 60,
        );
        const alternatives = await getAlternativeFacilitySlotOptions(
          fac.id,
          durationDraft.bookingDate,
          durationDraft.durationMinutes ?? 60,
        );

        if (slots.length > 0) {
          reply =
            `Jam berapa mau mulai?\n` +
            `Contoh: jam 8 pagi, jam 20.00, 19:00`;
        } else if (alternatives.length > 0) {
          deliveredStep = "choose_alternative_facility";
          reply = buildAlternativeFacilitySlotPrompt({
            currentFacilityName: fac.name,
            bookingDate: durationDraft.bookingDate,
            durationMinutes: durationDraft.durationMinutes ?? 60,
            options: alternatives,
            reason: "full",
          });
        } else {
          reply += `\n\n⚠️ Tidak ada slot yang sesuai durasi di *${fac.name}* maupun fasilitas sejenis pada tanggal ini.\n\nKetik *ganti tanggal* atau *ganti durasi*.`;
        }
      }

      await appendMessage(durationDraft.id, "bot", reply);
      const delivered = await sendReply(reply);
      if (delivered) {
        await updateSession(session.id, { currentStep: deliveredStep });
      } else {
        await updateSession(session.id, {
          durationMinutes: session.durationMinutes,
          currentStep: "ask_duration",
        });
        await logAudit({
          action: "mina_booking_step_delivery_failed",
          entity: "wa_booking_session",
          entityId: session.id,
          after: {
            attemptedStep: deliveredStep,
            restoredStep: "ask_duration",
            message: msg,
          },
        }).catch(() => {});
      }
      break;
    }

    case "ask_name": {
      // This step intentionally captures the customer's direct answer as the
      // booking customer_name. Mina asks for one simple name; no role or
      // relationship prefix is required.
      const rawName = msg.trim();

      // Fonnte can retry an inbound message after the previous handler has
      // already advanced the session. Do not treat the previous menu answer
      // ("lanjut di sini") or another flow command as the customer's name.
      if (
        isContinueHere(rawName) ||
        isMakeForm(rawName) ||
        isMinaGreeting(rawName) ||
        isBookingRequest(rawName) ||
        isYes(rawName)
      ) {
        const hint = `👤 *Pesan/Booking atas nama siapa?*\n\nContoh: *Andi*`;
        await appendMessage(session.id, "bot", hint);
        await sendReply(hint);
        return;
      }

      if (rawName.length < 2 || rawName.length > 150) {
        const hint = `👤 Nama booking belum valid. Contoh: *Andi*`;
        await appendMessage(session.id, "bot", hint);
        await sendReply(hint);
        return;
      }

      const updated = await updateSession(session.id, {
        customerName: rawName,
        // Notes are optional and are only persisted when the customer
        // mentioned them in natural language. Do not add an extra question.
        currentStep: getNextStep({ ...session, customerName: rawName }),
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_name", customerName: rawName } });
      const fac = session.facilityId ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null : null;

      const reply = await buildStepQuestion(
        updated.currentStep as WaStep,
        updated,
        fac?.name ?? "",
        Number(fac?.pricePerHour ?? 0),
      );
      await appendMessage(session.id, "bot", reply);
      await sendReply(reply);
      break;
    }

    case "ask_notes": {
      // Match exact skip words OR phrases meaning "no notes" / "nothing to add"
      const SKIP_WORDS = /^(tidak|nggak|ngga|ga|gak|skip|lewat|no|tidak ada|kosong|-|\.+|x)$/i;
      const SKIP_PHRASES = /^(tidak ada catatan|tidak ada tambahan|tidak ada|gak ada catatan|ga ada catatan|nggak ada catatan|no catatan|gak ada|ga ada|nggak ada|tidak perlu|gak perlu|ga perlu|tidak|nggak)[\s.,!]*$/i;
      const isSkip = SKIP_WORDS.test(msg.trim()) || SKIP_PHRASES.test(msg.trim());
      const noteText = isSkip ? "" : msg.trim().slice(0, 300); // max 300 chars

      const updated = await updateSession(session.id, {
        notes: noteText,        // "" = skipped, "text" = has note
        currentStep: "confirm",
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_notes", notes: noteText || null } });
      const fac = session.facilityId ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null : null;

      const noteAck = noteText ? `📝 Catatan dicatat: *${noteText}*\n\n` : "";
      const confirmQ = await buildStepQuestion("confirm", updated, fac?.name ?? "", Number(fac?.pricePerHour ?? 0));
      const reply = noteAck + confirmQ;
      await appendMessage(session.id, "bot", reply);
      await sendReply(reply);
      break;
    }

    case "confirm": {
      if (isYes(lower)) {
        try {
          await execCreateBookingFromSession(session, phone, useCustomerToken);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            { phone, sessionId: session.id, error: errorMessage },
            "[continueSession] booking confirmation failed",
          );
          await logAudit({
            action: "wa_booking_confirmation_failed",
            entity: "wa_booking_session",
            entityId: session.id,
            after: { phone, error: errorMessage },
          }).catch(() => {});

          const reply =
            `⚠️ Booking belum berhasil diproses karena ada gangguan sementara.\n\n` +
            `Data booking belum kami konfirmasi. Silakan ketik *ya* lagi untuk mencoba ulang ` +
            `atau *batal* untuk membatalkan.`;
          await appendMessage(session.id, "bot", reply);
          await sendReply(reply);
        }
      } else if (isNo(lower)) {
        await updateSession(session.id, { status: "cancelled" });
        await sendReply(`❌ Booking dibatalkan. Ketik *booking* untuk memulai lagi. 🏅`);
      } else {
        const fac = session.facilityId ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null : null;
        const reply = await buildStepQuestion("confirm", session, fac?.name ?? "", Number(fac?.pricePerHour ?? 0));
        await sendReply(`Ketik *ya* untuk konfirmasi atau *batal* untuk membatalkan.\n\n${reply}`);
      }
      break;
    }

    default: {
      await sendReply(`Ketik *booking* untuk membuat booking baru atau *status* untuk cek pesanan. 🏅`);
    }
  }
}

async function buildStepQuestion(
  step: WaStep,
  session: WaBookingSessionRow,
  facilityName: string,
  pricePerHour: number
): Promise<string> {
  switch (step) {
    case "ask_facility":
      return await buildFacilityList();

    case "choose_mode":
      return [
        `✅ Fasilitas *${facilityName}* dipilih.`,
        ``,
        `Mau lanjut pesan/booking di sini atau dibuatkan form?`,
        `1. *Lanjut di sini*`,
        `2. *Buatkan form*`,
      ].join("\n");

    case "ask_date":
      return `📅 Tanggal berapa mau booking${facilityName ? ` *${facilityName}*` : ""}?\nContoh: *besok*, *15 Juni*, *Sabtu*, *tanggal 20*`;

    case "ask_time": {
      const fac = session.facilityId
        ? (await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1))[0] ?? null
        : null;
      const hours = fac ? ` (jam operasional: *${fac.openTime}–${fac.closeTime}*)` : "";
      const facilityLabel = fac?.name ? ` di *${fac.name}*` : "";
      return `⏰ Jam berapa mau mulai${facilityLabel}?${hours}\nContoh: *jam 8 pagi*, *jam 20.00*, *19:00*`;
    }

    case "ask_duration":
      return `⏱️ Berapa lama? (min 1 jam)\nContoh: *1 jam*, *2 jam*, *3 jam*`;

    case "ask_name":
      return [
        `👤 *Pesan/Booking atas nama siapa?*`,
        ``,
        `Contoh: *Andi*`,
      ].join("\n");

    case "ask_notes":
      return [
        `📝 *Ada catatan tambahan untuk booking ini?* (opsional)`,
        ``,
        `Contoh: _untuk turnamen_, _butuh net ekstra_, _3 tim_, _pemula_`,
        ``,
        `Atau ketik *tidak* jika tidak ada catatan.`,
      ].join("\n");

    case "confirm": {
      if (!session.facilityId || !session.bookingDate || !session.startTime || !session.durationMinutes || !session.customerName) {
        return `Ada data yang belum lengkap. Ketik *batal* dan mulai ulang.`;
      }
      const durationHours = minutesToHours(session.durationMinutes);
      const endTime = addHoursToTime(session.startTime, durationHours);
      let totalPrice = pricePerHour * durationHours;
      try {
        const priceCalc = await calculatePrice(
          session.facilityId,
          session.bookingDate,
          session.startTime,
          endTime,
          durationHours,
        );
        const taxCalc = await resolveCustomerTax(priceCalc.finalPrice, {
          customerId: session.customerId,
          bookingDate: session.bookingDate,
        });
        totalPrice = taxCalc.grandTotal;
      } catch {
        // The final create path revalidates and recalculates; keep the prompt
        // usable if a pricing rule is temporarily unavailable.
      }
      return formatSessionSummary({
        facilityName,
        bookingDate: session.bookingDate,
        startTime: session.startTime,
        endTime,
        durationHours,
        customerName: session.customerName,
        pricePerHour,
        totalPrice,
      });
    }

    default:
      return `Ketik *booking* untuk membuat booking baru. 🏅`;
  }
}

// ─── Helper: get alternative available slots ──────────────────────────────────

function minutesToTimeStr(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function isWeekendDate(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00+07:00");
  return d.getDay() === 0 || d.getDay() === 6;
}

async function getAlternativeSlots(
  facilityId: number,
  date: string,
  requestedStartTime: string,
  durationHours: number,
  openTime: string,
  closeTime: string
): Promise<string[]> {
  const existingBookings = await db.select({
    startTime: bookingsTable.startTime,
    endTime: bookingsTable.endTime,
    status: bookingsTable.status,
  }).from(bookingsTable)
    .where(and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, date)));
  const blockedSchedules = await db.select({
    startTime: blockedSchedulesTable.startTime,
    endTime: blockedSchedulesTable.endTime,
  }).from(blockedSchedulesTable)
    .where(and(eq(blockedSchedulesTable.facilityId, facilityId), eq(blockedSchedulesTable.date, date)));

  return getNearestAvailableSlots({
    requestedStartTime,
    durationMinutes: durationHours * 60,
    openTime,
    closeTime,
    bookings: existingBookings,
    blockedSchedules,
  });
}

// ─── Availability helpers (cek DB termasuk blocked schedules) ────────────────

async function getAvailableSlotsForDay(
  facilityId: number,
  date: string,
  openTime: string,
  closeTime: string,
  durationMinutes = 60,
): Promise<string[]> {
  const bookings = await db
    .select({ startTime: bookingsTable.startTime, endTime: bookingsTable.endTime, status: bookingsTable.status })
    .from(bookingsTable)
    .where(and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, date)));
  const activeBookings = bookings.filter((b: typeof bookings[number]) => !INACTIVE_STATUSES.includes(b.status));

  const blocked = await db
    .select({ startTime: blockedSchedulesTable.startTime, endTime: blockedSchedulesTable.endTime })
    .from(blockedSchedulesTable)
    .where(and(eq(blockedSchedulesTable.facilityId, facilityId), eq(blockedSchedulesTable.date, date)));

  const openMin = timeToMinutes(openTime);
  const rawCloseMin = timeToMinutes(closeTime);
  const closeMin = rawCloseMin === 0 ? 24 * 60 : rawCloseMin;
  const available: string[] = [];

  for (let t = openMin; t + durationMinutes <= closeMin; t += 60) {
    const slotEnd = t + durationMinutes;
    const timeStr = minutesToTimeStr(t);
    const isBooked = activeBookings.some((b: typeof activeBookings[number]) => {
      const bS = timeToMinutes(b.startTime);
      const bE = timeToMinutes(b.endTime);
      return t < bE && slotEnd > bS;
    });
    const isBlocked = blocked.some((b: typeof blocked[number]) => {
      const bS = timeToMinutes(b.startTime);
      const bE = timeToMinutes(b.endTime);
      return t < bE && slotEnd > bS;
    });
    if (!isBooked && !isBlocked) available.push(timeStr);
  }
  return available;
}

type AlternativeFacilitySlotOption = {
  facility: typeof facilitiesTable.$inferSelect;
  slots: string[];
};

async function getAlternativeFacilitySlotOptions(
  facilityId: number,
  date: string,
  durationMinutes: number,
): Promise<AlternativeFacilitySlotOption[]> {
  const [selectedFacility] = await db
    .select()
    .from(facilitiesTable)
    .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.isActive, true)))
    .limit(1);
  if (!selectedFacility || selectedFacility.bookingMode === "walk_in") return [];

  const activeFacilities = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.isActive, true));
  const selectedText = `${selectedFacility.name} ${selectedFacility.category}`.toLowerCase();
  const isBadminton = /badminton|bulutangkis|bulu tangkis/.test(selectedText);
  const siblings = activeFacilities.filter((candidate) => {
    if (candidate.id === selectedFacility.id || candidate.bookingMode === "walk_in") return false;
    const candidateText = `${candidate.name} ${candidate.category}`.toLowerCase();
    return isBadminton
      ? /badminton|bulutangkis|bulu tangkis/.test(candidateText)
      : candidate.category.toLowerCase() === selectedFacility.category.toLowerCase();
  });

  const options: AlternativeFacilitySlotOption[] = [];
  for (const facility of siblings) {
    const slots = await getAvailableSlotsForDay(
      facility.id,
      date,
      facility.openTime,
      facility.closeTime,
      durationMinutes,
    );
    if (slots.length > 0) options.push({ facility, slots });
  }
  return options;
}

function buildAlternativeFacilitySlotPrompt(params: {
  currentFacilityName: string;
  bookingDate: string;
  durationMinutes: number;
  options: AlternativeFacilitySlotOption[];
  reason?: "not_suitable" | "full";
}): string {
  const optionText = params.options
    .map(({ facility, slots }) =>
      `🏸 *${facility.name}*\n${slots.join("  | ")}`,
    )
    .join("\n\n");
  const intro = params.reason === "full"
    ? `⚠️ Semua slot yang sesuai durasi di *${params.currentFacilityName}* pada *${params.bookingDate}* sudah penuh.`
    : `❌ Baik, slot yang tampil di *${params.currentFacilityName}* belum cocok.`;
  return [
    intro,
    ``,
    `Saya cek lapangan sejenis lain pada tanggal *${params.bookingDate}* untuk durasi *${minutesToHours(params.durationMinutes)} jam*:`,
    ``,
    optionText,
    ``,
    `⏰ Ketik jam yang kamu inginkan dari slot di atas. Jika hanya ada satu lapangan alternatif, Mina akan mengecek jam itu di lapangan tersebut tanpa mengulang data booking.`,
    `Kamu juga bisa ketik nama lapangan, misalnya *Court B*.`,
    ``,
    formatAlternativeFacilityOptions(params.options.map(({ facility }) => facility.name)),
  ].join("\n");
}

async function getAvailableAlternativeFacilities(
  facilityId: number,
  date: string,
  startTime: string,
  durationHours: number,
): Promise<Array<typeof facilitiesTable.$inferSelect>> {
  const [selectedFacility] = await db
    .select()
    .from(facilitiesTable)
    .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.isActive, true)))
    .limit(1);
  if (!selectedFacility || selectedFacility.bookingMode === "walk_in") return [];

  const activeFacilities = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.isActive, true));

  const selectedName = selectedFacility.name.toLowerCase();
  const selectedCategory = selectedFacility.category.toLowerCase();
  const isBadminton = /badminton|bulutangkis|bulu tangkis/.test(`${selectedName} ${selectedCategory}`);
  const siblings = activeFacilities.filter((candidate) => {
    if (candidate.id === selectedFacility.id || candidate.bookingMode === "walk_in") return false;
    if (isBadminton) {
      return /badminton|bulutangkis|bulu tangkis/.test(
        `${candidate.name.toLowerCase()} ${candidate.category.toLowerCase()}`,
      );
    }
    return candidate.category.toLowerCase() === selectedCategory;
  });

  const startMin = timeToMinutes(startTime);
  const endMin = startMin + durationHours * 60;
  const available: Array<typeof facilitiesTable.$inferSelect> = [];
  for (const candidate of siblings) {
    const rawCloseMin = timeToMinutes(candidate.closeTime);
    const closeMin = rawCloseMin === 0 ? 24 * 60 : rawCloseMin;
    if (startMin < timeToMinutes(candidate.openTime) || endMin > closeMin) continue;
    if (await checkSlotAvailable(candidate.id, date, startTime, durationHours)) {
      available.push(candidate);
    }
  }
  return available;
}

function buildAlternativeFacilityChoiceReply(params: {
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  alternatives: Array<typeof facilitiesTable.$inferSelect>;
  sameFacilitySlots?: string[];
}): string {
  const sameFacilitySlots = params.sameFacilitySlots?.length
    ? [
      ``,
      `🟢 Jika tetap di *${params.facilityName}*, slot lain yang tersedia untuk durasi yang sama:`,
      params.sameFacilitySlots.join("  | "),
      `Kamu juga boleh langsung ketik salah satu jam di atas.`,
    ].join("\n")
    : `\n\n⚠️ Tidak ada jam lain yang tersedia di *${params.facilityName}* untuk tanggal tersebut.`;

  const alternativeNames = params.alternatives.map((candidate) => candidate.name);
  const alternativeAction = alternativeNames.length === 1
    ? [
      `✅ Slot *${params.startTime}–${params.endTime}* tersedia di *${alternativeNames[0]}*.`,
      ``,
      `1. Gunakan *${alternativeNames[0]}* untuk jam yang sama`,
      `2. Ganti tanggal`,
      `3. Ganti durasi`,
    ].join("\n")
    : [
      `✅ Slot *${params.startTime}–${params.endTime}* tersedia di beberapa fasilitas sejenis:`,
      ...alternativeNames.map((name) => `• *${name}*`),
      ``,
      `Ketik nama fasilitas yang ingin dipakai.`,
      `Atau ketik *ganti tanggal* / *ganti durasi*.`,
    ].join("\n");

  return [
    `❌ Slot *${params.startTime}–${params.endTime}* di *${params.facilityName}* pada *${params.bookingDate}* sudah penuh.`,
    ``,
    alternativeAction,
    sameFacilitySlots,
  ].join("\n");
}

async function checkSlotAvailable(
  facilityId: number,
  date: string,
  startTime: string,
  durationHours: number,
): Promise<boolean> {
  const startMin = timeToMinutes(startTime);
  const endMin = startMin + durationHours * 60;
  const endTime = minutesToTimeStr(endMin);

  const conflict = await checkConflict(facilityId, date, startTime, endTime);
  if (conflict) return false;

  const blocked = await db
    .select({ startTime: blockedSchedulesTable.startTime, endTime: blockedSchedulesTable.endTime })
    .from(blockedSchedulesTable)
    .where(and(eq(blockedSchedulesTable.facilityId, facilityId), eq(blockedSchedulesTable.date, date)));

  return !blocked.some((b: typeof blocked[number]) => {
    const bS = timeToMinutes(b.startTime);
    const bE = timeToMinutes(b.endTime);
    return startMin < bE && endMin > bS;
  });
}

// ─── Auto-create customer if WA user not registered ───────────────────────────

async function ensureCustomer(phone: string, name: string): Promise<{ id: number; email: string }> {
  const [existing] = await db.select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (existing) return { id: existing.id, email: existing.email ?? `wa_${phone}@whatsapp.local` };

  const customerCode = await generateCustomerCode();
  const finalEmail = `wa_${phone}@whatsapp.local`;
  const [emailConflict] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, finalEmail)).limit(1);

  const email = emailConflict ? `wa_${phone}_${Date.now()}@whatsapp.local` : finalEmail;
  const passwordHash = await hashPassword(randomBytes(16).toString("hex"));

  const [user] = await db.insert(usersTable).values({
    name: name.trim(),
    email,
    passwordHash,
    phone,
    role: "customer",
    customerCode,
    registrationSource: "whatsapp",
  }).returning({ id: usersTable.id, email: usersTable.email });

  await logAudit({
    action: "CUSTOMER_REGISTERED_VIA_WA_CHAT",
    entity: "user",
    entityId: user.id,
    after: { customerCode, phone, name: name.trim(), registrationSource: "whatsapp" },
  });

  return { id: user.id, email: user.email ?? email };
}

// ─── Main: create booking from session with full FASE 2 logic ─────────────────

async function execCreateBookingFromSession(
  session: WaBookingSessionRow,
  phone: string,
  useCustomerToken = false,
): Promise<void> {
  const sendReply = (message: string) => sendWAMsg(phone, message, useCustomerToken);
  if (!session.facilityId || !session.bookingDate || !session.startTime || !session.durationMinutes || !session.customerName) {
    await sendReply(`❌ Data booking tidak lengkap. Ketik *batal* dan mulai ulang.`);
    return;
  }
  // Capture the narrowed values before entering the transaction callback.
  // Drizzle's callback type does not preserve property narrowing from the
  // session guard across the closure.
  const facilityId = session.facilityId;
  const bookingDate = session.bookingDate;
  const startTime = session.startTime;
  const durationMinutes = session.durationMinutes;
  const customerName = session.customerName;

  // ── 1. Validasi fasilitas ──────────────────────────────────────────────────
  const [facility] = await db.select().from(facilitiesTable)
    .where(and(eq(facilitiesTable.id, session.facilityId), eq(facilitiesTable.isActive, true)))
    .limit(1);
  if (!facility) {
    await sendReply(`❌ Fasilitas tidak ditemukan atau sudah tidak aktif. Ketik *batal* dan mulai ulang.`);
    return;
  }

  // ── 2. Hitung durasi & end time ────────────────────────────────────────────
  const durationHours = minutesToHours(session.durationMinutes);
  const endTime = addHoursToTime(session.startTime, durationHours);

  // ── 3. Validasi jam operasional ────────────────────────────────────────────
  const openMin = timeToMinutes(facility.openTime);
  const closeMin = timeToMinutes(facility.closeTime);
  const startMin = timeToMinutes(session.startTime);
  const endMin = timeToMinutes(endTime);
  if (startMin < openMin || endMin > closeMin) {
    const reply =
      `⚠️ Waktu yang dipilih di luar jam operasional *${facility.openTime}–${facility.closeTime}*.\n` +
      `Pilih jam lain. Ketik jam yang kamu inginkan.`;
    await updateSession(session.id, { currentStep: "ask_time" });
    await appendMessage(session.id, "bot", reply);
    await sendReply(reply);
    return;
  }

  // ── 4. Validasi tanggal (tidak boleh lampau) ───────────────────────────────
  if (session.bookingDate < todayWIB()) {
    const reply = `⚠️ Tanggal *${session.bookingDate}* sudah lewat. Pilih tanggal yang akan datang.`;
    await updateSession(session.id, { currentStep: "ask_date" });
    await appendMessage(session.id, "bot", reply);
    await sendReply(reply);
    return;
  }

  // ── 5. Audit: data lengkap ─────────────────────────────────────────────────
  await logAudit({
    action: "booking_data_completed",
    entity: "wa_booking_session",
    entityId: session.id,
    after: {
      phone,
      facilityId: session.facilityId,
      facilityName: facility.name,
      bookingDate: session.bookingDate,
      startTime: session.startTime,
      endTime,
      durationHours,
      customerName: session.customerName,
    },
  });

  // ── 6. Cek bentrok jadwal ──────────────────────────────────────────────────
  const conflict = await checkConflict(facility.id, session.bookingDate, session.startTime, endTime);
  if (conflict) {
    const alternativeFacilities = await getAvailableAlternativeFacilities(
      facility.id,
      session.bookingDate,
      session.startTime,
      durationHours,
    );
    const alternatives = await getAlternativeSlots(
      facility.id, session.bookingDate, session.startTime, durationHours, facility.openTime, facility.closeTime
    );

    await logAudit({
      action: "schedule_conflict_detected",
      entity: "wa_booking_session",
      entityId: session.id,
      after: { phone, facilityId: facility.id, bookingDate: session.bookingDate, startTime: session.startTime, endTime, alternatives },
    });

    let reply =
      `⚠️ *Jadwal Tidak Tersedia*\n\n` +
      `Slot *${session.startTime}–${endTime}* pada *${session.bookingDate}* sudah terisi untuk *${facility.name}*.`;

    if (alternativeFacilities.length > 0) {
      reply = buildAlternativeFacilityChoiceReply({
        facilityName: facility.name,
        bookingDate: session.bookingDate,
        startTime: session.startTime,
        endTime,
        alternatives: alternativeFacilities,
        sameFacilitySlots: alternatives.map((alternative) => alternative.split("–")[0]),
      });
      await updateSession(session.id, { currentStep: "choose_alternative_facility" });
    } else if (alternatives.length > 0) {
      reply += `\n\n🕐 *Alternatif jam yang tersedia pada tanggal yang sama:*\n` +
        alternatives.map((alt, i) => `${i + 1}. *${alt}*`).join("\n") +
        `\n\nKetik jam pilihan kamu (contoh: *jam 10.00*) atau *batal* untuk membatalkan.`;
      await updateSession(session.id, { currentStep: "ask_time" });
    } else {
      reply += `\n\nMaaf, tidak ada slot lain yang tersedia pada tanggal tersebut.\nKetik tanggal lain atau *batal* untuk membatalkan.`;
      await updateSession(session.id, { currentStep: "ask_time" });
    }

    await appendMessage(session.id, "bot", reply);
    await sendReply(reply);
    return;
  }

  // ── 7. Cari atau buat customer ─────────────────────────────────────────────
  const customer = await ensureCustomer(phone, session.customerName);

  // ── 8. Hitung harga dari pricing rules (weekday/weekend/peak) ─────────────
  let priceCalc;
  try {
    priceCalc = await calculatePrice(facility.id, session.bookingDate, session.startTime, endTime, durationHours);
  } catch {
    priceCalc = { basePrice: Number(facility.pricePerHour) * durationHours, finalPrice: Number(facility.pricePerHour) * durationHours, appliedRules: [] };
  }

  const totalPrice = priceCalc.finalPrice;
  const basePrice = priceCalc.basePrice;
  const discountAmount = Math.max(0, basePrice - totalPrice);
  const appliedRulesStr = priceCalc.appliedRules.length > 0
    ? priceCalc.appliedRules.map(r => `${r.name} (${r.adjustment >= 0 ? "+" : ""}${formatIDR(r.adjustment)})`).join(", ")
    : "";

  // ── 9. Hitung PPN ──────────────────────────────────────────────────────────
  const taxCalc = await resolveCustomerTax(totalPrice, {
    customerId: customer.id,
    bookingDate: session.bookingDate,
  });
  const grandTotal = taxCalc.grandTotal;
  const orderNumber = await generateBookingOrderNumber();

  // ── 10. Buat booking dengan status pending_payment ─────────────────────────
  let booking = null as unknown as typeof bookingsTable.$inferSelect;
  try {
    await db.transaction(async (tx) => {
      // Serialize only booking attempts for the same facility/day. This
      // closes the check-then-insert race without changing the canonical
      // booking lifecycle or requiring a broad database constraint migration.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`sport-center:${facility.id}:${session.bookingDate}`}, 0)
      )`);

      const [sameDayBookings, blocked] = await Promise.all([
        tx.select({
          startTime: bookingsTable.startTime,
          endTime: bookingsTable.endTime,
          status: bookingsTable.status,
        }).from(bookingsTable).where(and(
          eq(bookingsTable.facilityId, facility.id),
        eq(bookingsTable.bookingDate, bookingDate),
        )),
        tx.select({
          startTime: blockedSchedulesTable.startTime,
          endTime: blockedSchedulesTable.endTime,
        }).from(blockedSchedulesTable).where(and(
          eq(blockedSchedulesTable.facilityId, facility.id),
        eq(blockedSchedulesTable.date, bookingDate),
        )),
      ]);

      if (hasSlotConflict({
        startTime,
        endTime,
        bookings: sameDayBookings,
        blockedSchedules: blocked,
      })) {
        throw new Error("WA_SLOT_CONFLICT_AFTER_LOCK");
      }

      const [created] = await tx.insert(bookingsTable).values({
        orderNumber,
        customerName,
        customerEmail: customer.email,
        customerPhone: phone,
        customerId: customer.id,
        facilityId: facility.id,
        bookingDate,
        startTime,
        endTime,
        durationHours,
        totalPrice: String(totalPrice),
        discountAmount: String(discountAmount),
        apDiscountAmount: "0",
        basePrice: String(basePrice),
        source: "whatsapp_ai",
         status: "pending_payment",
        bookerName: session.bookerName || null,
        notes: session.notes || null,
        ppnRate: taxCalc.taxRate > 0 ? String(taxCalc.taxRate) : null,
        dpp: String(taxCalc.dpp),
        ppnAmount: String(taxCalc.taxAmount),
        grandTotal: String(taxCalc.grandTotal),
        ppnTreatment: taxCalc.ppnTreatment,
        ppnCollectedByCustomer: taxCalc.ppnCollectedByCustomer,
      }).returning();
      booking = created;

      await tx.insert(bookingHistoryTable).values({
        bookingId: created.id,
        fromStatus: null,
         toStatus: "pending_payment",
        changedByName: session.customerName,
         note: "Booking dibuat via WhatsApp Mina — menunggu pembayaran",
      });
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "WA_SLOT_CONFLICT_AFTER_LOCK") {
      throw error;
    }

    const alternatives = await getAlternativeSlots(
      facility.id,
      session.bookingDate,
      session.startTime,
      durationHours,
      facility.openTime,
      facility.closeTime,
    );
    let reply =
      `⚠️ *Jadwal Tidak Tersedia*\n\n` +
      `Slot *${session.startTime}–${endTime}* pada *${session.bookingDate}* sudah diambil atau diblokir untuk *${facility.name}*.`;
    const alternativeFacilities = await getAvailableAlternativeFacilities(
      facility.id,
      session.bookingDate,
      session.startTime,
      durationHours,
    );
    if (alternativeFacilities.length > 0) {
      reply = buildAlternativeFacilityChoiceReply({
        facilityName: facility.name,
        bookingDate: session.bookingDate,
        startTime: session.startTime,
        endTime,
        alternatives: alternativeFacilities,
        sameFacilitySlots: alternatives.map((alternative) => alternative.split("–")[0]),
      });
      await updateSession(session.id, { currentStep: "choose_alternative_facility" });
    } else {
      reply += alternatives.length
        ? `\n\n🕐 *Alternatif terdekat:*\n${alternatives.map((alt, i) => `${i + 1}. *${alt}*`).join("\n")}\n\nKetik jam pilihan kamu atau *batal* untuk membatalkan.`
        : `\n\nTidak ada alternatif pada tanggal tersebut. Ketik tanggal lain atau *batal*.`;
      await updateSession(session.id, { currentStep: "ask_time" });
    }
    await appendMessage(session.id, "bot", reply);
    await sendReply(reply);
    return;
  }

  broadcastAvailabilityChange(facility.id, session.bookingDate);

  if (taxCalc.taxCode) {
    recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, session.bookingDate).catch(() => {});
  }

  // Mark session done
  await updateSession(session.id, { status: "completed", currentStep: "done" });

  // Spam check: jika 3+ booking dalam 24 jam → auto-block nomor
  try {
    const spamResult = await db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*) AS cnt FROM sport_center.bookings
          WHERE customer_phone = ${phone}
            AND created_at > NOW() - INTERVAL '24 hours'
            AND status NOT IN ('cancelled','expired','rejected','refunded')`
    );
    const spamCount = parseInt(spamResult.rows[0]?.cnt ?? "0", 10);
    if (spamCount >= 3) {
      await db.execute(
        sql`INSERT INTO sport_center.wa_blocked_phones (phone, reason, blocked_by)
            VALUES (${phone}, ${"Auto-blocked: " + spamCount + " booking dalam 24 jam"}, 'system')
            ON CONFLICT (phone) DO UPDATE
              SET is_active = true,
                  reason = EXCLUDED.reason,
                  updated_at = NOW()`
      );
      await logAudit({ action: "phone_auto_blocked_spam", entity: "wa_session", after: { phone, spamCount } });
      const adminPhoneList = await getAdminPhones();
      for (const ap of adminPhoneList) {
        await sendWAMsg(ap, `🚫 *Auto-block*: Nomor *${phone}* telah diblokir otomatis karena membuat *${spamCount} booking* dalam 24 jam.\n\nKetik *UNBLOCK ${phone}* untuk membuka blokir.`).catch(() => {});
      }
    }
  } catch { /* non-fatal */ }

  // ── 11. Audit: booking dibuat ──────────────────────────────────────────────
  await logAudit({
    action: "booking_created_from_wa",
    entity: "booking",
    entityId: booking.id,
    after: {
      orderNumber,
      source: "whatsapp_chat",
      sessionId: session.id,
       status: "pending_payment",
      facilityId: facility.id,
      bookingDate: session.bookingDate,
      startTime: session.startTime,
      endTime,
      totalPrice: grandTotal,
      customerId: customer.id,
      appliedRules: appliedRulesStr || null,
    },
  });

  const statusUrl = `${await getBaseUrl()}/status/${orderNumber}`;
  const weekend = isWeekendDate(session.bookingDate);
  const paymentToken = await createWaToken(booking.id, "upload_proof", 7);
  const paymentUrl = `${await getBaseUrl()}/bayar/${paymentToken}`;
  const paymentDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.update(bookingsTable).set({ paymentDeadline, updatedAt: new Date() }).where(eq(bookingsTable.id, booking.id));

  // ── 12. Kirim WA ke customer ───────────────────────────────────────────────
  await notifyWaBookingPaymentRequired({
    customerName: session.customerName,
    customerPhone: phone,
    orderNumber,
    facilityName: facility.name,
    bookingDate: session.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    durationHours,
    totalPrice: grandTotal.toLocaleString("id-ID"),
    statusUrl,
    paymentUrl,
    paymentDeadline: paymentDeadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false }),
  });

  // The customer sends the proof through the payment page; staff notification
  // is sent only after OCR succeeds or fails, so the admin queue is actionable.
  await logAudit({
    action: "wa_payment_required_sent",
    entity: "booking",
    entityId: booking.id,
    after: { orderNumber, paymentUrl, bookingDate: session.bookingDate, facilityName: facility.name },
  });
}

// ─── Fonnte inbound message handler ───────────────────────────────────────────
// Canonical URL: /api/wa/fonnte/webhook
// Compatibility URL used by existing Fonnte devices: /api/webhook/fonnte

// ─── Per-phone message hash dedup (survives ID-less retries) ─────────────────
const _recentMsgHashes = new Map<string, number>(); // "phone:msgHash" → timestamp

// ─── Outgoing message cache — blokir Fonnte echo-back ────────────────────────
// trackSentMessage & isBotEcho diimpor dari ../lib/waSentTracker (shared dengan notifications.ts)

// Pola pesan yang HANYA bisa berasal dari bot — blokir tanpa perlu timing cache
const BOT_MESSAGE_PATTERNS = [
  /^🏅 \*BOOKING BARU SPORT CENTER\*/,
  /^⏳ \*Booking Diterima — Menunggu Persetujuan Admin\*/,
  /^✅ \*Booking Disetujui!\*/,
  /^❌ \*Booking Ditolak\*/,
  /^💳 \*Pembayaran Dikonfirmasi\*/,
  /^⏰ \*Booking Expired\*/,
  /^❌ Booking dibatalkan\. Ketik \*booking\* kapan saja untuk memulai lagi\./,
  /^📎 Untuk upload bukti pembayaran/,
  /^⚠️ \*Jadwal Tidak Tersedia\*/,
  /^✅ Slot jam \*\d{2}:\d{2}\* tersedia!/,
  /^🏟️ \*Fasilitas tersedia:\*/,
  /^✅ Fasilitas \*/,
  /^Mau lanjut pesan\/booking di sini/,
  /^📅 Tanggal berapa mau booking/,
  /^⏰ Jam berapa mau mulai(?: di \*)?/,
  /^⏱️ Berapa lama\? \(min 1 jam\)/,
  /^👤 Atas nama siapa booking ini\?/,
  /^📋 Berikut ringkasan booking/,
  /^✅ Saya cek tersedia\. Berikut detail booking:/,
];

function isBotGeneratedMessage(msg: string): boolean {
  return BOT_MESSAGE_PATTERNS.some((p) => p.test(msg.trimStart()));
}

function isDuplicateByContent(phone: string, msg: string): boolean {
  // Layer 1: timing-based cache (semua pesan outgoing yang sudah di-track)
  if (isBotEcho(msg) || isMinaGreetingEcho(msg) || isFonnteProviderEcho(msg)) return true;

  // Layer 2: pattern-based — pesan yang jelas dari bot, blokir tanpa cache
  if (isBotGeneratedMessage(msg)) return true;

  const hash = `${phone}:${normalizeInboundMessage(msg).substring(0, 160)}`;
  const now = Date.now();
  if (isRecentMessageDuplicate(_recentMsgHashes, hash, now)) {
    return true; // same msg from same phone within 8 detik → duplicate
  }
  const cleanupTimer = setTimeout(() => _recentMsgHashes.delete(hash), 30 * 1000);
  cleanupTimer.unref?.();
  return false;
}

const WEBHOOK_DEDUP_WINDOW_SECONDS = 60;

function normalizeInboundMessage(msg: string): string {
  return msg.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Claim an inbound webhook in the shared database.
 *
 * Fonnte can retry a delivery without a stable message id. The in-memory
 * caches above protect a single process, but they cannot coordinate two
 * instances. Advisory transaction locks serialize the check-and-insert for
 * each fingerprint so only the first request is allowed through.
 */
async function claimDistributedWebhook(
  phone: string,
  msg: string,
  messageId: string | null,
): Promise<boolean> {
  const keys = [
    `content:${phone}:${normalizeInboundMessage(msg)}`,
    ...(messageId ? [`id:${messageId}`] : []),
  ];

  return db.transaction(async (tx) => {
    for (const key of keys) {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`sport-center:wa-webhook:${key}`}, 0)
        )
      `);

      const existing = await tx.execute<{ id: number }>(sql`
        SELECT id
        FROM sport_center.audit_logs
        WHERE action = 'mina_webhook_dedup_claim'
          AND created_at >= NOW() - make_interval(secs => ${WEBHOOK_DEDUP_WINDOW_SECONDS})
          AND after->>'dedupKey' = ${key}
        LIMIT 1
      `);
      if (existing.rows.length > 0) return false;
    }

    for (const key of keys) {
      await tx.insert(auditLogsTable).values({
        action: "mina_webhook_dedup_claim",
        entity: "wa_webhook",
        after: {
          dedupKey: key,
          phone,
          message: msg,
          messageId,
          inboxIdPresent: Boolean(fonnteReplyContext.getStore()?.inboxId),
        },
      });
    }
    return true;
  });
}

const handleFonnteWebhook = async (req: Request, res: Response) => {
  // Keep the webhook request open until Mina has finished processing the
  // inbound message. Replit Autoscale can suspend work after an HTTP response
  // has already been sent; acknowledging first can therefore drop slower
  // booking steps such as duration -> availability lookup.
  //
  // Fonnte retries are still protected by the existing in-memory and
  // distributed dedup guards below.
  try {
    req.log?.debug?.({ body: req.body }, "[wa-webhook] raw payload");

    const deviceCheck = await validateMinaFonnteWebhookDevice(req.body);
    if (!deviceCheck.accepted) {
      req.log?.warn?.(
        { providedDevice: deviceCheck.providedDevice },
        "[wa-webhook] inbound device is not the configured Mina device; message ignored",
      );
      await logAudit({
        action: "mina_webhook_device_rejected",
        entity: "wa_session",
        after: { providedDevice: deviceCheck.providedDevice },
      });
      return;
    }

    if (isDuplicateWebhook(req.body)) return;
    const { sender, message = "", name = "" } = req.body;
    if (!sender) return;

    const inboundInboxId = resolveFonnteInboxId(req.body);
    fonnteReplyContext.enterWith({ inboxId: inboundInboxId });

    const phone = cleanPhone(String(sender));
    const msg = String(message).trim();
    if (!msg || !phone) return;

    // Dedup berdasarkan konten (cegah Fonnte retry tanpa message_id)
    if (isDuplicateByContent(phone, msg)) return;
    const inboundMessageId = req.body.id ?? req.body.message_id ?? req.body.msg_id ?? req.body.msgId;
    const claimed = await claimDistributedWebhook(
      phone,
      msg,
      inboundMessageId ? String(inboundMessageId) : null,
    );
    if (!claimed) {
      req.log?.info?.({ phone, message: msg }, "[wa-webhook] duplicate inbound message ignored");
      return;
    }

    // 1. Audit log — every inbound message
    await logAiMessageReceived(phone, msg, String(name));
    await logAudit({
      action: "customer_chat_received",
      entity: "wa_session",
      after: { phone, message: msg, waName: String(name) },
    });

    // 2. Admin command check + unauthorized guard
    const adminPhones = await getAdminPhones();
    const looksLikeAdminCmd = /^(APPROVE|KONFIRMASI|SETUJU|REJECT|TOLAK|PAID|LUNAS|BAYAR|CANCEL|BATALKAN|RESEND|STATUS)\s+SC-\d+/i.test(msg);
    if (!adminPhones.includes(phone) && looksLikeAdminCmd) {
      await logAudit({
        action: "unauthorized_admin_command",
        entity: "booking",
        after: { phone, message: msg },
      });
      await sendWAMsg(phone, "⚠️ Maaf, Anda tidak memiliki akses untuk perintah admin ini.", true);
      return;
    }
    if (adminPhones.includes(phone)) {
      const handled = await handleAdminCommand(phone, msg);
      if (handled) return;
      // If admin sends non-command, still allow normal flow
    }

    // 2b. Cek apakah nomor diblokir (spam protection) — skip untuk admin
    if (!adminPhones.includes(phone)) {
      const blockedResult = await db.execute<{ phone: string }>(
        sql`SELECT phone FROM sport_center.wa_blocked_phones WHERE phone = ${phone} AND is_active = true AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`
      );
      if (blockedResult.rows.length > 0) {
        await sendWAMsg(phone, `⛔ Nomor Anda telah diblokir dari layanan booking WhatsApp kami.\n\nHubungi admin untuk informasi lebih lanjut.`, true);
        await logAudit({ action: "blocked_phone_attempted", entity: "wa_session", after: { phone, msg } });
        return;
      }
    }

    // 3. Active session — continue conversation (always takes priority)
    const session = await getActiveSession(phone);
    if (session) {
      // A greeting after a pause means the customer is starting over, not
      // answering the previous booking field. Close the stale flow and create
      // a fresh one so Mina does not send a confusing validation error.
      if (isMinaGreeting(msg)) {
        await updateSession(session.id, { status: "expired" });
        await logAudit({
          action: "booking_session_restarted",
          entity: "wa_booking_session",
          entityId: session.id,
          after: { reason: "new_greeting", message: msg },
        });
        await startGreetingSession(phone, msg, String(name), true);
        return;
      }

      // A time input at the time step must go through continueSession so the
      // requested facility's operating hours, blocked schedules, bookings,
      // and same-slot alternative facilities are checked before replying.
      // Otherwise the generic merge path jumps directly to the summary and
      // can leave an out-of-hours/full-slot request without the right prompt.
      const parsedMessage = parseIntent(msg);
      try {
        if (session.currentStep === "ask_duration") {
          await continueSession(session, phone, msg, true);
          return;
        }

        if (session.currentStep === "ask_time" && parsedMessage.startTime) {
          await continueSession(session, phone, msg, true);
          return;
        }

        // A correction can contain several fields ("jamnya ganti jam 8,
        // jadi 1 jam saja", "besoknya lusa"). Merge every field first so the
        // flow never forces the customer back through the old sequential steps.
        const merged = await mergeSessionFromMessage(session, msg);
        if (merged.changed) {
          await presentBookingSession(merged.session, phone, true);
        } else {
          await continueSession(session, phone, msg, true);
        }
      } catch (err) {
        logger.error(
          {
            phone,
            sessionId: session.id,
            step: session.currentStep,
            error: err instanceof Error ? err.message : String(err),
          },
          "[wa-webhook] booking session processing failed",
        );
        await logAudit({
          action: "mina_booking_session_failed",
          entity: "wa_booking_session",
          entityId: session.id,
          after: {
            phone,
            step: session.currentStep,
            message: msg,
            error: err instanceof Error ? err.message : String(err),
          },
        }).catch(() => {});
        await sendWAMsg(
          phone,
          `⚠️ Maaf, pengecekan booking sedang bermasalah. Data kamu belum hilang.\n\n` +
          `Coba kirim ulang jamnya, misalnya *jam 08:00*, atau ketik *batal* untuk mulai ulang.`,
          true,
        ).catch(() => {});
      }
      return;
    }

    // A bare confirmation without an active booking session should never fall
    // through to the general AI responder. This can happen in DEV when
    // transaction/session data is deliberately reset between booking steps.
    if (isYes(msg)) {
      await logAudit({
        action: "mina_orphan_confirmation",
        entity: "wa_session",
        after: { phone, message: msg, reason: "no_active_booking_session" },
      }).catch(() => {});
      await sendWAMsg(
        phone,
        "Sesi booking sudah tidak aktif. Ketik booking untuk mulai lagi.",
        true,
      );
      return;
    }

    // Mina's first greeting starts a fresh persisted conversation. A greeting
    // received while a session is active is handled above as a restart.
    if (isMinaGreeting(msg)) {
      await startGreetingSession(phone, msg, String(name), true);
      return;
    }

    // 3b. Deteksi media message (gambar/dokumen dikirim customer — kemungkinan bukti bayar)
    const msgType = String(req.body.type ?? req.body.message_type ?? req.body.file_type ?? "").toLowerCase();
    const isMediaMsg = ["image", "video", "document", "audio", "sticker"].includes(msgType);
    if (isMediaMsg) {
      const pendingBooking = await db.select({
        id: bookingsTable.id,
        orderNumber: bookingsTable.orderNumber,
        status: bookingsTable.status,
      }).from(bookingsTable)
        .where(and(eq(bookingsTable.customerPhone, phone), eq(bookingsTable.status, "pending_payment")))
        .orderBy(desc(bookingsTable.createdAt))
        .limit(1);

      if (pendingBooking.length > 0) {
        const b = pendingBooking[0];
        const tokens = await db.select().from(waActionTokensTable)
          .where(and(eq(waActionTokensTable.bookingId, b.id), eq(waActionTokensTable.action, "upload_proof")))
          .orderBy(desc(waActionTokensTable.createdAt))
          .limit(1);
        const proofToken = tokens[0]?.token;

        const uploadUrl = proofToken ? `${await getBaseUrl()}/bukti/${proofToken}` : null;
        const reply = uploadUrl
          ? `📎 Untuk upload bukti pembayaran *${b.orderNumber}*, silakan gunakan link berikut:\n\n${uploadUrl}\n\n⚠️ Upload hanya bisa melalui link, tidak bisa via WhatsApp langsung.`
          : `📎 Untuk upload bukti pembayaran *${b.orderNumber}*, ketik *status* untuk mendapatkan link upload.`;
        await sendWAMsg(phone, reply, true);
      } else {
        await sendWAMsg(phone, `📎 Bukti pembayaran diunggah melalui link khusus yang dikirimkan setelah booking dikonfirmasi admin.\n\nKetik *status* untuk cek status booking, atau *booking* untuk membuat pesanan baru. 🏅`, true);
      }
      await logAudit({ action: "media_message_received", entity: "wa_session", after: { phone, msgType } });
      return;
    }

    // 4. AI Assistant (when enabled) — routes all intents:
    //    booking_intent → hand off to structured flow
    //    status_check   → answered by AI with DB data
    //    everything else→ answered by AI grounded in DB
    const aiEnabled = process.env.AI_SPORTCENTER_ENABLED !== "false" && !!process.env.OPENAI_API_KEY;
    if (aiEnabled) {
      const intent = detectIntent(msg);
      await logAiIntentDetected(phone, msg, intent);

      // booking_intent: go straight to structured booking session
      if (intent === "booking_intent") {
        await startBookingSession(phone, msg, String(name), true);
        return;
      }

      // talk_to_admin: langsung kirim kontak admin, tidak perlu OpenAI
      if (intent === "talk_to_admin") {
        const [settingsRow] = await db.select({ whatsapp: settingsTable.whatsapp, phone: settingsTable.phone, openHour: settingsTable.openHour, closeHour: settingsTable.closeHour })
          .from(settingsTable).limit(1);
        const adminContact = settingsRow?.whatsapp || settingsRow?.phone || (await getAdminPhones())[0] || "";
        const reply = adminContact
          ? `👋 Baik, saya hubungkan Anda dengan admin kami.\n\n📞 *Admin WhatsApp:* ${adminContact}\n\nSilakan hubungi admin langsung untuk bantuan lebih lanjut. Jam operasional: *${settingsRow?.openHour ?? "06:00"}–${settingsRow?.closeHour ?? "22:00"}*. 🙏`
          : `👋 Untuk berbicara langsung dengan admin, ketik *status* atau kunjungi ${await getBaseUrl()}/contact.\n\nKami siap membantu! 🏅`;
        await sendWAMsg(phone, reply, true);
        await logAudit({ action: "ai_talk_to_admin_handled", entity: "wa_ai", after: { phone, adminContact } });
        return;
      }

      const history = getHistory(phone);
      appendTurn(phone, "user", msg);
      let aiResult;
      try {
        aiResult = await generateAiReply(phone, msg, history, { channel: "whatsapp" });
      } catch (aiErr) {
        logger.error(
          {
            phone,
            error: aiErr instanceof Error ? aiErr.message : String(aiErr),
          },
          "[wa/fonnte/webhook] Mina AI pipeline failed; sending static fallback",
        );
        await logAudit({
          action: "mina_ai_pipeline_failed",
          entity: "wa_ai",
          after: {
            phone,
            intent,
            error: aiErr instanceof Error ? aiErr.message : String(aiErr),
          },
        }).catch(() => {});

        const fallback =
          `Halo! 👋 Terima kasih sudah menghubungi *Sport Center Soekarno-Hatta*.\n\n` +
          `Untuk bantuan cepat, ketik:\n` +
          `• *booking* — pesan fasilitas olahraga\n` +
          `• *status* — cek status pesanan\n\n` +
          `Atau kunjungi: ${await getBaseUrl()}/facilities`;
        appendTurn(phone, "assistant", fallback);
        await sendWAMsg(phone, fallback, true);
        return;
      }

      if (aiResult.shouldHandoffToBookingFlow) {
        clearHistory(phone);
        await startBookingSession(phone, msg, String(name), true);
        return;
      }

      if (!aiResult.fallbackToAdmin && aiResult.reply) {
        appendTurn(phone, "assistant", aiResult.reply);
        await sendWAMsg(phone, aiResult.reply, true);
        return;
      }
      // if AI failed/disabled, fall through to legacy handlers
    }

    // 5. Legacy fallback: status intent (when AI is off or errored)
    if (isStatusIntent(msg)) {
      const allBookings = await db.select().from(bookingsTable)
        .where(eq(bookingsTable.customerPhone, phone))
        .orderBy(desc(bookingsTable.createdAt))
        .limit(8);

      if (allBookings.length === 0) {
        await sendWAMsg(phone, `Tidak ada booking terdaftar untuk nomor ini.\n\nKetik *booking* untuk membuat booking baru. 🏅`, true);
        return;
      }

      const facIds = [...new Set(allBookings.map((b: typeof allBookings[number]) => b.facilityId))];
      const facRows = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name })
        .from(facilitiesTable).where(inArray(facilitiesTable.id, facIds));
      const facMap = new Map(facRows.map((f: typeof facRows[number]) => [f.id, f.name]));

      const STATUS_ICON: Record<string, string> = {
        waiting_admin_approval: "⏳",
        pending_payment: "💳",
        waiting_confirmation: "🔍",
        confirmed: "✅",
        checked_in: "🏃",
        completed: "🏆",
        cancelled: "❌",
        rejected: "🚫",
        expired: "⌛",
        refunded: "💰",
      };

      let reply = `📋 *Riwayat Booking Anda*\n\n`;
      for (const b of allBookings) {
        const icon = STATUS_ICON[b.status] ?? "•";
        const statusLabel = b.status.replace(/_/g, " ").toUpperCase();
        reply += `${icon} *${b.orderNumber}*\n` +
          `   ${facMap.get(b.facilityId) ?? "-"} — ${b.bookingDate} ${b.startTime}–${b.endTime}\n` +
          `   Status: *${statusLabel}*\n\n`;
      }
      reply += `Detail: ${await getBaseUrl()}/status/${allBookings[0].orderNumber}`;
      await sendWAMsg(phone, reply, true);
      return;
    }

    // 6. Legacy fallback: explicit booking keyword (when AI is off or errored)
    if (isBookingIntent(msg)) {
      await startBookingSession(phone, msg, String(name), true);
      return;
    }

    // 7. Final fallback — unknown message
    await logAudit({
      action: "unknown_message_received",
      entity: "wa_session",
      after: { phone, message: msg },
    });

    await sendWAMsg(phone,
      `Halo! 👋 Saya asisten booking Sport Center.\n\n` +
      `Ketik:\n` +
      `• *booking* — pesan fasilitas olahraga\n` +
      `• *status* — cek status pesanan\n\n` +
      `Atau kunjungi: ${await getBaseUrl()}/facilities`,
      true,
    );
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      "[wa/fonnte/webhook] error",
    );
  } finally {
    // ACK only after the processing path has finished so no business logic is
    // left running after the request lifecycle is considered complete.
    if (!res.headersSent) {
      res.status(200).json({ status: "ok" });
    }
  }
};

router.post(["/wa/fonnte/webhook", "/webhook/fonnte", "/wa/webhook"], handleFonnteWebhook);

// ─── GET /api/wa/booking-approval/:token — load form data (no auth) ──────────
router.get("/wa/booking-approval/:token", async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "Link tidak valid atau sudah kedaluwarsa" }); return; }
    if (tokenRow.action !== "approve_booking") { res.status(400).json({ error: "Link tidak valid untuk aksi ini" }); return; }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa (24 jam)" }); return;
    }
    if (tokenRow.usedAt) {
      res.status(409).json({ error: "Link ini sudah digunakan", usedAt: tokenRow.usedAt }); return;
    }

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, tokenRow.bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const [facility] = await db.select({ name: facilitiesTable.name, category: facilitiesTable.category })
      .from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    await logAudit({
      action: "WA_APPROVAL_OPENED",
      entity: "booking",
      entityId: booking.id,
      after: { orderNumber: booking.orderNumber, openedAt: new Date().toISOString() },
      userName: "admin (WhatsApp link)",
    });

    res.json({
      booking: {
        id: booking.id,
        orderNumber: booking.orderNumber,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        facilityName: facility?.name ?? "-",
        facilityCategory: facility?.category ?? "-",
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        durationHours: Number(booking.durationHours),
        totalPrice: Number(booking.totalPrice),
        grandTotal: booking.grandTotal != null ? Number(booking.grandTotal) : null,
        status: booking.status,
        notes: booking.notes ?? null,
        source: booking.source ?? null,
      },
      expiresAt: tokenRow.expiresAt,
    });
  } catch (err) {
    console.error("[wa/booking-approval GET]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/wa/booking-approval — submit approve / reject ─────────────────
router.post("/wa/booking-approval", async (req, res) => {
  try {
    const { token, status, note } = req.body as { token: string; status: "approved" | "rejected"; note?: string };

    if (!token || !status || !["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Parameter tidak valid" }); return;
    }

    const tokenRow = await getWaTokenRow(token);
    if (!tokenRow) { res.status(404).json({ error: "Link tidak valid" }); return; }
    if (tokenRow.action !== "approve_booking") { res.status(400).json({ error: "Link tidak valid untuk aksi ini" }); return; }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa" }); return;
    }
    if (tokenRow.usedAt) {
      res.status(409).json({ error: "Aksi ini sudah dilakukan sebelumnya" }); return;
    }

    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, tokenRow.bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const [facility] = await db.select({ name: facilitiesTable.name })
      .from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
    const [settings] = await db.select().from(settingsTable).limit(1);

    await consumeWaToken(token);

    if (status === "approved") {
      await db.update(bookingsTable)
        .set({ status: "pending_payment", approvedByAdminPhone: "wa-link", approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));
      await db.insert(bookingHistoryTable).values({
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "pending_payment",
        changedByName: "admin (WhatsApp approval)",
        note: note ? `Disetujui. Catatan: ${note}` : "Disetujui via WhatsApp Mini Form",
      });

      await logAudit({
        action: "WA_APPROVAL_APPROVED",
        entity: "booking",
        entityId: booking.id,
        before: { status: booking.status },
        after: { status: "pending_payment", note },
        userName: "admin (WhatsApp approval)",
      });


      const uploadToken = await createWaToken(booking.id, "upload_proof", 3);
      const statusUrl = `${await getBaseUrl()}/status/${booking.orderNumber}`;
      const uploadProofUrl = `${await getBaseUrl()}/bukti/${uploadToken}`;
      const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const deadlineStr = deadline.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });

      notifyCustomerBookingApproved({
        customerPhone: booking.customerPhone,
        customerName: booking.customerName,
        orderNumber: booking.orderNumber,
        facilityName: facility?.name ?? "-",
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
        bankName: settings?.bankName ?? "",
        bankAccount: settings?.bankAccount ?? "",
        bankAccountName: settings?.bankAccountName ?? "",
        uploadProofUrl,
        paymentDeadline: deadlineStr,
        statusUrl,
      }).catch(() => {});

      res.json({ success: true, message: `Booking ${booking.orderNumber} disetujui. Customer dikirim notifikasi WA.` });

    } else {
      await db.update(bookingsTable)
        .set({ status: "cancelled", rejectedReason: note ?? null, updatedAt: new Date() })
        .where(eq(bookingsTable.id, booking.id));
      await db.insert(bookingHistoryTable).values({
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "cancelled",
        changedByName: "admin (WhatsApp approval)",
        note: note ? `Ditolak. Alasan: ${note}` : "Ditolak via WhatsApp Mini Form",
      });

      await logAudit({
        action: "WA_APPROVAL_REJECTED",
        entity: "booking",
        entityId: booking.id,
        before: { status: booking.status },
        after: { status: "cancelled", note },
        userName: "admin (WhatsApp approval)",
      });

      notifyCustomerBookingRejectedByAdmin({
        customerPhone: booking.customerPhone,
        customerName: booking.customerName,
        orderNumber: booking.orderNumber,
        facilityName: facility?.name ?? "-",
        bookingDate: booking.bookingDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        reason: note,
      }).catch(() => {});

      res.json({ success: true, message: `Booking ${booking.orderNumber} ditolak. Customer diberitahu via WA.` });
    }
  } catch (err) {
    console.error("[wa/booking-approval POST]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
