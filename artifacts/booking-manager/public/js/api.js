// api.js — helper HTTP request ke backend
const API = (() => {
  const BASE = '/api';
  function getToken() { return localStorage.getItem('admin_token'); }

  async function request(method, path, data) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    const token = getToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (data !== undefined) opts.body = JSON.stringify(data);
    const res = await fetch(BASE + path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  return {
    get:    (path)       => request('GET',    path),
    post:   (path, data) => request('POST',   path, data),
    put:    (path, data) => request('PUT',    path, data),
    delete: (path)       => request('DELETE', path),
    login:  (u, p)       => request('POST', '/auth/login', { username: u, password: p }),
    me:     ()           => request('GET',  '/auth/me'),
  };
})();

// ─── Format helpers ───────────────────────────────────────────────────────────
function formatRp(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}
function formatDate(str) {
  if (!str) return '-';
  return new Date(str).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}
function formatDateTime(str) {
  if (!str) return '-';
  return new Date(str).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    verified:             '<span class="badge badge-success">✅ Terverifikasi</span>',
    pending_verification: '<span class="badge badge-warning">⏳ Pending Verifikasi</span>',
    pending:              '<span class="badge badge-warning">⏳ Pending</span>',
    cancelled:            '<span class="badge badge-danger">❌ Dibatalkan</span>',
    rejected:             '<span class="badge badge-danger">🚫 Ditolak</span>',
  };
  return map[status] || `<span class="badge badge-secondary">${status}</span>`;
}

function typeBadge(type) {
  return type === 'angkasa_pura'
    ? '<span class="badge badge-info">✈️ Angkasa Pura</span>'
    : '<span class="badge badge-secondary">👤 Umum</span>';
}

// ─── Toast notification ───────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showLoading() { document.getElementById('loading')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading')?.classList.add('hidden'); }

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
