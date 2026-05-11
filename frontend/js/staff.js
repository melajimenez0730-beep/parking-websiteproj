function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

const LM_ISLANDS = [
  { label: 'A', colLeft: range(1,18),   colRight: range(19,36)   },
  { label: 'B', colLeft: range(37,54),  colRight: range(55,72)   },
  { label: 'C', colLeft: range(73,90),  colRight: range(91,108)  },
  { label: 'D', colLeft: range(109,126),colRight: range(127,144) },
  { label: 'E', colLeft: range(145,162),colRight: range(163,180) },
  { label: 'F', colLeft: range(181,198),colRight: range(199,216) },
];

const TYPE_COLORS = {
  soft_lock: 'type-soft_lock',
  reserve:   'type-reserve',
  occupy:    'type-occupy',
  release:   'type-release',
  expire:    'type-expire',
};

const SHARD_LABELS = { 1: 'Shard 1', 2: 'Shard 2', 3: 'Shard 3' };

const FEATURE_ICONS = { entrance: '🚪', exit: '⬅️', grocery: '🛒', disability: '♿' };

let hourlyChart = null;
let statusChart = null;
let typeChart   = null;

export function initStaff(AuthAPI, StaffAPI, toast) {
  let currentPage      = 1;
  let totalPages       = 1;
  let filterFloor      = '';
  let filterType       = '';
  let filterDateFrom   = '';
  let filterDateTo     = '';
  let autoRefresh      = false;
  let autoRefreshInt   = null;
  let currentView      = 'overview';
  let currentSMFloor   = '';
  let smStatusFilter   = '';
  let editingSpot      = null;
  let pwdBadgeInterval       = null;
  let pwdCardCountdownInt    = null;
  let lmFloor       = 1;
  let lmSpots       = [];
  let lmEditingSpot = null;

  const loginPage  = document.getElementById('login-page');
  const dashboard  = document.getElementById('dashboard');

  const token = localStorage.getItem('staff_token');
  if (token) verifyAndShow();

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = document.getElementById('login-btn');
    const errEl    = document.getElementById('login-error');
    const username = document.getElementById('l-username').value.trim();
    const password = document.getElementById('l-password').value;

    btn.disabled    = true;
    btn.textContent = 'Signing in…';
    errEl.classList.remove('show');

    try {
      const result = await AuthAPI.login(username, password);
      localStorage.setItem('staff_token', result.token);
      localStorage.setItem('staff_user',  result.username);
      showDashboard(result.username);
    } catch (err) {
      errEl.textContent = err.message || 'Invalid credentials.';
      errEl.classList.add('show');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Sign In';
    }
  });

  async function verifyAndShow() {
    try {
      const res = await AuthAPI.verify();
      if (res.valid) {
        showDashboard(res.user.username);
      } else {
        localStorage.removeItem('staff_token');
        localStorage.removeItem('staff_user');
      }
    } catch {
      localStorage.removeItem('staff_token');
    }
  }

  function showDashboard(username) {
    loginPage.style.display = 'none';
    dashboard.classList.add('show');

    const name = username || localStorage.getItem('staff_user') || 'admin';
    document.getElementById('user-name').textContent   = name;
    document.getElementById('user-avatar').textContent = name[0].toUpperCase();
    document.getElementById('drawer-logout').onclick   = doLogout;
    document.getElementById('logout-btn').addEventListener('click', doLogout);

    showView('overview');
    loadOverview();
    startPWDBadgePolling();
  }

  async function doLogout() {
    try { await AuthAPI.logout(); } catch { /* ignore */ }
    localStorage.removeItem('staff_token');
    localStorage.removeItem('staff_user');
    stopAutoRefresh();
    if (pwdBadgeInterval)    { clearInterval(pwdBadgeInterval);    pwdBadgeInterval    = null; }
    if (pwdCardCountdownInt) { clearInterval(pwdCardCountdownInt); pwdCardCountdownInt = null; }
    dashboard.classList.remove('show');
    loginPage.style.display = 'flex';
  }

  function showView(viewName) {
    currentView = viewName;
    // Clear PWD card countdown when navigating away
    if (viewName !== 'pwd' && pwdCardCountdownInt) {
      clearInterval(pwdCardCountdownInt); pwdCardCountdownInt = null;
    }
    ['overview', 'transactions', 'spots', 'analytics', 'pwd', 'livemap'].forEach(v => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.classList.toggle('active', v === viewName);
    });
    document.querySelectorAll('.drawer-nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
    if (viewName === 'transactions') loadTransactions();
    if (viewName === 'analytics')    loadAnalytics();
    if (viewName === 'spots')        { smStatusFilter = ''; loadSpots(currentSMFloor); }
    if (viewName === 'pwd')          loadPWDRequests();
    if (viewName === 'livemap')      loadLiveMap(lmFloor);
  }

  const drawer   = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');

  document.getElementById('burger-btn').addEventListener('click', () => drawer.classList.add('open'));
  backdrop.addEventListener('click', () => drawer.classList.remove('open'));

  document.querySelectorAll('.drawer-nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      drawer.classList.remove('open');
      showView(item.dataset.view);
    });
  });

  const arBtn   = document.getElementById('auto-refresh-btn');
  const arLabel = document.getElementById('ar-label');

  arBtn.addEventListener('click', () => {
    autoRefresh = !autoRefresh;
    if (autoRefresh) {
      arBtn.classList.add('on');
      arLabel.textContent = 'Auto-refresh On';
      autoRefreshInt = setInterval(() => {
        loadOverview();
        if (currentView === 'transactions') loadTransactions();
        if (currentView === 'analytics')    loadAnalytics();
        if (currentView === 'spots')        loadSpots(currentSMFloor);
        if (currentView === 'pwd')          loadPWDRequests();
        if (currentView === 'livemap')      loadLiveMap(lmFloor);
      }, 10000);
    } else {
      stopAutoRefresh();
    }
  });

  function stopAutoRefresh() {
    autoRefresh = false;
    arBtn.classList.remove('on');
    arLabel.textContent = 'Auto-refresh Off';
    clearInterval(autoRefreshInt);
  }

  document.getElementById('apply-filter-btn').addEventListener('click', () => {
    filterFloor    = document.getElementById('f-floor').value;
    filterType     = document.getElementById('f-type').value;
    filterDateFrom = document.getElementById('f-date-from').value;
    filterDateTo   = document.getElementById('f-date-to').value;
    currentPage    = 1;
    loadTransactions();
  });

  document.getElementById('reset-filter-btn').addEventListener('click', () => {
    filterFloor = ''; filterType = ''; filterDateFrom = ''; filterDateTo = '';
    currentPage = 1;
    document.getElementById('f-floor').value     = '';
    document.getElementById('f-type').value      = '';
    document.getElementById('f-date-from').value = '';
    document.getElementById('f-date-to').value   = '';
    loadTransactions();
  });

  document.getElementById('refresh-txn-btn').addEventListener('click', () => {
    loadOverview();
    loadTransactions();
  });

  document.getElementById('export-csv-btn').addEventListener('click', async () => {
    const btn = document.getElementById('export-csv-btn');
    btn.disabled    = true;
    btn.textContent = '⏳ Exporting…';
    try {
      await StaffAPI.exportTransactions(filterFloor, filterType, filterDateFrom, filterDateTo);
      toast('CSV exported successfully!', 'success');
    } catch (err) {
      toast(err.message || 'Export failed.', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = '⬇ Export CSV';
    }
  });

  async function loadOverview() {
    try {
      const data = await StaffAPI.overview();
      document.getElementById('s-total').textContent     = data.totalSpots;
      document.getElementById('s-available').textContent = data.available;
      document.getElementById('s-reserved').textContent  = data.reserved + data.softLocked;
      document.getElementById('s-occupied').textContent  = data.occupied;
      renderFloorBreakdown(data.byFloor);
    } catch (err) {
      console.error(err);
    }
  }

  function renderFloorBreakdown(byFloor) {
    const el = document.getElementById('floor-breakdown');
    el.innerHTML = [1, 2, 3].map(f => {
      const d  = byFloor[`floor${f}`] || { available: 0, reserved: 0, occupied: 0, soft_locked: 0, total: 12 };
      const rt = (d.reserved || 0) + (d.soft_locked || 0);
      const pct = Math.round((d.available / (d.total || 12)) * 100);
      const barColor = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--amber)' : 'var(--red)';
      return `
        <div class="floor-card">
          <div class="floor-card-title">
            <span>Floor ${f} <span style="color:var(--text-4);font-weight:400;">· ${SHARD_LABELS[f]}</span></span>
            <span style="font-family:var(--font-mono);font-size:13px;color:var(--accent);">${pct}%</span>
          </div>
          <div style="height:3px;background:var(--border-subtle);border-radius:2px;margin-bottom:12px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;transition:width 0.5s ease;"></div>
          </div>
          <div class="floor-stat-row"><span>Available</span><span class="floor-stat-val green">${d.available}</span></div>
          <div class="floor-stat-row"><span>Reserved / Locked</span><span class="floor-stat-val amber">${rt}</span></div>
          <div class="floor-stat-row"><span>Occupied</span><span class="floor-stat-val red">${d.occupied}</span></div>
          <div class="floor-stat-row" style="border-top:1px solid var(--border-faint);margin-top:4px;padding-top:6px;">
            <span>Total</span><span class="floor-stat-val" style="color:var(--text-2);">${d.total}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadTransactions() {
    const tbody = document.getElementById('txn-body');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-4);"><div class="spinner" style="margin:0 auto;"></div></td></tr>`;

    try {
      const data = await StaffAPI.transactions(currentPage, 50, filterFloor, filterType, filterDateFrom, filterDateTo);
      totalPages = data.pages || 1;
      const total = data.total || 0;

      document.getElementById('txn-total').innerHTML =
        `Showing <strong>${Math.min(50 * currentPage, total)}</strong> of <strong>${total}</strong> records`;

      if (!data.transactions || data.transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:48px;color:var(--text-4);"><div style="font-size:28px;margin-bottom:10px;">📋</div>No transactions found.</td></tr>`;
      } else {
        tbody.innerHTML = data.transactions.map(txn => renderTxnRow(txn)).join('');
      }

      renderPagination(currentPage, totalPages);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--red);">⚠ Failed to load: ${err.message}</td></tr>`;
    }
  }

  function renderTxnRow(txn) {
    const ts = txn.timestamp
      ? new Date(txn.timestamp).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'medium' })
      : '—';
    const padNum     = String(txn.spotNum || 0).padStart(2, '0');
    const txnIdShort = txn.transactionId ? txn.transactionId.split('-')[0] + '…' : '—';
    return `
      <tr>
        <td><span style="font-family:var(--font-mono);font-size:11px;color:var(--text-4);" title="${txn.transactionId}">${txnIdShort}</span></td>
        <td>
          <span style="font-size:13px;color:var(--text-2);">Floor ${txn.floor_number}</span>
          <span style="display:block;font-size:11px;color:var(--text-4);font-family:var(--font-mono);">${SHARD_LABELS[txn.floor_number] || '—'}</span>
        </td>
        <td><span style="font-family:var(--font-mono);font-weight:600;color:var(--text-1);">P${padNum}</span></td>
        <td><span class="type-badge ${TYPE_COLORS[txn.type] || ''}">${(txn.type || '').replace('_', ' ')}</span></td>
        <td style="color:var(--text-2);">${txn.vehicle?.owner || '—'}</td>
        <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--text-2);">${txn.vehicle?.plate || '—'}</span></td>
        <td style="font-size:12px;color:var(--text-3);white-space:nowrap;">${ts}</td>
      </tr>
    `;
  }

  function renderPagination(page, total) {
    const el = document.getElementById('pagination');
    if (total <= 1) { el.innerHTML = ''; return; }

    let html = `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="window.__goPage(${page - 1})">‹</button>`;
    const start = Math.max(1, page - 2);
    const end   = Math.min(total, start + 4);

    if (start > 1) html += `<button class="page-btn" onclick="window.__goPage(1)">1</button>`;
    if (start > 2) html += `<span style="color:var(--text-4);padding:0 4px;">…</span>`;
    for (let i = start; i <= end; i++) {
      html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="window.__goPage(${i})">${i}</button>`;
    }
    if (end < total - 1) html += `<span style="color:var(--text-4);padding:0 4px;">…</span>`;
    if (end < total) html += `<button class="page-btn" onclick="window.__goPage(${total})">${total}</button>`;
    html += `<button class="page-btn" ${page >= total ? 'disabled' : ''} onclick="window.__goPage(${page + 1})">›</button>`;

    el.innerHTML = html;
  }

  window.__goPage = (page) => {
    currentPage = page;
    loadTransactions();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  document.getElementById('sm-load-btn').addEventListener('click', () => {
    currentSMFloor = document.getElementById('sm-floor').value;
    loadSpots(currentSMFloor);
  });
  document.getElementById('sm-refresh-btn').addEventListener('click', () => { smStatusFilter = ''; loadSpots(currentSMFloor); });

  async function loadSpots(floor) {
    const tbody = document.getElementById('sm-body');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;"><div class="spinner" style="margin:0 auto;"></div></td></tr>`;

    try {
      const spots = await StaffAPI.spots(floor);
      window.__spotCache = spots;

      if (!spots.length) {
        document.getElementById('sm-status-tabs').style.display = 'none';
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:48px;color:var(--text-4);">No spots found.</td></tr>`;
        return;
      }

      renderSMTabs(spots);
      renderSMRows(spots);
    } catch (err) {
      document.getElementById('sm-status-tabs').style.display = 'none';
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--red);">⚠ ${err.message}</td></tr>`;
    }
  }

  function renderSMTabs(spots) {
    const counts = { '': spots.length };
    ['reserved', 'soft_locked', 'occupied', 'exiting', 'available'].forEach(s => {
      counts[s] = spots.filter(x => x.status === s).length;
    });
    const activeCount = (counts.reserved || 0) + (counts.soft_locked || 0) + (counts.occupied || 0) + (counts.exiting || 0);

    const tabs = [
      { key: '',          label: 'All',       count: counts[''],        activeClass: 'active' },
      { key: 'active',    label: 'In Use',    count: activeCount,       activeClass: 'active-occupied' },
      { key: 'reserved',  label: 'Reserved',  count: counts.reserved,   activeClass: 'active-reserved' },
      { key: 'soft_locked',label: 'Held',     count: counts.soft_locked,activeClass: 'active-reserved' },
      { key: 'occupied',  label: 'Occupied',  count: counts.occupied,   activeClass: 'active-occupied' },
      { key: 'exiting',   label: 'Exiting',   count: counts.exiting,    activeClass: 'active-exiting'  },
      { key: 'available', label: 'Available', count: counts.available,  activeClass: 'active-available'},
    ];

    const tabsEl = document.getElementById('sm-status-tabs');
    tabsEl.style.display = 'flex';
    tabsEl.innerHTML = tabs.map(t => `
      <button class="sm-tab ${smStatusFilter === t.key ? t.activeClass : ''}" data-key="${t.key}">
        ${t.label}
        <span class="sm-tab-count">${t.count}</span>
      </button>
    `).join('');

    tabsEl.querySelectorAll('.sm-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        smStatusFilter = btn.dataset.key;
        renderSMTabs(window.__spotCache || []);
        renderSMRows(window.__spotCache || []);
      });
    });
  }

  function renderSMRows(spots) {
    const tbody = document.getElementById('sm-body');
    let filtered = spots;
    if (smStatusFilter === 'active') {
      filtered = spots.filter(s => ['reserved','soft_locked','occupied','exiting'].includes(s.status));
    } else if (smStatusFilter) {
      filtered = spots.filter(s => s.status === smStatusFilter);
    }

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:48px;color:var(--text-4);">No spots with this status.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(spot => {
      const pad   = String(spot.spotNum).padStart(2, '0');
      const feats = (spot.features || []).map(f => `<span title="${f}">${FEATURE_ICONS[f] || f}</span>`).join(' ');
      return `
        <tr>
          <td><span style="font-family:var(--font-mono);font-weight:700;color:var(--text-1);">P${pad}</span></td>
          <td>Floor ${spot.floor_number} <span style="color:var(--text-4);font-size:12px;">· ${SHARD_LABELS[spot.floor_number]}</span></td>
          <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-3);">R${spot.row} · C${spot.col}</td>
          <td style="font-size:14px;">${feats || '<span style="color:var(--text-4);">—</span>'}</td>
          <td><span class="status-pill ${spot.status}">${spot.status.replace('_', ' ')}</span></td>
          <td style="color:var(--text-3);font-size:13px;">${spot.vehicle?.owner || spot.reservedBy || '—'}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="window.__editSpot('${spot.spotId}')">Edit</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  const spotModal = document.getElementById('spot-editor-modal');

  window.__editSpot = (spotId) => {
    const spot = (window.__spotCache || []).find(s => s.spotId === spotId);
    if (!spot) return;
    editingSpot = spot;

    const pad      = String(spot.spotNum).padStart(2, '0');
    const isActive = ['occupied', 'reserved', 'soft_locked', 'exiting'].includes(spot.status);
    document.getElementById('se-title').textContent = `Force Release P${pad}`;
    document.getElementById('se-sub').textContent   = `Floor ${spot.floor_number} · Row ${spot.row} · Col ${spot.col}`;
    document.getElementById('se-occupant-info').style.display = isActive ? '' : 'none';
    document.getElementById('se-available-msg').style.display = isActive ? 'none' : '';
    document.getElementById('se-release-info').style.display  = isActive ? '' : 'none';
    document.getElementById('se-save').disabled                = !isActive;

    if (isActive) {
      const ST = { reserved: 'Reserved 🟡', occupied: 'Occupied 🔴', soft_locked: 'Held 🟡', exiting: 'Exiting 🟡' };
      document.getElementById('se-occ-status').textContent = ST[spot.status] || spot.status;
      document.getElementById('se-occ-owner').textContent  = spot.vehicle?.owner || spot.reservedBy || '—';
      document.getElementById('se-occ-plate').textContent  = spot.vehicle?.plate || '—';
      document.getElementById('se-occ-mobile').textContent = spot.mobileNumber || '—';
    }
    document.getElementById('se-notes').value = '';
    spotModal.classList.add('open');
  };

  document.getElementById('se-cancel').addEventListener('click', () => {
    spotModal.classList.remove('open');
    editingSpot = null;
  });
  spotModal.addEventListener('click', (e) => {
    if (e.target === spotModal) { spotModal.classList.remove('open'); editingSpot = null; }
  });

  document.getElementById('se-save').addEventListener('click', async () => {
    if (!editingSpot) return;
    const notes = document.getElementById('se-notes').value.trim();
    const btn   = document.getElementById('se-save');

    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Releasing…';

    try {
      await StaffAPI.updateSpot(editingSpot.spotId, 'available', notes);
      const pad = String(editingSpot.spotNum).padStart(2, '0');
      toast(`Spot P${pad} force-released`, 'success');
      spotModal.classList.remove('open');
      editingSpot = null;
      loadSpots(currentSMFloor);
      loadOverview();
    } catch (err) {
      toast(err.message || 'Failed to release spot.', 'error');
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '⚡ Force Release';
    }
  });

  // ── PWD badge polling ─────────────────────────────────────────────────
  function startPWDBadgePolling() {
    pollPWDBadge();
    if (pwdBadgeInterval) clearInterval(pwdBadgeInterval);
    pwdBadgeInterval = setInterval(pollPWDBadge, 5000);
  }

  async function pollPWDBadge() {
    try {
      const { count } = await StaffAPI.pwdCount();
      const badge = document.getElementById('pwd-nav-badge');
      if (badge) {
        badge.textContent    = count;
        badge.style.display  = count > 0 ? '' : 'none';
      }
    } catch { /* silent — badge polling is non-critical */ }
  }

  // ── PWD Approvals view ────────────────────────────────────────────────
  async function loadPWDRequests() {
    const list = document.getElementById('pwd-list');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:32px;"><div class="spinner" style="margin:0 auto;"></div></div>';

    try {
      const { requests } = await StaffAPI.pwdRequests();
      if (!requests.length) {
        list.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text-4);"><div style="font-size:32px;margin-bottom:10px;">♿</div>No pending PWD requests.</div>';
        return;
      }
      list.innerHTML = requests.map(req => renderPWDCard(req)).join('');
      window.__pwdRequests = requests;

      // Live countdown
      if (pwdCardCountdownInt) clearInterval(pwdCardCountdownInt);
      pwdCardCountdownInt = setInterval(() => {
        document.querySelectorAll('[data-req-countdown]').forEach(el => {
          const reqId = el.dataset.reqCountdown;
          const req   = (window.__pwdRequests || []).find(r => r.requestId === reqId);
          if (!req) return;
          const secs = Math.max(0, Math.round((new Date(req.expiresAt) - Date.now()) / 1000));
          el.textContent  = secs + 's';
          el.style.color  = secs <= 10 ? 'var(--red)' : secs <= 20 ? 'var(--amber)' : 'var(--text-2)';
          if (secs === 0) {
            clearInterval(pwdCardCountdownInt); pwdCardCountdownInt = null;
            setTimeout(() => loadPWDRequests(), 1200);
          }
        });
      }, 1000);
    } catch (err) {
      list.innerHTML = `<div style="text-align:center;padding:32px;color:var(--red);">⚠ ${err.message}</div>`;
    }
  }

  function renderPWDCard(req) {
    const secs = Math.max(0, Math.round((new Date(req.expiresAt) - Date.now()) / 1000));
    const pad  = String(req.spotNum || 0).padStart(2, '0');
    const act  = req.action === 'park_now' ? '🚗 Park Now' : '🔒 Reserve';
    return `
      <div class="pwd-card" data-req-id="${req.requestId}">
        <div class="pwd-card-header">
          <div style="font-size:36px;flex-shrink:0;">♿</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:15px;font-weight:700;color:var(--text-1);">Spot P${pad} · Floor ${req.floor_number}</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:3px;">${req.mobileNumber} · ${act}</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:2px;">Owner: ${req.vehicleInfo?.owner || '—'} · Plate: ${req.vehicleInfo?.plate || '—'}</div>
          </div>
          <div style="font-family:var(--font-mono);font-size:20px;font-weight:700;flex-shrink:0;" data-req-countdown="${req.requestId}">${secs}s</div>
        </div>
        <div class="pwd-id-images">
          <div class="pwd-id-img">
            <img src="${req.idFront}" alt="Front ID">
            <div class="pwd-id-label">Front of PWD ID</div>
          </div>
          <div class="pwd-id-img">
            <img src="${req.idBack}" alt="Back ID">
            <div class="pwd-id-label">Back of PWD ID</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-ghost btn-full" onclick="window.__pwdDecline('${req.requestId}')">✕ Decline</button>
          <button class="btn btn-primary btn-full" onclick="window.__pwdApprove('${req.requestId}')">✓ Approve</button>
        </div>
      </div>
    `;
  }

  window.__pwdApprove = async (requestId) => {
    const card = document.querySelector(`[data-req-id="${requestId}"]`);
    const btn  = card?.querySelector('.btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
    try {
      await StaffAPI.pwdApprove(requestId);
      toast('PWD request approved!', 'success');
    } catch (err) {
      toast(err.message || 'Failed to approve.', 'error');
    } finally {
      loadPWDRequests();
      pollPWDBadge();
    }
  };

  window.__pwdDecline = async (requestId) => {
    const card = document.querySelector(`[data-req-id="${requestId}"]`);
    const btn  = card?.querySelector('.btn-ghost');
    if (btn) { btn.disabled = true; btn.textContent = 'Declining…'; }
    try {
      await StaffAPI.pwdDecline(requestId);
      toast('PWD request declined.', 'info');
    } catch (err) {
      toast(err.message || 'Failed to decline.', 'error');
    } finally {
      loadPWDRequests();
      pollPWDBadge();
    }
  };

  // ── Live Map ───────────────────────────────────────────────────────────────
  async function loadLiveMap(floor) {
    const grid = document.getElementById('lm-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><div class="spinner"></div></div>';

    try {
      const spots = await StaffAPI.spots(floor);
      lmSpots = spots;
      renderLMGrid(spots);

      const avail = spots.filter(s => s.status === 'available').length;
      const res   = spots.filter(s => ['reserved','soft_locked'].includes(s.status)).length;
      const occ   = spots.filter(s => s.status === 'occupied').length;
      document.getElementById('lm-stat-total').textContent = spots.length;
      document.getElementById('lm-stat-avail').textContent = avail;
      document.getElementById('lm-stat-res').textContent   = res;
      document.getElementById('lm-stat-occ').textContent   = occ;
    } catch (err) {
      grid.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--red);">⚠ ${err.message}</div>`;
    }
  }

  function renderLMGrid(spots) {
    const grid = document.getElementById('lm-grid');
    if (!grid) return;
    const byNum = {};
    spots.forEach(s => { byNum[s.spotNum] = s; });

    let html = '';
    LM_ISLANDS.forEach((island, i) => {
      if (i > 0) {
        html += `<div class="lm-aisle"><div class="lm-aisle-label">Drive</div><div class="lm-aisle-track"></div></div>`;
      }
      html += renderLMIsland(island, byNum);
    });
    grid.innerHTML = html;

    grid.querySelectorAll('.lm-spot-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const spot = lmSpots.find(s => s.spotId === cell.dataset.spotId);
        if (spot) openLMSpotModal(spot);
      });
    });
  }

  function renderLMIsland(island, byNum) {
    const leftCol  = island.colLeft.map(n  => renderLMCell(byNum[n])).join('');
    const rightCol = island.colRight.map(n => renderLMCell(byNum[n])).join('');
    return `
      <div class="lm-island">
        <div class="lm-island-label">${island.label}</div>
        <div class="lm-island-block">
          <div class="lm-spot-col">${leftCol}</div>
          <div class="lm-island-drive">↔</div>
          <div class="lm-spot-col">${rightCol}</div>
        </div>
      </div>`;
  }

  function renderLMCell(spot) {
    if (!spot) return '<div class="lm-spot-empty"></div>';
    const pad   = String(spot.spotNum).padStart(2, '0');
    const feats = spot.features || [];
    const isPwd = feats.includes('disability');
    const isMoto= feats.includes('motorcycle');
    const hc    = isPwd ? '♿' : (isMoto ? '🏍' : '');
    const cls   = isPwd ? 'pwd' : (isMoto ? 'moto' : '');
    return `<div class="lm-spot-cell ${cls}" data-status="${spot.status}" data-spot-id="${spot.spotId}">
      ${hc ? `<div class="lm-spot-hc">${hc}</div>` : ''}
      <div class="lm-spot-dot"></div>
      <div class="lm-spot-id">P${pad}</div>
    </div>`;
  }

  function openLMSpotModal(spot) {
    lmEditingSpot = spot;
    const pad      = String(spot.spotNum).padStart(2, '0');
    const isActive = ['occupied', 'reserved', 'soft_locked', 'exiting'].includes(spot.status);
    document.getElementById('lm-spot-title').textContent = `Spot P${pad}`;
    document.getElementById('lm-spot-sub').textContent   = `Floor ${spot.floor_number} · Row ${spot.row} · Col ${spot.col}`;
    document.getElementById('lm-occupant-info').style.display  = isActive ? '' : 'none';
    document.getElementById('lm-available-info').style.display = isActive ? 'none' : '';
    document.getElementById('lm-release-btn').disabled         = !isActive;

    if (isActive) {
      const ST = { reserved: 'Reserved 🟡', occupied: 'Occupied 🔴', soft_locked: 'Held 🟡', exiting: 'Exiting 🟡' };
      document.getElementById('lm-occ-status').textContent = ST[spot.status] || spot.status;
      document.getElementById('lm-occ-owner').textContent  = spot.vehicle?.owner || spot.reservedBy || '—';
      document.getElementById('lm-occ-plate').textContent  = spot.vehicle?.plate || '—';
      document.getElementById('lm-occ-mobile').textContent = spot.mobileNumber || '—';
    }
    document.getElementById('lm-spot-modal').classList.add('open');
  }

  document.getElementById('lm-close-btn').addEventListener('click', () => {
    document.getElementById('lm-spot-modal').classList.remove('open');
    lmEditingSpot = null;
  });
  document.getElementById('lm-spot-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lm-spot-modal')) {
      document.getElementById('lm-spot-modal').classList.remove('open');
      lmEditingSpot = null;
    }
  });

  document.getElementById('lm-release-btn').addEventListener('click', async () => {
    if (!lmEditingSpot) return;
    const btn = document.getElementById('lm-release-btn');
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Releasing…';
    try {
      await StaffAPI.updateSpot(lmEditingSpot.spotId, 'available', 'Staff force-release via Live Map');
      const pad = String(lmEditingSpot.spotNum).padStart(2, '0');
      toast(`Spot P${pad} force-released`, 'success');
      document.getElementById('lm-spot-modal').classList.remove('open');
      lmEditingSpot = null;
      loadLiveMap(lmFloor);
      loadOverview();
    } catch (err) {
      toast(err.message || 'Failed to release spot.', 'error');
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '⚡ Force Release';
    }
  });

  document.querySelectorAll('.lm-floor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lm-floor-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      lmFloor = parseInt(btn.dataset.floor);
      loadLiveMap(lmFloor);
    });
  });
  document.getElementById('lm-refresh-btn').addEventListener('click', () => loadLiveMap(lmFloor));

  async function loadAnalytics() {
    try {
      const data = await StaffAPI.analytics();

      const activity24h = data.typeStats.reduce((s, t) => s + t.count, 0);
      const availNow    = (data.currentStatus.find(s => s._id === 'available')    || {}).count || 0;
      const occupNow    = (data.currentStatus.find(s => s._id === 'occupied')     || {}).count || 0;

      document.getElementById('a-total').textContent = data.totalTransactions.toLocaleString();
      document.getElementById('a-24h').textContent   = activity24h;
      document.getElementById('a-avail').textContent = availNow;
      document.getElementById('a-occup').textContent = occupNow;

      renderHourlyChart(data.hourlyData);
      renderStatusChart(data.currentStatus);
      renderTypeChart(data.typeStats);
    } catch (err) {
      console.error('Analytics failed:', err);
      toast('Analytics unavailable: ' + err.message, 'error');
    }
  }

  const CHART_OPTS = {
    responsive: true,
    plugins: { legend: { labels: { color: '#B0B0C4', font: { size: 12 } } } },
    scales: {
      x: { ticks: { color: '#6E6E88' }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#6E6E88' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
    },
  };

  function renderHourlyChart(hourlyData) {
    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const counts = new Array(24).fill(0);
    hourlyData.forEach(h => { counts[h._id] = h.count; });

    if (hourlyChart) hourlyChart.destroy();
    const ctx = document.getElementById('hourly-chart').getContext('2d');
    hourlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Transactions',
          data: counts,
          backgroundColor: 'rgba(232,123,61,0.5)',
          borderColor: '#E87B3D',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: { ...CHART_OPTS, plugins: { legend: { display: false } } },
    });
  }

  function renderStatusChart(currentStatus) {
    const STATUS_COLORS = {
      available:   '#22C55E',
      reserved:    '#F59E0B',
      soft_locked: '#F59E0B',
      occupied:    '#EF4444',
    };
    const labels = currentStatus.map(s => s._id.replace('_', ' '));
    const counts = currentStatus.map(s => s.count);
    const colors = currentStatus.map(s => STATUS_COLORS[s._id] || '#60A5FA');

    if (statusChart) statusChart.destroy();
    const ctx = document.getElementById('status-chart').getContext('2d');
    statusChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: counts, backgroundColor: colors, borderColor: 'transparent', borderWidth: 0 }],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#B0B0C4', font: { size: 12 }, padding: 16 } } },
        cutout: '65%',
      },
    });
  }

  function renderTypeChart(typeStats) {
    const TYPE_COLORS_CHART = {
      soft_lock: '#F59E0B', reserve: '#22C55E', occupy: '#60A5FA',
      release: '#6E6E88', expire: '#EF4444',
    };
    const labels = typeStats.map(t => t._id.replace('_', ' '));
    const counts = typeStats.map(t => t.count);
    const colors = typeStats.map(t => TYPE_COLORS_CHART[t._id] || '#B0B0C4');

    if (typeChart) typeChart.destroy();
    const ctx = document.getElementById('type-chart').getContext('2d');
    typeChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Count',
          data: counts,
          backgroundColor: colors.map(c => c + 'AA'),
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        ...CHART_OPTS,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#6E6E88' }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true },
          y: { ticks: { color: '#B0B0C4' }, grid: { color: 'transparent' } },
        },
      },
    });
  }
}
