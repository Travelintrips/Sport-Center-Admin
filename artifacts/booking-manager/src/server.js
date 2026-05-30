// server.js — entry point Express
const express = require('express');
const cors = require('cors');
const path = require('path');

// Inisialisasi database (seed otomatis)
require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware global ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/facilities', require('./routes/facilities'));
app.use('/api/customers',  require('./routes/customers'));
app.use('/api/bookings',   require('./routes/bookings'));
app.use('/api/settings',   require('./routes/settings'));

// ─── Static files (frontend) ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback untuk admin routes
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Sport Center Booking Manager berjalan di port ${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin/login.html`);
  console.log(`   Customer: http://localhost:${PORT}`);
});
