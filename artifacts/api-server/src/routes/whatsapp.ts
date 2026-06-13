import { Router } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { db, bookingsTable, facilitiesTable, paymentsTable, bookingHistoryTable, waActionTokensTable, settingsTable, usersTable, blockedSchedulesTable } from "@workspace/db";
import { eq, and, desc, isNotNull, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import { createWaToken, verifyWaToken, consumeWaToken, getWaTokenRow } from "../lib/waTokens";
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
  notifyWaAdminNewBooking,
  notifyWaBookingApproved,
  notifyWaBookingRejectedByAdmin,
} from "../lib/notifications";
import { calculatePrice } from "../lib/pricing";
import { logAudit } from "../lib/auditLog";
import { hashPassword } from "../lib/auth";
import { syncStatusToBizportal } from "../lib/bizportalSync";
import { calculateTax, recordTaxTransaction } from "../lib/tax";
import { broadcastAvailabilityChange } from "../lib/supabase";
import { uploadToStorage, BUCKETS } from "../lib/supabaseStorage";
import {
  generateAiReply,
  logAiMessageReceived,
  logAiIntentDetected,
  detectIntent,
} from "../services/aiSportCenterService";

const router = Router();
const APP_URL = process.env.APP_URL ?? "";
const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];

// ─── Webhook deduplication — cegah Fonnte retry/outgoing loop ─────────────────
const _processedMsgIds = new Set<string>();
function isDuplicateWebhook(body: Record<string, unknown>): boolean {
  // Fonnte kirim me=true untuk pesan outgoing (balasan bot sendiri) → skip
  if (body.me === true || body.me === "true" || body.is_me === true) return true;
  // Cek message ID unik — Fonnte kadang retry dengan id yang sama
  const id = body.id ?? body.message_id;
  if (id) {
    const key = String(id);
    if (_processedMsgIds.has(key)) return true;
    _processedMsgIds.add(key);
    // Bersihkan setelah 5 menit agar tidak memory leak
    setTimeout(() => _processedMsgIds.delete(key), 5 * 60 * 1000);
  }
  return false;
}

// ─── Multer for proof upload (memory → Supabase Storage) ─────────────────────
const uploadProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|png|webp)|application\/pdf/.test(file.mimetype);
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
  return `SC-${String(maxNum + 1).padStart(4, "0")}`;
}

async function checkConflict(facilityId: number, bookingDate: string, startTime: string, endTime: string): Promise<boolean> {
  const existing = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, bookingDate)));
  const active = existing.filter((b) => !INACTIVE_STATUSES.includes(b.status));
  const sMin = timeToMinutes(startTime);
  const eMin = timeToMinutes(endTime);
  return active.some((b) => {
    const bS = timeToMinutes(b.startTime);
    const bE = timeToMinutes(b.endTime);
    return sMin < bE && eMin > bS;
  });
}

async function getBookingFull(id: number) {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
  if (!booking) return null;
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, booking.facilityId)).limit(1);
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, id)).limit(1);
  return {
    ...booking,
    totalPrice: Number(booking.totalPrice),
    discountAmount: Number(booking.discountAmount),
    basePrice: booking.basePrice == null ? null : Number(booking.basePrice),
    apDiscountAmount: Number(booking.apDiscountAmount),
    ppnRate: booking.ppnRate == null ? null : Number(booking.ppnRate),
    ppnAmount: booking.ppnAmount == null ? null : Number(booking.ppnAmount),
    grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
    facilityName: facility?.name ?? "",
    facilityCategory: facility?.category ?? "",
    payment: payment ? { ...payment, amount: Number(payment.amount) } : null,
  };
}

// ─── Keyword detection ────────────────────────────────────────────────────────
const FACILITY_KEYWORDS: Record<string, string[]> = {
  basket: ["basket", "basketball", "bola basket"],
  futsal: ["futsal", "sepak bola", "bola", "mini soccer"],
  badminton: ["badminton", "bulutangkis", "bulu tangkis", "shuttle"],
  tennis: ["tennis", "tenis"],
  gym: ["gym", "fitness", "fitnes"],
  voli: ["voli", "volley", "volleyball", "bola voli"],
  renang: ["renang", "kolam", "swimming"],
  squash: ["squash"],
  golf: ["golf", "driving range"],
};

function detectFacilityKeyword(msg: string): string | null {
  const lower = msg.toLowerCase();
  for (const [key, kws] of Object.entries(FACILITY_KEYWORDS)) {
    if (kws.some((kw) => lower.includes(kw))) return key;
  }
  return null;
}

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
    const passwordHash = hashPassword(randomBytes(16).toString("hex"));

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
      facilitiesUrl: `${APP_URL}/facilities`,
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

