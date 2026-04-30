const PRIORITY = {
  entrance:   [1,2,3,4,5,6,7,8,9,10,11,12],
  exit:       [9,10,5,6,1,2,11,12,7,8,3,4],
  grocery:    [11,12,7,8,3,4,9,10,5,6,1,2],
  disability: [3,4,1,2,5,6,7,8,9,10,11,12],
};

const STATUS_LABEL = {
  available: 'Available', soft_locked: 'Held', reserved: 'Reserved', occupied: 'Occupied'
};

const FEATURE_ICONS = { entrance: '🚪', exit: '⬅️', grocery: '🛒', disability: '♿' };

export function initMap(ParkingAPI, toast) {
  let allSpots      = { 1: [], 2: [], 3: [] };
  let selectedSpot  = null;
  let currentLevel  = 1;
  let currentCriteria = 'entrance';

  const facilityGrid  = document.getElementById('facility-grid');
  const modalBackdrop = document.getElementById('reserve-modal');
  const mBadge        = document.getElementById('m-badge');
  const mTitle        = document.getElementById('m-title');
  const mSub          = document.getElementById('m-sub');
  const mFloor        = document.getElementById('m-floor');
  const mShard        = document.getElementById('m-shard');
  const mPos          = document.getElementById('m-pos');
  const mStatus       = document.getElementById('m-status');
  const mFeatures     = document.getElementById('m-features');
  const mReserveBtn   = document.getElementById('m-reserve-btn');
  const mCancelBtn    = document.getElementById('m-cancel-btn');

  mCancelBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });

  document.getElementById('refresh-btn').addEventListener('click', () => loadAll(true));

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
      currentLevel = parseInt(card.dataset.floor);
      document.getElementById('rec-floor-label').textContent = `(Floor ${currentLevel})`;
      loadRecommendations();
    });
  });

  mReserveBtn.addEventListener('click', async () => {
    if (!selectedSpot) return;
    mReserveBtn.disabled = true;
    mReserveBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Holding spot…';

    try {
      const userId = 'user_' + Date.now();
      const result = await ParkingAPI.softLock(selectedSpot.spotId, userId, {});

      sessionStorage.setItem('reservation', JSON.stringify({
        spotId:    selectedSpot.spotId,
        spotNum:   selectedSpot.spotNum,
        floor:     selectedSpot.floor_number,
        row:       selectedSpot.row,
        col:       selectedSpot.col,
        features:  selectedSpot.features,
        lockId:    result.lockId,
        expiresAt: result.expiresAt,
        userId,
      }));

      window.location.href = 'confirm.html';
    } catch (err) {
      toast(err.message || 'Could not hold spot. Try another.', 'error');
      mReserveBtn.disabled = false;
      mReserveBtn.innerHTML = '🔒 Reserve This Spot';
      closeModal();
      loadAll();
    }
  });

  loadAll();
  setInterval(loadAll, 30000);

  async function loadAll(showSpinner = false) {
    if (showSpinner) {
      facilityGrid.innerHTML = '<div class="facility-loading"><div class="spinner"></div> Refreshing…</div>';
    }

    try {
      const [f1, f2, f3] = await Promise.all([
        ParkingAPI.getSpots(1),
        ParkingAPI.getSpots(2),
        ParkingAPI.getSpots(3),
      ]);
      allSpots = { 1: f1, 2: f2, 3: f3 };
      renderFacility();
      updateSidebar();
      await loadRecommendations();
    } catch (err) {
      console.error(err);
      facilityGrid.innerHTML = `<div class="facility-loading" style="color:var(--red);">⚠ Failed to load facility.<br><small style="color:var(--text-4);">Is the backend running on port 3000?</small></div>`;
    }
  }

  function renderFacility() {
    let html = '';
    for (let floor = 1; floor <= 3; floor++) {
      const spots = allSpots[floor];
      const map   = {};
      spots.forEach(s => { map[s.spotNum] = s; });
      const avail = spots.filter(s => s.status === 'available').length;
      html += renderFloorGroup(floor, map, avail);
      if (floor < 3) html += '<div class="floor-sep"></div>';
    }
    facilityGrid.innerHTML = html;

    facilityGrid.querySelectorAll('.spot-cell').forEach(el => {
      el.addEventListener('click', () => handleSpotClick(el));
    });
  }

  function renderFloorGroup(floor, map, avail) {
    const shardLabel = `zone_floor${floor}`;
    return `
      <div class="floor-group">
        <div class="floor-group-header">
          <div>
            <div class="fgh-title">Floor ${floor}</div>
            <div class="fgh-shard">Shard ${floor} · ${shardLabel}</div>
          </div>
          <span class="fgh-badge">${avail} free</span>
        </div>
        <div class="floor-islands">
          ${renderIsland('A', [1,2,3], [4,5,6], map, floor)}
          <div class="drive-aisle">
            <div class="drive-arrow">↑</div>
            <div class="drive-track"></div>
            <div class="drive-label">DRIVE</div>
            <div class="drive-track"></div>
            <div class="drive-arrow">↓</div>
          </div>
          ${renderIsland('B', [7,8,9], [10,11,12], map, floor)}
        </div>
      </div>
    `;
  }

  function renderIsland(label, row1Nums, row2Nums, map, floor) {
    return `
      <div class="island">
        <div class="island-label">Island ${label}</div>
        <div class="island-row">${row1Nums.map(n => renderCell(n, map, floor)).join('')}</div>
        <div class="island-divider"></div>
        <div class="island-row">${row2Nums.map(n => renderCell(n, map, floor)).join('')}</div>
      </div>
    `;
  }

  function renderCell(num, map, floor) {
    const spot = map[num];
    if (!spot) return '';
    const pad  = String(num).padStart(2, '0');
    const isHC = spot.features?.includes('disability');
    return `
      <div class="spot-cell"
           data-id="${spot.spotId}"
           data-status="${spot.status}"
           data-floor="${floor}"
           title="Floor ${floor} · P${pad} · ${STATUS_LABEL[spot.status]}">
        ${isHC ? '<span class="spot-hc">♿</span>' : ''}
        <div class="spot-dot"></div>
        <span class="spot-id">P${pad}</span>
        <span class="spot-lbl">${STATUS_LABEL[spot.status]}</span>
      </div>
    `;
  }

  function updateSidebar() {
    let available = 0, reserved = 0, occupied = 0;
    for (let f = 1; f <= 3; f++) {
      const spots = allSpots[f] || [];
      available += spots.filter(s => s.status === 'available').length;
      reserved  += spots.filter(s => s.status === 'reserved' || s.status === 'soft_locked').length;
      occupied  += spots.filter(s => s.status === 'occupied').length;

      const avail = spots.filter(s => s.status === 'available').length;
      const pct   = Math.round((avail / 12) * 100);
      const color = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--amber)' : 'var(--red)';
      const fill  = document.getElementById(`fmf-${f}`);
      const label = document.getElementById(`fma-${f}`);
      if (fill)  { fill.style.width = pct + '%'; fill.style.background = color; }
      if (label) label.textContent = `${avail}/12 free`;
    }

    const sAvail    = document.getElementById('s-avail');
    const sReserved = document.getElementById('s-reserved');
    const sOccupied = document.getElementById('s-occupied');
    const badge     = document.getElementById('total-badge');
    if (sAvail)    sAvail.textContent    = available;
    if (sReserved) sReserved.textContent = reserved;
    if (sOccupied) sOccupied.textContent = occupied;
    if (badge)     badge.textContent     = `${available} / 36 available`;
  }

  function handleSpotClick(el) {
    const spotId = el.dataset.id;
    const floor  = parseInt(el.dataset.floor);
    const spot   = (allSpots[floor] || []).find(s => s.spotId === spotId);
    if (!spot) return;

    if (spot.status !== 'available') {
      toast(`Spot P${String(spot.spotNum).padStart(2,'0')} is ${STATUS_LABEL[spot.status].toLowerCase()}.`, 'info');
      return;
    }

    selectedSpot = spot;
    openModal(spot);
  }

  function openModal(spot) {
    const pad = String(spot.spotNum).padStart(2, '0');
    mBadge.textContent  = `P${pad}`;
    mTitle.textContent  = `Reserve Spot P${pad}`;
    mSub.textContent    = `Floor ${spot.floor_number} · Row ${spot.row} · Column ${spot.col}`;
    mFloor.textContent  = `Level ${spot.floor_number}`;
    mShard.textContent  = `Shard ${spot.floor_number}`;
    mPos.textContent    = `R${spot.row} · C${spot.col}`;
    mStatus.textContent = 'Available';
    mFeatures.innerHTML = (spot.features || []).map(f =>
      `<span class="pill pill-default" style="font-size:11px;">${FEATURE_ICONS[f] || ''} ${f}</span>`
    ).join('') || '<span style="font-size:12px;color:var(--text-4);">No special features</span>';

    mReserveBtn.disabled = false;
    mReserveBtn.innerHTML = '🔒 Reserve This Spot';
    modalBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.classList.remove('open');
    document.body.style.overflow = '';
    selectedSpot = null;
  }

  async function loadRecommendations() {
    const bar = document.getElementById('recommend-bar');
    try {
      const result = await ParkingAPI.recommend(currentLevel, currentCriteria);
      const top4   = result.recommendedOrder.slice(0, 4);

      if (top4.length === 0) {
        bar.innerHTML = '<span style="font-size:11px;color:var(--text-4);">No spots available</span>';
        return;
      }

      bar.innerHTML = top4.map((num, i) => {
        const spotId = `${currentLevel}-P${String(num).padStart(2,'0')}`;
        return `<span class="rec-chip" onclick="window.__clickRec('${spotId}',${currentLevel})">
          <span class="rank">#${i+1}</span> P${String(num).padStart(2,'0')}
        </span>`;
      }).join('');
    } catch {
      bar.innerHTML = '<span style="font-size:11px;color:var(--text-4);">Unavailable</span>';
    }
  }

  window.__clickRec = (spotId, floor) => {
    const spot = (allSpots[floor] || []).find(s => s.spotId === spotId);
    if (!spot || spot.status !== 'available') return;
    openModal(spot);
  };
}
