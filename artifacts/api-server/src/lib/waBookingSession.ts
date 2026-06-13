import { db, waBookingSessionsTable, usersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";

export type WaStep =
  | "ask_facility"
  | "ask_date"
  | "ask_time"
  | "ask_duration"
  | "ask_name"
  | "confirm"
  | "done";

export type WaSessionStatus = "active" | "completed" | "expired" | "cancelled";

export type BookingContext = "friend" | "member" | "corporate" | null;

export interface ParsedIntent {
  facilityKeyword: string | null;
  bookingDate: string | null;
  startTime: string | null;
  durationMinutes: number | null;
  personName: string | null;
  bookingContext: BookingContext;
}

// ─── Date Helpers (WIB = UTC+7) ──────────────────────────────────────────────

export function todayWIB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00+07:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

const DAY_NAMES: Record<string, number> = {
  minggu: 0, ahad: 0,
  senin: 1, senen: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5, jum: 5,
  sabtu: 6,
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, maret: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  agu: 8, agustus: 8,
  sep: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  des: 12, desember: 12,
};

function nextDayOfWeek(dayIndex: number): string {
  const today = todayWIB();
  const d = new Date(today + "T00:00:00+07:00");
  const current = d.getDay();
  let diff = dayIndex - current;
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function parseDate(lower: string): string | null {
  if (/hari ini|sekarang|today/.test(lower)) return todayWIB();
  if (/\blusa\b/.test(lower)) return addDays(todayWIB(), 2);
  if (/\bbesok\b|\btomorrow\b/.test(lower)) return addDays(todayWIB(), 1);

  // "minggu depan"
  const mingDepanMatch = lower.match(/(\w+)\s+depan/);
  if (mingDepanMatch) {
    const dayIdx = DAY_NAMES[mingDepanMatch[1]];
    if (dayIdx !== undefined) {
      const base = nextDayOfWeek(dayIdx);
      return addDays(base, 7);
    }
  }

  // "hari senin" / "senin"
  for (const [name, idx] of Object.entries(DAY_NAMES)) {
    if (lower.includes(name)) {
      return nextDayOfWeek(idx);
    }
  }

  // "tanggal 15 juni" / "15 juni" / "15/06" / "15-06"
  const dateWithMonth = lower.match(/(\d{1,2})\s+([a-z]+)/);
  if (dateWithMonth) {
    const day = parseInt(dateWithMonth[1], 10);
    const monthKey = dateWithMonth[2].substring(0, 3);
    const month = MONTH_NAMES[monthKey] ?? MONTH_NAMES[dateWithMonth[2]];
    if (month && day >= 1 && day <= 31) {
      const today = todayWIB();
      const year = new Date(today + "T00:00:00+07:00").getFullYear();
      const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (candidate >= today) return candidate;
      return `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // "15/06/2026" or "15-06-2026" or "15/6"
  const slashDate = lower.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
  if (slashDate) {
    const day = parseInt(slashDate[1], 10);
    const month = parseInt(slashDate[2], 10);
    const today = todayWIB();
    const year = slashDate[3]
      ? parseInt(slashDate[3], 10)
      : new Date(today + "T00:00:00+07:00").getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // "tanggal 15"
  const justDay = lower.match(/tanggal\s+(\d{1,2})/);
  if (justDay) {
    const day = parseInt(justDay[1], 10);
    const today = todayWIB();
    const d = new Date(today + "T00:00:00+07:00");
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (candidate >= today) return candidate;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

function parseTime(lower: string): string | null {
  // Priority 1: "jam 20.00" / "jam 20:00" / "pukul 20.00"
  const withPrefix = lower.match(/(?:jam|pukul)\s+(\d{1,2})(?:[.:](\d{2}))?(?:\s+(malam|sore|pagi|siang))?/);
  if (withPrefix) {
    let h = parseInt(withPrefix[1], 10);
    const m = withPrefix[2] ? parseInt(withPrefix[2], 10) : 0;
    const period = withPrefix[3];
    if (period === "malam" && h < 12) h += 12;
    else if (period === "sore" && h < 12) h += 12;
    else if (period === "siang" && h < 12) h = 12;
    else if (period === "pagi" && h === 12) h = 0;
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  // Priority 2: "7 malam" / "8 pagi" / "3 sore" (tanpa prefix jam/pukul)
  const withPeriod = lower.match(/\b(\d{1,2})\s+(malam|sore|pagi|siang)\b/);
  if (withPeriod) {
    let h = parseInt(withPeriod[1], 10);
    const period = withPeriod[2];
    if (period === "malam" && h < 12) h += 12;
    else if (period === "sore" && h < 12) h += 12;
    else if (period === "siang" && h < 12) h = 12;
    else if (period === "pagi" && h === 12) h = 0;
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, "0")}:00`;
    }
  }

  // Priority 3: Standalone "20:00" or "20.00" (2-digit hours with separator)
  const standalone = lower.match(/\b([01]?\d|2[0-3])[.:]([0-5]\d)\b/);
  if (standalone) {
    const h = parseInt(standalone[1], 10);
    const m = parseInt(standalone[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  return null;
}

function parseDuration(lower: string): number | null {
  // "1.5 jam" / "1,5 jam"
  const fracMatch = lower.match(/(\d+)[.,](\d+)\s*jam/);
  if (fracMatch) {
    const hours = parseFloat(`${fracMatch[1]}.${fracMatch[2]}`);
    return Math.round(hours * 60);
  }

  // "2 jam"
  const jamMatch = lower.match(/(\d+)\s*jam/);
  if (jamMatch) return parseInt(jamMatch[1], 10) * 60;

  // "90 menit" / "30 menit"
  const menitMatch = lower.match(/(\d+)\s*menit/);
  if (menitMatch) return parseInt(menitMatch[1], 10);

  return null;
}

// Parse "jam 4 sd jam 6 sore", "4 sore sampai 6 sore", "16:00 - 18:00", etc.
// Returns startTime + durationMinutes derived from a start–end range expression.
function parseTimeRange(lower: string): { startTime: string; durationMinutes: number } | null {
  // Capture: [jam/pukul] <start>[.:]<min> [period] <separator> [jam/pukul] <end>[.:]<min> [period]
  const rangeRe =
    /(?:jam|pukul)?\s*(\d{1,2})(?:[.:](\d{2}))?\s*(sore|malam|pagi|siang)?\s*(?:sd|s\/d|sampai|hingga|[-–])\s*(?:jam|pukul)?\s*(\d{1,2})(?:[.:](\d{2}))?\s*(sore|malam|pagi|siang)?/;
  const m = lower.match(rangeRe);
  if (!m) return null;

  let startH = parseInt(m[1], 10);
  const startM = m[2] ? parseInt(m[2], 10) : 0;
  const startPeriod = m[3];
  let endH = parseInt(m[4], 10);
  const endM = m[5] ? parseInt(m[5], 10) : 0;
  const endPeriod = m[6];

  // The trailing period (e.g. "sore") applies to both if neither has its own period
  const effectivePeriod = endPeriod ?? startPeriod;

  const applyPeriod = (h: number, period: string | undefined): number => {
    if (!period) return h;
    if ((period === "sore" || period === "malam") && h < 12) return h + 12;
    // "siang" = daytime, hours 10-14 are already correct — only fix h=0 edge case
    if (period === "siang" && h === 0) return 12;
    if (period === "pagi" && h === 12) return 0;
    return h;
  };

  startH = applyPeriod(startH, startPeriod ?? effectivePeriod);
  endH = applyPeriod(endH, endPeriod ?? effectivePeriod);

  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;
  const durationMinutes = endTotal - startTotal;
  if (durationMinutes <= 0 || startH < 0 || startH > 23 || endH < 0 || endH > 23) return null;

  return {
    startTime: `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`,
    durationMinutes,
  };
}

const FACILITY_KEYWORDS: Record<string, string[]> = {
  serbaguna: ["serbaguna", "multiguna", "lapangan serbaguna", "lapangan multiguna", "hall", "aula", "futsal", "sepak bola", "bola", "mini soccer"],
  basket: ["basket", "basketball", "bola basket"],
  badminton: ["badminton", "bulutangkis", "bulu tangkis", "shuttle", "cock"],
  tennis: ["tennis", "tenis"],
  gym: ["gym", "fitness", "fitnes"],
  voli: ["voli", "volley", "volleyball", "bola voli"],
  renang: ["renang", "kolam", "swimming"],
  squash: ["squash"],
  golf: ["golf"],
  billiard: ["billiard", "biliar", "bilyard"],
};

export function detectFacilityKeyword(msg: string): string | null {
  const lower = msg.toLowerCase();
  for (const [key, kws] of Object.entries(FACILITY_KEYWORDS)) {
    if (kws.some((kw) => lower.includes(kw))) return key;
  }
  return null;
}

// ─── Name Parser ─────────────────────────────────────────────────────────────
// Supports: personal name, member name, company/institution name
// Examples:
//   "untuk teman saya Budi"    → "Budi"         context=friend
//   "atas nama PT Maju Jaya"   → "PT Maju Jaya" context=corporate
//   "member Sinta Dewi"        → "Sinta Dewi"   context=member
//   "a/n CV Berkah Abadi"      → "CV Berkah Abadi" context=corporate

// Stop words — extraction halts when one of these is encountered
const NAME_STOP_WORDS = new Set([
  // Pronouns / self-reference
  "saya", "aku", "gue", "gw", "gua", "kamu", "anda", "dia", "mereka",
  "kita", "kami", "kalian", "sendiri",
  // Relationship words without a name after
  "adik", "kakak", "abang", "bang", "mas", "mbak", "pak", "bu", "om", "tante",
  "saudara", "ayah", "ibu", "bapak", "mama", "papa", "ortu",
  // Booking / time keywords
  "mau", "bisa", "akan", "sudah", "lagi", "ingin", "pengen", "pengin",
  "main", "maen", "bermain", "olahraga", "booking", "boking", "pesan", "sewa",
  "jam", "pukul", "pk", "tanggal", "tgl", "hari", "besok", "lusa", "sekarang",
  "lapangan", "fasilitas", "futsal", "basket", "badminton", "gym", "voli",
  "tennis", "tenis", "renang", "golf", "squash", "billiard",
  // Filler
  "dong", "ya", "nih", "deh", "sih", "yg", "yang", "aja", "juga", "sama",
]);

// Company/institution prefixes that trigger company-name extraction mode
const COMPANY_PREFIX_RE = /^(pt|cv|ud|pd|fa|koperasi|yayasan|lembaga|dinas|badan|balai|komite|perkumpulan|organisasi|komunitas)\b/i;

function extractNameWords(raw: string): string | null {
  const words = raw.trim().split(/\s+/);
  const result: string[] = [];
  for (const w of words) {
    const wl = w.toLowerCase().replace(/[^a-z]/g, "");
    if (!wl || NAME_STOP_WORDS.has(wl)) break;
    if (!/^[A-Za-z]+$/.test(w)) break;               // non-alphabetic char → stop
    result.push(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    if (result.length >= 4) break;                    // max 4 name words
  }
  if (result.length === 0) return null;
  const name = result.join(" ");
  return name.length >= 2 ? name : null;
}

/**
 * Extract a company/institution name from a raw string.
 * Company names can contain numbers and punctuation, so extraction is more permissive.
 * Returns null if `raw` doesn't start with a known company prefix.
 */
function extractCompanyName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!COMPANY_PREFIX_RE.test(trimmed)) return null;
  // Strip trailing filler ONLY when preceded by whitespace (avoids cutting "Jaya" → "Ja")
  const cleaned = trimmed
    .replace(/\s+(?:ya|dong|nih|deh|sih)$/i, "")         // trailing filler words
    .replace(/,?\s*(?:mau|bisa|besok|jam\s+\d|tanggal\s|\d{2}\s).*$/i, "") // inline keywords
    .trim();
  if (cleaned.length < 3) return null;
  // Title-case each word in the company name
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function parseName(msg: string): string | null {
  const lower = msg.toLowerCase().trim();

  // Bail out immediately for self-booking phrases
  if (/\b(?:untuk|atas nama|buat)\s+(?:saya|aku|gue|gw|gua)\s*(?:sendiri)?\b/.test(lower)) return null;

  // ── Company/institution patterns ──────────────────────────────────────────

  // "atas nama PT Maju Jaya" / "a/n CV Berkah" / "atas nama Koperasi ABC"
  const atasNamaRaw = lower.match(/(?:atas\s+nama|a\/n)\s+(.+)/);
  if (atasNamaRaw) {
    const company = extractCompanyName(atasNamaRaw[1]);
    if (company) return company;
    const n = extractNameWords(atasNamaRaw[1]);
    if (n) return n;
  }

  // "untuk perusahaan PT Indo Sport" / "buat instansi CV Jaya"
  const untukPerusahaan = lower.match(/(?:untuk|buat)\s+(?:perusahaan|instansi|organisasi|komunitas|lembaga)\s+(.+)/);
  if (untukPerusahaan) {
    const company = extractCompanyName(untukPerusahaan[1]);
    if (company) return company;
    const n = extractNameWords(untukPerusahaan[1]);
    if (n) return n;
  }

  // "nama perusahaan: PT ABC" / "nama instansi Yayasan XYZ"
  const namaPerusahaan = lower.match(/nama\s+(?:perusahaan|instansi|organisasi|komunitas|lembaga)\s*[:\-]?\s+(.+)/);
  if (namaPerusahaan) {
    const company = extractCompanyName(namaPerusahaan[1]);
    if (company) return company;
    // Non-prefixed institution name (e.g. "nama instansi Sekolah Harapan")
    const n = extractNameWords(namaPerusahaan[1]);
    if (n) return n;
  }

  // Direct company prefix at start of message: "PT Maju Jaya mau booking ..."
  const directCompanyStart = lower.match(/^((?:pt|cv|ud|pd|fa|koperasi|yayasan|lembaga|dinas|badan|balai|komite|perkumpulan|organisasi|komunitas)\s+.+)/i);
  if (directCompanyStart) {
    const company = extractCompanyName(directCompanyStart[1]);
    if (company) return company;
  }

  // ── Member patterns ───────────────────────────────────────────────────────

  // "untuk/buat member Budi" / "anggota kami Ahmad"
  const untukMember = lower.match(/(?:untuk|buat)\s+(?:member|anggota)\s+([A-Za-z].+)/);
  if (untukMember) {
    const n = extractNameWords(untukMember[1]);
    if (n) return n;
  }
  // "member Sinta Dewi" / "anggota Rudi Hartono"
  // Skip possessives like "kami/kita" — those are already in NAME_STOP_WORDS
  const memberLangsung = lower.match(/\b(?:member|anggota)\s+(?:(?:kami|kita|saya|ku)\s+)?([A-Za-z][A-Za-z\s]{1,40})/);
  if (memberLangsung) {
    const n = extractNameWords(memberLangsung[1]);
    if (n) return n;
  }

  // ── Personal name patterns ────────────────────────────────────────────────

  // "namanya Joko" / "nama teman saya Rina" / "nama: Ahmad"
  const namaX = lower.match(/nama(?:nya|[\s\-]+(?:teman(?:\s+(?:saya|ku))?|dia|nya))?\s*[:\-]?\s+([A-Za-z].+)/);
  if (namaX) {
    const n = extractNameWords(namaX[1]);
    if (n) return n;
  }

  // "untuk teman (saya/ku) Budi" / "buat teman Ahmad"
  const untukTeman = lower.match(/(?:untuk|buat)\s+(?:teman(?:\s+(?:saya|ku))?\s+|kawan(?:\s+(?:saya|ku))?\s+)([A-Za-z].+)/);
  if (untukTeman) {
    const n = extractNameWords(untukTeman[1]);
    if (n) return n;
  }

  // "temanku Ahmad Fauzi" / "kawanku Sinta" / "teman saya Deni"
  const temanSaya = lower.match(/(?:temanku|kawanku|teman\s+(?:saya|ku))\s+([A-Za-z].+)/);
  if (temanSaya) {
    const n = extractNameWords(temanSaya[1]);
    if (n) return n;
  }
  // "teman [name]" without possessive
  const temanSaja = lower.match(/\bteman\s+([A-Za-z].+)/);
  if (temanSaja) {
    const n = extractNameWords(temanSaja[1]);
    if (n) return n;
  }

  // "untuk Budi" — only if message ends with the name (avoids false positives mid-sentence)
  const untukEnd = lower.match(/\buntuk\s+([A-Za-z][A-Za-z\s]{1,25})$/);
  if (untukEnd) {
    const n = extractNameWords(untukEnd[1]);
    if (n) return n;
  }

  return null;
}

/**
 * Detect what kind of booking context is described in the message.
 * Corporate is checked first (most specific), then member, then friend.
 */
export function detectBookingContext(msg: string): BookingContext {
  const lower = msg.toLowerCase();
  // Corporate / institution
  if (/\b(?:pt|cv|ud|pd|koperasi|yayasan|perusahaan|instansi|lembaga|dinas|organisasi|komunitas|perkumpulan|badan)\b/.test(lower)) return "corporate";
  // Member / registered member
  if (/\b(?:member|membership|anggota|pelanggan\s+tetap)\b/.test(lower)) return "member";
  // Friend / family / someone else
  if (/\b(?:teman|temanku|kawan|kawanku|rekan|saudara|adik|kakak|suami|istri|pacar|orang\s+lain)\b/.test(lower)) return "friend";
  return null;
}

/** @deprecated use detectBookingContext instead */
export function isBookingForFriend(msg: string): boolean {
  return detectBookingContext(msg) === "friend";
}

export function parseIntent(msg: string): ParsedIntent {
  const lower = msg.toLowerCase();
  const timeRange = parseTimeRange(lower);
  const personName = parseName(msg);
  const bookingContext = detectBookingContext(lower);
  return {
    facilityKeyword: detectFacilityKeyword(lower),
    bookingDate: parseDate(lower),
    startTime: timeRange?.startTime ?? parseTime(lower),
    durationMinutes: timeRange?.durationMinutes ?? parseDuration(lower),
    personName,
    bookingContext,
  };
}

export function getNextStep(data: {
  facilityId?: number | null;
  bookingDate?: string | null;
  startTime?: string | null;
  durationMinutes?: number | null;
  customerName?: string | null;
}): WaStep {
  if (!data.facilityId) return "ask_facility";
  if (!data.bookingDate) return "ask_date";
  if (!data.startTime) return "ask_time";
  if (!data.durationMinutes) return "ask_duration";
  if (!data.customerName) return "ask_name";
  return "confirm";
}

// ─── Session DB helpers ───────────────────────────────────────────────────────

const SESSION_TTL_MINUTES = 30;

function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
}

export type WaBookingSessionRow = typeof waBookingSessionsTable.$inferSelect;

export async function getActiveSession(phone: string): Promise<WaBookingSessionRow | null> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(waBookingSessionsTable)
    .where(
      and(
        eq(waBookingSessionsTable.phone, phone),
        eq(waBookingSessionsTable.status, "active"),
        gt(waBookingSessionsTable.expiredAt, now)
      )
    )
    .orderBy(waBookingSessionsTable.createdAt)
    .limit(1);
  return row ?? null;
}

export async function createSession(params: {
  phone: string;
  customerId?: number | null;
  facilityId?: number | null;
  bookingDate?: string | null;
  startTime?: string | null;
  durationMinutes?: number | null;
  customerName?: string | null;
  currentStep: WaStep;
}): Promise<WaBookingSessionRow> {
  const [row] = await db
    .insert(waBookingSessionsTable)
    .values({
      phone: params.phone,
      customerId: params.customerId ?? null,
      currentStep: params.currentStep,
      facilityId: params.facilityId ?? null,
      bookingDate: params.bookingDate ?? null,
      startTime: params.startTime ?? null,
      durationMinutes: params.durationMinutes ?? null,
      customerName: params.customerName ?? null,
      status: "active",
      rawMessages: [],
      expiredAt: sessionExpiry(),
    })
    .returning();
  return row;
}

export async function updateSession(
  id: number,
  data: {
    currentStep?: WaStep;
    facilityId?: number | null;
    bookingDate?: string | null;
    startTime?: string | null;
    durationMinutes?: number | null;
    customerName?: string | null;
    status?: WaSessionStatus;
  }
): Promise<WaBookingSessionRow> {
  const [row] = await db
    .update(waBookingSessionsTable)
    .set({ ...data, expiredAt: sessionExpiry(), updatedAt: new Date() })
    .where(eq(waBookingSessionsTable.id, id))
    .returning();
  return row;
}

export async function appendMessage(
  id: number,
  role: "customer" | "bot",
  text: string
): Promise<void> {
  const [row] = await db
    .select({ rawMessages: waBookingSessionsTable.rawMessages })
    .from(waBookingSessionsTable)
    .where(eq(waBookingSessionsTable.id, id));
  if (!row) return;
  const messages = (row.rawMessages ?? []) as Array<{ role: string; text: string; at: string }>;
  messages.push({ role, text, at: new Date().toISOString() });
  await db
    .update(waBookingSessionsTable)
    .set({ rawMessages: messages })
    .where(eq(waBookingSessionsTable.id, id));
}

export async function getRegisteredCustomer(phone: string) {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, customerCode: usersTable.customerCode })
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);
  return user ?? null;
}

export function formatIDR(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

export function formatSessionSummary(params: {
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  customerName: string;
  pricePerHour: number;
  totalPrice: number;
}): string {
  return (
    `✅ Saya cek tersedia. Berikut detail booking:\n\n` +
    `Fasilitas: *${params.facilityName}*\n` +
    `Tanggal: *${params.bookingDate}*\n` +
    `Jam: *${params.startTime} – ${params.endTime}*\n` +
    `Durasi: *${params.durationHours} jam*\n` +
    `Nama: *${params.customerName}*\n` +
    `Total: *${formatIDR(params.totalPrice)}*\n\n` +
    `Balas *YA* untuk lanjut dibuatkan booking.\n` +
    `(Ketik *BATAL* untuk membatalkan)`
  );
}
