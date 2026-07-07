import { db, bookingsTable, facilitiesTable, gymCheckinsTable, gymMembershipsTable } from "@workspace/db";
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

  return "BASKET/VOLI/FUTSAL";
}

// Urutan tampilan kategori
const KATEGORI_ORDER = ["GYM", "BASKET/VOLI/FUTSAL", "TENIS", "BADMINTON", "BILIARD"] as const;

// ─── Ikon status pembayaran ────────────────────────────────────────────────
// ✅ = confirmed / completed  (sudah bayar & dikonfirmasi)
// ⏳ = paid / waiting_confirmation  (bukti masuk, menunggu konfirmasi)
// ❌ = pending_payment  (belum bayar)

function paymentIcon(status: string): string {
  if (status === "confirmed" || status === "completed") return "✅";
  if (status === "paid" || status === "waiting_confirmation") return "⏳";
  return "❌";
}

export interface RekapBookingRow {
  customerName: string;
  startTime: string;
  endTime: string;
  kategori: string;
  status: string;
  /** "m" = member (company billing atau karyawan AP2), "v" = visit (umum) */
  customerLabel: "m" | "v";
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
      status: bookingsTable.status,
      facilityName: facilitiesTable.name,
      facilityCategory: facilitiesTable.category,
      payerType: bookingsTable.payerType,
      customerType: bookingsTable.customerType,
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
    // GYM booking harian (pay-per-visit) selalu (v) — bukan member bulanan
    // company billing atau karyawan AP2 di fasilitas lain = (m)
    const isMember = kategori !== "GYM" && (row.payerType === "company" || row.customerType === "angkasa_pura");
    grouped[kategori]!.push({
      customerName: row.customerName,
      startTime: row.startTime,
      endTime: row.endTime,
      kategori,
      status: row.status,
      customerLabel: isMember ? "m" : "v",
    });
  }

  // Sort setiap kategori: confirmed/completed dulu, lalu paid/waiting, lalu pending
  const statusOrder = (s: string) => {
    if (s === "confirmed" || s === "completed") return 0;
    if (s === "paid" || s === "waiting_confirmation") return 1;
    return 2; // pending_payment
  };

  for (const cat of Object.keys(grouped)) {
    grouped[cat]!.sort((a, b) => {
      const diff = statusOrder(a.status) - statusOrder(b.status);
      if (diff !== 0) return diff;
      return a.startTime.localeCompare(b.startTime);
    });
  }

  // ── Gym member check-ins ──────────────────────────────────────────────────
  // Ambil check-in member gym untuk tanggal ini dan masukkan ke group GYM
  try {
    const checkinRows = await db
      .select({
        name: gymMembershipsTable.name,
        checkedInAt: gymCheckinsTable.checkedInAt,
      })
      .from(gymCheckinsTable)
      .leftJoin(gymMembershipsTable, eq(gymCheckinsTable.membershipId, gymMembershipsTable.id))
      .where(eq(gymCheckinsTable.checkinDate, tanggalBooking));

    for (const row of checkinRows) {
      if (!grouped["GYM"]) grouped["GYM"] = [];
      // Konversi ke WIB (UTC+7) agar jam tampil dan sort akurat secara lokal
      const checkinTime = row.checkedInAt
        ? (() => {
            const wib = new Date(row.checkedInAt!.getTime() + 7 * 60 * 60 * 1000);
            return wib.toISOString().substring(11, 16);
          })()
        : "00:00";
      grouped["GYM"]!.push({
        customerName: row.name ?? "Member Gym",
        startTime: checkinTime,
        endTime: checkinTime,
        kategori: "GYM",
        status: "confirmed", // member gym = sudah bayar iuran
        customerLabel: "m",  // member gym selalu (m)
      });
    }

    // Sort ulang GYM setelah menambahkan check-ins member (agar urut waktu)
    if (grouped["GYM"]) {
      grouped["GYM"].sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
  } catch (err) {
    logger.warn({ err }, "[rekap] Gagal mengambil gym check-ins, dilewati");
  }

  return grouped;
}

// ─── formatRekapWhatsapp ───────────────────────────────────────────────────

function formatTanggalIndonesia(tanggal: string): string {
  const parts = tanggal.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
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
    ``,
    `Ket: ✅ Lunas  ⏳ Verifikasi  ❌ Belum Bayar`,
  ];

  for (const kategori of KATEGORI_ORDER) {
    lines.push("");
    lines.push(`*${kategori}*`);

    const items = dataBooking[kategori] ?? [];
    if (items.length === 0) {
      lines.push("1.");
    } else {
      items.forEach((item, idx) => {
        const icon = paymentIcon(item.status);
        const label = `(${item.customerLabel})`;
        if (kategori === "GYM") {
          lines.push(`${idx + 1}. ${item.customerName} ${label} ${icon}`);
        } else {
          lines.push(`${idx + 1}. ${item.customerName} ${item.startTime.substring(0,5)}-${item.endTime.substring(0,5)} ${label} ${icon}`);
        }
      });
    }
  }

  lines.push("");
  lines.push("SELAMAT BEROLAHRAGA 🏆");

  return lines.join("\n");
}

// ─── sendRekapPemakaianToAdmin ────────────────────────────────────────────

export async function sendRekapPemakaianToAdmin(tanggalBooking: string): Promise<void> {
  const dataBooking = await generateRekapPemakaian(tanggalBooking);
  const msg = formatRekapWhatsapp(dataBooking, tanggalBooking);

  // Kirim ke semua admin phones + grup WA (grup bisa dimasukkan ke adminWaPhones di settings DB)
  // Format grup: XXXXXXXX@g.us — cukup tambahkan ke kolom adminWaPhones di halaman settings
  await sendWAToAdmins(msg);
}
