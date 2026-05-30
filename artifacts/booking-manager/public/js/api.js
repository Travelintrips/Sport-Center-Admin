// api.js — helper HTTP request ke backend
const API = (() => {
  const BASE = '/api';

  function getToken() { return localStorage.getItem('admin_token'); }

  async function request(method, path, data) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const token = getToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (data) opts.body = JSON.stringify(data);
    const res = await fetch(BASE + path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  return {
    get:    (path)        => request('GET',    path),
    post:   (path, data)  => request('POST',   path, data),
    put:    (path, data)  => request('PUT',    path, data),
    delete: (path)        => request('DELETE', path),
    // Auth
    login:  (u, p) => request('POST', '/auth/login', { username: u, password: p }),
    me:     ()     => request('GET',  '/auth/me'),
  };
})();

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatRp(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function formatDate(str) {
  if (!str) return '-';
  const d = new Date(str);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDateTime(str) {
  if (!str) return '-';
  const d = new Date(str);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
  const map = {
    verified:   '<span class="badge badge-success">✅ Terverifikasi</span>',
    pending:    '<span class="badge badge-warning">⏳ Pending Verifikasi</span>',
    cancelled:  '<span class="badge badge-danger">❌ Dibatalkan</span>',
    rejected:   '<span class="badge badge-danger">🚫 Ditolak</span>',
  };
  return map[status] || `<span class="badge badge-secondary">${status}</span>`;
}

function typeBadge(type) {
  return type === 'angkasa_pura'
    ? '<span class="badge badge-info">✈️ Angkasa Pura</span>'
    : '<span class="badge badge-secondary">👤 Umum</span>';
}

// Toast notification
function toast(msg, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// Show/hide loading overlay
function showLoading() { document.getElementById('loading')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading')?.classList.add('hidden'); }

// Get query param
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
