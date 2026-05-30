// routes/verify.js — endpoint verifikasi ID Card Angkasa Pura
// Fitur: rate limiting, logging aktivitas, validasi admin-only
const express = require('express');
const { prepare } = require('../database');
const auth = require('../middleware/auth');

const router = express.Router();

// ─── Rate limiter sederhana (in-memory, per IP, max 15 req/menit) ─────────────
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 15;
const RATE_WINDOW_MS = 60 * 1000; // 1 menit

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Helper: catat log verifikasi ────────────────────────────────────────────
function writeLog({ booking_id, booking_code, scanned_id, admin_username, ip_address, result, detail }) {
  prepare(`INSERT INTO verification_logs
    (booking_id, booking_code, scanned_id, admin_username, ip_address, result, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    booking_id || null, booking_code || null, scanned_id || null,
    admin_username || null, ip_address || null, result, detail || null
  );
}

// POST /api/verify-angkasa-pura — verifikasi ID Card & terapkan diskon
router.post('/', auth, (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const adminUser = req.admin?.username || 'unknown';

  // Rate limiting
  if (!checkRateLimit(ip)) {
    writeLog({ scanned_id: req.body?.scanned_id, admin_username: adminUser, ip_address: ip, result: 'rate_limited', detail: 'Terlalu banyak percobaan' });
    return res.status(429).json({
      error: 'Terlalu banyak percobaan. Tunggu 1 menit sebelum mencoba lagi.',
      retry_after: 60
    });
  }

  const { scanned_id, booking_id } = req.body;

  if (!scanned_id) return res.status(400).json({ error: 'ID Card (scanned_id) wajib diisi' });
  if (!booking_id) return res.status(400).json({ error: 'booking_id wajib diisi' });

  // Ambil data booking
  const booking = prepare(`SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id WHERE b.id = ?`).get(booking_id);

  if (!booking) {
    writeLog({ booking_id, scanned_id, admin_username: adminUser, ip_address: ip, result: 'booking_not_found', detail: 'Booking tidak ditemukan' });
    return res.status(404).json({ error: 'Booking tidak ditemukan' });
  }

  // Cek status booking harus pending_verification
  if (booking.verification_status !== 'pending_verification') {
    const msg = `Booking sudah berstatus '${booking.verification_status}', tidak perlu verifikasi ulang`;
    writeLog({ booking_id, booking_code: booking.booking_code, scanned_id, admin_username: adminUser, ip_address: ip, result: 'not_pending', detail: msg });
    return res.status(400).json({ error: msg, current_status: booking.verification_status });
  }

  // Validasi: ID Card harus ada di tabel customers + customer_type = angkasa_pura
  const customer = prepare("SELECT * FROM customers WHERE id_card_number = ? AND customer_type = 'angkasa_pura'").get(scanned_id);

  if (!customer) {
    writeLog({ booking_id, booking_code: booking.booking_code, scanned_id, admin_username: adminUser, ip_address: ip, result: 'invalid_card', detail: 'ID Card tidak ditemukan di database' });
    // Tandai booking sebagai ditolak
    prepare("UPDATE bookings SET verification_status = 'rejected', notes = COALESCE(notes || ' | ', '') || ? WHERE id = ?")
      .run(`[${new Date().toISOString()}] Ditolak: ID Card '${scanned_id}' tidak ditemukan`, booking_id);
    return res.status(422).json({
      success: false,
      error: 'ID Card tidak valid atau bukan karyawan Angkasa Pura.',
      result: 'invalid_card'
    });
  }

  // Cek ID Card cocok dengan yang ada di booking (jika sudah diisi sebelumnya)
  if (booking.id_card_number && booking.id_card_number !== scanned_id) {
    const detail = `ID Card di scan (${scanned_id}) tidak cocok dengan booking (${booking.id_card_number})`;
    writeLog({ booking_id, booking_code: booking.booking_code, scanned_id, admin_username: adminUser, ip_address: ip, result: 'mismatch', detail });
    return res.status(422).json({
      success: false,
      error: detail,
      result: 'mismatch',
      expected: booking.id_card_number,
      got: scanned_id
    });
  }

  // Cek apakah fasilitas ini mendapat diskon AP
  const facilityHasDiscount = prepare(
    "SELECT 1 FROM facility_discounts WHERE customer_type = 'angkasa_pura' AND facility_id = ?"
  ).get(booking.facility_id);

  const setting = prepare("SELECT * FROM discount_settings WHERE customer_type = 'angkasa_pura' AND is_active = 1").get();
  const discountEnabled = setting && facilityHasDiscount;
  const discount_pct = discountEnabled ? setting.discount_percentage : 0;
  const discount_amount = Math.round(booking.base_price * discount_pct / 100);
  const final_price = booking.base_price - discount_amount;

  // Terapkan verifikasi + diskon
  prepare(`UPDATE bookings
    SET verification_status = 'verified',
        id_card_number = ?,
        discount_percentage = ?,
        discount_amount = ?,
        final_price = ?,
        notes = COALESCE(notes || ' | ', '') || ?
    WHERE id = ?`).run(
    scanned_id, discount_pct, discount_amount, final_price,
    `[${new Date().toISOString()}] Diverifikasi oleh ${adminUser}`,
    booking_id
  );

  writeLog({
    booking_id,
    booking_code: booking.booking_code,
    scanned_id,
    admin_username: adminUser,
    ip_address: ip,
    result: 'success',
    detail: discountEnabled
      ? `Diskon ${discount_pct}% diterapkan. Harga akhir: ${final_price}`
      : 'Terverifikasi tanpa diskon (fasilitas tidak masuk program diskon atau diskon nonaktif)'
  });

  const updatedBooking = prepare(`SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id WHERE b.id = ?`).get(booking_id);

  const msg = discountEnabled
    ? `✅ Verifikasi berhasil! Diskon ${discount_pct}% diterapkan. Harga akhir: Rp ${final_price.toLocaleString('id-ID')}`
    : '✅ ID Card valid. Terverifikasi (fasilitas ini tidak dalam program diskon AP).';

  res.json({
    success: true,
    message: msg,
    discount_applied: discountEnabled,
    discount_percentage: discount_pct,
    discount_amount,
    final_price,
    customer_name: customer.name,
    booking: updatedBooking
  });
});

// GET /api/verify-angkasa-pura/logs — riwayat log verifikasi (admin)
router.get('/logs', auth, (req, res) => {
  const { booking_id, limit = 50 } = req.query;
  let sql = 'SELECT * FROM verification_logs WHERE 1=1';
  const params = [];
  if (booking_id) { sql += ' AND booking_id = ?'; params.push(booking_id); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(limit));
  res.json(prepare(sql).all(...params));
});

module.exports = router;
