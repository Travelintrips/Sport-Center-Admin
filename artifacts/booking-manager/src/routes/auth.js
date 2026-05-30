// routes/auth.js — login & verifikasi admin
const express = require('express');
const jwt = require('jsonwebtoken');
const { prepare, hashPassword } = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'sportcenter-jwt-secret-2024';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });

  const admin = prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || admin.password !== hashPassword(password)) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  const token = jwt.sign({ id: admin.id, username: admin.username, name: admin.name }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, name: admin.name });
});

// GET /api/auth/me — validasi token
router.get('/me', (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Token diperlukan' });
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    res.json({ id: payload.id, username: payload.username, name: payload.name });
  } catch {
    res.status(401).json({ error: 'Token tidak valid' });
  }
});

module.exports = router;
