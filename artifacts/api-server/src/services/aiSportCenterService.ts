import OpenAI from "openai";
import {
  db,
  facilitiesTable,
  bookingsTable,
  promosTable,
  settingsTable,
  pricingRulesTable,
  gymMembershipsTable,
  blockedSchedulesTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, not, inArray } from "drizzle-orm";
import { logAudit } from "../lib/auditLog";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiContext {
  facilities: FacilityInfo[];
  activePromos: PromoInfo[];
  settings: SettingsInfo;
  customerBookings: BookingInfo[];
  customerMembership: MembershipInfo | null;
  availabilityNote: string;
}

interface FacilityInfo {
  id: number;
  name: string;
  category: string;
  pricePerHour: number;
  openTime: string;
  closeTime: string;
  minDuration: number;
  maxDuration: number | null;
  capacity: number | null;
  pricingRules: PricingRuleInfo[];
}

interface PricingRuleInfo {
  name: string;
  ruleType: string;
  dayType: string | null;
  peakStartTime: string | null;
  peakEndTime: string | null;
  priceOverride: number | null;
  priceAddon: number | null;
  priceMultiplier: number | null;
}

interface PromoInfo {
  title: string;
  description: string | null;
  code: string | null;
  discountType: string;
  discountPercent: number | null;
  discountAmount: number | null;
  minPurchase: number | null;
  startDate: string | null;
  endDate: string | null;
  maxUses: number | null;
  usedCount: number;
}

interface SettingsInfo {
  centerName: string;
  address: string;
  phone: string;
  whatsapp: string;
  openHour: string;
  closeHour: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
}

interface BookingInfo {
  orderNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice: number;
  status: string;
  createdAt: string;
}

interface MembershipInfo {
  name: string;
  startDate: string;
  endDate: string;
  months: number;
  totalPrice: number;
  status: string;
}

// ─── Guardrail constants ──────────────────────────────────────────────────────

const ADMIN_ONLY_ACTIONS = [
  "approve", "konfirmasi", "setujui", "lunas", "paid", "mark paid",
  "cancel booking orang", "batalkan booking", "hapus booking",
  "ubah status", "ganti status", "refund",
];

const INACTIVE_STATUSES = ["cancelled", "expired", "rejected", "refunded"];

// ─── DB Context Loader ────────────────────────────────────────────────────────

