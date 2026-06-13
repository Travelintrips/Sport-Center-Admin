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

export interface ParsedIntent {
  facilityKeyword: string | null;
  bookingDate: string | null;
  startTime: string | null;
  durationMinutes: number | null;
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

export function parseIntent(msg: string): ParsedIntent {
  const lower = msg.toLowerCase();
  // Try range first ("jam 4 sd jam 6 sore") — fills both startTime & durationMinutes at once
  const timeRange = parseTimeRange(lower);
  return {
    facilityKeyword: detectFacilityKeyword(lower),
    bookingDate: parseDate(lower),
    startTime: timeRange?.startTime ?? parseTime(lower),
    durationMinutes: timeRange?.durationMinutes ?? parseDuration(lower),
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