// POST /api/wa/webhook — Fonnte incoming message handler
router.post("/wa/webhook", async (req, res) => {
  res.status(200).json({ status: "ok" });

  try {
    if (isDuplicateWebhook(req.body)) return;
    const { sender, message = "", name = "" } = req.body;
    if (!sender || !message) return;

    const senderPhone = cleanPhone(String(sender));
    const msg = String(message).trim();

    // Status check intent
    if (isStatusIntent(msg)) {
      // Try to find last booking by phone
      const bookings = await db.select().from(bookingsTable)
        .where(eq(bookingsTable.customerPhone, senderPhone))
        .orderBy(desc(bookingsTable.createdAt))
        .limit(1);

      if (bookings.length > 0) {
        const b = bookings[0];
        const [fac] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
          .where(eq(facilitiesTable.id, b.facilityId)).limit(1);
        const statusUrl = `${APP_URL}/wa/status/${b.orderNumber}`;
        // Use Fonnte API directly to reply
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
          `Tidak ada booking yang terdaftar untuk nomor ini.\n\n` +
          `Ketik *booking* untuk membuat booking baru. 🏅`
        );
      }
      return;
    }

    if (!isBookingIntent(msg)) return;

    // Cek apakah nomor sudah terdaftar sebagai customer
    const [registeredUser] = await db.select({ id: usersTable.id, name: usersTable.name, customerCode: usersTable.customerCode })
      .from(usersTable).where(eq(usersTable.phone, senderPhone)).limit(1);

    if (!registeredUser) {
      const registerUrl = `${APP_URL}/register?phone=${senderPhone}&source=wa`;
      await sendWAReply(senderPhone,
        `👋 Halo! Untuk booking fasilitas, kamu perlu *daftar dulu* sebagai customer.\n\n` +
        `📝 *Daftar gratis sekarang:*\n${registerUrl}\n\n` +
        `Setelah daftar, ketik *booking* lagi di sini dan kita langsung bantu! 🏅`
      );
      return;
    }

    // Detect facility keyword
    const keyword = detectFacilityKeyword(msg);
    const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));

    if (keyword) {
      // Find matching facility
      const matched = facilities.find((f) =>
        f.name.toLowerCase().includes(keyword) ||
        f.category.toLowerCase().includes(keyword) ||
        keyword === f.category.toLowerCase()
      ) ?? facilities.find((f) =>
        Object.entries(FACILITY_KEYWORDS).some(([k, kws]) =>
          k === keyword && (kws.some((kw) => f.name.toLowerCase().includes(kw)) || kws.some((kw) => f.category.toLowerCase().includes(kw)))
        )
      );

      if (matched) {
        const formUrl = `${APP_URL}/wa/booking/${matched.id}?phone=${senderPhone}`;
        await sendWAReply(senderPhone,
          `🏅 *Booking ${matched.name}*\n\n` +
          `Harga: *Rp ${Number(matched.pricePerHour).toLocaleString("id-ID")}/jam*\n` +
          `Jam operasional: *${matched.openTime} – ${matched.closeTime}*\n\n` +
          `Silakan isi form booking di sini:\n${formUrl}\n\n` +
          `Form hanya berlaku 30 menit setelah dibuka. ⏰`
        );
        return;
      }
    }

    // No specific facility — show all options
    const list = facilities.map((f, i) =>
      `${i + 1}. *${f.name}* — Rp ${Number(f.pricePerHour).toLocaleString("id-ID")}/jam`
    ).join("\n");

    await sendWAReply(senderPhone,
      `🏟️ *Fasilitas Sport Center*\n\n` +
      `${list}\n\n` +
      `Sebutkan fasilitas yang ingin kamu booking, contoh:\n` +
      `_"mau booking lapangan basket"_\n_"booking futsal"_`
    );
  } catch (err) {
    console.error("[wa/webhook] error:", err);
  }
});

async function sendWAReply(phone: string, message: string): Promise<void> {
  const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
  if (!FONNTE_TOKEN || !phone) return;
  try {
    await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: FONNTE_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message }),
    });
  } catch { /* non-critical */ }
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
    // Hitung PPN — mengikuti effective_date backward-compat rule
    const taxCalc = await calculateTax(totalPrice, "sport_center_booking", bookingDate);
    const orderNumber = await generateOrderNumber();
    const paymentDeadline = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const [booking] = await db.insert(bookingsTable).values({
      orderNumber,
      customerName,
      customerEmail: `wa_${cleanPhone(customerPhone)}@whatsapp.local`,
      customerPhone,
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
      ppnAmount: taxCalc.taxAmount > 0 ? String(taxCalc.taxAmount) : null,
      grandTotal: taxCalc.taxAmount > 0 ? String(taxCalc.grandTotal) : null,
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
    const statusUrl = `${APP_URL}/wa/status/${orderNumber}`;
    const uploadProofUrl = `${APP_URL}/wa/proof/${proofToken}`;
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
      ppnAmount: booking.ppnAmount == null ? null : Number(booking.ppnAmount),
      grandTotal: booking.grandTotal == null ? null : Number(booking.grandTotal),
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
      uploadProofUrl: proofToken ? `${APP_URL}/wa/proof/${proofToken}` : null,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/wa/action/:token — get action details (no auth)
router.get("/wa/action/:token", async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(req.params.token);
    if (!tokenRow) { res.status(404).json({ error: "Link tidak valid" }); return; }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa" }); return;
    }
    if (tokenRow.usedAt) {
      res.status(409).json({ error: "Link ini sudah digunakan", usedAt: tokenRow.usedAt }); return;
    }

    const booking = await getBookingFull(tokenRow.bookingId);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    res.json({
      action: tokenRow.action,
      booking,
      expiresAt: tokenRow.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wa/action/:token — execute action
router.post("/wa/action/:token", async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(req.params.token);
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
        const [payment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.bookingId, booking.id)).limit(1);
        if (!payment) { res.status(400).json({ error: "Tidak ada bukti pembayaran" }); return; }

        await consumeWaToken(req.params.token);

        await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
          .where(eq(paymentsTable.bookingId, booking.id));
        await db.update(bookingsTable).set({ status: "confirmed", updatedAt: new Date() })
          .where(eq(bookingsTable.id, booking.id));
        await db.insert(bookingHistoryTable).values({
          bookingId: booking.id, fromStatus: booking.status, toStatus: "confirmed",
          changedByName: "admin (WhatsApp)", note: "Pembayaran dikonfirmasi via WhatsApp",
        });

        const statusUrl = `${APP_URL}/wa/status/${booking.orderNumber}`;
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
          checkinUrl: `${APP_URL}/wa/action/${checkinToken}`,
          finishUrl: `${APP_URL}/wa/action/${finishToken}`,
        });

        syncStatusToBizportal(booking.orderNumber, "confirmed", payment.proofUrl, new Date()).catch(() => {});

        await logAudit({
          action: "wa_approve_payment",
          entity: "booking",
          entityId: booking.id,
          before: { status: booking.status },
          after: { status: "confirmed" },
          userName: "admin (WhatsApp)",
        });

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
          uploadProofUrl: `${APP_URL}/wa/proof/${newUploadToken}`,
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
        if (booking.status !== "confirmed") {
          res.status(400).json({ error: "Check-in hanya bisa untuk booking yang sudah dikonfirmasi" }); return;
        }

        const nowJKT = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
        if (booking.bookingDate !== nowJKT) {
          res.status(400).json({ error: "Check-in hanya bisa pada hari H booking" }); return;
        }

        await consumeWaToken(req.params.token);

        const now = new Date();
        await db.update(bookingsTable).set({ checkedInAt: now, updatedAt: now })
          .where(eq(bookingsTable.id, booking.id));
        await db.insert(bookingHistoryTable).values({
          bookingId: booking.id, fromStatus: booking.status, toStatus: booking.status,
          changedByName: "staff (WhatsApp)",
          note: `Check-in pukul ${now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`,
        });

        await logAudit({
          action: "wa_checkin",
          entity: "booking",
          entityId: booking.id,
          after: { checkedInAt: now.toISOString() },
          userName: "staff (WhatsApp)",
        });

        res.json({ success: true, message: `Customer ${booking.customerName} berhasil check-in.` });
        break;
      }

      case "finish": {
        if (!["confirmed"].includes(booking.status)) {
          res.status(400).json({ error: "Booking belum dalam status yang bisa diselesaikan" }); return;
        }

        await consumeWaToken(req.params.token);

        const now = new Date();
        await db.update(bookingsTable).set({ status: "completed", completedAt: now, updatedAt: now })
          .where(eq(bookingsTable.id, booking.id));
        await db.insert(bookingHistoryTable).values({
          bookingId: booking.id, fromStatus: booking.status, toStatus: "completed",
          changedByName: "staff (WhatsApp)", note: "Sesi selesai via WhatsApp",
        });

        await logAudit({
          action: "wa_finish",
          entity: "booking",
          entityId: booking.id,
          before: { status: booking.status },
          after: { status: "completed" },
          userName: "staff (WhatsApp)",
        });

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

// POST /api/wa/proof/upload — multer file upload, returns URL
router.post("/wa/proof/upload", uploadProof.single("proof"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "Tidak ada file" }); return; }
    const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const objectPath = `wa-proof-${randomUUID()}${ext}`;
    const publicUrl = await uploadToStorage(BUCKETS.proof, objectPath, req.file.buffer, req.file.mimetype);
    res.json({ url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: "Upload gagal" });
  }
});

