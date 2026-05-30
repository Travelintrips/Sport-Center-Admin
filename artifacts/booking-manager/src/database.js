// database.js — setup SQLite (node:sqlite built-in) + seed data
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'booking.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── Skema tabel ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS discount_settings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_type       TEXT UNIQUE NOT NULL,
    discount_percentage INTEGER NOT NULL DEFAULT 0,
    description         TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    updated_at          TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS facility_discounts (
    customer_type TEXT NOT NULL,
    facility_id   INTEGER NOT NULL,
    PRIMARY KEY (customer_type, facility_id)
  );

  CREATE TABLE IF NOT EXISTS customers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    customer_type   TEXT NOT NULL DEFAULT 'umum',
    id_card_number  TEXT UNIQUE,
    is_verified     INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS facilities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    base_price  INTEGER NOT NULL,
    open_time   TEXT DEFAULT '06:00',
    close_time  TEXT DEFAULT '22:00',
    is_active   INTEGER NOT NULL DEFAULT 1,
    image_url   TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_code        TEXT UNIQUE NOT NULL,
    customer_name       TEXT NOT NULL,
    customer_phone      TEXT,
    customer_type       TEXT NOT NULL DEFAULT 'umum',
    id_card_number      TEXT,
    facility_id         INTEGER NOT NULL,
    booking_date        TEXT NOT NULL,
    start_time          TEXT NOT NULL,
    end_time            TEXT NOT NULL,
    duration_hours      INTEGER NOT NULL,
    base_price          INTEGER NOT NULL,
    discount_percentage INTEGER NOT NULL DEFAULT 0,
    discount_amount     INTEGER NOT NULL DEFAULT 0,
    final_price         INTEGER NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'verified',
    notes               TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (facility_id) REFERENCES facilities(id)
  );

  CREATE TABLE IF NOT EXISTS verification_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id     INTEGER,
    booking_code   TEXT,
    scanned_id     TEXT,
    admin_username TEXT,
    ip_address     TEXT,
    result         TEXT,
    detail         TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Helper prepare (API mirip better-sqlite3) ───────────────────────────────
function prepare(sql) {
  const stmt = db.prepare(sql);
  return {
    get:  (...args) => stmt.get(...args) || null,
    all:  (...args) => stmt.all(...args),
    run:  (...args) => stmt.run(...args),
  };
}

const hashPassword = (pwd) =>
  crypto.createHash('sha256').update(pwd + 'sportcenter-salt-2024').digest('hex');

// ─── Seed admin ───────────────────────────────────────────────────────────────
if (!prepare('SELECT id FROM admins WHERE username = ?').get('admin')) {
  prepare('INSERT INTO admins (username, password, name) VALUES (?, ?, ?)').run(
    'admin', hashPassword('admin123'), 'Administrator'
  );
}

// ─── Seed discount settings ───────────────────────────────────────────────────
if (!prepare("SELECT id FROM discount_settings WHERE customer_type = 'angkasa_pura'").get()) {
  prepare("INSERT INTO discount_settings (customer_type, discount_percentage, description) VALUES (?, ?, ?)").run(
    'angkasa_pura', 20, 'Diskon khusus karyawan Angkasa Pura'
  );
}

// ─── Seed fasilitas ───────────────────────────────────────────────────────────
if (prepare('SELECT COUNT(*) as c FROM facilities').get().c === 0) {
  [
    ['Lapangan Futsal A',   'Lapangan futsal indoor berstandar internasional', 150000, '06:00', '22:00', 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600'],
    ['Lapangan Futsal B',   'Lapangan futsal indoor kapasitas 10 pemain',      130000, '06:00', '22:00', 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600'],
    ['Lapangan Basket',     'Lapangan basket outdoor ring standar NBA',         120000, '06:00', '22:00', 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=600'],
    ['Lapangan Tenis',      'Lapangan tenis hardcourt pencahayaan LED',         100000, '06:00', '21:00', 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=600'],
    ['Lapangan Badminton A','Lapangan badminton indoor standar BWF',             90000, '06:00', '22:00', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=600'],
    ['Lapangan Badminton B','Lapangan badminton indoor standar BWF',             90000, '06:00', '22:00', 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=600'],
    ['Gymnasium',           'Gym lengkap dengan peralatan modern',               80000, '05:00', '22:00', 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600'],
  ].forEach(([name, desc, price, open, close, img]) =>
    prepare('INSERT INTO facilities (name,description,base_price,open_time,close_time,image_url) VALUES (?,?,?,?,?,?)').run(name,desc,price,open,close,img)
  );
}

// ─── Seed facility_discounts (semua fasilitas dapat diskon AP secara default) ─
if (prepare('SELECT COUNT(*) as c FROM facility_discounts').get().c === 0) {
  const facilities = prepare('SELECT id FROM facilities').all();
  facilities.forEach(f =>
    prepare('INSERT OR IGNORE INTO facility_discounts (customer_type, facility_id) VALUES (?, ?)').run('angkasa_pura', f.id)
  );
}

// ─── Seed sample customers ────────────────────────────────────────────────────
if (prepare('SELECT COUNT(*) as c FROM customers').get().c === 0) {
  [
    ['Budi Santoso',    '08111234567', 'budi@example.com',  'umum',         null,          1],
    ['Siti Rahayu',     '08222345678', 'siti@example.com',  'angkasa_pura', 'AP-2024-001', 1],
    ['Ahmad Fauzi',     '08333456789', 'ahmad@example.com', 'angkasa_pura', 'AP-2024-002', 1],
    ['Dewi Kartika',    '08444567890', 'dewi@example.com',  'umum',         null,          1],
    ['Eko Prasetyo',    '08555678901', 'eko@example.com',   'angkasa_pura', 'AP-2024-003', 1],
    ['Fitri Handayani', '08666789012', 'fitri@example.com', 'angkasa_pura', 'AP-2024-004', 0],
  ].forEach(row =>
    prepare('INSERT INTO customers (name,phone,email,customer_type,id_card_number,is_verified) VALUES (?,?,?,?,?,?)').run(...row)
  );
}

module.exports = { db, prepare, hashPassword };
