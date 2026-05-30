// routes/bookings.js — manajemen booking
const express = require('express');
const { prepare } = require('../database');
const auth = require('../middleware/auth');

const router = express.Router();

// ─── Helper ─────────────────────────────────────────────────────────────────
function generateCode() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BK-${ts}-${rand}`;
}

function formatBooking(b) {
  const facility = prepare('SELECT name FROM facilities WHERE id = ?').get(b.facility_id);
  return { ...b, facility_name: facility ? facility.name : '-' };
}

// GET /api/bookings — semua booking (admin)
router.get('/', auth, (req, res) => {
  const { status, date, search, facility_id } = req.query;
  let sql = `SELECT b.*, f.name as facility_name FROM bookings b
             JOIN facilities f ON b.facility_id = f.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND b.verification_status = ?'; params.push(status); }
  if (date)   { sql += ' AND b.booking_date = ?'; params.push(date); }
  if (facility_id) { sql += ' AND b.facility_id = ?'; params.push(facility_id); }
  if (search) {
    sql += ' AND (b.customer_name LIKE ? OR b.booking_code LIKE ? OR b.customer_phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY b.created_at DESC';
  res.json(prepare(sql).all(...params));
});

// GET /api/bookings/stats — statistik (admin)
router.get('/stats', auth, (req, res) => {
  const total     = prepare('SELECT COUNT(*) as c FROM bookings').get().c;
  const pending   = prepare("SELECT COUNT(*) as c FROM bookings WHERE verification_status = 'pending'").get().c;
  const verified  = prepare("SELECT COUNT(*) as c FROM bookings WHERE verification_status = 'verified'").get().c;
  const cancelled = prepare("SELECT COUNT(*) as c FROM bookings WHERE verification_status = 'cancelled'").get().c;
  const revenue   = prepare("SELECT IFNULL(SUM(final_price),0) as total FROM bookings WHERE verification_status = 'verified'").get().total;
  const today     = new Date().toISOString().slice(0, 10);
  const today_count = prepare("SELECT COUNT(*) as c FROM bookings WHERE booking_date = ?").get(today).c;
  res.json({ total, pending, verified, cancelled, revenue, today_count });
});

// GET /api/bookings/code/:code — detail by kode booking (public)
router.get('/code/:code', (req, res) => {
  const row = prepare(`SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id WHERE b.booking_code = ?`).get(req.params.code);
  if (!row) return res.status(404).json({ error: 'Booking tidak ditemukan' });
  res.json(row);
});