// POST /api/wa/proof/:token — submit proof (tokenized, no login)
router.post("/wa/proof/:token", uploadProof.single("proof"), async (req, res) => {
  try {
    const tokenRow = await getWaTokenRow(req.params.token);
    if (!tokenRow || tokenRow.action !== "upload_proof") {
      res.status(404).json({ error: "Link tidak valid" }); return;
    }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Link sudah kedaluwarsa" }); return;
    }

    let proofUrl: string | undefined = req.body?.proofUrl;
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      const objectPath = `wa-proof-${randomUUID()}${ext}`;
      proofUrl = await uploadToStorage(BUCKETS.proof, objectPath, req.file.buffer, req.file.mimetype);
    }
    if (!proofUrl) { res.status(400).json({ error: "Tidak ada bukti yang diupload" }); return; }

    const bookingId = tokenRow.bookingId;
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId)).limit(1);
    if (!booking) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }

    const [facility] = await db.select({ name: facilitiesTable.name }).from(facilitiesTable)
      .where(eq(facilitiesTable.id, booking.facilityId)).limit(1);

    // Upsert payment record
    const [existing] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.bookingId, bookingId)).limit(1);

    if (existing) {
      await db.update(paymentsTable).set({ proofUrl, status: "pending", updatedAt: new Date() })
        .where(eq(paymentsTable.bookingId, bookingId));
    } else {
      await db.insert(paymentsTable).values({
        bookingId,
        amount: String(Number(booking.totalPrice)),
        proofUrl,
        paymentMethod: "Transfer Bank (WhatsApp)",
        status: "pending",
      });
    }

    await db.update(bookingsTable).set({ status: "waiting_confirmation", updatedAt: new Date() })
      .where(eq(bookingsTable.id, bookingId));

    await db.insert(bookingHistoryTable).values({
      bookingId, fromStatus: booking.status, toStatus: "waiting_confirmation",
      changedByName: booking.customerName, note: "Bukti pembayaran diupload via WhatsApp",
    });

    // Create approve/reject tokens for admin
    const approveToken = await createWaToken(bookingId, "approve_payment", 7);
    const rejectToken = await createWaToken(bookingId, "reject_payment", 7);

    const fullProofUrl = proofUrl;

    notifyWaProofUploaded({
      customerName: booking.customerName, customerPhone: booking.customerPhone,
      orderNumber: booking.orderNumber, facilityName: facility?.name ?? "",
      bookingDate: booking.bookingDate, startTime: booking.startTime, endTime: booking.endTime,
      totalPrice: Number(booking.totalPrice).toLocaleString("id-ID"),
      proofUrl: fullProofUrl,
      approveUrl: `${APP_URL}/wa/action/${approveToken}`,
      rejectUrl: `${APP_URL}/wa/action/${rejectToken}`,
    });

    await logAudit({
      action: "wa_proof_uploaded",
      entity: "booking",
      entityId: bookingId,
      after: { proofUrl, status: "waiting_confirmation" },
    });

    syncStatusToBizportal(booking.orderNumber, "waiting_confirmation", proofUrl).catch(() => {});

    res.json({ success: true, orderNumber: booking.orderNumber });
  } catch (err) {
    console.error("[wa/proof] error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Helpers for Fonnte webhook ───────────────────────────────────────────────

async function sendWAMsg(phone: string, message: string): Promise<void> {
  const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
  if (!FONNTE_TOKEN || !phone) return;
  try {
    await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: FONNTE_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message }),
    });
  } catch { /* non-critical */ }
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
  const lines = facilities.map((f, i) =>
    `${i + 1}. *${f.name}* — ${formatIDR(Number(f.pricePerHour))}/jam`
  ).join("\n");
  return `🏟️ *Fasilitas tersedia:*\n${lines}\n\nSebutkan nama fasilitas yang ingin kamu booking.`;
}

async function getFacilityByKeyword(keyword: string) {
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
    serbaguna: ["serbaguna", "multiguna", "hall", "aula"],
    billiard: ["billiard", "biliar", "bilyard"],
  };
  const kws = FACILITY_KEYWORDS[keyword] ?? [keyword];
  return (
    facilities.find((f) => kws.some((kw) => f.name.toLowerCase().includes(kw) || f.category.toLowerCase().includes(kw))) ??
    facilities.find((f) => f.category.toLowerCase() === keyword.toLowerCase()) ??
    facilities.find((f) => f.name.toLowerCase().includes(keyword.toLowerCase())) ??
    null
  );
}

