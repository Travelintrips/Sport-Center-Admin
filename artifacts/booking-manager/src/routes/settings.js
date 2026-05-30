// routes/settings.js — pengaturan diskon
const express = require('express');
const { prepare } = require('../database');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/settings/discount — ambil semua pengaturan diskon (public, untuk kalkulasi booking)
router.get('/discount', (req, res) => {
  const rows = prepare('SELECT * FROM discount_settings ORDER BY customer_type').all();
  res.json(rows);
});

// GET /api/settings/discount/:type — ambil diskon per tipe customer
router.get('/discount/:type', (req, res) => {
  const row = prepare('SELECT * FROM discount_settings WHERE customer_type = ?').get(req.params.type);
  if (!row) return res.status(404).json({ error: 'Pengaturan tidak ditemukan' });
  res.json(row);
});

// PUT /api/settings/discount/:type — update persentase diskon (admin)
router.put('/discount/:type', auth, (req, res) => {
  const { discount_percentage, description, is_active } = req.body;
  if (discount_percentage === undefined) return res.status(400).json({ error: 'Persentase diskon wajib diisi' });
  if (discount_percentage < 0 || discount_percentage > 100) {
    return res.status(400).json({ error: 'Persentase harus antara 0 - 100' });
  }
  const existing = prepare('SELECT id FROM discount_settings WHERE customer_type = ?').get(req.params.type);
  if (existing) {
    prepare(
      'UPDATE discount_settings SET discount_percentage=?, description=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE customer_type=?'
    ).run(Number(discount_percentage), description, is_active ? 1 : 0, req.params.type);
  } else {
    prepare(
      'INSERT INTO discount_settings (customer_type, discount_percentage, description, is_active) VALUES (?, ?, ?, ?)'
    ).run(req.params.type, Number(discount_percentage), description || '', is_active ? 1 : 0);
  }
  res.json(prepare('SELECT * FROM discount_settings WHERE customer_type = ?').get(req.params.type));
});

module.exports = router;
