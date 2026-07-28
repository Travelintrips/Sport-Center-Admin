import postgres from "pg";
import { randomBytes } from "crypto";

const { Client } = postgres;

const TARGET_PHONE = "6285719889185";
const APP_URL = process.env.APP_URL ?? "https://sport-center-admin-111569.replit.app";
const FONNTE_TOKEN = process.env.FONNTE_TOKEN ?? "";
const DB_URL = process.env.DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL_DEV ?? "";

if (!FONNTE_TOKEN) { console.error("❌ FONNTE_TOKEN not set"); process.exit(1); }
if (!DB_URL) { console.error("❌ SUPABASE_DATABASE_URL_DEV not set"); process.exit(1); }

async function sendWA(phone: string, message: string) {
  const body = new URLSearchParams({ target: phone, message, delay: "1", countryCode: "62" });
  const resp = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: FONNTE_TOKEN },
    body,
  });
  const text = await resp.text();
  console.log(`[WA] Kirim ke ${phone}:`, resp.status, text.slice(0, 200));
  return resp.ok;
}

async function main() {
  const url = DB_URL.includes("supabase")
    ? DB_URL.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432")
    : DB_URL;
  const sslOpts = DB_URL.includes("supabase") ? { ssl: { rejectUnauthorized: false } } : {};
  const client = new Client({ connectionString: url, ...sslOpts });
  await client.connect();
  console.log("✅ DB connected");

  // Ambil booking pertama yang masih pending
  const { rows: bookings } = await client.query(`
    SELECT b.id, b.order_number, b.customer_name, b.customer_phone,
           b.booking_date, b.start_time, b.end_time, b.duration_hours,
           b.total_price, b.status, f.name as facility_name
    FROM sport_center.bookings b
    LEFT JOIN sport_center.facilities f ON f.id = b.facility_id
    ORDER BY b.created_at DESC
    LIMIT 1
  `);

  if (!bookings.length) { console.error("❌ Tidak ada booking di DB"); process.exit(1); }

  const booking = bookings[0];
  console.log(`\n📋 Pakai booking: ${booking.order_number} — ${booking.customer_name} — ${booking.facility_name}`);

  // Buat token approve_booking (expire 1 hari)
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO sport_center.wa_action_tokens (token, booking_id, action, expires_at)
     VALUES ($1, $2, 'approve_booking', $3)`,
    [token, booking.id, expiresAt]
  );
  console.log(`🔑 Token dibuat: ${token.slice(0, 16)}...`);

  const approvalUrl = `${APP_URL}/wa/booking-approval/${token}`;

  // Hitung hari
  const dow = new Date(booking.booking_date + "T00:00:00+07:00").getDay();
  const dayType = (dow === 0 || dow === 6) ? "Weekend" : "Weekday";
  const totalPrice = Number(booking.total_price).toLocaleString("id-ID");

  const msg =
    `🔔 *BOOKING BARU — PERLU APPROVAL* [TEST]\n\n` +
    `Order: *${booking.order_number}*\n` +
    `Customer: *${booking.customer_name}*\n` +
    `WA: *${booking.customer_phone}*\n` +
    `Fasilitas: *${booking.facility_name ?? "-"}*\n` +
    `Tanggal: *${booking.booking_date}* (${dayType})\n` +
    `Jam: *${booking.start_time} – ${booking.end_time}*\n` +
    `Durasi: *${booking.duration_hours} jam*\n` +
    `Total: *Rp ${totalPrice}*\n\n` +
    `👇 *Approve / Reject via link:*\n${approvalUrl}`;

  console.log(`\n📨 Kirim WA ke ${TARGET_PHONE}...`);
  console.log(`🔗 Approval URL: ${approvalUrl}\n`);

  const ok = await sendWA(TARGET_PHONE, msg);
  if (ok) {
    console.log("✅ WA berhasil dikirim!");
  } else {
    console.log("❌ WA gagal dikirim — cek FONNTE_TOKEN atau nomor tujuan");
  }

  await client.end();
}

main().catch((err) => { console.error("❌", err.message); process.exit(1); });
