// routes/customers.js — CRUD customer
const express = require('express');
const { prepare } = require('../database');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/customers — semua customer (admin)
router.get('/', auth, (req, res) => {
  const { type, search } = req.query;
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND customer_type = ?'; params.push(type); }
  if (search) { sql += ' AND (name LIKE ? OR phone LIKE ? OR id_card_number LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY created_at DESC';
  res.json(prepare(sql).all(...params));
});

// GET /api/customers/:id — detail customer (admin)
router.get('/:id', auth, (req, res) => {
  const row = prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Customer tidak ditemukan' });
  const bookings = prepare('SELECT b.*, f.name as facility_name FROM bookings b JOIN facilities f ON b.facility_id = f.id WHERE b.id_card_number = ? OR (b.customer_type = "umum" AND b.customer_phone = ?) ORDER BY b.created_at DESC LIMIT 10').all(row.id_card_number || '', row.phone || '');
  res.json({ ...row, recent_bookings: bookings });
});

// POST /api/customers — tambah customer (admin)
router.post('/', auth, (req, res) => {
  const { name, phone, email, customer_type, id_card_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });
  if (customer_type === 'angkasa_pura' && !id_card_number) {
    return res.status(400).json({ error: 'Nomor ID Card wajib untuk customer Angkasa Pura' });
  }
  try {
    const result = prepare(
      'INSERT INTO customers (name, phone, email, customer_type, id_card_number, is_verified) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, phone || null, email || null, customer_type || 'umum', id_card_number || null, customer_type === 'umum' ? 1 : 0);
    res.status(201).json(prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Nomor ID Card sudah terdaftar' });
    throw e;
  }
});

// PUT /api/customers/:id — update customer (admin)
router.put('/:id', auth, (req, res) => {
  const existing = prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Customer tidak ditemukan' });
  const { name, phone, email, customer_type, id_card_number, is_verified } = req.body;
  try {
    prepare(
      'UPDATE customers SET name=?, phone=?, email=?, customer_type=?, id_card_number=?, is_verified=? WHERE id=?'
    ).run(name, phone || null, email || null, customer_type, id_card_number || null, is_verified ? 1 : 0, req.params.id);
    res.json(prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Nomor ID Card sudah terdaftar' });
    throw e;
  }
});

// DELETE /api/customers/:id — hapus customer (admin)
router.delete('/:id', auth, (req, res) => {
  const existing = prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Customer tidak ditemukan' });
  prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.json({ message: 'Customer berhasil dihapus' });
});

// POST /api/customers/lookup — cek ID card untuk booking (public)
router.post('/lookup', (req, res) => {
  const { id_card_number } = req.body;
  if (!id_card_number) return res.status(400).json({ error: 'Nomor ID Card wajib diisi' });
  const customer = prepare("SELECT * FROM customers WHERE id_card_number = ? AND customer_type = 'angkasa_pura'").get(id_card_number);
  if (!customer) return res.status(404).json({ error: 'ID Card tidak ditemukan di database' });
  res.json({ name: customer.name, customer_type: customer.customer_type, is_verified: customer.is_verified });
});

module.exports = router;
