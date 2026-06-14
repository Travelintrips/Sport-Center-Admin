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
import { getAvailableSlotsForDay, checkSlotAvailable, getFacilityByName } from "../lib/availability";
import { calculatePrice } from "../lib/pricing";

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

━━━ ALIAS FASILITAS (PENTING) ━━━
Lapangan Multiguna adalah SATU lapangan fisik yang bisa dipakai untuk 3 olahraga berbeda:
• Basket (basketball) → Lapangan Multiguna
• Futsal → Lapangan Multiguna
• Voli / Volley (volleyball) → Lapangan Multiguna

Artinya: jika customer menyebut "futsal", "basket", atau "voli/volley", SELALU arahkan ke *Lapangan Multiguna*.
Contoh: "mau booking futsal" → gunakan Lapangan Multiguna, harga & ketersediaan sama.
Saat menampilkan info, sebutkan: "Lapangan Multiguna (Basket / Futsal / Voli)" agar customer tidak bingung.

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

━━━ CARA KIRIM LINK BOOKING ━━━
Ketika customer menanyakan ketersediaan slot DAN slot tersebut TERSEDIA (sudah kamu cek via tool), lakukan ini secara otomatis:
1. Panggil tool [calculate_booking_price] untuk hitung harga tepat
2. Panggil tool [generate_booking_link] untuk buat link pre-filled
3. Tampilkan link booking di reply dengan format:
   "✅ Slot tersedia! Berikut link booking langsung:\n🔗 [URL]\n\nLink sudah terisi otomatis dengan detail pesanan kamu. Tinggal isi nama & data diri, lalu bayar! 🎯"

Jika slot TIDAK tersedia → tawarkan cari jadwal alternatif via tool [find_next_available_dates].

━━━ GUARDRAIL MUTLAK ━━━
❌ DILARANG: mengarang data, harga, jadwal, atau fasilitas yang tidak ada di database
❌ DILARANG: menyatakan slot tersedia/kosong tanpa data ketersediaan
❌ DILARANG: approve, konfirmasi pembayaran, cancel, atau ubah status booking
❌ DILARANG: memberikan estimasi harga jika data harga tidak ada
❌ DILARANG: kirim link booking jika slot belum dikonfirmasi TERSEDIA via tool
✅ Jika ditanya sesuatu yang tidak ada datanya → jawab: "Info tersebut belum tersedia di sistem kami. Silakan tanya langsung ke admin ya 🙏"
✅ Untuk aksi admin → "Tindakan ini hanya bisa dilakukan admin. Hubungi: ${adminContact}"
✅ Untuk mulai booking → arahkan customer ketik: *booking [fasilitas] [tanggal] jam [waktu] [durasi] jam*