export async function loadDbContext(
  customerPhone: string,
  requestedDate?: string
): Promise<AiContext> {
  const today = new Date().toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).split("/").reverse().join("-");

  const targetDate = requestedDate ?? today;

  // Load in parallel
  const [facilitiesRaw, promosRaw, settingsRaw, bookingsRaw, membershipRaw, pricingRaw] =
    await Promise.all([
      db.select().from(facilitiesTable).where(eq(facilitiesTable.isActive, true)),
      db.select().from(promosTable).where(eq(promosTable.isActive, true)),
      db.select().from(settingsTable).limit(1),
      db.select().from(bookingsTable)
        .where(eq(bookingsTable.customerPhone, customerPhone))
        .orderBy(desc(bookingsTable.createdAt))
        .limit(5),
      db.select().from(gymMembershipsTable)
        .where(eq(gymMembershipsTable.phone, customerPhone))
        .orderBy(desc(gymMembershipsTable.createdAt))
        .limit(1),
      db.select().from(pricingRulesTable).where(eq(pricingRulesTable.isActive, true)),
    ]);

  const s = settingsRaw[0];
  const settings: SettingsInfo = {
    centerName: s?.centerName ?? "Sport Center",
    address: s?.address ?? "",
    phone: s?.phone ?? "",
    whatsapp: s?.whatsapp ?? "",
    openHour: s?.openHour ?? "06:00",
    closeHour: s?.closeHour ?? "22:00",
    bankName: s?.bankName ?? "",
    bankAccount: s?.bankAccount ?? "",
    bankAccountName: s?.bankAccountName ?? "",
  };

  // Build facility info with pricing rules
  const facilities: FacilityInfo[] = facilitiesRaw.map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    pricePerHour: Number(f.pricePerHour),
    openTime: f.openTime,
    closeTime: f.closeTime,
    minDuration: f.minDuration,
    maxDuration: f.maxDuration,
    capacity: f.capacity,
    pricingRules: pricingRaw
      .filter((p) => p.facilityId === f.id)
      .map((p) => ({
        name: p.name,
        ruleType: p.ruleType,
        dayType: p.dayType,
        peakStartTime: p.peakStartTime,
        peakEndTime: p.peakEndTime,
        priceOverride: p.priceOverride ? Number(p.priceOverride) : null,
        priceAddon: p.priceAddon ? Number(p.priceAddon) : null,
        priceMultiplier: p.priceMultiplier ? Number(p.priceMultiplier) : null,
      })),
  }));

  // Check availability for targetDate — list busy slots
  const dateBookings = await db.select({
    facilityId: bookingsTable.facilityId,
    startTime: bookingsTable.startTime,
    endTime: bookingsTable.endTime,
    status: bookingsTable.status,
  }).from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.bookingDate, targetDate),
        not(inArray(bookingsTable.status, INACTIVE_STATUSES))
      )
    );

  const blockedSlots = await db.select({
    facilityId: blockedSchedulesTable.facilityId,
    startTime: blockedSchedulesTable.startTime,
    endTime: blockedSchedulesTable.endTime,
    reason: blockedSchedulesTable.reason,
  }).from(blockedSchedulesTable)
    .where(eq(blockedSchedulesTable.date, targetDate));

  // Build availability summary per facility
  const availabilityLines: string[] = [];
  for (const f of facilities) {
    const busy = dateBookings.filter((b) => b.facilityId === f.id);
    const blocked = blockedSlots.filter((b) => b.facilityId === f.id);
    if (busy.length > 0 || blocked.length > 0) {
      const busyStr = busy.map((b) => `${b.startTime}-${b.endTime}`).join(", ");
      const blockedStr = blocked.map((b) => `${b.startTime}-${b.endTime}(${b.reason})`).join(", ");
      const parts = [busyStr, blockedStr].filter(Boolean).join(", ");
      availabilityLines.push(`${f.name}: slot terisi ${parts}`);
    }
  }
  const availabilityNote = availabilityLines.length > 0
    ? `Slot terisi pada ${targetDate}:\n` + availabilityLines.join("\n")
    : `Semua slot tersedia pada ${targetDate} (sesuai jam operasional masing-masing fasilitas).`;

  // Customer bookings
  const facilityMap = new Map(facilitiesRaw.map((f) => [f.id, f.name]));
  const customerBookings: BookingInfo[] = bookingsRaw.map((b) => ({
    orderNumber: b.orderNumber,
    facilityName: facilityMap.get(b.facilityId) ?? "Unknown",
    bookingDate: b.bookingDate,
    startTime: b.startTime,
    endTime: b.endTime,
    totalPrice: Number(b.grandTotal ?? b.totalPrice),
    status: b.status,
    createdAt: b.createdAt?.toISOString?.() ?? "",
  }));

  // Membership
  const mem = membershipRaw[0];
  const customerMembership: MembershipInfo | null = mem ? {
    name: mem.name,
    startDate: mem.startDate,
    endDate: mem.endDate,
    months: mem.months,
    totalPrice: Number(mem.totalPrice),
    status: mem.status,
  } : null;

  // Active promos (filter by date)
  const activePromos: PromoInfo[] = promosRaw
    .filter((p) => {
      if (p.endDate && p.endDate < today) return false;
      if (p.startDate && p.startDate > today) return false;
      return true;
    })
    .map((p) => ({
      title: p.title,
      description: p.description,
      code: p.code,
      discountType: p.discountType,
      discountPercent: p.discountPercent ? Number(p.discountPercent) : null,
      discountAmount: p.discountAmount ? Number(p.discountAmount) : null,
      minPurchase: p.minPurchase ? Number(p.minPurchase) : null,
      startDate: p.startDate,
      endDate: p.endDate,
      maxUses: p.maxUses,
      usedCount: p.usedCount,
    }));

  return { facilities, activePromos, settings, customerBookings, customerMembership, availabilityNote };
}

