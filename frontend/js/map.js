const SECTION_COLS = [
  { label: 'A', nums: [1, 2, 3] },
  { label: 'B', nums: [4, 5, 6] },
  { label: 'C', nums: [7, 8, 9] },
  { label: 'D', nums: [10, 11, 12] },
];

const SHARD = { 1:'Shard 1 · zone_floor1', 2:'Shard 2 · zone_floor2', 3:'Shard 3 · zone_floor3' };

const PRIORITY = {
  entrance:   [1,2,3,4,5,6,7,8,9,10,11,12],
  exit:       [9,10,5,6,1,2,11,12,7,8,3,4],
  grocery:    [11,12,7,8,3,4,9,10,5,6,1,2],
  disability: [3,4,1,2,5,6,7,8,9,10,11,12],
};

const STATUS_LABEL = {
  available:'Available', soft_locked:'Held', reserved:'Reserved', occupied:'Occupied'
};

const FEATURE_ICONS = { entrance:'🚪', exit:'⬅️', grocery:'🛒', disability:'♿' };

function carSVG(color) {
  return `<svg class="car-svg" viewBox="0 0 40 72" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="8" width="32" height="56" rx="8" fill="${color}" opacity="0.9"/>
    <rect x="8" y="14" width="24" height="16" rx="4" fill="rgba(0,0,0,0.45)"/>
    <rect x="8" y="44" width="24" height="13" rx="3" fill="rgba(0,0,0,0.35)"/>
    <rect x="10" y="30" width="20" height="14" rx="2" fill="${color}" opacity="0.6"/>
    <rect x="0"  y="12" width="6" height="14" rx="3" fill="${color}" opacity="0.7"/>
    <rect x="34" y="12" width="6" height="14" rx="3" fill="${color}" opacity="0.7"/>
    <rect x="0"  y="46" width="6" height="14" rx="3" fill="${color}" opacity="0.7"/>
    <rect x="34" y="46" width="6" height="14" rx="3" fill="${color}" opacity="0.7"/>
    <rect x="8"  y="8" width="8" height="5" rx="2" fill="rgba(255,230,100,0.8)"/>
    <rect x="24" y="8" width="8" height="5" rx="2" fill="rgba(255,230,100,0.8)"/>
    <rect x="8"  y="63" width="8" height="5" rx="2" fill="rgba(255,80,80,0.9)"/>
    <rect x="24" y="63" width="8" height="5" rx="2" fill="rgba(255,80,80,0.9)"/>
  </svg>`;
}

function emptySpotSVG() {
  return `<svg class="empty-svg" viewBox="0 0 40 72" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="8" width="32" height="56" rx="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4"/>
    <rect x="10" y="14" width="20" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/>
    <rect x="12" y="30" width="16" height="10" rx="2" fill="currentColor" opacity="0.12"/>
  </svg>`;
}

function spotCarIcon(status) {
  if (status === 'occupied')                          return carSVG('#EF4444');
  if (status === 'reserved' || status === 'soft_locked') return carSVG('#F59E0B');
  return emptySpotSVG();
}

