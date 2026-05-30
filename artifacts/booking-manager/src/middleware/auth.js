// middleware/auth.js — proteksi route admin
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'sportcenter-jwt-secret-2024';

module.exports = (req, res, next) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Akses ditolak. Login terlebih dahulu.' });
  try {
    req.admin = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token tidak valid atau sudah kadaluarsa' });
  }
};
