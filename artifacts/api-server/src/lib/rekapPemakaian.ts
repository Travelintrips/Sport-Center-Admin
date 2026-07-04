import { db, bookingsTable, facilitiesTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { sendWAToAdmins } from "./notifications";
import { logger } from "./logger";

// ─── Mapping kategori fasilitas ke label rekap ─────────────────────────────

function mapKategori(facilityName: string, facilityCategory: string): string {
  const cat = facilityCategory.toLowerCase();
  const name = facilityName.toLowerCase();

  if (cat.includes("gym") || name.includes("gym")) return "GYM";

  if (
    cat.includes("futsal") || name.includes("futsal") ||
    cat.includes("basket") || name.includes("basket") ||
    cat.includes("voli") || name.includes("voli") ||
    cat.includes("bola") || name.includes("bola") ||
    cat.includes("volleyball") || name.includes("volleyball") ||
    cat.includes("basketball") || name.includes("basketball")
  ) return "BASKET/VOLI/FUTSAL";

  if (
    cat.includes("tenis") || name.includes("tenis") ||
    cat.includes("tennis") || name.includes("tennis")
  ) return "TENIS";

  if (cat.includes("badminton") || name.includes("badminton")) return "BADMINTON";

  if (
    cat.includes("biliard") || name.includes("biliard") ||
    cat.includes("billiard") || name.includes("billiard") ||
    cat.includes("biliar") || name.includes("biliar")
  ) return "BILIARD";

  // Default fallback
  return "BASKET/VOLI/FUTSAL";
}

// Urutan tampilan kategori
const KATEGORI_ORDER = ["GYM", "BASKET/VOLI/FUTSAL", "TENIS", "BADMINTON", "BILIARD"] as const;

export interface RekapBookingRow {
  customerName: string;
  startTime: string;
  endTime: string;
  kategori: string;
}

export type RekapPerKategori = Record<string, RekapBookingRow[]>;

// ─── generateRekapPemakaian ────────────────────────────────────────────────

export async function generateRekapPemakaian(
  tanggalBooking: string, // format "YYYY-MM-DD"
): Promise<RekapPerKategori> {
  const rows = await db
    .select({
      customerName: bookingsTable.customerName,
      startTime: bookingsTable.startTime,
      endTime: bookingsTable.endTime,
      facilityName: facilitiesTable.name,
      facilityCategory: facilitiesTable.category,
    })
    .from(bookingsTable)
    .leftJoin(facilitiesTable, eq(bookingsTable.facilityId, facilitiesTable.id))
    .where(
      and(
        eq(bookingsTable.bookingDate, tanggalBooking),
        or(
          eq(bookingsTable.status, "confirmed"),
          eq(bookingsTable.status, "completed"),
          eq(bookingsTable.status, "pending_payment"),
          eq(bookingsTable.status, "paid"),
          eq(bookingsTable.status, "waiting_confirmation"),
        )!,
      ),
    )
    .orderBy(bookingsTable.startTime);

  const grouped: RekapPerKategori = {};

  for (const row of rows) {
    const kategori = mapKategori(row.facilityName ?? "", row.facilityCategory ?? "");
    if (!grouped[kategori]) grouped[kategori] = [];
    grouped[kategori]!.push({
      customerName: row.customerName,
      startTime: row.startTime,
      endTime: row.endTime,
      kategori,
    });
  }

  // Sort setiap kategori berdasarkan startTime
  for (const cat of Object.keys(grouped)) {
    grouped[cat]!.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  return grouped;
}

// ─── formatRekapWhatsapp ───────────────────────────────────────────────────

function formatTanggalIndonesia(tanggal: string): string {
  // tanggal format "YYYY-MM-DD"
  const parts = tanggal.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  // Gunakan UTC noon agar tidak terkena offset timezone
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const MONTHS = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  return `${DAYS[date.getUTCDay()]} ${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatRekapWhatsapp(
  dataBooking: RekapPerKategori,
  tanggalBooking: string,
): string {
  const tanggalStr = formatTanggalIndonesia(tanggalBooking);
  const lines: string[] = [
    `PEMAKAIAN SPORT CENTER`,
    tanggalStr,
  ];

  for (const kategori of KATEGORI_ORDER) {
    lines.push("");
    lines.push(kategori);

    const items = dataBooking[kategori] ?? [];
    if (items.length === 0) {
      lines.push("1.");
    } else {
      items.forEach((item, idx) => {
        if (kategori === "GYM") {
          lines.push(`${idx + 1}. ${item.customerName} (m) ✅`);
        } else {
          lines.push(`${idx + 1}. ${item.customerName} ${item.startTime} - ${item.endTime} (m) ✅`);
        }
      });
    }
  }

  lines.push("");
  lines.push("SELAMAT BEROLAHRAGA");

  return lines.join("\n");
}

// ─── sendRekapPemakaianToAdmin ────────────────────────────────────────────

export async function sendRekapPemakaianToAdmin(tanggalBooking: string): Promise<void> {
  const dataBooking = await generateRekapPemakaian(tanggalBooking);
  const msg = formatRekapWhatsapp(dataBooking, tanggalBooking);

  // Kirim ke semua admin phones (termasuk grup WA jika sudah ada di adminWaPhones settings)
  await sendWAToAdmins(msg);

  // Jika ADMIN_WA_GROUP di-set dan belum dicakup oleh sendWAToAdmins, kirim eksplisit
  const adminGroup = process.env.ADMIN_WA_GROUP?.trim();
  if (adminGroup && adminGroup.endsWith("@g.us")) {
    // sendWAToAdmins sudah menggunakan adminPhones dari DB; grup mungkin belum masuk.
    // Kirim langsung via Fonnte menggunakan token admin.
    const fonnteToken = process.env.FONNTE_TOKEN;
    if (fonnteToken) {
      try {
        const resp = await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: {
            Authorization: fonnteToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ target: adminGroup, message: msg }),
        });
        const body = await resp.text().catch(() => "(no body)");
        if (!resp.ok) {
          logger.error({ status: resp.status, body }, "[REKAP] Gagal kirim rekap ke grup WA admin");
        } else {
          logger.info({ target: adminGroup }, "[REKAP] Rekap berhasil dikirim ke grup WA admin");
        }
      } catch (err) {
        logger.error({ err }, "[REKAP] Exception kirim rekap ke grup WA admin");
      }
    }
  }
}
