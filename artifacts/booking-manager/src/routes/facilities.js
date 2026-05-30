// routes/facilities.js — CRUD fasilitas
const express = require('express');
const { prepare } = require('../database');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/facilities — semua fasilitas (public)
router.get('/', (req, res) => {
  const active = req.query.active;
  const rows = active
    ? prepare('SELECT * FROM facilities WHERE is_active = 1 ORDER BY name').all()
    : prepare('SELECT * FROM facilities ORDER BY name').all();
  res.json(rows);
});

// GET /api/facilities/:id — detail fasilitas (public)
router.get('/:id', (req, res) => {
  const row = prepare('SELECT * FROM facilities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fasilitas tidak ditemukan' });
  res.json(row);
});

// POST /api/facilities — tambah fasilitas (admin)
router.post('/', auth, (req, res) => {
  const { name, description, base_price, open_time, close_time, image_url } = req.body;
  if (!name || !base_price) return res.status(400).json({ error: 'Nama dan harga wajib diisi' });
  const result = prepare(
    'INSERT INTO facilities (name, description, base_price, open_time, close_time, image_url) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, description || '', Number(base_price), open_time || '06:00', close_time || '22:00', image_url || '');
  res.status(201).json(prepare('SELECT * FROM facilities WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/facilities/:id — update fasilitas (admin)
router.put('/:id', auth, (req, res) => {
  const { name, description, base_price, open_time, close_time, image_url, is_active } = req.body;
  const existing = prepare('SELECT id FROM facilities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Fasilitas tidak ditemukan' });
  prepare(
    'UPDATE facilities SET name=?, description=?, base_price=?, open_time=?, close_time=?, image_url=?, is_active=? WHERE id=?'
  ).run(name, description, Number(base_price), open_time, close_time, image_url, is_active ? 1 : 0, req.params.id);
  res.json(prepare('SELECT * FROM facilities WHERE id = ?').get(req.params.id));
});

// DELETE /api/facilities/:id — hapus fasilitas (admin)
router.delete('/:id', auth, (req, res) => {
  const existing = prepare('SELECT id FROM facilities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Fasilitas tidak ditemukan' });
  prepare('DELETE FROM facilities WHERE id = ?').run(req.params.id);
  res.json({ message: 'Fasilitas berhasil dihapus' });
});

module.exports = router;
