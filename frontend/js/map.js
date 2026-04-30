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

export function initMap(ParkingAPI, toast) {
  let currentSpots    = [];
  let allFloorMeta    = { 1: null, 2: null, 3: null };
  let selectedSpot    = null;
  let currentFloor    = 1;
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
  modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });
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
      loadFloor(currentFloor);
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
      loadFloor(currentFloor);
    }
  });

  init();
  setInterval(() => loadFloor(currentFloor), 30000);

  async function init() {
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
      currentSpots = spots;
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
    });
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
    const pad   = String(num).padStart(3, '0');
    const isPWD = spot.spotType === 'PWD';
    return `
      <div class="spot-cell${isPWD ? ' pwd' : ''}"
           data-id="${spot.spotId}"
           data-status="${spot.status}"
           title="P${pad} · ${STATUS_LABEL[spot.status]}">
        ${isPWD ? '<span class="spot-hc">♿</span>' : ''}
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
    openModal(spot);
  }

  function openModal(spot) {
    const pad = String(spot.spotNum).padStart(3, '0');
    mBadge.textContent  = `P${pad}`;
    mTitle.textContent  = `Reserve Spot P${pad}`;
    mSub.textContent    = `Floor ${spot.floor_number} · Row ${spot.row} · Col ${spot.col}`;
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
    openModal(spot);
  };
}