Bahasa: Indonesia santai + profesional. Gunakan emoji secukupnya (jangan berlebihan).
Panjang jawaban: maksimal ${maxLen} karakter. Ringkas, padat, langsung ke inti.`;
}

// ─── OpenAI Tool Definitions ──────────────────────────────────────────────────

const AI_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "check_slot_availability",
      description: "Cek apakah slot waktu tertentu tersedia untuk booking di fasilitas tertentu pada tanggal tertentu.",
      parameters: {
        type: "object",
        properties: {
          facility_name: { type: "string", description: "Nama atau kategori fasilitas, misal 'futsal', 'basket', 'badminton'" },
          date: { type: "string", description: "Tanggal dalam format YYYY-MM-DD" },
          start_time: { type: "string", description: "Jam mulai dalam format HH:MM, misal '14:00'" },
          duration_hours: { type: "number", description: "Durasi booking dalam jam, misal 2" },
        },
        required: ["facility_name", "date", "start_time", "duration_hours"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_slots",
      description: "Ambil semua slot jam yang tersedia (kosong) untuk fasilitas tertentu pada tanggal tertentu.",
      parameters: {
        type: "object",
        properties: {
          facility_name: { type: "string", description: "Nama atau kategori fasilitas" },
          date: { type: "string", description: "Tanggal dalam format YYYY-MM-DD" },
        },
        required: ["facility_name", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_booking_price",
      description: "Hitung harga booking yang tepat termasuk pricing rules (weekend, peak hour, dll).",
      parameters: {
        type: "object",
        properties: {
          facility_name: { type: "string", description: "Nama atau kategori fasilitas" },
          date: { type: "string", description: "Tanggal booking format YYYY-MM-DD (untuk deteksi weekend)" },
          start_time: { type: "string", description: "Jam mulai format HH:MM" },
          duration_hours: { type: "number", description: "Durasi dalam jam" },
        },
        required: ["facility_name", "date", "start_time", "duration_hours"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_next_available_dates",
      description: "Cari tanggal-tanggal ke depan yang masih punya slot kosong untuk fasilitas tertentu.",
      parameters: {
        type: "object",
        properties: {
          facility_name: { type: "string", description: "Nama atau kategori fasilitas" },
          from_date: { type: "string", description: "Mulai cari dari tanggal ini (YYYY-MM-DD)" },
          days_to_check: { type: "number", description: "Jumlah hari ke depan yang dicek, maks 14" },
        },
        required: ["facility_name", "from_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_booking_link",
      description: "Buat link booking yang sudah terisi otomatis (facility, tanggal, jam, durasi) untuk dikirim ke customer. Gunakan HANYA setelah ketersediaan slot SUDAH dikonfirmasi tersedia via check_slot_availability.",
      parameters: {
        type: "object",
        properties: {
          facility_name: { type: "string", description: "Nama atau kategori fasilitas" },
          date: { type: "string", description: "Tanggal booking format YYYY-MM-DD" },
          start_time: { type: "string", description: "Jam mulai format HH:MM" },
          duration_hours: { type: "number", description: "Durasi dalam jam" },
        },
        required: ["facility_name", "date", "start_time", "duration_hours"],
      },
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === "check_slot_availability") {
      const facility = await getFacilityByName(String(args.facility_name));
      if (!facility) return JSON.stringify({ error: `Fasilitas '${args.facility_name}' tidak ditemukan` });
      const available = await checkSlotAvailable(
        facility.id,
        String(args.date),
        String(args.start_time),
        Number(args.duration_hours)
      );
      const endMin =
        parseInt(String(args.start_time).split(":")[0]) * 60 +
        parseInt(String(args.start_time).split(":")[1] || "0") +
        Number(args.duration_hours) * 60;
      const endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
      return JSON.stringify({
        facility: facility.name,
        date: args.date,
        start_time: args.start_time,
        end_time: endTime,
        duration_hours: args.duration_hours,
        available,
        message: available
          ? `Slot ${args.start_time}–${endTime} TERSEDIA untuk ${facility.name}`
          : `Slot ${args.start_time}–${endTime} TIDAK TERSEDIA (sudah dipesan atau diblokir)`,
      });
    }

    if (name === "get_available_slots") {
      const facility = await getFacilityByName(String(args.facility_name));
      if (!facility) return JSON.stringify({ error: `Fasilitas '${args.facility_name}' tidak ditemukan` });
      const slots = await getAvailableSlotsForDay(
        facility.id,
        String(args.date),
        facility.openTime,
        facility.closeTime
      );
      return JSON.stringify({
        facility: facility.name,
        date: args.date,
        open_time: facility.openTime,
        close_time: facility.closeTime,
        available_slots: slots,
        total_available: slots.length,
        message:
          slots.length > 0
            ? `Slot tersedia: ${slots.join(", ")}`
            : `Tidak ada slot yang tersedia pada tanggal ini`,
      });
    }

    if (name === "calculate_booking_price") {
      const facility = await getFacilityByName(String(args.facility_name));
      if (!facility) return JSON.stringify({ error: `Fasilitas '${args.facility_name}' tidak ditemukan` });
      const startMin =
        parseInt(String(args.start_time).split(":")[0]) * 60 +
        parseInt(String(args.start_time).split(":")[1] || "0");
      const endMin = startMin + Number(args.duration_hours) * 60;
      const endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
      const price = await calculatePrice(
        facility.id,
        String(args.date),
        String(args.start_time),
        endTime,
        Number(args.duration_hours)
      );
      const fmtIDR = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
      return JSON.stringify({
        facility: facility.name,
        date: args.date,
        start_time: args.start_time,
        end_time: endTime,
        duration_hours: args.duration_hours,
        base_price: price.basePrice,
        final_price: price.finalPrice,
        base_price_formatted: fmtIDR(price.basePrice),
        final_price_formatted: fmtIDR(price.finalPrice),
        applied_rules: price.appliedRules,
        calculation: `${args.duration_hours} jam × ${fmtIDR(Number(facility.pricePerHour))}/jam = ${fmtIDR(price.basePrice)}${price.appliedRules.length > 0 ? ` → setelah pricing rules: ${fmtIDR(price.finalPrice)}` : ""}`,
      });
    }

    if (name === "find_next_available_dates") {
      const facility = await getFacilityByName(String(args.facility_name));
      if (!facility) return JSON.stringify({ error: `Fasilitas '${args.facility_name}' tidak ditemukan` });
      const daysToCheck = Math.min(Number(args.days_to_check ?? 7), 14);
      const results: Array<{ date: string; available_slots: string[] }> = [];
      const fromDate = new Date(String(args.from_date) + "T00:00:00+07:00");
      for (let i = 0; i < daysToCheck; i++) {
        const d = new Date(fromDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        const slots = await getAvailableSlotsForDay(facility.id, dateStr, facility.openTime, facility.closeTime);
        if (slots.length > 0) results.push({ date: dateStr, available_slots: slots });
        if (results.length >= 5) break; // Cukup 5 hari yang ada slot
      }
      return JSON.stringify({
        facility: facility.name,
        dates_with_availability: results,
        summary:
          results.length > 0
            ? results.map((r) => `${r.date}: ${r.available_slots.join(", ")}`).join(" | ")
            : `Tidak ada slot tersedia dalam ${daysToCheck} hari ke depan`,
      });
    }

    if (name === "generate_booking_link") {
      const facility = await getFacilityByName(String(args.facility_name));
      if (!facility) return JSON.stringify({ error: `Fasilitas '${args.facility_name}' tidak ditemukan` });
      const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
      const params = new URLSearchParams({
        facilityId: String(facility.id),
        date: String(args.date),
        startTime: String(args.start_time),
        duration: String(args.duration_hours),
        source: "mina",
      });
      const bookingUrl = `${appUrl}/booking?${params.toString()}`;
      const startMin =
        parseInt(String(args.start_time).split(":")[0]) * 60 +
        parseInt(String(args.start_time).split(":")[1] || "0");
      const endMin = startMin + Number(args.duration_hours) * 60;
      const endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
      return JSON.stringify({
        facility: facility.name,
        date: args.date,
        start_time: args.start_time,
        end_time: endTime,
        duration_hours: args.duration_hours,
        booking_url: bookingUrl,
        message: `Link booking sudah siap untuk ${facility.name} tanggal ${args.date} jam ${args.start_time}–${endTime}`,
      });
    }

    return JSON.stringify({ error: `Tool '${name}' tidak dikenal` });
  } catch (err: any) {
    return JSON.stringify({ error: err?.message ?? "Tool execution error" });
  }
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
    return { reply: "", intent: "general_question", shouldHandoffToBookingFlow: false, fallbackToAdmin: true };
  }

  const intent = detectIntent(message);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

  // Load DB context (static snapshot — tools will supplement with real-time data)
  const ctx = await loadDbContext(customerPhone);

  await logAudit({
    action: "ai_db_context_loaded",
    entity: "wa_ai",
    after: { phone: customerPhone, intent, facilitiesCount: ctx.facilities.length },
  }).catch(() => {});

  // ── Guardrail shortcuts (no OpenAI needed) ────────────────────────────────
  if (intent === "admin_action_attempt") {
    await logAudit({ action: "ai_fallback_to_admin", entity: "wa_ai", after: { phone: customerPhone, reason: "admin_action_attempt" } }).catch(() => {});
    return {
      reply: "Tindakan tersebut hanya bisa dilakukan oleh admin. Silakan hubungi admin kami untuk bantuan lebih lanjut. 🙏",
      intent, shouldHandoffToBookingFlow: false, fallbackToAdmin: true,
    };
  }

  if (intent === "talk_to_admin") {
    const adminContact = ctx.settings.whatsapp || ctx.settings.phone || "";
    const reply = adminContact
      ? `👋 Baik, saya hubungkan Anda dengan admin kami.\n\n📞 *Admin WhatsApp:* ${adminContact}\n\nJam operasional: *${ctx.settings.openHour}–${ctx.settings.closeHour}*. 🙏`
      : `👋 Untuk berbicara langsung dengan admin, silakan hubungi kami melalui kontak di website.\n\nJam operasional: *${ctx.settings.openHour}–${ctx.settings.closeHour}*.`;
    await logAudit({ action: "ai_talk_to_admin", entity: "wa_ai", after: { phone: customerPhone } }).catch(() => {});
    return { reply, intent, shouldHandoffToBookingFlow: false, fallbackToAdmin: false };
  }

  if (intent === "booking_intent") {
    return { reply: "", intent, shouldHandoffToBookingFlow: true, fallbackToAdmin: false };
  }

  // ── Build OpenAI messages ─────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(ctx, customerPhone, today);
  const maxLen = parseInt(process.env.AI_SPORTCENTER_MAX_REPLY_LENGTH ?? "900", 10);
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  const openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  // ── Hybrid model routing ──────────────────────────────────────────────────
  // Intent sederhana (jawaban pendek, tidak butuh tool/kalkulasi) → gpt-4o-mini (hemat)
  // Intent kompleks (butuh tool call, kalkulasi harga, reasoning) → gpt-4o (akurat)
  const SIMPLE_INTENTS: AiIntent[] = [
    "operating_hours",
    "contact_info",
    "payment_info",
    "ask_reschedule_policy",
    "promo_inquiry",
    "facility_info",
  ];
  const COMPLEX_INTENTS: AiIntent[] = [
    "price_inquiry",
    "availability_check",
    "status_check",
    "membership_inquiry",
    "general_question",
  ];

  const envModel = process.env.OPENAI_MODEL;
  const miniModel = baseURL?.includes("openrouter") ? "openai/gpt-4o-mini" : "gpt-4o-mini";
  const fullModel = baseURL?.includes("openrouter") ? "openai/gpt-4o" : "gpt-4o";

  let model: string;
  if (envModel) {
    // Jika env OPENAI_MODEL di-set manual, selalu pakai itu (override)
    model = envModel;
  } else if (SIMPLE_INTENTS.includes(intent)) {
    model = miniModel;
  } else if (COMPLEX_INTENTS.includes(intent)) {
    model = fullModel;
  } else {
    model = miniModel; // default fallback
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-8),
    { role: "user", content: message },
  ];

  try {
    // ── Tool-calling loop (max 4 rounds) ──────────────────────────────────
    let toolCallsUsed = 0;
    const MAX_TOOL_ROUNDS = 4;

    while (toolCallsUsed < MAX_TOOL_ROUNDS) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: 600,
        temperature: 0.3,
        tools: AI_TOOLS,
        tool_choice: "auto",
      });

      const choice = completion.choices[0];
      const assistantMsg = choice.message;

      // No tool calls → final answer
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        let reply = assistantMsg.content?.trim() ?? "";
        if (reply.length > maxLen) reply = reply.slice(0, maxLen - 3) + "...";

        // Admin-action safety net
        if (["saya setujui", "saya konfirmasi", "saya tandai lunas", "saya cancel"].some((kw) => reply.toLowerCase().includes(kw))) {
          reply = "Tindakan tersebut hanya bisa dilakukan admin. Silakan hubungi admin kami. 🙏";
        }

        await logAudit({
          action: "ai_reply_sent",
          entity: "wa_ai",
          after: { phone: customerPhone, intent, replyLength: reply.length, toolCallsUsed, model },
        }).catch(() => {});

        return { reply, intent, shouldHandoffToBookingFlow: false, fallbackToAdmin: false };
      }

      // Has tool calls → execute each, push results, loop
      messages.push(assistantMsg as OpenAI.Chat.ChatCompletionMessageParam);

      for (const tc of assistantMsg.tool_calls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tcAny = tc as any;
        const fnName: string = tcAny.function?.name ?? "";
        const fnArgs: string = tcAny.function?.arguments ?? "{}";
        let toolArgs: Record<string, unknown> = {};
        try { toolArgs = JSON.parse(fnArgs); } catch { /* ignore */ }
        const result = await executeTool(fnName, toolArgs);
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }

      toolCallsUsed++;
    }

    // Exceeded max rounds — ask for final answer without tools
    const fallbackCompletion = await openai.chat.completions.create({
      model, messages, max_tokens: 500, temperature: 0.3,
    });
    let reply = fallbackCompletion.choices[0]?.message?.content?.trim() ?? "";
    if (reply.length > maxLen) reply = reply.slice(0, maxLen - 3) + "...";
    return { reply, intent, shouldHandoffToBookingFlow: false, fallbackToAdmin: false };

  } catch (err: any) {
    console.error("[aiSportCenter] OpenAI error:", err?.message);
    await logAudit({
      action: "ai_fallback_to_admin",
      entity: "wa_ai",
      after: { phone: customerPhone, reason: "openai_error", error: err?.message },
    }).catch(() => {});
    return { reply: "", intent, shouldHandoffToBookingFlow: false, fallbackToAdmin: true };
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
