import { UserAPI } from './api.js';

const FEATURE_META = {
  entrance:   { icon: '🚪', label: 'Entrance' },
  exit:       { icon: '⬅️',  label: 'Exit' },
  grocery:    { icon: '🛒', label: 'Grocery' },
  disability: { icon: '♿', label: 'Disability HC' },
};

export function initConfirm(ParkingAPI, toast) {
  const LOCK_SECS = 3 * 60;

  let reservation;
  try {
    reservation = JSON.parse(sessionStorage.getItem('reservation') || 'null');
  } catch { reservation = null; }

  if (!reservation) {
    toast('No active reservation found. Please select a spot first.', 'error');
    setTimeout(() => { window.location.href = 'map.html'; }, 2000);
    return;
  }

  const { spotId, spotNum, floor, row, col, features, lockId, expiresAt, userId } = reservation;

  const padNum   = String(spotNum).padStart(3, '0');
  const spotLabel = `P${padNum}`;

  document.getElementById('c-spot-badge').textContent  = spotLabel;
  document.getElementById('c-spot-title').textContent  = `Spot ${spotLabel} — Level ${floor}`;
  document.getElementById('c-spot-sub').textContent    = `Floor ${floor} · Row ${row} · Column ${col}`;

  const featsEl = document.getElementById('c-features');
  featsEl.innerHTML = (features || []).map(f =>
    `<span class="pill pill-default" style="font-size:11px;">${FEATURE_META[f]?.icon || ''} ${FEATURE_META[f]?.label || f}</span>`
  ).join('');

  const timerEl    = document.getElementById('timer-display');
  const timerBar   = document.getElementById('timer-bar');
  const expireTime = new Date(expiresAt).getTime();

  function getSecsLeft() {
    return Math.max(0, Math.ceil((expireTime - Date.now()) / 1000));
  }

  function updateTimer() {
    const secsLeft = getSecsLeft();
    const mins = Math.floor(secsLeft / 60);
    const secs = secsLeft % 60;

    timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;

    const pct = (secsLeft / LOCK_SECS) * 100;
    timerBar.style.width = pct + '%';

    timerEl.classList.remove('warn', 'urgent');
    timerBar.style.background = '';

    if (secsLeft <= 30) {
      timerEl.classList.add('urgent');
      timerBar.style.background = 'var(--red)';
    } else if (secsLeft <= 60) {
      timerEl.classList.add('warn');
      timerBar.style.background = 'var(--amber)';
    }

    if (secsLeft <= 0) {
      clearInterval(timerInterval);
      onLockExpired();
    }
  }

  updateTimer();
  const timerInterval = setInterval(updateTimer, 1000);

  function onLockExpired() {
    sessionStorage.removeItem('reservation');
    document.getElementById('expired-overlay').classList.add('show');
    if (reservation.mobileNumber) {
      UserAPI.recordStrike(reservation.mobileNumber).catch(e => console.warn('[strike]', e.message));
    }
  }

  function getVehicleInfo() {
    const owner = document.getElementById('f-owner').value.trim();
    const plate = document.getElementById('f-plate').value.trim().toUpperCase();
    const type  = document.getElementById('f-type').value;

    if (!owner) { toast('Please enter the owner name.', 'error'); return null; }
    if (!plate) { toast('Please enter the license plate.', 'error'); return null; }
    if (!type)  { toast('Please select a vehicle type.', 'error'); return null; }

    return { owner, plate, type };
  }

  document.getElementById('confirm-btn').addEventListener('click', async () => {
    if (getSecsLeft() <= 0) { onLockExpired(); return; }

    const vehicleInfo = getVehicleInfo();
    if (!vehicleInfo) return;

    const btn = document.getElementById('confirm-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Confirming…';

    try {
      const result = await ParkingAPI.reserve(spotId, lockId, vehicleInfo);

      clearInterval(timerInterval);
      sessionStorage.removeItem('reservation');

      localStorage.setItem('ps_last_reservation', JSON.stringify({
        spotId,
        spotNum:       reservation.spotNum,
        floor:         reservation.floor,
        row:           reservation.row,
        col:           reservation.col,
        features:      reservation.features,
        transactionId: result.transactionId,
        confirmedAt:   new Date().toISOString(),
        vehicle:       vehicleInfo,
      }));

      document.getElementById('success-txn').textContent = `Transaction ID: ${result.transactionId}`;
      document.getElementById('success-overlay').classList.add('show');

    } catch (err) {
      toast(err.message || 'Failed to confirm reservation.', 'error');
      btn.disabled = false;
      btn.textContent = '✓ Confirm Reservation';

      if (err.status === 410) {
        clearInterval(timerInterval);
        onLockExpired();
      }
    }
  });

  document.getElementById('cancel-btn').addEventListener('click', async () => {
    const confirmed = window.confirm('Cancel this reservation? The spot will be released back to the pool.');
    if (!confirmed) return;

    clearInterval(timerInterval);

    try {
      await ParkingAPI.release(spotId);
    } catch {
      /* best-effort release */
    }

    sessionStorage.removeItem('reservation');
    window.location.href = 'map.html';
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && getSecsLeft() <= 0) {
      clearInterval(timerInterval);
      onLockExpired();
    }
  });
}
