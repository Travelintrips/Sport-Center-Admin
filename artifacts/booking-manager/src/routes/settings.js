// routes/settings.js — pengaturan diskon + fasilitas yang mendapat diskon
const express = require('express');
const { prepare } = require('../database');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/settings/discount — semua pengaturan diskon (public)
router.get('/discount', (req, res) => {
  res.json(prepare('SELECT * FROM discount_settings ORDER BY customer_type').all());
});

// GET /api/settings/discount/:type — diskon per tipe (public)
router.get('/discount/:type', (req, res) => {
  const row = prepare('SELECT * FROM discount_settings WHERE customer_type = ?').get(req.params.type);
  if (!row) return res.status(404).json({ error: 'Pengaturan tidak ditemukan' });
  res.json(row);
});

// PUT /api/settings/discount/:type — update persentase & status diskon (admin)
router.put('/discount/:type', auth, (req, res) => {
  const { discount_percentage, description, is_active } = req.body;
  if (discount_percentage === undefined) return res.status(400).json({ error: 'Persentase diskon wajib diisi' });
  if (discount_percentage < 0 || discount_percentage > 100) return res.status(400).json({ error: 'Persentase harus 0–100' });

  const existing = prepare('SELECT id FROM discount_settings WHERE customer_type = ?').get(req.params.type);
  if (existing) {
    prepare('UPDATE discount_settings SET discount_percentage=?, description=?, is_active=?, updated_at=datetime("now") WHERE customer_type=?')
      .run(Number(discount_percentage), description || '', is_active ? 1 : 0, req.params.type);
  } else {
    prepare('INSERT INTO discount_settings (customer_type, discount_percentage, description, is_active) VALUES (?, ?, ?, ?)')
      .run(req.params.type, Number(discount_percentage), description || '', is_active ? 1 : 0);
  }
  res.json(prepare('SELECT * FROM discount_settings WHERE customer_type = ?').get(req.params.type));
});

// GET /api/settings/discount/:type/facilities — fasilitas yang mendapat diskon (public)
router.get('/discount/:type/facilities', (req, res) => {
  const ids = prepare('SELECT facility_id FROM facility_discounts WHERE customer_type = ?')
    .all(req.params.type).map(r => r.facility_id);
  res.json({ customer_type: req.params.type, facility_ids: ids });
});

// PUT /api/settings/discount/:type/facilities — update daftar fasilitas diskon (admin)
router.put('/discount/:type/facilities', auth, (req, res) => {
  const { facility_ids } = req.body; // array of IDs
  if (!Array.isArray(facility_ids)) return res.status(400).json({ error: 'facility_ids harus berupa array' });

  // Hapus lama, insert baru
  prepare('DELETE FROM facility_discounts WHERE customer_type = ?').run(req.params.type);
  facility_ids.forEach(fid =>
    prepare('INSERT OR IGNORE INTO facility_discounts (customer_type, facility_id) VALUES (?, ?)').run(req.params.type, fid)
  );
  res.json({ customer_type: req.params.type, facility_ids });
});

module.exports = router;
