function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

const ISLANDS_META = [
  { label: 'A', colLeft: range(1,   18),  colRight: range(19,  36)  },
  { label: 'B', colLeft: range(37,  54),  colRight: range(55,  72)  },
  { label: 'C', colLeft: range(73,  90),  colRight: range(91,  108) },
  { label: 'D', colLeft: range(109, 126), colRight: range(127, 144) },
  { label: 'E', colLeft: range(145, 162), colRight: range(163, 180) },
  { label: 'F', colLeft: range(181, 198), colRight: range(199, 216) },
];

const STATUS_LABEL = {
  available: 'Available', soft_locked: 'Held', reserved: 'Reserved', occupied: 'Occupied'
};

const FEATURE_ICONS = { entrance: '🚪', exit: '⬅️', grocery: '🛒', disability: '♿' };

const FLOOR_LABELS = {
  1: { left: 'Mall Entrance ↑', right: 'Parking Exit →' },
  2: { left: 'Mall Entrance ↑', right: 'Way to Floor 3 ↑' },
  3: { left: 'Mall Entrance ↑', right: 'Way to Floor 2 ↓' },
};

const VALID_OTPS = ['123456', '888888', '000000'];

// ── Session helpers ────────────────────────────────────────────────────────
function getSession() {
  const mobile = localStorage.getItem('user_mobile');
  const token  = localStorage.getItem('user_token');
  return mobile && token ? { mobile, token } : null;
}

function saveSession(mobile, token) {
  localStorage.setItem('user_mobile', mobile);
  localStorage.setItem('user_token',  token);
}

function clearSession() {
  localStorage.removeItem('user_mobile');
  localStorage.removeItem('user_token');
}

function maskMobile(mobile) {
  if (mobile.length < 8) return mobile;
  return mobile.slice(0, 4) + 'XXXX' + mobile.slice(8);
}