export function initMap(ParkingAPI, toast) {
  let currentLevel   = 1;
  let currentSpots   = [];
  let currentCriteria = 'entrance';
  let selectedSpot   = null;

  const gridWrap    = document.getElementById('lot-grid-wrap');
  const bottomStrip = document.getElementById('bottom-strip');
  const lotTitle    = document.getElementById('lot-title');
  const lotShard    = document.getElementById('lot-shard');
  const availNum    = document.getElementById('avail-num');
  const availFill   = document.getElementById('avail-fill');
  const availPct    = document.getElementById('avail-pct');
  const availBadge  = document.getElementById('avail-badge');
  const shardInfo   = document.getElementById('shard-info');

  const modalBackdrop = document.getElementById('reserve-modal');
  const mBadge     = document.getElementById('m-badge');
  const mTitle     = document.getElementById('m-title');
  const mSub       = document.getElementById('m-sub');
  const mFloor     = document.getElementById('m-floor');
  const mShard     = document.getElementById('m-shard');
  const mPos       = document.getElementById('m-pos');
  const mStatus    = document.getElementById('m-status');
  const mFeatures  = document.getElementById('m-features');
  const mReserveBtn = document.getElementById('m-reserve-btn');
  const mCancelBtn  = document.getElementById('m-cancel-btn');

  document.querySelectorAll('.level-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.level-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentLevel = parseInt(tab.dataset.level);
      loadFloor(currentLevel);
    });
  });

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentCriteria = chip.dataset.criteria;
      applyHighlights();
      loadRecommendations();
    });
  });

  document.getElementById('refresh-btn').addEventListener('click', () => loadFloor(currentLevel, true));

  mCancelBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });

  mReserveBtn.addEventListener('click', async () => {
    if (!selectedSpot) return;
    mReserveBtn.disabled = true;
    mReserveBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Holding spot…';

    try {
      const userId = 'user_' + Date.now();
      const result = await ParkingAPI.softLock(selectedSpot.spotId, userId, {});

      sessionStorage.setItem('reservation', JSON.stringify({
        spotId:   selectedSpot.spotId,
        spotNum:  selectedSpot.spotNum,
        floor:    selectedSpot.floor_number,
        row:      selectedSpot.row,
        col:      selectedSpot.col,
        features: selectedSpot.features,
        lockId:   result.lockId,
        expiresAt: result.expiresAt,
        userId,
      }));

      window.location.href = 'confirm.html';
    } catch (err) {
      toast(err.message || 'Could not hold spot. Try another.', 'error');
      mReserveBtn.disabled = false;
      mReserveBtn.innerHTML = '🔒 Reserve This Spot';
      closeModal();
      loadFloor(currentLevel);
    }
  });

  loadFloor(1);
  setInterval(() => loadFloor(currentLevel), 30000);

  async function loadFloor(level, showSpinner = false) {
    if (showSpinner) {
      gridWrap.innerHTML = '<div class="lot-loading"><div class="spinner"></div> Refreshing…</div>';
      bottomStrip.style.display = 'none';
    }

    lotTitle.textContent = `Floor Level ${level}`;
    lotShard.textContent = `→ ${SHARD[level]}`;
    shardInfo.textContent = `Showing Floor ${level} · ${SHARD[level]}`;

    try {
      currentSpots = await ParkingAPI.getSpots(level);
      renderLot(currentSpots);
      updateAvailability(currentSpots);
      await loadRecommendations();
    } catch (err) {
      console.error(err);
      gridWrap.innerHTML = `<div class="lot-loading" style="color:var(--red);">⚠ Failed to load spots.<br><small style="color:var(--text-4);">Is the backend running on port 3000?</small></div>`;
    }
  }

  function updateAvailability(spots) {
    const avail = spots.filter(s => s.status === 'available').length;
    const pct   = Math.round((avail / 12) * 100);
    availNum.textContent  = avail;
    availFill.style.width = pct + '%';
    availFill.style.background = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--amber)' : 'var(--red)';
    availPct.textContent  = pct + '% free';
    availBadge.textContent = `${avail} free`;
    availBadge.style.display = 'inline-flex';
  }

  function renderLot(spots) {
    const map = {};
    spots.forEach(s => { map[s.spotNum] = s; });

    function renderSpot(num) {
      const spot = map[num];
      if (!spot) return '';
      const pad = String(num).padStart(2, '0');
      const isHC = spot.features?.includes('disability');
      return `
        <div class="pspot"
             data-id="${spot.spotId}"
             data-status="${spot.status}"
             data-num="${num}"
             title="P${pad} · ${STATUS_LABEL[spot.status]}">
          ${isHC ? '<span class="pspot-hc">♿</span>' : ''}
          <span class="pspot-num">P${pad}</span>
          <div class="pspot-car">${spotCarIcon(spot.status)}</div>
          <span class="pspot-status-label">${STATUS_LABEL[spot.status]}</span>
        </div>
      `;
    }

    function renderCol(col) {
      return `
        <div class="spot-col">
          <div class="spot-col-label">${col.label}</div>
          ${col.nums.map(n => renderSpot(n)).join('')}
        </div>
      `;
    }

    const driveAisle = `
      <div class="drive-aisle">
        <div class="drive-aisle-arrow">↑</div>
        <div class="drive-aisle-track"></div>
        <div class="drive-aisle-text">DRIVE</div>
        <div class="drive-aisle-track"></div>
        <div class="drive-aisle-arrow">↓</div>
      </div>
    `;

    gridWrap.innerHTML = `
      <div class="spot-grid">
        ${SECTION_COLS.slice(0, 2).map(renderCol).join('')}
        ${driveAisle}
        ${SECTION_COLS.slice(2).map(renderCol).join('')}
      </div>
    `;

    bottomStrip.style.display = 'flex';

    gridWrap.querySelectorAll('.pspot').forEach(el => {
      el.addEventListener('click', () => handleSpotClick(el));
    });

    applyHighlights();
  }

  function handleSpotClick(el) {
    const spotId = el.dataset.id;
    const spot   = currentSpots.find(s => s.spotId === spotId);
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

  function applyHighlights() {
    gridWrap.querySelectorAll('.pspot').forEach(el => el.classList.remove('highlighted'));
  }

  async function loadRecommendations() {
    const bar = document.getElementById('recommend-bar');
    try {
      const result = await ParkingAPI.recommend(currentLevel, currentCriteria);
      const top5   = result.recommendedOrder.slice(0, 5);

      if (top5.length === 0) {
        bar.innerHTML = `<span class="recommend-label">Best spots:</span><span style="font-size:12px;color:var(--text-4);">No available spots on this floor.</span>`;
        return;
      }

      bar.innerHTML = `<span class="recommend-label">Best spots (${currentCriteria}):</span>` +
        top5.map((num, i) => {
          const spotId = `${currentLevel}-P${String(num).padStart(2,'0')}`;
          return `<span class="recommend-spot" onclick="window.__clickSpot('${spotId}')">
            <span class="rank">#${i+1}</span> P${String(num).padStart(2,'0')}
          </span>`;
        }).join('');
    } catch {
      bar.innerHTML = `<span class="recommend-label">Best spots:</span><span style="font-size:12px;color:var(--text-4);">Unavailable</span>`;
    }
  }

  window.__clickSpot = (spotId) => {
    const spot = currentSpots.find(s => s.spotId === spotId);
    if (!spot || spot.status !== 'available') return;
    openModal(spot);
  };
}
