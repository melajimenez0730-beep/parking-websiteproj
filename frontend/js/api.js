const API_BASE = 'http://localhost:3000/api';

async function request(method, path, body = null, auth = false) {
  const headers = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = localStorage.getItem('staff_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data   = data;
    throw err;
  }

  return data;
}

export const ParkingAPI = {
  getSpots: (level) =>
    request('GET', `/parking/levels/${level}/spots`),

  recommend: (level, criteria) =>
    request('GET', `/parking/recommend?level=${level}&criteria=${criteria}`),

  softLock: (spotId, userId, vehicleInfo, mobileNumber = null) =>
    request('POST', `/parking/spots/${spotId}/soft-lock`, { userId, vehicleInfo, mobileNumber }),

  reserve: (spotId, lockId, vehicleInfo) =>
    request('POST', `/parking/spots/${spotId}/reserve`, { lockId, vehicleInfo }),

  parkNow: (spotId, mobileNumber, vehicleInfo = {}) =>
    request('POST', `/parking/spots/${spotId}/park-now`, { mobileNumber, vehicleInfo }),

  checkMobile: (mobile) =>
    request('GET', `/parking/check-mobile?mobile=${encodeURIComponent(mobile)}`),

  occupy: (spotId, vehicleInfo) =>
    request('POST', `/parking/spots/${spotId}/occupy`, { vehicleInfo }),

  release: (spotId) =>
    request('DELETE', `/parking/spots/${spotId}/release`),
};

export const UserAPI = {
  tokenLogin: (mobileNumber, otpCode) =>
    request('POST', '/user/token-login', { mobileNumber, otpCode }),

  logout: (mobileNumber, token) =>
    request('POST', '/user/logout', { mobileNumber, token }),

  status: (mobile) =>
    request('GET', `/user/status?mobile=${encodeURIComponent(mobile)}`),

  recordStrike: (mobileNumber) =>
    request('POST', '/user/strike', { mobileNumber }),
};

export const AuthAPI = {
  login: (username, password) =>
    request('POST', '/auth/login', { username, password }),

  logout: () =>
    request('POST', '/auth/logout', null, true),

  verify: () =>
    request('GET', '/auth/verify', null, true),
};

export const StaffAPI = {
  overview: () =>
    request('GET', '/staff/overview', null, true),

  transactions: (page = 1, limit = 50, floor = '', type = '', dateFrom = '', dateTo = '') => {
    const params = new URLSearchParams({ page, limit });
    if (floor)    params.set('floor',    floor);
    if (type)     params.set('type',     type);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo',   dateTo);
    return request('GET', `/staff/transactions?${params}`, null, true);
  },

  exportTransactions: async (floor = '', type = '', dateFrom = '', dateTo = '') => {
    const params = new URLSearchParams();
    if (floor)    params.set('floor',    floor);
    if (type)     params.set('type',     type);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo',   dateTo);

    const token = localStorage.getItem('staff_token');
    const res   = await fetch(`${API_BASE}/staff/transactions/export?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) throw new Error('Export failed');

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `parksmart-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  spots: (floor = '') => {
    const params = floor ? `?floor=${floor}` : '';
    return request('GET', `/staff/spots${params}`, null, true);
  },

  updateSpot: (spotId, status, notes = '') =>
    request('PATCH', `/staff/spots/${spotId}`, { status, notes }, true),

  analytics: () =>
    request('GET', '/staff/analytics', null, true),
};

export function toast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id        = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  const el      = document.createElement('div');
  el.className  = `toast ${type}`;
  el.innerHTML  = `<span style="font-size:16px">${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateY(10px)';
    el.style.transition = 'all 0.25s ease';
    setTimeout(() => el.remove(), 250);
  }, duration);
}

export function initTheme() {
  const saved = localStorage.getItem('ps_theme') || 'dark';
  if (saved === 'light') document.body.classList.add('light-mode');

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.title     = saved === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    btn.textContent = saved === 'light' ? '🌙' : '☀️';

    btn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-mode');
      const next    = isLight ? 'light' : 'dark';
      localStorage.setItem('ps_theme', next);
      document.querySelectorAll('.theme-toggle').forEach(b => {
        b.textContent = isLight ? '🌙' : '☀️';
        b.title       = isLight ? 'Switch to dark mode' : 'Switch to light mode';
      });
    });
  });
}