// Parse facility from raw message text (search by name or keyword)
async function resolveFacilityFromMsg(msg: string) {
  const kw = detectFacilityKeyword(msg);
  if (kw) return getFacilityByKeyword(kw);
  // Direct name search
  const facilities = await db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true));
  const lower = msg.toLowerCase();
  return facilities.find((f) => f.name.toLowerCase().includes(lower)) ?? null;
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

function isYes(msg: string): boolean {
  return /^(ya|iya|ok|oke|yes|lanjut|betul|benar|confirm|konfirm)/i.test(msg.trim());
}

function isNo(msg: string): boolean {
  return /^(tidak|tidak|batal|cancel|hapus|no|ga|gak|nggak|ngga)/i.test(msg.trim());
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

  // HELP — tampilkan daftar perintah admin
  if (/^HELP$/i.test(upper)) {
    await sendWAMsg(adminPhone,
      `🏅 *Perintah Admin Sport Center*\n\n` +
      `📋 *APPROVE SC-xxxx*\n   Setujui booking, kirim instruksi bayar ke customer\n\n` +
      `🚫 *REJECT SC-xxxx [alasan]*\n   Tolak booking dengan alasan\n\n` +
      `✅ *PAID SC-xxxx*\n   Konfirmasi pembayaran diterima\n\n` +
      `❌ *CANCEL SC-xxxx [alasan]*\n   Batalkan booking\n\n` +
      `🔁 *RESEND SC-xxxx*\n   Kirim ulang notifikasi WA\n\n` +
      `🔍 *STATUS SC-xxxx*\n   Cek detail booking\n\n` +
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
    const statusUrl = `${APP_URL}/wa/status/${booking.orderNumber}`;
    const uploadProofUrl = `${APP_URL}/wa/proof/${proofToken}`;
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
  if (existingPay) {
    await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(paymentsTable.bookingId, booking.id));
  } else {
    await db.insert(paymentsTable).values({
      bookingId: booking.id,
      amount: String(Number(booking.grandTotal ?? booking.totalPrice)),
      paymentMethod: "Manual (Admin WA)",
      status: "confirmed",
      confirmedAt: new Date(),
    });
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
  const statusUrl = `${APP_URL}/wa/status/${booking.orderNumber}`;

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
    checkinUrl: `${APP_URL}/wa/action/${checkinToken}`,
    finishUrl: `${APP_URL}/wa/action/${finishToken}`,
  });

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
      uploadProofUrl: `${APP_URL}/wa/proof/${newUploadToken}`,
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
    `\n🔗 ${APP_URL}/wa/status/${orderNumber}`
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
  if (existingPay) {
    await db.update(paymentsTable).set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(paymentsTable.bookingId, booking.id));
  } else {
    await db.insert(paymentsTable).values({
      bookingId: booking.id,
      amount: String(Number(booking.grandTotal ?? booking.totalPrice)),
      paymentMethod: "Manual (Admin WA)",
      status: "confirmed",
      confirmedAt: new Date(),
    });
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
    userName: `admin (WA: ${adminPhone})`,
  });

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
    `Hubungi kami untuk info lebih lanjut.`
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
      statusUrl: `${APP_URL}/wa/status/${booking.orderNumber}`,
      uploadProofUrl: `${APP_URL}/wa/proof/${proofToken}`,
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
      statusUrl: `${APP_URL}/wa/status/${booking.orderNumber}`,
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

async function startBookingSession(phone: string, msg: string, waName: string): Promise<void> {
  const intent = parseIntent(msg);
  const customer = await getRegisteredCustomer(phone);

  let facilityId: number | null = null;
  let facilityName = "";
  let pricePerHour = 0;
  let facData: typeof facilitiesTable.$inferSelect | null = null;

  if (intent.facilityKeyword) {
    const fac = await getFacilityByKeyword(intent.facilityKeyword);
    if (fac) {
      facilityId = fac.id;
      facilityName = fac.name;
      pricePerHour = Number(fac.pricePerHour);
      facData = fac;
    }
  }

  // Jika pesan sudah mengandung fasilitas + tanggal + jam → langsung cek ketersediaan
  let availabilityPrefix = "";
  if (facilityId && intent.bookingDate && intent.startTime && facData && facData.bookingMode !== "walk_in") {
    const isAvail = await checkSlotAvailable(facilityId, intent.bookingDate, intent.startTime, 1);
    if (isAvail) {
      availabilityPrefix = `✅ Slot jam *${intent.startTime}* tanggal *${intent.bookingDate}* untuk *${facilityName}* tersedia!\n\n`;
    } else {
      const availSlots = await getAvailableSlotsForDay(facilityId, intent.bookingDate, facData.openTime, facData.closeTime);
      const slotsStr = availSlots.length > 0
        ? `\n\n🟢 *Slot tersedia tanggal ${intent.bookingDate}:*\n${availSlots.join("  |  ")}`
        : `\n\n⚠️ Tidak ada slot tersedia pada tanggal tersebut. Coba tanggal lain.`;
      const reply = `❌ Slot jam *${intent.startTime}* tanggal *${intent.bookingDate}* untuk *${facilityName}* sudah terisi.${slotsStr}`;
      await sendWAMsg(phone, reply);
      return;
    }
  }

  const step = getNextStep({
    facilityId,
    bookingDate: intent.bookingDate,
    startTime: intent.startTime,
    durationMinutes: intent.durationMinutes,
    customerName: customer?.name ?? null,
  });

  const session = await createSession({
    phone,
    customerId: customer?.id ?? null,
    facilityId,
    bookingDate: intent.bookingDate,
    startTime: intent.startTime,
    durationMinutes: intent.durationMinutes,
    customerName: customer?.name ?? null,
    currentStep: step,
  });

  await appendMessage(session.id, "customer", msg);

  await logAudit({
    action: "booking_session_started",
    entity: "wa_booking_session",
    entityId: session.id,
    after: { phone, step, facilityId, bookingDate: intent.bookingDate, startTime: intent.startTime },
  });

  // Tambah prefix ketersediaan jika ada
  const baseQuestion = await buildStepQuestion(step, session, facilityName, pricePerHour);

  // Jika tanggal sudah diketahui tapi jam belum (step=ask_time), tampilkan slot tersedia
  let slotsSuffix = "";
  if (step === "ask_time" && facilityId && intent.bookingDate && facData && facData.bookingMode !== "walk_in") {
    const availSlots = await getAvailableSlotsForDay(facilityId, intent.bookingDate, facData.openTime, facData.closeTime);
    if (availSlots.length > 0) {
      slotsSuffix = `\n\n🟢 *Slot tersedia tanggal ${intent.bookingDate}:*\n${availSlots.join("  |  ")}`;
    } else {
      slotsSuffix = `\n\n⚠️ Semua slot tanggal *${intent.bookingDate}* sudah penuh. Ketik tanggal lain.`;
    }
  }

  const reply = availabilityPrefix + baseQuestion + slotsSuffix;
  await appendMessage(session.id, "bot", reply);
  await sendWAMsg(phone, reply);
}