// ─── Intent Detection ────────────────────────────────────────────────────────

export type AiIntent =
  | "booking_intent"
  | "status_check"
  | "facility_info"
  | "price_inquiry"
  | "promo_inquiry"
  | "availability_check"
  | "membership_inquiry"
  | "payment_info"
  | "operating_hours"
  | "contact_info"
  | "admin_action_attempt"
  | "general_question"
  | "out_of_scope";

export function detectIntent(msg: string): AiIntent {
  const lower = msg.toLowerCase();

  // Admin action attempts — must be caught before general
  if (ADMIN_ONLY_ACTIONS.some((a) => lower.includes(a))) return "admin_action_attempt";

  // Informational intents checked BEFORE booking_intent to avoid false positives
  // e.g. "berapa harga sewa badminton" → price_inquiry (not booking_intent)
  if (/\b(harga|tarif|biaya|berapa|price|cost)\b/.test(lower)) return "price_inquiry";
  if (/\b(promo|diskon|voucher|kode promo|potongan|cashback)\b/.test(lower)) return "promo_inquiry";
  if (/\b(slot|kosong|tersedia|available|ada slot|jam berapa bisa|kapan bisa)\b/.test(lower)) return "availability_check";
  if (/\b(cara bayar|rekening|no rek|transfer ke|bank apa|qris|cara pembayaran)\b/.test(lower)) return "payment_info";
  if (/\b(jam buka|jam tutup|buka jam|hari apa|operasional|buka sampai|jam berapa buka)\b/.test(lower)) return "operating_hours";
  if (/\b(alamat|lokasi|dimana|contact|kontak|nomor telepon|wa admin)\b/.test(lower)) return "contact_info";
  if (/\b(status|order saya|pesanan saya|cek booking|sudah bayar|sudah lunas|booking saya)\b/.test(lower)) return "status_check";
  if (/\b(member|membership|langganan|daftar member)\b/.test(lower)) return "membership_inquiry";
  if (/\b(fasilitas apa|ada apa aja|list fasilitas|lapangan apa saja)\b/.test(lower)) return "facility_info";

  // Booking intent: explicit action verb required, not just facility/price question
  if (/\b(mau book|mau pesan|mau sewa|mau booking|mau reservasi|mau daftar|saya booking|reservasi|pesan lapangan|book lapangan|booking lapangan|mulai booking)\b/.test(lower)) return "booking_intent";
  if (/\bboking\b/.test(lower)) return "booking_intent";
  // Standalone "booking" only if NOT status-related
  if (/\bbooking\b/.test(lower) && !/booking saya|status booking|cek booking/.test(lower)) return "booking_intent";

  return "general_question";
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(ctx: AiContext, customerPhone: string, today: string): string {
  const fmtIDR = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  const facilitiesText = ctx.facilities.map((f) => {
    const rules = f.pricingRules.length > 0
      ? `\n    Pricing rules: ${f.pricingRules.map((r) =>
          `${r.name} (${r.ruleType}${r.dayType ? "/" + r.dayType : ""}${r.peakStartTime ? " " + r.peakStartTime + "-" + r.peakEndTime : ""}: ${r.priceOverride ? "override " + fmtIDR(r.priceOverride) : ""}${r.priceAddon ? "+addon " + fmtIDR(r.priceAddon) : ""}${r.priceMultiplier ? "×" + r.priceMultiplier : ""})`
        ).join("; ")}`
      : "";
    return `  - ${f.name} (${f.category}): ${fmtIDR(f.pricePerHour)}/jam | buka ${f.openTime}-${f.closeTime} | min ${f.minDuration}jam${f.maxDuration ? " max " + f.maxDuration + "jam" : ""}${f.capacity ? " | kapasitas " + f.capacity : ""}${rules}`;
  }).join("\n");

  const promosText = ctx.activePromos.length > 0
    ? ctx.activePromos.map((p) => {
        const disc = p.discountPercent ? `${p.discountPercent}%` : p.discountAmount ? fmtIDR(p.discountAmount) : "-";
        return `  - ${p.title}${p.code ? " [kode: " + p.code + "]" : ""}: diskon ${disc}${p.minPurchase ? " min belanja " + fmtIDR(p.minPurchase) : ""}${p.endDate ? " s/d " + p.endDate : ""}`;
      }).join("\n")
    : "  Tidak ada promo aktif saat ini.";

  const bookingsText = ctx.customerBookings.length > 0
    ? ctx.customerBookings.map((b) =>
        `  - ${b.orderNumber}: ${b.facilityName} tgl ${b.bookingDate} ${b.startTime}-${b.endTime} | ${fmtIDR(b.totalPrice)} | status: ${b.status.replace(/_/g, " ").toUpperCase()}`
      ).join("\n")
    : "  Tidak ada riwayat booking dari nomor ini.";

  const membershipText = ctx.customerMembership
    ? `  Member aktif: ${ctx.customerMembership.name} | ${ctx.customerMembership.startDate} s/d ${ctx.customerMembership.endDate} | status: ${ctx.customerMembership.status}`
    : "  Tidak ada data membership untuk nomor ini.";

  const paymentText = ctx.settings.bankName
    ? `Transfer ke:\n  Bank: ${ctx.settings.bankName}\n  Rekening: ${ctx.settings.bankAccount}\n  A/n: ${ctx.settings.bankAccountName}`
    : "Informasi rekening belum dikonfigurasi.";

  return `Kamu adalah asisten AI resmi ${ctx.settings.centerName}, yang membantu customer via WhatsApp.

HARI INI: ${today}
JAM OPERASIONAL: ${ctx.settings.openHour} - ${ctx.settings.closeHour}
ALAMAT: ${ctx.settings.address || "Belum diisi"}
KONTAK: ${ctx.settings.phone || ctx.settings.whatsapp || "Belum diisi"}

=== DATA FASILITAS (DARI DATABASE) ===
${facilitiesText || "Belum ada data fasilitas."}

=== KETERSEDIAAN SLOT ===
${ctx.availabilityNote}

=== PROMO AKTIF (DARI DATABASE) ===
${promosText}

=== DATA CUSTOMER (nomor: ${customerPhone}) ===
Riwayat Booking:
${bookingsText}

Membership:
${membershipText}

=== INSTRUKSI PEMBAYARAN ===
${paymentText}

=== ATURAN WAJIB (GUARDRAIL) ===
1. Hanya boleh menjawab berdasarkan data di atas. JANGAN mengarang jadwal, harga, promo, atau fasilitas.
2. Jika data tidak ada, jawab: "Data belum tersedia di sistem."
3. Jika slot belum dicek dari database, JANGAN bilang tersedia.
4. Jika harga tidak ditemukan di data, JANGAN estimasi.
5. Jika customer minta diskon/promo di luar database, arahkan ke admin.
6. DILARANG KERAS: approve booking, tandai paid, cancel booking, atau ubah status apapun.
7. Untuk tindakan admin (approve/paid/cancel), selalu jawab: "Tindakan ini hanya bisa dilakukan admin. Silakan hubungi admin kami."
8. Untuk mulai booking, arahkan customer ketik: *booking [nama fasilitas] [tanggal] jam [waktu] [durasi] jam*
9. Jawab dalam Bahasa Indonesia, santai tapi profesional.
10. Maksimal ${process.env.AI_SPORTCENTER_MAX_REPLY_LENGTH ?? 900} karakter per balasan. Ringkas dan jelas.`;
}

// ─── Main AI Reply Function ───────────────────────────────────────────────────

export interface AiReplyResult {
  reply: string;
  intent: AiIntent;
  shouldHandoffToBookingFlow: boolean;
  fallbackToAdmin: boolean;
}

export async function generateAiReply(
  customerPhone: string,
  message: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<AiReplyResult> {
  const enabled = process.env.AI_SPORTCENTER_ENABLED !== "false";
  const apiKey = process.env.OPENAI_API_KEY;

  if (!enabled || !apiKey) {
    return {
      reply: "",
      intent: "general_question",
      shouldHandoffToBookingFlow: false,
      fallbackToAdmin: true,
    };
  }

  const intent = detectIntent(message);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

  // Extract date from message for availability context
  const dateMatch = message.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  const requestedDate = dateMatch ? dateMatch[0] : undefined;

  // Load DB context
  const ctx = await loadDbContext(customerPhone, requestedDate);

  // Log: context loaded
  await logAudit({
    action: "ai_db_context_loaded",
    entity: "wa_ai",
    after: {
      phone: customerPhone,
      intent,
      facilitiesCount: ctx.facilities.length,
      promosCount: ctx.activePromos.length,
      customerBookingsCount: ctx.customerBookings.length,
    },
  }).catch(() => {});

  // Admin action attempt guardrail
  if (intent === "admin_action_attempt") {
    const reply = "Tindakan tersebut hanya bisa dilakukan oleh admin. Silakan hubungi admin kami untuk bantuan lebih lanjut. 🙏";
    await logAudit({
      action: "ai_fallback_to_admin",
      entity: "wa_ai",
      after: { phone: customerPhone, message, reason: "admin_action_attempt" },
    }).catch(() => {});
    return { reply, intent, shouldHandoffToBookingFlow: false, fallbackToAdmin: true };
  }

  // Booking intent — hand off to structured booking flow
  if (intent === "booking_intent") {
    return {
      reply: "",
      intent,
      shouldHandoffToBookingFlow: true,
      fallbackToAdmin: false,
    };
  }

  // Build messages for OpenAI
  const systemPrompt = buildSystemPrompt(ctx, customerPhone, today);
  const maxLen = parseInt(process.env.AI_SPORTCENTER_MAX_REPLY_LENGTH ?? "900", 10);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    // Last 4 turns of history for context
    ...conversationHistory.slice(-4),
    { role: "user", content: message },
  ];

  const openai = new OpenAI({ apiKey });

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages,
      max_tokens: 400,
      temperature: 0.4,
    });

    let reply = completion.choices[0]?.message?.content?.trim() ?? "";

    // Enforce length limit
    if (reply.length > maxLen) {
      reply = reply.slice(0, maxLen - 3) + "...";
    }

    // Safety check: if reply mentions approving/confirming/paying despite guardrails
    const lowerReply = reply.toLowerCase();
    const hasAdminAction = ["saya setujui", "saya konfirmasi", "saya tandai lunas", "sudah dikonfirmasi", "saya cancel"].some(
      (kw) => lowerReply.includes(kw)
    );
    if (hasAdminAction) {
      reply = "Tindakan tersebut hanya bisa dilakukan admin. Silakan hubungi admin kami. 🙏";
    }

    // Log: reply sent
    await logAudit({
      action: "ai_reply_sent",
      entity: "wa_ai",
      after: {
        phone: customerPhone,
        intent,
        replyLength: reply.length,
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      },
    }).catch(() => {});

    return { reply, intent, shouldHandoffToBookingFlow: false, fallbackToAdmin: false };
  } catch (err: any) {
    console.error("[aiSportCenter] OpenAI error:", err?.message);

    await logAudit({
      action: "ai_fallback_to_admin",
      entity: "wa_ai",
      after: { phone: customerPhone, reason: "openai_error", error: err?.message },
    }).catch(() => {});

    return {
      reply: "",
      intent,
      shouldHandoffToBookingFlow: false,
      fallbackToAdmin: true,
    };
  }
}

// ─── Log inbound message ──────────────────────────────────────────────────────

export async function logAiMessageReceived(phone: string, message: string, waName: string): Promise<void> {
  await logAudit({
    action: "ai_wa_message_received",
    entity: "wa_ai",
    after: { phone, message, waName },
  }).catch(() => {});
}

export async function logAiIntentDetected(phone: string, message: string, intent: AiIntent): Promise<void> {
  await logAudit({
    action: "ai_intent_detected",
    entity: "wa_ai",
    after: { phone, message, intent },
  }).catch(() => {});
}
