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
  let editingSpot      = null;

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
  }

  async function doLogout() {
    try { await AuthAPI.logout(); } catch { /* ignore */ }
    localStorage.removeItem('staff_token');
    localStorage.removeItem('staff_user');
    stopAutoRefresh();
    dashboard.classList.remove('show');
    loginPage.style.display = 'flex';
  }

  function showView(viewName) {
    currentView = viewName;
    ['overview', 'transactions', 'spots', 'analytics'].forEach(v => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.classList.toggle('active', v === viewName);
    });
    document.querySelectorAll('.drawer-nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
    if (viewName === 'transactions') loadTransactions();
    if (viewName === 'analytics')    loadAnalytics();
    if (viewName === 'spots')        loadSpots(currentSMFloor);
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
  document.getElementById('sm-refresh-btn').addEventListener('click', () => loadSpots(currentSMFloor));

  async function loadSpots(floor) {
    const tbody = document.getElementById('sm-body');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;"><div class="spinner" style="margin:0 auto;"></div></td></tr>`;

    try {
      const spots = await StaffAPI.spots(floor);
      if (!spots.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:48px;color:var(--text-4);">No spots found.</td></tr>`;
        return;
      }
      tbody.innerHTML = spots.map(spot => {
        const pad  = String(spot.spotNum).padStart(2, '0');
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

      window.__spotCache = spots;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--red);">⚠ ${err.message}</td></tr>`;
    }
  }

  const spotModal = document.getElementById('spot-editor-modal');

  window.__editSpot = (spotId) => {
    const spot = (window.__spotCache || []).find(s => s.spotId === spotId);
    if (!spot) return;
    editingSpot = spot;

    const pad = String(spot.spotNum).padStart(2, '0');
    document.getElementById('se-title').textContent = `Edit Spot P${pad}`;
    document.getElementById('se-sub').textContent   = `Floor ${spot.floor_number} · Row ${spot.row} · Col ${spot.col}`;
    const status = spot.status === 'soft_locked' ? 'available' : spot.status;
    document.getElementById('se-status').value = status;
    document.getElementById('se-notes').value  = '';
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
    const status = document.getElementById('se-status').value;
    const notes  = document.getElementById('se-notes').value.trim();
    const btn    = document.getElementById('se-save');

    btn.disabled    = true;
    btn.innerHTML   = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Saving…';

    try {
      await StaffAPI.updateSpot(editingSpot.spotId, status, notes);
      const pad = String(editingSpot.spotNum).padStart(2, '0');
      toast(`Spot P${pad} updated to "${status}"`, 'success');
      spotModal.classList.remove('open');
      editingSpot = null;
      loadSpots(currentSMFloor);
      loadOverview();
    } catch (err) {
      toast(err.message || 'Failed to update spot.', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save Changes';
    }
  });

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