async function continueSession(session: WaBookingSessionRow, phone: string, msg: string): Promise<void> {
  await appendMessage(session.id, "customer", msg);

  const step = session.currentStep as WaStep;
  const lower = msg.toLowerCase().trim();

  // Allow cancelling at any step
  if (isNo(lower) && step !== "confirm") {
    await updateSession(session.id, { status: "cancelled" });
    await sendWAMsg(phone, `❌ Booking dibatalkan. Ketik *booking* kapan saja untuk memulai lagi. 🏅`);
    return;
  }

  switch (step) {
    case "ask_facility": {
      const fac = await resolveFacilityFromMsg(msg);
      if (!fac) {
        const reply = `Fasilitas tidak ditemukan. ${await buildFacilityList()}`;
        await appendMessage(session.id, "bot", reply);
        await sendWAMsg(phone, reply);
        return;
      }
      const updated = await updateSession(session.id, {
        facilityId: fac.id,
        currentStep: getNextStep({
          facilityId: fac.id,
          bookingDate: session.bookingDate,
          startTime: session.startTime,
          durationMinutes: session.durationMinutes,
          customerName: session.customerName,
        }),
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_facility", facilityId: fac.id } });
      const reply = await buildStepQuestion(updated.currentStep as WaStep, updated, fac.name, Number(fac.pricePerHour));
      await appendMessage(session.id, "bot", reply);
      await sendWAMsg(phone, reply);
      break;
    }

    case "ask_date": {
      const parsed = parseIntent(msg);
      if (!parsed.bookingDate) {
        const reply = `📅 Tidak bisa mengenali tanggal. Coba format:\n• *besok*\n• *15 Juni*\n• *Senin*\n• *tanggal 20*`;
        await appendMessage(session.id, "bot", reply);
        await sendWAMsg(phone, reply);
        return;
      }
      if (parsed.bookingDate < todayWIB()) {
        const reply = `📅 Tanggal *${parsed.bookingDate}* sudah lewat. Pilih tanggal hari ini atau yang akan datang.`;
        await appendMessage(session.id, "bot", reply);
        await sendWAMsg(phone, reply);
        return;
      }
      const updated = await updateSession(session.id, {
        bookingDate: parsed.bookingDate,
        currentStep: getNextStep({ ...session, bookingDate: parsed.bookingDate }),
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_date", bookingDate: parsed.bookingDate } });
      const fac = session.facilityId ? await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1).then(r => r[0]) : null;

      // Cek dan tampilkan slot yang tersedia untuk tanggal yang dipilih
      let slotsMsg = "";
      if (fac && fac.bookingMode !== "walk_in") {
        const availSlots = await getAvailableSlotsForDay(session.facilityId!, parsed.bookingDate, fac.openTime, fac.closeTime);
        if (availSlots.length === 0) {
          slotsMsg = `\n\n⚠️ Semua slot pada *${parsed.bookingDate}* sudah penuh. Coba pilih tanggal lain (ketik *batal* dulu).`;
        } else {
          slotsMsg = `\n\n🟢 *Slot tersedia tanggal ${parsed.bookingDate}:*\n${availSlots.join("  |  ")}`;
        }
      }

      const baseQuestion = await buildStepQuestion(updated.currentStep as WaStep, updated, fac?.name ?? "", Number(fac?.pricePerHour ?? 0));
      const reply = baseQuestion + slotsMsg;
      await appendMessage(session.id, "bot", reply);
      await sendWAMsg(phone, reply);
      break;
    }

    case "ask_time": {
      const parsed = parseIntent(msg);
      if (!parsed.startTime) {
        const reply = `⏰ Tidak bisa mengenali jam. Coba format:\n• *jam 8 pagi*\n• *jam 20.00*\n• *19:00*\n• *jam 7 malam*`;
        await appendMessage(session.id, "bot", reply);
        await sendWAMsg(phone, reply);
        return;
      }

      // Cek ketersediaan slot dari DB (booking + blocked schedules)
      if (session.facilityId && session.bookingDate) {
        const fac = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1).then(r => r[0]);
        if (fac && fac.bookingMode !== "walk_in") {
          // Cek jam operasional dulu
          const reqMin = timeToMinutes(parsed.startTime);
          const openMin = timeToMinutes(fac.openTime);
          const closeMin = timeToMinutes(fac.closeTime);
          if (reqMin < openMin || reqMin >= closeMin) {
            const availSlots = await getAvailableSlotsForDay(session.facilityId, session.bookingDate, fac.openTime, fac.closeTime);
            const slotsStr = availSlots.length > 0
              ? `\n\n🟢 *Slot tersedia:*\n${availSlots.join("  |  ")}`
              : `\n\n⚠️ Tidak ada slot tersedia di tanggal ini.`;
            const reply = `⏰ Jam *${parsed.startTime}* di luar jam operasional *${fac.openTime}–${fac.closeTime}*.${slotsStr}\n\nPilih jam yang tersedia:`;
            await appendMessage(session.id, "bot", reply);
            await sendWAMsg(phone, reply);
            return;
          }

          // Cek apakah slot tersedia di DB (1 jam sebagai pengecekan awal)
          const isAvail = await checkSlotAvailable(session.facilityId, session.bookingDate, parsed.startTime, 1);
          if (!isAvail) {
            const availSlots = await getAvailableSlotsForDay(session.facilityId, session.bookingDate, fac.openTime, fac.closeTime);
            const slotsStr = availSlots.length > 0
              ? `\n\n🟢 *Slot tersedia tanggal ${session.bookingDate}:*\n${availSlots.join("  |  ")}`
              : `\n\n⚠️ Tidak ada slot lain yang tersedia. Ketik *batal* dan pilih tanggal berbeda.`;
            const reply = `❌ Slot jam *${parsed.startTime}* pada *${session.bookingDate}* sudah terisi.${slotsStr}\n\nPilih jam lain:`;
            await appendMessage(session.id, "bot", reply);
            await sendWAMsg(phone, reply);
            return;
          }
        }
      }

      const updated = await updateSession(session.id, {
        startTime: parsed.startTime,
        currentStep: getNextStep({ ...session, startTime: parsed.startTime }),
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_time", startTime: parsed.startTime } });
      const fac2 = session.facilityId ? await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1).then(r => r[0]) : null;

      // Konfirmasi slot tersedia ke customer
      const availConfirm = session.facilityId && session.bookingDate
        ? `✅ Slot jam *${parsed.startTime}* tersedia!\n\n`
        : "";
      const nextQ = await buildStepQuestion(updated.currentStep as WaStep, updated, fac2?.name ?? "", Number(fac2?.pricePerHour ?? 0));
      const reply = availConfirm + nextQ;
      await appendMessage(session.id, "bot", reply);
      await sendWAMsg(phone, reply);
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
        const reply = `⏱️ Tidak bisa mengenali durasi. Coba:\n• *2 jam*\n• *1 jam 30 menit*\n• *90 menit*`;
        await appendMessage(session.id, "bot", reply);
        await sendWAMsg(phone, reply);
        return;
      }
      const updated = await updateSession(session.id, {
        durationMinutes,
        currentStep: getNextStep({ ...session, durationMinutes }),
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_duration", durationMinutes } });
      const fac = session.facilityId ? await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1).then(r => r[0]) : null;
      const reply = await buildStepQuestion(updated.currentStep as WaStep, updated, fac?.name ?? "", Number(fac?.pricePerHour ?? 0));
      await appendMessage(session.id, "bot", reply);
      await sendWAMsg(phone, reply);
      break;
    }

    case "ask_name": {
      const name = msg.trim();
      if (name.length < 2 || name.length > 100) {
        const reply = `👤 Masukkan nama lengkap yang valid (minimal 2 karakter).`;
        await appendMessage(session.id, "bot", reply);
        await sendWAMsg(phone, reply);
        return;
      }
      const updated = await updateSession(session.id, {
        customerName: name,
        currentStep: "confirm",
      });
      await logAudit({ action: "booking_session_updated", entity: "wa_booking_session", entityId: session.id, after: { step: "ask_name", customerName: name } });
      const fac = session.facilityId ? await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1).then(r => r[0]) : null;
      const reply = await buildStepQuestion("confirm", updated, fac?.name ?? "", Number(fac?.pricePerHour ?? 0));
      await appendMessage(session.id, "bot", reply);
      await sendWAMsg(phone, reply);
      break;
    }

    case "confirm": {
      if (isYes(lower)) {
        await execCreateBookingFromSession(session, phone);
      } else if (isNo(lower)) {
        await updateSession(session.id, { status: "cancelled" });
        await sendWAMsg(phone, `❌ Booking dibatalkan. Ketik *booking* untuk memulai lagi. 🏅`);
      } else {
        const fac = session.facilityId ? await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1).then(r => r[0]) : null;
        const reply = await buildStepQuestion("confirm", session, fac?.name ?? "", Number(fac?.pricePerHour ?? 0));
        await sendWAMsg(phone, `Ketik *ya* untuk konfirmasi atau *batal* untuk membatalkan.\n\n${reply}`);
      }
      break;
    }

    default: {
      await sendWAMsg(phone, `Ketik *booking* untuk membuat booking baru atau *status* untuk cek pesanan. 🏅`);
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

    case "ask_date":
      return `📅 Tanggal berapa mau booking${facilityName ? ` *${facilityName}*` : ""}?\nContoh: *besok*, *15 Juni*, *Sabtu*, *tanggal 20*`;

    case "ask_time": {
      const fac = session.facilityId
        ? await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, session.facilityId)).limit(1).then(r => r[0])
        : null;
      const hours = fac ? ` (jam operasional: *${fac.openTime}–${fac.closeTime}*)` : "";
      return `⏰ Jam berapa mau mulai?${hours}\nContoh: *jam 8 pagi*, *jam 20.00*, *19:00*`;
    }

    case "ask_duration":
      return `⏱️ Berapa lama? (min 1 jam)\nContoh: *1 jam*, *2 jam*, *90 menit*`;

    case "ask_name":
      return `👤 Atas nama siapa booking ini?`;

    case "confirm": {
      if (!session.facilityId || !session.bookingDate || !session.startTime || !session.durationMinutes || !session.customerName) {
        return `Ada data yang belum lengkap. Ketik *batal* dan mulai ulang.`;
      }
      const durationHours = minutesToHours(session.durationMinutes);
      const endTime = addHoursToTime(session.startTime, durationHours);
      const totalPrice = pricePerHour * durationHours;
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

  const activeBookings = existingBookings.filter(b => !INACTIVE_STATUSES.includes(b.status));
  const openMin = timeToMinutes(openTime);
  const closeMin = timeToMinutes(closeTime);
  const requestedMin = timeToMinutes(requestedStartTime);
  const durMin = durationHours * 60;

  const candidates: number[] = [];
  for (let t = openMin; t + durMin <= closeMin; t += 60) {
    candidates.push(t);
  }

  candidates.sort((a, b) => Math.abs(a - requestedMin) - Math.abs(b - requestedMin));

  const alternatives: string[] = [];
  for (const startMin of candidates) {
    if (startMin === requestedMin) continue;
    const endMin = startMin + durMin;
    const hasConflict = activeBookings.some(b => {
      const bS = timeToMinutes(b.startTime);
      const bE = timeToMinutes(b.endTime);
      return startMin < bE && endMin > bS;
    });
    if (!hasConflict) {
      alternatives.push(`${minutesToTimeStr(startMin)}–${minutesToTimeStr(endMin)}`);
      if (alternatives.length >= 3) break;
    }
  }
  return alternatives;
}

// ─── Availability helpers (cek DB termasuk blocked schedules) ────────────────

async function getAvailableSlotsForDay(
  facilityId: number,
  date: string,
  openTime: string,
  closeTime: string,
): Promise<string[]> {
  const bookings = await db
    .select({ startTime: bookingsTable.startTime, endTime: bookingsTable.endTime, status: bookingsTable.status })
    .from(bookingsTable)
    .where(and(eq(bookingsTable.facilityId, facilityId), eq(bookingsTable.bookingDate, date)));
  const activeBookings = bookings.filter((b) => !INACTIVE_STATUSES.includes(b.status));

  const blocked = await db
    .select({ startTime: blockedSchedulesTable.startTime, endTime: blockedSchedulesTable.endTime })
    .from(blockedSchedulesTable)
    .where(and(eq(blockedSchedulesTable.facilityId, facilityId), eq(blockedSchedulesTable.date, date)));

  const openMin = timeToMinutes(openTime);
  const closeMin = timeToMinutes(closeTime);
  const available: string[] = [];

  for (let t = openMin; t < closeMin; t += 60) {
    const slotEnd = t + 60;
    const timeStr = minutesToTimeStr(t);
    const isBooked = activeBookings.some((b) => {
      const bS = timeToMinutes(b.startTime);
      const bE = timeToMinutes(b.endTime);
      return t < bE && slotEnd > bS;
    });
    const isBlocked = blocked.some((b) => {
      const bS = timeToMinutes(b.startTime);
      const bE = timeToMinutes(b.endTime);
      return t < bE && slotEnd > bS;
    });
    if (!isBooked && !isBlocked) available.push(timeStr);
  }
  return available;
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

  return !blocked.some((b) => {
    const bS = timeToMinutes(b.startTime);
    const bE = timeToMinutes(b.endTime);
    return startMin < bE && endMin > bS;
  });
}

// ─── Auto-create customer if WA user not registered ───────────────────────────

async function ensureCustomer(phone: string, name: string): Promise<{ id: number; email: string }> {
  const [existing] = await db.select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (existing) return existing;

  const customerCode = await generateCustomerCode();
  const finalEmail = `wa_${phone}@whatsapp.local`;
  const [emailConflict] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, finalEmail)).limit(1);

  const email = emailConflict ? `wa_${phone}_${Date.now()}@whatsapp.local` : finalEmail;
  const passwordHash = hashPassword(randomBytes(16).toString("hex"));

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

  return user;
}

