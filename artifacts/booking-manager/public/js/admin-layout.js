// admin-layout.js — inject sidebar + proteksi halaman admin
(async function() {
  const token = localStorage.getItem('admin_token');
  if (!token) { window.location.href = '/admin/login.html'; return; }

  // Verifikasi token
  try {
    const me = await API.me();
    document.querySelectorAll('.admin-name').forEach(el => el.textContent = me.name);
  } catch {
    localStorage.removeItem('admin_token');
    window.location.href = '/admin/login.html';
    return;
  }

  // Inject sidebar
  const currentPath = window.location.pathname;
  const navItems = [
    { href: '/admin/index.html',      icon: '📊', label: 'Dashboard' },
    { href: '/admin/bookings.html',   icon: '📋', label: 'Booking' },
    { href: '/admin/customers.html',  icon: '👥', label: 'Customer' },
    { href: '/admin/facilities.html', icon: '🏟️', label: 'Fasilitas' },
    { href: '/admin/settings.html',   icon: '⚙️', label: 'Pengaturan' },
  ];

  const navHtml = navItems.map(item => {
    const active = currentPath.endsWith(item.href.split('/').pop()) ? 'active' : '';
    return `<a href="${item.href}" class="${active}"><span class="nav-icon">${item.icon}</span>${item.label}</a>`;
  }).join('');

  const sidebarHtml = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <h2>⚽ Sport Center</h2>
        <p>Admin Panel</p>
      </div>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-footer">
        <div style="font-size:.82rem;color:rgba(255,255,255,.5);margin-bottom:.5rem">Login sebagai <strong class="admin-name"></strong></div>
        <button onclick="adminLogout()" class="btn btn-danger btn-sm btn-block">🚪 Logout</button>
      </div>
    </aside>
    <div id="sidebar-overlay" onclick="closeSidebar()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:199;"></div>
  `;
  document.getElementById('sidebar-root').innerHTML = sidebarHtml;
  document.querySelectorAll('.admin-name').forEach(el => {
    const stored = localStorage.getItem('admin_name');
    if (stored) el.textContent = stored;
  });
})();

function adminLogout() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_name');
  window.location.href = '/admin/login.html';
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  const ov = document.getElementById('sidebar-overlay');
  if (ov) ov.style.display = ov.style.display === 'none' ? 'block' : 'none';
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  const ov = document.getElementById('sidebar-overlay');
  if (ov) ov.style.display = 'none';
}
