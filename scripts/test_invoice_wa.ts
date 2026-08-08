import { Client } from "pg";
import { createHmac } from "crypto";

async function main() {
  const client = new Client({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV });
  await client.connect();

  // Ambil booking confirmed/completed terbaru
  const r = await client.query(`
    SELECT b.order_number, b.customer_name, b.customer_phone, b.booking_date,
           b.start_time, b.end_time, b.status,
           COALESCE(b.grand_total, b.total_price)::numeric AS grand_total,
           f.name AS facility_name
    FROM sport_center.sport_bookings b
    LEFT JOIN sport_center.sport_facilities f ON f.id = b.facility_id
    WHERE b.status IN ('confirmed','completed')
    ORDER BY b.created_at DESC
    LIMIT 1
  `);

  const s = await client.query(`
    SELECT fonnte_token FROM sport_center.sport_settings LIMIT 1
  `);

  await client.end();

  if (!r.rows.length) {
    console.error("Tidak ada booking confirmed/completed ditemukan");
    process.exit(1);
  }

  const booking = r.rows[0];
  const fonnteToken = s.rows[0]?.fonnte_token || process.env.FONNTE_TOKEN;

  if (!fonnteToken) {
    console.error("FONNTE_TOKEN tidak ditemukan");
    process.exit(1);
  }

  console.log("Booking ditemukan:", booking.order_number, booking.customer_name);
  console.log("Kirim WA test invoice ke: 081386210415");

  // Hitung invoice number
  const datePart = String(booking.booking_date).replace(/-/g, "").substring(0, 8);
  const seq = booking.order_number.replace(/[^0-9]/g, "").slice(-6).padStart(6, "0");
  const invoiceNumber = `INV/SC/${datePart}/${seq}`;

  const grandTotal = Number(booking.grand_total);
  const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);

  // Ambil URL PDF publik dari server lokal
  const appUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const publicPdfLink = `${appUrl}/api/public/invoices/${booking.order_number}/pdf`;

  const message =
    `✅ *[TEST] Invoice Booking Sport Center*\n\n` +
    `Halo *Test User*,\n\n` +
    `Ini adalah test pengiriman invoice otomatis.\n\n` +
    `📋 *No Invoice:* ${invoiceNumber}\n` +
    `🏟️ *Fasilitas:* ${booking.facility_name}\n` +
    `📅 *Tanggal:* ${booking.booking_date}\n` +
    `⏰ *Jam:* ${booking.start_time} – ${booking.end_time}\n` +
    `💰 *Total:* Rp ${fmt(grandTotal)}\n\n` +
    `📄 *Invoice PDF:*\n${publicPdfLink}\n\n` +
    `_(Pesan ini dikirim otomatis oleh sistem setelah pembayaran dikonfirmasi)_ 🙏`;

  const targetPhone = "081386210415".replace(/^\+/, "").replace(/^0/, "62");

  console.log("Mengirim via Fonnte ke:", targetPhone);
  const resp = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: fonnteToken, "Content-Type": "application/json" },
    body: JSON.stringify({ target: targetPhone, message }),
  });

  const body = await resp.json().catch(() => ({}));
  console.log("Fonnte response:", JSON.stringify(body, null, 2));

  if (!resp.ok || (body as any).status === false) {
    console.error("❌ WA gagal terkirim");
    process.exit(1);
  } else {
    console.log("✅ WA test invoice berhasil dikirim ke 081386210415");
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