// ─── Main: create booking from session with full FASE 2 logic ─────────────────

async function execCreateBookingFromSession(session: WaBookingSessionRow, phone: string): Promise<void> {
  if (!session.facilityId || !session.bookingDate || !session.startTime || !session.durationMinutes || !session.customerName) {
    await sendWAMsg(phone, `❌ Data booking tidak lengkap. Ketik *batal* dan mulai ulang.`);
    return;
  }

  // ── 1. Validasi fasilitas ──────────────────────────────────────────────────
  const [facility] = await db.select().from(facilitiesTable)
    .where(and(eq(facilitiesTable.id, session.facilityId), eq(facilitiesTable.isActive, true)))
    .limit(1);
  if (!facility) {
    await sendWAMsg(phone, `❌ Fasilitas tidak ditemukan atau sudah tidak aktif. Ketik *batal* dan mulai ulang.`);
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
    await sendWAMsg(phone, reply);
    return;
  }

  // ── 4. Validasi tanggal (tidak boleh lampau) ───────────────────────────────
  if (session.bookingDate < todayWIB()) {
    const reply = `⚠️ Tanggal *${session.bookingDate}* sudah lewat. Pilih tanggal yang akan datang.`;
    await updateSession(session.id, { currentStep: "ask_date" });
    await appendMessage(session.id, "bot", reply);
    await sendWAMsg(phone, reply);
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

    if (alternatives.length > 0) {
      reply += `\n\n🕐 *Alternatif jam yang tersedia pada tanggal yang sama:*\n` +
        alternatives.map((alt, i) => `${i + 1}. *${alt}*`).join("\n") +
        `\n\nKetik jam pilihan kamu (contoh: *jam 10.00*) atau *batal* untuk membatalkan.`;
    } else {
      reply += `\n\nMaaf, tidak ada slot lain yang tersedia pada tanggal tersebut.\nKetik tanggal lain atau *batal* untuk membatalkan.`;
    }

    await updateSession(session.id, { currentStep: "ask_time" });
    await appendMessage(session.id, "bot", reply);
    await sendWAMsg(phone, reply);
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
  const taxCalc = await calculateTax(totalPrice, "sport_center_booking", session.bookingDate);
  const grandTotal = taxCalc.taxAmount > 0 ? taxCalc.grandTotal : totalPrice;
  const orderNumber = await generateOrderNumber();

  // ── 10. Buat booking dengan status waiting_admin_approval ──────────────────
  const [booking] = await db.insert(bookingsTable).values({
    orderNumber,
    customerName: session.customerName,
    customerEmail: customer.email,
    customerPhone: phone,
    customerId: customer.id,
    facilityId: facility.id,
    bookingDate: session.bookingDate,
    startTime: session.startTime,
    endTime,
    durationHours,
    totalPrice: String(totalPrice),
    discountAmount: String(discountAmount),
    apDiscountAmount: "0",
    basePrice: String(basePrice),
    source: "whatsapp_ai",
    status: "waiting_admin_approval",
    ppnRate: taxCalc.taxAmount > 0 ? String(taxCalc.taxRate) : null,
    ppnAmount: taxCalc.taxAmount > 0 ? String(taxCalc.taxAmount) : null,
    grandTotal: taxCalc.taxAmount > 0 ? String(taxCalc.grandTotal) : null,
  }).returning();

  await db.insert(bookingHistoryTable).values({
    bookingId: booking.id,
    fromStatus: null,
    toStatus: "waiting_admin_approval",
    changedByName: session.customerName,
    note: "Booking dibuat via WhatsApp AI — menunggu persetujuan admin",
  });

  broadcastAvailabilityChange(facility.id, session.bookingDate);

  if (taxCalc.taxCode) {
    recordTaxTransaction("booking", booking.id, booking.orderNumber, taxCalc, session.bookingDate).catch(() => {});
  }

  // Mark session done
  await updateSession(session.id, { status: "completed", currentStep: "done" });

  // ── 11. Audit: booking dibuat ──────────────────────────────────────────────
  await logAudit({
    action: "booking_created_from_wa",
    entity: "booking",
    entityId: booking.id,
    after: {
      orderNumber,
      source: "whatsapp_chat",
      sessionId: session.id,
      status: "waiting_admin_approval",
      facilityId: facility.id,
      bookingDate: session.bookingDate,
      startTime: session.startTime,
      endTime,
      totalPrice: grandTotal,
      customerId: customer.id,
      appliedRules: appliedRulesStr || null,
    },
  });

  const statusUrl = `${APP_URL}/wa/status/${orderNumber}`;
  const weekend = isWeekendDate(session.bookingDate);

  // ── 12. Kirim WA ke customer ───────────────────────────────────────────────
  notifyWaBookingPendingApproval({
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
  });

  // ── 13. Kirim WA ke semua admin ────────────────────────────────────────────
  notifyWaAdminNewBooking({
    orderNumber,
    customerName: session.customerName,
    customerPhone: phone,
    facilityName: facility.name,
    bookingDate: session.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    durationHours,
    totalPrice: grandTotal.toLocaleString("id-ID"),
    isWeekend: weekend,
    appliedRules: appliedRulesStr || undefined,
    statusUrl,
  });

  // ── 14. Audit: notifikasi admin dikirim ────────────────────────────────────
  await logAudit({
    action: "admin_approval_sent",
    entity: "booking",
    entityId: booking.id,
    after: { orderNumber, sentToAdmins: true, bookingDate: session.bookingDate, facilityName: facility.name },
  });
}

// ─── POST /api/wa/fonnte/webhook — Fonnte inbound message handler ─────────────

router.post("/wa/fonnte/webhook", async (req, res) => {
  // Respond immediately to avoid Fonnte timeout
  res.status(200).json({ status: "ok" });

  try {
    if (isDuplicateWebhook(req.body)) return;
    const { sender, message = "", name = "" } = req.body;
    if (!sender) return;

    const phone = cleanPhone(String(sender));
    const msg = String(message).trim();
    if (!msg || !phone) return;

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
      await sendWAMsg(phone, "⚠️ Maaf, Anda tidak memiliki akses untuk perintah admin ini.");
      return;
    }
    if (adminPhones.includes(phone)) {
      const handled = await handleAdminCommand(phone, msg);
      if (handled) return;
      // If admin sends non-command, still allow normal flow
    }

    // 3. Active session — continue conversation (always takes priority)
    const session = await getActiveSession(phone);
    if (session) {
      await continueSession(session, phone, msg);
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
        const uploadUrl = proofToken ? `${APP_URL}/wa/proof/${proofToken}` : null;
        const reply = uploadUrl
          ? `📎 Untuk upload bukti pembayaran *${b.orderNumber}*, silakan gunakan link berikut:\n\n${uploadUrl}\n\n⚠️ Upload hanya bisa melalui link, tidak bisa via WhatsApp langsung.`
          : `📎 Untuk upload bukti pembayaran *${b.orderNumber}*, ketik *status* untuk mendapatkan link upload.`;
        await sendWAMsg(phone, reply);
      } else {
        await sendWAMsg(phone, `📎 Bukti pembayaran diunggah melalui link khusus yang dikirimkan setelah booking dikonfirmasi admin.\n\nKetik *status* untuk cek status booking, atau *booking* untuk membuat pesanan baru. 🏅`);
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
        await startBookingSession(phone, msg, String(name));
        return;
      }

      // talk_to_admin: langsung kirim kontak admin, tidak perlu OpenAI
      if (intent === "talk_to_admin") {
        const [settingsRow] = await db.select({ whatsapp: settingsTable.whatsapp, phone: settingsTable.phone, openHour: settingsTable.openHour, closeHour: settingsTable.closeHour })
          .from(settingsTable).limit(1);
        const adminContact = settingsRow?.whatsapp || settingsRow?.phone || (await getAdminPhones())[0] || "";
        const reply = adminContact
          ? `👋 Baik, saya hubungkan Anda dengan admin kami.\n\n📞 *Admin WhatsApp:* ${adminContact}\n\nSilakan hubungi admin langsung untuk bantuan lebih lanjut. Jam operasional: *${settingsRow?.openHour ?? "06:00"}–${settingsRow?.closeHour ?? "22:00"}*. 🙏`
          : `👋 Untuk berbicara langsung dengan admin, ketik *status* atau kunjungi ${APP_URL}/contact.\n\nKami siap membantu! 🏅`;
        await sendWAMsg(phone, reply);
        await logAudit({ action: "ai_talk_to_admin_handled", entity: "wa_ai", after: { phone, adminContact } });
        return;
      }

      const aiResult = await generateAiReply(phone, msg, []);

      if (aiResult.shouldHandoffToBookingFlow) {
        await startBookingSession(phone, msg, String(name));
        return;
      }

      if (!aiResult.fallbackToAdmin && aiResult.reply) {
        await sendWAMsg(phone, aiResult.reply);
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
        await sendWAMsg(phone, `Tidak ada booking terdaftar untuk nomor ini.\n\nKetik *booking* untuk membuat booking baru. 🏅`);
        return;
      }

      const facIds = [...new Set(allBookings.map(b => b.facilityId))];
      const facRows = await db.select({ id: facilitiesTable.id, name: facilitiesTable.name })
        .from(facilitiesTable).where(inArray(facilitiesTable.id, facIds));
      const facMap = new Map(facRows.map(f => [f.id, f.name]));

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
      reply += `Detail: ${APP_URL}/wa/status/${allBookings[0].orderNumber}`;
      await sendWAMsg(phone, reply);
      return;
    }

    // 6. Legacy fallback: explicit booking keyword (when AI is off or errored)
    if (isBookingIntent(msg)) {
      await startBookingSession(phone, msg, String(name));
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
      `Atau kunjungi: ${APP_URL}/facilities`
    );
  } catch (err) {
    console.error("[wa/fonnte/webhook] error:", err);
  }
});

export default router;
