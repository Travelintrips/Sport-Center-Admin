import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { db, bookingsTable, facilitiesTable, paymentsTable, bookingHistoryTable, waActionTokensTable, settingsTable, usersTable } from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { createWaToken, verifyWaToken, consumeWaToken, getWaTokenRow } from "../lib/waTokens";
import {
  notifyWaBookingCreated,
  notifyWaProofUploaded,
  notifyWaBookingConfirmed,
  notifyWaPaymentRejected,
  notifyWaStaffCheckin,
  notifyWaCustomerRegistered,
} from "../lib/notifications";
import { logAudit } from "../lib/auditLog";
import { hashPassword } from "../lib/auth";
import { syncStatusToBizportal } from "../lib/bizportalSync";
import { broadcastAvailabilityChange } from "../lib/supabase";

const router = Router();
const APP_URL = process.env.APP_URL ?? "";
const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];

// ─── Multer for proof upload ──────────────────────────────────────────────────
const PROOFS_DIR = path.resolve(process.cwd(), "uploads", "proofs");
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });

const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROOFS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `wa-proof-${randomUUID()}${ext}`);
  },
});
const uploadProof = multer({
  storage: proofStorage,
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

    // Create proof upload token (multi-use, 7 days)
    const proofToken = await createWaToken(booking.id, "upload_proof", 7);

    // Get bank info
    const settingsRows = await db.select().from(settingsTable).limit(1);
    const settings = settingsRows[0];

    // Send WA to customer
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
      totalPrice: totalPrice.toLocaleString("id-ID"),
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
    const objectPath = `/api/uploads/proofs/${req.file.filename}`;
    res.json({ objectPath });
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
    if (req.file) proofUrl = `/api/uploads/proofs/${req.file.filename}`;
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

    const fullProofUrl = proofUrl.startsWith("/")
      ? `${APP_URL}${proofUrl}`
      : proofUrl;

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

export default router;