export function initMap(ParkingAPI, UserAPI, toast) {
  let currentSpots    = [];
  let allFloorMeta    = { 1: null, 2: null, 3: null };
  let selectedSpot    = null;
  let selectedAction  = 'reserve';
  let currentFloor    = 1;
  let currentCriteria = 'entrance';
  let tooltipTimer    = null;

  const facilityGrid = document.getElementById('facility-grid');

  // ── Action Modal DOM refs ────────────────────────────────────────────
  const actionModal         = document.getElementById('action-modal');
  const actionStep1         = document.getElementById('action-step-1');
  const actionStep2         = document.getElementById('action-step-2');
  const mBadge              = document.getElementById('m-badge');
  const mTitle              = document.getElementById('m-title');
  const mSub                = document.getElementById('m-sub');
  const mFloor              = document.getElementById('m-floor');
  const mPos                = document.getElementById('m-pos');
  const mFeatures           = document.getElementById('m-features');
  const mSessionInfo        = document.getElementById('m-session-info');
  const mSessionMobile      = document.getElementById('m-session-mobile');
  const mLogoutBtn          = document.getElementById('m-logout-btn');
  const mMobileWrap         = document.getElementById('m-mobile-wrap');
  const mMobileInput        = document.getElementById('m-mobile-input');
  const mCancelBtn          = document.getElementById('m-cancel-btn');
  const mConfirmBtn         = document.getElementById('m-confirm-btn');
  const actionToggleReserve = document.getElementById('action-toggle-reserve');
  const actionToggleParkNow = document.getElementById('action-toggle-parknow');
  const mOtpInput           = document.getElementById('m-otp-input');
  const mOtpSub             = document.getElementById('m-otp-sub');
  const mOtpBackBtn         = document.getElementById('m-otp-back-btn');
  const mOtpVerifyBtn       = document.getElementById('m-otp-verify-btn');

  // ── Action toggle ────────────────────────────────────────────────────
  actionToggleReserve.addEventListener('click', () => {
    selectedAction = 'reserve';
    actionToggleReserve.classList.add('active');
    actionToggleParkNow.classList.remove('active');
  });

  actionToggleParkNow.addEventListener('click', () => {
    selectedAction = 'park_now';
    actionToggleParkNow.classList.add('active');
    actionToggleReserve.classList.remove('active');
  });

  // ── Logout ───────────────────────────────────────────────────────────
  mLogoutBtn.addEventListener('click', async () => {
    const session = getSession();
    mLogoutBtn.textContent = 'Logging out…';
    mLogoutBtn.disabled    = true;

    if (session) {
      try {
        await UserAPI.logout(session.mobile, session.token);
      } catch (err) {
        console.warn('[logout]', err.message);
      }
    }

    clearSession();
    mSessionInfo.style.display = 'none';
    mMobileWrap.style.display  = '';
    mMobileInput.value         = '';
    mLogoutBtn.textContent     = 'Log out';
    mLogoutBtn.disabled        = false;
    setTimeout(() => mMobileInput.focus(), 60);
  });

  // ── Open / close modal ───────────────────────────────────────────────
  function openActionModal(spot) {
    const pad = String(spot.spotNum).padStart(3, '0');
    mBadge.textContent  = `P${pad}`;
    mTitle.textContent  = `Spot P${pad}`;
    mSub.textContent    = `Floor ${spot.floor_number} · Row ${spot.row} · Col ${spot.col}`;
    mFloor.textContent  = `Level ${spot.floor_number}`;
    mPos.textContent    = `R${spot.row} · C${spot.col}`;
    mFeatures.innerHTML = (spot.features || []).map(f =>
      `<span class="pill pill-default" style="font-size:11px;">${FEATURE_ICONS[f] || ''} ${f}</span>`
    ).join('') || '<span style="font-size:12px;color:var(--text-4);">No special features</span>';

    selectedAction = 'reserve';
    actionToggleReserve.classList.add('active');
    actionToggleParkNow.classList.remove('active');
    mMobileInput.value = '';
    mOtpInput.value    = '';
    mConfirmBtn.disabled    = false;
    mConfirmBtn.textContent = 'Confirm →';

    // Show session if user is already logged in, otherwise show mobile input
    const session = getSession();
    if (session) {
      mSessionMobile.textContent = maskMobile(session.mobile);
      mSessionInfo.style.display = 'flex';
      mMobileWrap.style.display  = 'none';
    } else {
      mSessionInfo.style.display = 'none';
      mMobileWrap.style.display  = '';
    }

    actionStep1.style.display = '';
    actionStep2.style.display = 'none';

    actionModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (!session) setTimeout(() => mMobileInput.focus(), 60);
  }

  function closeActionModal() {
    actionModal.classList.remove('open');
    document.body.style.overflow = '';
    selectedSpot = null;
  }

  mCancelBtn.addEventListener('click', closeActionModal);
  actionModal.addEventListener('click', e => { if (e.target === actionModal) closeActionModal(); });

  // ── Step 1: Confirm ──────────────────────────────────────────────────
  mConfirmBtn.addEventListener('click', async () => {
    const session = getSession();

    if (session) {
      // ── Returning user: token already in localStorage → skip OTP ──
      mConfirmBtn.disabled    = true;
      mConfirmBtn.textContent = 'Checking…';

      try {
        const check = await ParkingAPI.checkMobile(session.mobile);

        if (check.locked) {
          const until = new Date(check.lockoutUntil).toLocaleString();
          toast(`Account locked until ${until}. (${check.strikes}/3 strikes)`, 'error');
          clearSession();
          closeActionModal();
          return;
        }
        if (check.hasActiveSession) {
          toast('You already have an active parking session.', 'error');
          return;
        }

        mConfirmBtn.textContent = 'Processing…';
        await executeAction(selectedSpot, session.mobile);

      } catch (err) {
        toast(err.message || 'Action failed. Please try again.', 'error');
      } finally {
        mConfirmBtn.disabled    = false;
        mConfirmBtn.textContent = 'Confirm →';
      }

    } else {
      // ── New user: validate mobile, check, go to OTP ──
      const mobile = mMobileInput.value.trim().replace(/[\s\-]/g, '');

      if (!/^\d{11}$/.test(mobile)) {
        toast('Enter a valid 11-digit mobile number (e.g. 09XXXXXXXXX).', 'error');
        mMobileInput.focus();
        return;
      }

      mConfirmBtn.disabled    = true;
      mConfirmBtn.textContent = 'Checking…';

      try {
        const check = await ParkingAPI.checkMobile(mobile);

        if (check.locked) {
          const until = new Date(check.lockoutUntil).toLocaleString();
          toast(`Number locked until ${until}. (${check.strikes}/3 strikes)`, 'error');
          return;
        }
        if (check.hasActiveSession) {
          toast('This number already has an active parking session.', 'error');
          return;
        }

        const masked = mobile.slice(0, 4) + 'XXXX' + mobile.slice(8);
        mOtpSub.textContent       = `Enter the 6-digit code sent to ${masked}`;
        mOtpInput.value           = '';
        mOtpVerifyBtn.disabled    = false;
        mOtpVerifyBtn.textContent = 'Verify & Confirm';
        actionStep1.style.display = 'none';
        actionStep2.style.display = '';
        setTimeout(() => mOtpInput.focus(), 60);

      } catch (err) {
        toast(err.message || 'Failed to validate. Please try again.', 'error');
      } finally {
        mConfirmBtn.disabled    = false;
        mConfirmBtn.textContent = 'Confirm →';
      }
    }
  });

  // ── Step 2: Back ─────────────────────────────────────────────────────
  mOtpBackBtn.addEventListener('click', () => {
    actionStep2.style.display = 'none';
    actionStep1.style.display = '';
    setTimeout(() => mMobileInput.focus(), 60);
  });

  // ── Step 2: Verify OTP → issue token → execute action ────────────────
  mOtpVerifyBtn.addEventListener('click', async () => {
    const otp    = mOtpInput.value.trim();
    const mobile = mMobileInput.value.trim().replace(/[\s\-]/g, '');

    if (!VALID_OTPS.includes(otp)) {
      toast('Invalid OTP. Demo codes: 123456 · 888888 · 000000', 'error');
      mOtpInput.select();
      return;
    }

    mOtpVerifyBtn.disabled    = true;
    mOtpVerifyBtn.textContent = 'Verifying…';

    // Issue a session token from the backend so this user is remembered
    try {
      const result = await UserAPI.tokenLogin(mobile, otp);
      saveSession(result.mobileNumber, result.token);
    } catch (err) {
      console.warn('[token-login] non-fatal:', err.message);
      // Still proceed with action even if token storage fails
    }

    mOtpVerifyBtn.textContent = 'Processing…';

    try {
      await executeAction(selectedSpot, mobile);
    } catch (err) {
      toast(err.message || 'Action failed. Please try again.', 'error');
      mOtpVerifyBtn.disabled    = false;
      mOtpVerifyBtn.textContent = 'Verify & Confirm';
    }
  });

  // ── Execute the chosen parking action ────────────────────────────────
  async function executeAction(spot, mobile) {
    if (selectedAction === 'park_now') {
      const result = await ParkingAPI.parkNow(spot.spotId, mobile, {});
      toast(`Parked at P${String(spot.spotNum).padStart(3, '0')}! Txn: ${result.transactionId}`, 'success', 5000);
      closeActionModal();
      loadFloor(currentFloor);
    } else {
      const userId = 'user_' + Date.now();
      const result = await ParkingAPI.softLock(spot.spotId, userId, {}, mobile);

      sessionStorage.setItem('reservation', JSON.stringify({
        spotId:       spot.spotId,
        spotNum:      spot.spotNum,
        floor:        spot.floor_number,
        row:          spot.row,
        col:          spot.col,
        features:     spot.features,
        lockId:       result.lockId,
        expiresAt:    result.expiresAt,
        userId,
        mobileNumber: mobile,
      }));

      window.location.href = 'confirm.html';
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────
  document.getElementById('refresh-btn').addEventListener('click', () => loadFloor(currentFloor, true));

  document.querySelectorAll('.sort-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentCriteria = chip.dataset.criteria;
      loadRecommendations();
    });
  });

  document.querySelectorAll('.floor-mini').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.floor-mini').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentFloor = parseInt(card.dataset.floor);
      document.getElementById('rec-floor-label').textContent = `(Floor ${currentFloor})`;
      updateFloorInfoBar(currentFloor);
      loadFloor(currentFloor);
    });
  });

  // ── Init ─────────────────────────────────────────────────────────────
  init();
  setInterval(() => loadFloor(currentFloor), 30000);

  async function init() {
    updateFloorInfoBar(currentFloor);
    facilityGrid.innerHTML = '<div class="facility-loading"><div class="spinner"></div> Loading facility from all shards…</div>';
    try {
      const [f1, f2, f3] = await Promise.all([
        ParkingAPI.getSpots(1),
        ParkingAPI.getSpots(2),
        ParkingAPI.getSpots(3),
      ]);
      allFloorMeta = { 1: f1, 2: f2, 3: f3 };
      currentSpots = f1;
      updateFloorCards();
      renderGrid();
      updateCounters();
      await loadRecommendations();
    } catch (err) {
      console.error(err);
      facilityGrid.innerHTML = `<div class="facility-loading" style="color:var(--red);">⚠ Failed to load facility.<br><small style="color:var(--text-4);">Is the backend running on port 3000?</small></div>`;
    }
  }

  async function loadFloor(floor, showSpinner = false) {
    if (showSpinner) {
      facilityGrid.innerHTML = '<div class="facility-loading"><div class="spinner"></div> Refreshing…</div>';
    }
    try {
      const spots = await ParkingAPI.getSpots(floor);
      currentSpots        = spots;
      allFloorMeta[floor] = spots;
      renderGrid();
      updateCounters();
      updateFloorCards();
      await loadRecommendations();
    } catch (err) {
      console.error(err);
      toast('Failed to load floor data.', 'error');
    }
  }

  function updateFloorInfoBar(floor) {
    const bar = document.getElementById('floor-info-bar');
    if (!bar) return;
    const labels = FLOOR_LABELS[floor] || {};
    bar.innerHTML = `
      <span class="floor-info-tag">🚶 ${labels.left || ''}</span>
      <span class="floor-info-tag" style="color:var(--accent);border-color:var(--accent-border);background:var(--accent-dim);">🅿 Floor ${floor}</span>
      <span class="floor-info-tag">➡ ${labels.right || ''}</span>
    `;
  }

  function renderGrid() {
    const map = {};
    currentSpots.forEach(s => { map[s.spotNum] = s; });

    document.getElementById('shard-info').textContent =
      `Floor ${currentFloor} · ${currentSpots.length} spots · Shard ${currentFloor}`;

    let html = '';
    ISLANDS_META.forEach((island, idx) => {
      html += renderIsland(island.label, island.colLeft, island.colRight, map);
      if (idx < ISLANDS_META.length - 1) {
        html += `
          <div class="main-aisle">
            <div class="aisle-track"></div>
            <div class="aisle-label">DRIVE</div>
            <div class="aisle-track"></div>
          </div>
        `;
      }
    });

    facilityGrid.innerHTML = html;
    facilityGrid.querySelectorAll('.spot-cell').forEach(el => {
      el.addEventListener('click', () => handleSpotClick(el));
      if (el.dataset.status && el.dataset.status !== 'available') {
        el.addEventListener('mouseenter', () => {
          const spot = currentSpots.find(s => s.spotId === el.dataset.id);
          if (spot) showSpotTooltip(el, spot);
        });
        el.addEventListener('mouseleave', hideSpotTooltip);
      }
    });
  }

  function showSpotTooltip(el, spot) {
    const tt  = document.getElementById('spot-tooltip');
    if (!tt) return;
    const pad = String(spot.spotNum).padStart(3, '0');
    const typeSuffix = spot.spotType === 'PWD' ? ' · PWD' : spot.spotType === 'Motorcycle' ? ' · Moto' : '';

    let statusHtml = '';
    if (spot.status === 'soft_locked') {
      const expiry = spot.softLock?.expiresAt ? new Date(spot.softLock.expiresAt) : null;
      const countdown = () => {
        if (!expiry) return '--:--';
        const s = Math.max(0, Math.round((expiry - Date.now()) / 1000));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };
      statusHtml = `
        <div style="color:var(--amber);font-weight:700;font-size:12px;">⏱ HELD</div>
        <div style="color:var(--text-3);font-size:11px;margin-top:3px;">Expires in <span id="tt-countdown" style="font-family:var(--font-mono);color:var(--amber);">${countdown()}</span></div>
      `;
      if (tooltipTimer) clearInterval(tooltipTimer);
      tooltipTimer = setInterval(() => {
        const cd = document.getElementById('tt-countdown');
        if (cd) cd.textContent = countdown();
        else { clearInterval(tooltipTimer); tooltipTimer = null; }
      }, 1000);
    } else if (spot.status === 'reserved') {
      statusHtml = `<div style="color:var(--amber);font-weight:700;font-size:12px;">✓ RESERVED</div><div style="color:var(--text-3);font-size:11px;margin-top:3px;">Confirmed reservation</div>`;
    } else if (spot.status === 'occupied') {
      statusHtml = `<div style="color:var(--red);font-weight:700;font-size:12px;">● OCCUPIED</div><div style="color:var(--text-3);font-size:11px;margin-top:3px;">Currently in use</div>`;
    }

    tt.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--text-1);margin-bottom:4px;">P${pad}${typeSuffix}</div>
      <div style="font-size:10px;color:var(--text-4);margin-bottom:7px;">Floor ${spot.floor_number} · R${spot.row} · C${spot.col}</div>
      ${statusHtml}
    `;
    tt.style.display = 'block';

    const rect = el.getBoundingClientRect();
    let left = rect.right + 8;
    let top  = rect.top;
    if (left + 170 > window.innerWidth)  left = rect.left - 170 - 8;
    if (top  + 110 > window.innerHeight) top  = window.innerHeight - 115;
    tt.style.left = left + 'px';
    tt.style.top  = top  + 'px';
  }

  function hideSpotTooltip() {
    const tt = document.getElementById('spot-tooltip');
    if (tt) tt.style.display = 'none';
    if (tooltipTimer) { clearInterval(tooltipTimer); tooltipTimer = null; }
  }

  function renderIsland(label, colLeft, colRight, map) {
    const ltTop = colLeft.slice(0, 9);
    const ltBot = colLeft.slice(9);
    const rtTop = colRight.slice(0, 9);
    const rtBot = colRight.slice(9);

    return `
      <div class="island">
        <div class="island-label">ISL ${label}</div>
        <div class="island-block">
          <div class="spot-col">${ltTop.map(n => renderCell(n, map)).join('')}</div>
          <div class="spot-col">${rtTop.map(n => renderCell(n, map)).join('')}</div>
        </div>
        <div class="island-internal-drive">DRIVE</div>
        <div class="island-block">
          <div class="spot-col">${ltBot.map(n => renderCell(n, map)).join('')}</div>
          <div class="spot-col">${rtBot.map(n => renderCell(n, map)).join('')}</div>
        </div>
      </div>
    `;
  }

  function renderCell(num, map) {
    const spot = map[num];
    if (!spot) return '<div class="spot-cell spot-empty"></div>';
    const pad    = String(num).padStart(3, '0');
    const isPWD  = spot.spotType === 'PWD';
    const isMoto = spot.spotType === 'Motorcycle';
    const cls    = isPWD ? ' pwd' : isMoto ? ' moto' : '';
    const badge  = isPWD  ? '<span class="spot-hc">♿</span>'
                 : isMoto ? '<span class="spot-hc" style="font-size:8px;">🏍</span>'
                 : '';
    const tipSuffix = isPWD ? ' · PWD' : isMoto ? ' · Motorcycle' : '';
    return `
      <div class="spot-cell${cls}"
           data-id="${spot.spotId}"
           data-status="${spot.status}"
           title="P${pad} · ${STATUS_LABEL[spot.status]}${tipSuffix}">
        ${badge}
        <div class="spot-dot"></div>
        <span class="spot-id">P${pad}</span>
      </div>
    `;
  }

  function updateCounters() {
    const available = currentSpots.filter(s => s.status === 'available').length;
    const reserved  = currentSpots.filter(s => s.status === 'reserved' || s.status === 'soft_locked').length;
    const occupied  = currentSpots.filter(s => s.status === 'occupied').length;

    const sAvail    = document.getElementById('s-avail');
    const sReserved = document.getElementById('s-reserved');
    const sOccupied = document.getElementById('s-occupied');
    const badge     = document.getElementById('total-badge');

    if (sAvail)    sAvail.textContent    = available;
    if (sReserved) sReserved.textContent = reserved;
    if (sOccupied) sOccupied.textContent = occupied;
    if (badge)     badge.textContent     = `${available} / ${currentSpots.length} available`;
  }

  function updateFloorCards() {
    for (let f = 1; f <= 3; f++) {
      const spots = allFloorMeta[f];
      if (!spots) continue;
      const avail = spots.filter(s => s.status === 'available').length;
      const total = spots.length;
      const pct   = total > 0 ? Math.round((avail / total) * 100) : 0;
      const color = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--amber)' : 'var(--red)';
      const fill  = document.getElementById(`fmf-${f}`);
      const label = document.getElementById(`fma-${f}`);
      if (fill)  { fill.style.width = pct + '%'; fill.style.background = color; }
      if (label) label.textContent = `${avail}/${total} free`;
    }
  }

  function handleSpotClick(el) {
    const spotId = el.dataset.id;
    const spot   = currentSpots.find(s => s.spotId === spotId);
    if (!spot) return;

    if (spot.status !== 'available') {
      toast(`Spot P${String(spot.spotNum).padStart(3, '0')} is ${STATUS_LABEL[spot.status].toLowerCase()}.`, 'info');
      return;
    }

    selectedSpot = spot;
    openActionModal(spot);
  }

  async function loadRecommendations() {
    const bar = document.getElementById('recommend-bar');
    try {
      const result = await ParkingAPI.recommend(currentFloor, currentCriteria);
      const top4   = result.recommendedOrder.slice(0, 4);

      if (top4.length === 0) {
        bar.innerHTML = '<span style="font-size:11px;color:var(--text-4);">No spots available</span>';
        return;
      }

      bar.innerHTML = top4.map((num, i) => {
        const spotId = `${currentFloor}-P${String(num).padStart(3, '0')}`;
        return `<span class="rec-chip" onclick="window.__clickRec('${spotId}')">
          <span class="rank">#${i + 1}</span> P${String(num).padStart(3, '0')}
        </span>`;
      }).join('');
    } catch {
      bar.innerHTML = '<span style="font-size:11px;color:var(--text-4);">Unavailable</span>';
    }
  }

  window.__clickRec = (spotId) => {
    const spot = currentSpots.find(s => s.spotId === spotId);
    if (!spot || spot.status !== 'available') return;
    selectedSpot = spot;
    openActionModal(spot);
  };
}