// GET /api/bookings/:id — detail booking (admin)
router.get('/:id', auth, (req, res) => {
  const row = prepare(`SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id WHERE b.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Booking tidak ditemukan' });
  res.json(row);
});

// POST /api/bookings — buat booking baru (public)
router.post('/', (req, res) => {
  const {
    customer_name, customer_phone, customer_type,
    id_card_number, facility_id,
    booking_date, start_time, duration_hours, notes
  } = req.body;

  // Validasi input
  if (!customer_name || !facility_id || !booking_date || !start_time || !duration_hours) {
    return res.status(400).json({ error: 'Data booking tidak lengkap' });
  }
  if (customer_type === 'angkasa_pura' && !id_card_number) {
    return res.status(400).json({ error: 'Nomor ID Card wajib untuk customer Angkasa Pura' });
  }

  // Cek fasilitas
  const facility = prepare('SELECT * FROM facilities WHERE id = ? AND is_active = 1').get(facility_id);
  if (!facility) return res.status(404).json({ error: 'Fasilitas tidak ditemukan atau tidak aktif' });

  // Hitung waktu selesai
  const [h, m] = start_time.split(':').map(Number);
  const endH = h + Number(duration_hours);
  const end_time = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  // Cek ketersediaan (tidak boleh tumpang tindih)
  const conflict = prepare(`
    SELECT id FROM bookings
    WHERE facility_id = ? AND booking_date = ?
      AND verification_status != 'cancelled'
      AND NOT (end_time <= ? OR start_time >= ?)
  `).get(facility_id, booking_date, start_time, end_time);
  if (conflict) return res.status(409).json({ error: 'Waktu yang dipilih sudah dipesan. Pilih waktu lain.' });

  // Hitung harga
  const base_price = facility.base_price * Number(duration_hours);
  let discount_percentage = 0;
  let discount_amount = 0;
  let final_price = base_price;
  let verification_status = 'verified';

  if (customer_type === 'angkasa_pura') {
    // Cek apakah ID card valid di database
    const knownCustomer = prepare("SELECT * FROM customers WHERE id_card_number = ? AND customer_type = 'angkasa_pura'").get(id_card_number);
    if (!knownCustomer) {
      // ID card tidak dikenal → buat booking pending
      verification_status = 'pending';
    } else {
      // ID card dikenal → langsung pending verifikasi fisik via QR scan
      verification_status = 'pending';
    }
    // Diskon BELUM diterapkan sampai admin verifikasi
  }

  const booking_code = generateCode();
  const result = prepare(`
    INSERT INTO bookings
      (booking_code, customer_name, customer_phone, customer_type, id_card_number,
       facility_id, booking_date, start_time, end_time, duration_hours,
       base_price, discount_percentage, discount_amount, final_price,
       verification_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    booking_code, customer_name, customer_phone || null, customer_type || 'umum',
    id_card_number || null, facility_id, booking_date, start_time, end_time,
    Number(duration_hours), base_price, discount_percentage, discount_amount,
    final_price, verification_status, notes || null
  );

  const booking = prepare(`SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id WHERE b.id = ?`).get(result.lastInsertRowid);
  res.status(201).json(booking);
});

// POST /api/bookings/:id/verify — verifikasi ID card & terapkan diskon (admin)
router.post('/:id/verify', auth, (req, res) => {
  const { id_card_number } = req.body;
  if (!id_card_number) return res.status(400).json({ error: 'Nomor ID Card wajib diisi' });

  const booking = prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking tidak ditemukan' });
  if (booking.verification_status !== 'pending') {
    return res.status(400).json({ error: 'Booking ini tidak dalam status pending verifikasi' });
  }

  // Cocokkan ID Card dengan database customer Angkasa Pura
  const customer = prepare("SELECT * FROM customers WHERE id_card_number = ? AND customer_type = 'angkasa_pura'").get(id_card_number);
  if (!customer) {
    // ID Card tidak valid → batalkan booking (atau kembalikan harga normal)
    prepare("UPDATE bookings SET verification_status = 'rejected', notes = COALESCE(notes || ' | ', '') || 'ID Card tidak valid' WHERE id = ?").run(req.params.id);
    return res.status(422).json({
      success: false,
      error: 'ID Card tidak valid. Booking ditolak.',
      status: 'rejected'
    });
  }

  // ID Card valid → terapkan diskon
  const setting = prepare("SELECT * FROM discount_settings WHERE customer_type = 'angkasa_pura' AND is_active = 1").get();
  const discount_pct = setting ? setting.discount_percentage : 20;
  const discount_amount = Math.round(booking.base_price * discount_pct / 100);
  const final_price = booking.base_price - discount_amount;

  // Pastikan ID Card cocok dengan yang di booking
  if (booking.id_card_number && booking.id_card_number !== id_card_number) {
    return res.status(422).json({
      success: false,
      error: `ID Card tidak cocok dengan data booking (expected: ${booking.id_card_number})`,
      status: 'mismatch'
    });
  }

  prepare(`UPDATE bookings
    SET verification_status = 'verified',
        id_card_number = ?,
        discount_percentage = ?,
        discount_amount = ?,
        final_price = ?
    WHERE id = ?`).run(id_card_number, discount_pct, discount_amount, final_price, req.params.id);

  const updated = prepare(`SELECT b.*, f.name as facility_name FROM bookings b
    JOIN facilities f ON b.facility_id = f.id WHERE b.id = ?`).get(req.params.id);
  res.json({ success: true, message: `Verifikasi berhasil! Diskon ${discount_pct}% diterapkan.`, booking: updated });
});

// PUT /api/bookings/:id/cancel — batalkan booking (admin)
router.put('/:id/cancel', auth, (req, res) => {
  const booking = prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking tidak ditemukan' });
  prepare("UPDATE bookings SET verification_status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ message: 'Booking berhasil dibatalkan' });
});

// DELETE /api/bookings/:id — hapus booking (admin)
router.delete('/:id', auth, (req, res) => {
  const booking = prepare('SELECT id FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking tidak ditemukan' });
  prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ message: 'Booking berhasil dihapus' });
});

module.exports = router;
