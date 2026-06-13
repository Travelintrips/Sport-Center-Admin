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
  | "ask_reschedule_policy"
  | "talk_to_admin"
  | "admin_action_attempt"
  | "general_question"
  | "out_of_scope";

export function detectIntent(msg: string): AiIntent {
  const lower = msg.toLowerCase().trim();

  // ── Admin action attempts (highest priority) ──────────────────────────────
  if (ADMIN_ONLY_ACTIONS.some((a) => lower.includes(a))) return "admin_action_attempt";

  // ── Talk to human admin ───────────────────────────────────────────────────
  if (/\b(hubungi admin|bicara admin|minta admin|butuh admin|talk to admin|admin langsung|customer service|cs sport|sambungkan admin|minta tolong admin|operator|tanya admin|chat admin|ke admin|sama admin|via admin|telfon admin|telp admin)\b/.test(lower)) return "talk_to_admin";

  // ── Reschedule / change booking ───────────────────────────────────────────
  if (/\b(reschedule|jadwal ulang|ganti jadwal|ubah jadwal|pindah jadwal|ganti tanggal|ubah tanggal|pindah tanggal|ubah jam|ganti jam|pindah jam|kebijakan reschedule|policy reschedule|mau ganti|pengen ganti|ngerubah jadwal|geser jadwal|geser tanggal|geser jam|mau ubah|bisa ganti|bisa ubah|bisa pindah)\b/.test(lower)) return "ask_reschedule_policy";

  // ── Informational — checked BEFORE booking_intent ─────────────────────────

  // Price inquiry
  if (/\b(harga|tarif|biaya|berapa|price|cost|sewa berapa|bayar berapa|ongkos|rate|mahal|murah|seberapa)\b/.test(lower)) return "price_inquiry";

  // Promo / discount
  if (/\b(promo|diskon|voucher|kode promo|potongan|cashback|promo apa|ada diskon|ada promo|kupon|coupon|hemat|gratis|promo hari ini|diskon berapa)\b/.test(lower)) return "promo_inquiry";

  // Availability check — "mana yang kosong", "masih ada slot", "jam berapa kosong"
  if (/\b(slot|kosong|tersedia|available|ada slot|jam berapa bisa|kapan bisa|masih ada|masih bisa|ada yang kosong|sudah penuh|penuh gak|penuh ga|cek slot|cek ketersediaan|lihat slot|pilih jam|jam mana|hari mana)\b/.test(lower)) return "availability_check";

  // Payment info
  if (/\b(cara bayar|rekening|no rek|transfer ke|bank apa|qris|cara pembayaran|nomor rekening|rek berapa|transfer kemana|bayar lewat|metode bayar|bayar pakai|kirim bukti|upload bukti|bukti transfer|bukti bayar)\b/.test(lower)) return "payment_info";

  // Operating hours
  if (/\b(jam buka|jam tutup|buka jam|hari apa|operasional|buka sampai|jam berapa buka|buka gak|buka hari ini|tutup jam|kapan buka|kapan tutup|jam operasional|libur gak|hari libur|weekend buka|hari minggu buka)\b/.test(lower)) return "operating_hours";

  // Contact / location
  if (/\b(alamat|lokasi|dimana|di mana|contact|kontak|nomor telepon|wa admin|google maps|maps|rute|denah|petunjuk arah|jalan apa|deket mana|sekitar|koordinat|gps|pin lokasi|tempat)\b/.test(lower)) return "contact_info";

  // Status check — "cek order", "udah dikonfirmasi belum", "booking aku"
  if (/\b(status|order saya|pesanan saya|cek booking|sudah bayar|sudah lunas|booking saya|invoice|sudah diterima|sudah dikonfirmasi|udah konfirmasi|udah lunas|sudah selesai|kapan dikonfirmasi|order aku|booking aku|cek order|nomor order|no order|update dong|update status)\b/.test(lower)) return "status_check";

  // Membership
  if (/\b(member|membership|langganan|daftar member|paket member|kartu member|member ship|berlangganan|join member|mau member|daftar berlangganan|paket bulanan|paket tahunan)\b/.test(lower)) return "membership_inquiry";

  // Facility info — "ada lapangan apa aja", "fasilitas apa"
  if (/\b(fasilitas apa|ada apa aja|list fasilitas|lapangan apa saja|apa saja|ada lapangan|tersedia apa|fasilitas ada|ada gym|ada kolam|ada futsal|ada basket|ada badminton|sport apa|olahraga apa|ada sport|pilihan fasilitas)\b/.test(lower)) return "facility_info";

  // ── Booking intent — last resort (many natural language variations) ────────
  // Explicit action verbs
  if (/\b(mau book|mau pesan|mau sewa|mau booking|mau reservasi|mau daftar|saya booking|reservasi|pesan lapangan|book lapangan|booking lapangan|mulai booking|mau main|pengen main|ingin main|mau nge-book|ngebook|ngebuking|mau ngebook|mau ngebuking)\b/.test(lower)) return "booking_intent";
  // Typos / informal
  if (/\b(boking|bookingg|bookng|pesenin|pesen|mesen)\b/.test(lower)) return "booking_intent";
  // "booking" anywhere except status-related
  if (/\bbooking\b/.test(lower) && !/booking saya|status booking|cek booking|update booking|info booking/.test(lower)) return "booking_intent";
  // Casual: "mau main basket besok", "rencananya mau futsal"
  if (/\b(mau main|pengen main|ingin main|rencana main|besok main|plan main|jadwal main|mau bermain|pengen olahraga|mau olahraga)\b/.test(lower)) return "booking_intent";
  // "sewa lapangan", "sewa gym" dsb
  if (/\b(sewa lapangan|sewa gym|sewa kolam|sewa court|sewa space|pakai lapangan|pinjam lapangan)\b/.test(lower)) return "booking_intent";

  return "general_question";
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(ctx: AiContext, customerPhone: string, today: string): string {
  const fmtIDR = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  const facilitiesText = ctx.facilities.map((f) => {
    const rules = f.pricingRules.length > 0
      ? ` | pricing: ${f.pricingRules.map((r) =>
          `${r.name}(${r.ruleType}${r.dayType ? "/" + r.dayType : ""}${r.peakStartTime ? " " + r.peakStartTime + "-" + r.peakEndTime : ""}: ${r.priceOverride ? "override " + fmtIDR(r.priceOverride) : ""}${r.priceAddon ? "+addon " + fmtIDR(r.priceAddon) : ""}${r.priceMultiplier ? "×" + r.priceMultiplier : ""})`
        ).join("; ")}`
      : "";
    return `  • ${f.name} (${f.category}): ${fmtIDR(f.pricePerHour)}/jam | buka ${f.openTime}–${f.closeTime} | min ${f.minDuration}j${f.maxDuration ? " max " + f.maxDuration + "j" : ""}${f.capacity ? " | kap. " + f.capacity + " org" : ""}${rules}`;
  }).join("\n");

  const promosText = ctx.activePromos.length > 0
    ? ctx.activePromos.map((p) => {
        const disc = p.discountPercent ? `${p.discountPercent}%` : p.discountAmount ? fmtIDR(p.discountAmount) : "-";
        return `  • ${p.title}${p.code ? " [kode: " + p.code + "]" : ""}: diskon ${disc}${p.minPurchase ? " (min " + fmtIDR(p.minPurchase) + ")" : ""}${p.endDate ? " s/d " + p.endDate : ""}`;
      }).join("\n")
    : "  Tidak ada promo aktif.";

  const bookingsText = ctx.customerBookings.length > 0
    ? ctx.customerBookings.map((b) =>
        `  • ${b.orderNumber}: ${b.facilityName} | ${b.bookingDate} ${b.startTime}–${b.endTime} | ${fmtIDR(b.totalPrice)} | ${b.status.replace(/_/g, " ").toUpperCase()}`
      ).join("\n")
    : "  Belum ada riwayat booking dari nomor ini.";

  const membershipText = ctx.customerMembership
    ? `  Member aktif: ${ctx.customerMembership.name} | ${ctx.customerMembership.startDate} s/d ${ctx.customerMembership.endDate} | status: ${ctx.customerMembership.status}`
    : "  Tidak ada data membership.";

  const paymentText = ctx.settings.bankName
    ? `Bank: ${ctx.settings.bankName} | Rek: ${ctx.settings.bankAccount} | a/n: ${ctx.settings.bankAccountName}`
    : "Informasi rekening belum dikonfigurasi.";

  const adminContact = ctx.settings.whatsapp || ctx.settings.phone || "Admin";
  const maxLen = process.env.AI_SPORTCENTER_MAX_REPLY_LENGTH ?? 900;

  return `Kamu adalah *Mina*, asisten AI resmi ${ctx.settings.centerName} yang melayani customer via WhatsApp. Kamu ramah, cepat tanggap, dan sangat memahami bahasa Indonesia sehari-hari — termasuk singkatan, typo, dan bahasa gaul.

━━━ KONTEKS HARI INI ━━━
📅 Hari ini: ${today}
🕐 Jam operasional: ${ctx.settings.openHour}–${ctx.settings.closeHour} WIB
📍 Alamat: ${ctx.settings.address || "Belum diisi"}
📱 Kontak admin: ${adminContact}

━━━ FASILITAS TERSEDIA ━━━
${facilitiesText || "Belum ada data fasilitas."}

━━━ KETERSEDIAAN SLOT ━━━
${ctx.availabilityNote}

━━━ PROMO AKTIF ━━━
${promosText}

━━━ DATA CUSTOMER INI (${customerPhone}) ━━━
Riwayat booking:
${bookingsText}
Membership: ${membershipText}

━━━ CARA PEMBAYARAN ━━━
Transfer bank: ${paymentText}
Setelah transfer, customer upload bukti di link yang dikirim bot. Admin akan konfirmasi dalam 1×24 jam.

━━━ KEBIJAKAN RESCHEDULE & PEMBATALAN ━━━
• Reschedule: hubungi admin min. 24 jam sebelum jadwal main via WA (${adminContact})
• Batal < 24 jam sebelum jadwal: kena biaya admin 50%
• Batal H-1 atau lebih awal: booking hangus, tidak ada refund
• Admin bantu carikan slot alternatif yang kosong

━━━ CARA MINA BERPIKIR (REASONING STEPS) ━━━
Sebelum menjawab, lakukan langkah ini secara internal:
1. Pahami MAKSUD SEBENARNYA customer, bukan hanya kata per kata. Contoh: "kapan bisa main basket?" = cek ketersediaan, bukan tanya jam buka.
2. Cari informasi relevan dari data di atas.
3. Hitung jika perlu (harga × durasi, jam mulai + durasi = jam selesai, dll).
4. Berikan jawaban yang LANGSUNG BERGUNA — jangan tanya balik jika jawabannya sudah ada di data.
5. Jika ada info yang kurang, baru tanya satu pertanyaan paling penting saja.

━━━ PEMAHAMAN BAHASA MANUSIA ━━━
Kenali variasi berikut dan tangani dengan cerdas:
• "mau main" / "pengen main" / "rencana main" = niat booking
• "berapa sih" / "kira-kira berapa" / "mahal gak" = tanya harga
• "masih ada" / "udah penuh" / "kosong gak" = cek ketersediaan
• "sd" / "s/d" / "sampai" / "hingga" = rentang waktu
• "tgl" / "tggl" = tanggal
• "jam" / "pukul" / "pk" = waktu
• Angka tanpa "jam" setelah konteks waktu = tetap jam (contoh: "jam 4 sd 6 sore" → 16:00–18:00)
• "sore" = +12 jika jam < 12 (misal: "4 sore" = 16:00)
• "pagi" = jam 05:00–11:00, "siang" = 11:00–14:00, "sore" = 14:00–18:00, "malam" = 18:00–23:00
• Typo umum: "boking" "bookingg" "fasilitad" "badmintun" "futsl" — tetap pahami maksudnya
• Bahasa campuran (Inggris+Indonesia) adalah normal, jawab dalam bahasa yang sama dengan customer

━━━ KEMAMPUAN KALKULASI ━━━
Kamu BISA dan HARUS menghitung:
• Harga total = harga/jam × durasi (jam)
• Jam selesai = jam mulai + durasi
• Jika ada pricing rule (weekend/peak hours), sesuaikan harga secara otomatis
• Tampilkan perhitungan dengan jelas: "2 jam × Rp 150.000 = *Rp 300.000*"

━━━ CONTOH PERCAKAPAN IDEAL ━━━

Contoh 1 — Tanya harga sekaligus cek slot:
Customer: "badminton besok jam 3 sore masih kosong gak? berapa harganya?"
Mina: "Hai! 🏸 Cek dulu ya...\n\n📋 *Lapangan Badminton*\nHarga: Rp 75.000/jam\nBesok (${today}): [cek dari data ketersediaan]\n\n⏰ Jam 15:00–selesai — tergantung durasi berapa jam?\nKalau 2 jam: 15:00–17:00 = *Rp 150.000*\n\nKetik *booking badminton besok jam 15 2 jam* untuk lanjut booking! 🎯"

Contoh 2 — Rentang waktu lengkap:
Customer: "mau booking futsal 17 juni jam 4 sd jam 6 sore"
Mina: "Siap! ⚽ Detail booking:\n📅 17 Juni | ⏰ 16:00–18:00 (2 jam)\n💰 [harga × 2 jam]\n\nKetik *booking futsal 17 juni jam 16 2 jam* untuk lanjutkan! 🚀"

Contoh 3 — Pertanyaan ambigu, tanya satu hal saja:
Customer: "mau main basket"
Mina: "Halo! 🏀 Mau booking Lapangan Basket?\nHarga: Rp X/jam | Buka [jam operasional]\n\nMau main tanggal berapa & jam berapa? Sebutkan sekaligus biar langsung saya bantu! 😊"

Contoh 4 — Status booking:
Customer: "udah dikonfirmasi belum pesanan saya?"
Mina: [cek riwayat booking customer dari data] → tampilkan status terbaru dengan nomor order dan status saat ini.

━━━ GUARDRAIL MUTLAK ━━━
❌ DILARANG: mengarang data, harga, jadwal, atau fasilitas yang tidak ada di database
❌ DILARANG: menyatakan slot tersedia/kosong tanpa data ketersediaan
❌ DILARANG: approve, konfirmasi pembayaran, cancel, atau ubah status booking
❌ DILARANG: memberikan estimasi harga jika data harga tidak ada
✅ Jika ditanya sesuatu yang tidak ada datanya → jawab: "Info tersebut belum tersedia di sistem kami. Silakan tanya langsung ke admin ya 🙏"
✅ Untuk aksi admin → "Tindakan ini hanya bisa dilakukan admin. Hubungi: ${adminContact}"
✅ Untuk mulai booking → arahkan customer ketik: *booking [fasilitas] [tanggal] jam [waktu] [durasi] jam*

Bahasa: Indonesia santai + profesional. Gunakan emoji secukupnya (jangan berlebihan).
Panjang jawaban: maksimal ${maxLen} karakter. Ringkas, padat, langsung ke inti.`;
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

  // Extract date from message — support ISO, slash/dash, and Indonesian month names
  const MONTH_MAP: Record<string, string> = {
    januari: "01", jan: "01", februari: "02", feb: "02",
    maret: "03", mar: "03", april: "04", apr: "04",
    mei: "05", may: "05", juni: "06", jun: "06",
    juli: "07", jul: "07", agustus: "08", agu: "08",
    september: "09", sep: "09", oktober: "10", okt: "10",
    november: "11", nov: "11", desember: "12", des: "12",
  };
  let requestedDate: string | undefined;
  const isoMatch = message.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    requestedDate = isoMatch[1];
  } else {
    const idMonthMatch = message.toLowerCase().match(/(\d{1,2})\s+(januari|jan|februari|feb|maret|mar|april|apr|mei|may|juni|jun|juli|jul|agustus|agu|september|sep|oktober|okt|november|nov|desember|des)/);
    if (idMonthMatch) {
      const day = idMonthMatch[1].padStart(2, "0");
      const month = MONTH_MAP[idMonthMatch[2]] ?? "01";
      const year = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 4);
      requestedDate = `${year}-${month}-${day}`;
    } else {
      const slashMatch = message.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
      if (slashMatch) {
        const day = slashMatch[1].padStart(2, "0");
        const month = slashMatch[2].padStart(2, "0");
        const year = slashMatch[3] ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 4);
        requestedDate = `${year}-${month}-${day}`;
      }
    }
  }

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

  // talk_to_admin — return admin contact without calling OpenAI
  if (intent === "talk_to_admin") {
    const ctx = await loadDbContext(customerPhone);
    const adminContact = ctx.settings.whatsapp || ctx.settings.phone || "";
    const reply = adminContact
      ? `👋 Baik, saya hubungkan Anda dengan admin kami.\n\n📞 *Admin WhatsApp:* ${adminContact}\n\nSilakan hubungi admin langsung untuk bantuan lebih lanjut. Jam operasional: *${ctx.settings.openHour}–${ctx.settings.closeHour}*. 🙏`
      : `👋 Untuk berbicara langsung dengan admin, silakan hubungi kami melalui kontak yang tertera di website.\n\nJam operasional: *${ctx.settings.openHour}–${ctx.settings.closeHour}*.`;
    await logAudit({
      action: "ai_talk_to_admin",
      entity: "wa_ai",
      after: { phone: customerPhone, message },
    }).catch(() => {});
    return { reply, intent, shouldHandoffToBookingFlow: false, fallbackToAdmin: false };
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
    // Last 8 turns of history — enough context to track multi-step conversations
    ...conversationHistory.slice(-8),
    { role: "user", content: message },
  ];

  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  const openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  // Model: OpenRouter pakai format "openai/gpt-4o-mini", direct OpenAI pakai "gpt-4o-mini"
  const model = process.env.OPENAI_MODEL ?? (baseURL?.includes("openrouter") ? "openai/gpt-4o-mini" : "gpt-4o-mini");

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: 500,
      temperature: 0.3,
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
