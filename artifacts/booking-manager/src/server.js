// server.js — entry point Express
const express = require('express');
const cors = require('cors');
const path = require('path');

require('./database'); // inisialisasi DB + seed

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',                  require('./routes/auth'));
app.use('/api/facilities',            require('./routes/facilities'));
app.use('/api/customers',             require('./routes/customers'));
app.use('/api/bookings',              require('./routes/bookings'));
app.use('/api/settings',              require('./routes/settings'));
app.use('/api/verify-angkasa-pura',   require('./routes/verify'));

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/admin/*', (_req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'))
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Booking Manager → http://localhost:${PORT}`);
  console.log(`   Admin → http://localhost:${PORT}/admin/login.html`);
});
