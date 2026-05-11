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
  available: 'Available', soft_locked: 'Held', reserved: 'Reserved', occupied: 'Occupied', exiting: 'Exiting'
};

const FEATURE_ICONS = { entrance: '🚪', exit: '⬅️', grocery: '🛒', disability: '♿' };

const FLOOR_LABELS = {
  1: {
    bottomLeft:  { icon: '🅿', text: 'Parking Exit ↙',   cls: 'exit' },
    bottomRight: { icon: '⬆', text: 'Way to 2nd Floor',  cls: 'ramp' },
  },
  2: {
    bottomLeft:  { icon: '⬇', text: 'Way to 1st Floor',  cls: 'ramp' },
    bottomRight: { icon: '⬆', text: 'Way to 3rd Floor',  cls: 'ramp' },
  },
  3: {
    bottomLeft:  { icon: '⬇', text: 'Way to 2nd Floor',  cls: 'ramp' },
    bottomRight: null,
  },
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
  let exitSpot        = null;
  let selectedAction  = 'reserve';
  let currentFloor    = 1;
  let activeSpotlight  = null;
  let tooltipTimer     = null;
  let exitRefreshTimer = null;
  let pendingMobile    = null;
  let vehicleFromStep  = 1;
  let activePWDRequest  = null;
  let pwdPollInterval   = null;
  let pwdCountdownTimer = null;
  let pendingVehicleInfo = null;
  let pwdIdFrontData    = null;
  let pwdIdBackData     = null;

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

  // ── Vehicle step (step 3) DOM refs ───────────────────────────────────
  const actionStep3  = document.getElementById('action-step-3');
  const mvBadge      = document.getElementById('mv-badge');
  const mvTitle      = document.getElementById('mv-title');
  const mvSub        = document.getElementById('mv-sub');
  const mvStandard   = document.getElementById('mv-standard');
  const mvMoto       = document.getElementById('mv-moto');
  const mvOwner      = document.getElementById('mv-owner');
  const mvPlate      = document.getElementById('mv-plate');
  const mvType       = document.getElementById('mv-type');
  const mvMotoName   = document.getElementById('mv-moto-name');
  const mvMotoPlate  = document.getElementById('mv-moto-plate');
  const mvBackBtn    = document.getElementById('mv-back-btn');
  const mvSubmitBtn  = document.getElementById('mv-submit-btn');
  const mvPwdUpload      = document.getElementById('mv-pwd-upload');
  const mvIdFront        = document.getElementById('mv-id-front');
  const mvIdBack         = document.getElementById('mv-id-back');
  const mvIdFrontPreview = document.getElementById('mv-id-front-preview');
  const mvIdBackPreview  = document.getElementById('mv-id-back-preview');
  const mvIdFrontImg     = document.getElementById('mv-id-front-img');
  const mvIdBackImg      = document.getElementById('mv-id-back-img');
  const actionStep4      = document.getElementById('action-step-4');
  const pwdCountdownEl   = document.getElementById('pwd-countdown');

  // ── Check-in modal ──────────────────────────────────────────────────
  const checkinModal      = document.getElementById('checkin-modal');
  const checkinModalBadge = document.getElementById('checkin-modal-badge');
  const checkinModalSub   = document.getElementById('checkin-modal-sub');
  let   checkinSpot       = null;

  function openCheckinModal(spot) {
    const pad = String(spot.spotNum).padStart(3, '0');
    checkinModalBadge.textContent = `P${pad}`;
    checkinModalSub.textContent   = `Floor ${spot.floor_number} · Your reserved spot`;
    checkinSpot = spot;
    checkinModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  document.getElementById('checkin-cancel-btn').addEventListener('click', () => {
    checkinModal.classList.remove('open');
    document.body.style.overflow = '';
    checkinSpot = null;
  });
  checkinModal.addEventListener('click', e => {
    if (e.target === checkinModal) {
      checkinModal.classList.remove('open');
      document.body.style.overflow = '';
      checkinSpot = null;
    }
  });

  document.getElementById('checkin-confirm-btn').addEventListener('click', async () => {
    if (!checkinSpot) return;
    const btn = document.getElementById('checkin-confirm-btn');
    btn.disabled    = true;
    btn.textContent = 'Checking in…';
    try {
      await ParkingAPI.occupy(checkinSpot.spotId);
      const pad = String(checkinSpot.spotNum).padStart(3, '0');
      toast(`Checked in! Spot P${pad} is now occupied.`, 'success', 5000);
      checkinModal.classList.remove('open');
      document.body.style.overflow = '';
      checkinSpot = null;
      loadFloor(currentFloor);
    } catch (err) {
      toast(err.message || 'Check-in failed. Please try again.', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = '🚗 Check In';
    }
  });

  // ── Exit modal ───────────────────────────────────────────────────────
  const exitModal      = document.getElementById('exit-modal');
  const exitModalBadge = document.getElementById('exit-modal-badge');
  const exitModalSub   = document.getElementById('exit-modal-sub');
  const exitCancelBtn  = document.getElementById('exit-cancel-btn');
  const exitConfirmBtn = document.getElementById('exit-confirm-btn');

  function openExitModal(spot) {
    const pad   = String(spot.spotNum).padStart(3, '0');
    const since = spot.occupiedAt ? new Date(spot.occupiedAt) : null;
    const secs  = since ? Math.round((Date.now() - since) / 1000) : 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const dur = h > 0 ? `${h}h ${m}m` : `${m}m`;
    exitModalBadge.textContent = `P${pad}`;
    exitModalSub.textContent   = `Floor ${spot.floor_number} · Occupied ${dur} · Confirm payment received`;
    exitSpot = spot;
    exitModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  exitCancelBtn.addEventListener('click', () => {
    exitModal.classList.remove('open');
    document.body.style.overflow = '';
    exitSpot = null;
  });
  exitModal.addEventListener('click', e => { if (e.target === exitModal) exitCancelBtn.click(); });

  exitConfirmBtn.addEventListener('click', async () => {
    if (!exitSpot) return;
    exitConfirmBtn.disabled    = true;
    exitConfirmBtn.textContent = 'Processing…';
    try {
      await ParkingAPI.completeExit(exitSpot.spotId);
      const pad = String(exitSpot.spotNum).padStart(3, '0');
      toast(`P${pad} — exit grace period started. Clears in 30 seconds.`, 'success', 5000);
      exitModal.classList.remove('open');
      document.body.style.overflow = '';
      exitSpot = null;
      loadFloor(currentFloor);
    } catch (err) {
      toast(err.message || 'Failed to complete exit.', 'error');
    } finally {
      exitConfirmBtn.disabled    = false;
      exitConfirmBtn.textContent = '✓ Complete Exit';
    }
  });

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
    actionStep3.style.display = 'none';
    actionStep4.style.display = 'none';

    actionModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (!session) setTimeout(() => mMobileInput.focus(), 60);
  }

  function closeActionModal() {
    actionModal.classList.remove('open');
    document.body.style.overflow = '';
    selectedSpot       = null;
    pendingMobile      = null;
    pendingVehicleInfo = null;
    activePWDRequest   = null;
    pwdIdFrontData     = null;
    pwdIdBackData      = null;
    if (pwdPollInterval)   { clearInterval(pwdPollInterval);   pwdPollInterval   = null; }
    if (pwdCountdownTimer) { clearInterval(pwdCountdownTimer); pwdCountdownTimer = null; }
    actionStep4.style.display = 'none';
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

        showVehicleStep(selectedSpot, session.mobile, 1);

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

    showVehicleStep(selectedSpot, mobile, 2);
    mOtpVerifyBtn.disabled    = false;
    mOtpVerifyBtn.textContent = 'Verify & Confirm';
  });

  // ── Step 3: vehicle form ─────────────────────────────────────────────
  function showVehicleStep(spot, mobile, fromStep) {
    pendingMobile   = mobile;
    vehicleFromStep = fromStep;
    const isMoto = spot.spotType === 'Motorcycle';
    const isPWD  = spot.spotType === 'PWD';
    const pad    = String(spot.spotNum).padStart(3, '0');

    mvBadge.textContent = `P${pad}`;
    mvTitle.textContent = selectedAction === 'park_now' ? '🚗 Park Now' : '🔒 Reserve Spot';
    mvSub.textContent   = isPWD  ? 'PWD spot · Staff verification required'
                        : isMoto ? `Motorcycle spot · Floor ${spot.floor_number}`
                        : `Standard spot · Floor ${spot.floor_number}`;

    mvStandard.style.display  = isMoto ? 'none' : '';
    mvMoto.style.display      = isMoto ? '' : 'none';
    mvPwdUpload.style.display = isPWD  ? '' : 'none';

    mvOwner.value     = '';
    mvPlate.value     = '';
    mvType.value      = 'car';
    mvMotoName.value  = '';
    mvMotoPlate.value = '';

    // Reset PWD upload state
    pwdIdFrontData = null;
    pwdIdBackData  = null;
    mvIdFront.value = '';
    mvIdBack.value  = '';
    mvIdFrontPreview.style.display = 'none';
    mvIdBackPreview.style.display  = 'none';
    const frontBtn = document.getElementById('mv-id-front-btn');
    const backBtn  = document.getElementById('mv-id-back-btn');
    if (frontBtn) { frontBtn.textContent = '📷 Tap to upload front'; frontBtn.style.borderColor = ''; frontBtn.style.color = ''; }
    if (backBtn)  { backBtn.textContent  = '📷 Tap to upload back';  backBtn.style.borderColor = ''; backBtn.style.color  = ''; }

    mvSubmitBtn.disabled    = false;
    mvSubmitBtn.textContent = isPWD
      ? '♿ Submit for Verification →'
      : (selectedAction === 'park_now' ? '🚗 Park Now →' : '🔒 Reserve Spot →');

    actionStep1.style.display = 'none';
    actionStep2.style.display = 'none';
    actionStep3.style.display = '';
    actionStep4.style.display = 'none';
    setTimeout(() => (isMoto ? mvMotoName : mvOwner).focus(), 60);
  }

  mvBackBtn.addEventListener('click', () => {
    actionStep3.style.display = 'none';
    if (vehicleFromStep === 2) {
      actionStep2.style.display = '';
      setTimeout(() => mOtpInput.focus(), 60);
    } else {
      actionStep1.style.display = '';
    }
  });

  // ── Image compression helper ──────────────────────────────────────────
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const MAX = 640;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else       { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  mvIdFront.addEventListener('change', async () => {
    if (!mvIdFront.files[0]) return;
    try {
      pwdIdFrontData = await compressImage(mvIdFront.files[0]);
      mvIdFrontImg.src = pwdIdFrontData;
      mvIdFrontPreview.style.display = '';
      const btn = document.getElementById('mv-id-front-btn');
      if (btn) { btn.textContent = '✓ Front uploaded'; btn.style.borderColor = 'var(--green-border)'; btn.style.color = 'var(--green)'; }
    } catch { toast('Failed to process image. Please try another.', 'error'); }
  });

  mvIdBack.addEventListener('change', async () => {
    if (!mvIdBack.files[0]) return;
    try {
      pwdIdBackData = await compressImage(mvIdBack.files[0]);
      mvIdBackImg.src = pwdIdBackData;
      mvIdBackPreview.style.display = '';
      const btn = document.getElementById('mv-id-back-btn');
      if (btn) { btn.textContent = '✓ Back uploaded'; btn.style.borderColor = 'var(--green-border)'; btn.style.color = 'var(--green)'; }
    } catch { toast('Failed to process image. Please try another.', 'error'); }
  });

  mvSubmitBtn.addEventListener('click', async () => {
    const isPWD  = selectedSpot?.spotType === 'PWD';
    const isMoto = selectedSpot?.spotType === 'Motorcycle';
    let vehicleInfo;

    if (isMoto) {
      const name  = mvMotoName.value.trim();
      const plate = mvMotoPlate.value.trim().toUpperCase();
      if (!name)  { toast('Please enter the rider name.', 'error');    mvMotoName.focus();  return; }
      if (!plate) { toast('Please enter the license plate.', 'error'); mvMotoPlate.focus(); return; }
      vehicleInfo = { owner: name, plate, type: 'motorcycle' };
    } else {
      const owner = mvOwner.value.trim();
      const plate = mvPlate.value.trim().toUpperCase();
      const type  = mvType.value;
      if (!owner) { toast('Please enter the owner name.', 'error');    mvOwner.focus(); return; }
      if (!plate) { toast('Please enter the license plate.', 'error'); mvPlate.focus(); return; }
      vehicleInfo = { owner, plate, type };
    }

    if (isPWD) {
      if (!pwdIdFrontData) { toast('Please upload the front of your PWD ID.', 'error'); return; }
      if (!pwdIdBackData)  { toast('Please upload the back of your PWD ID.',  'error'); return; }
    }

    mvSubmitBtn.disabled    = true;
    mvSubmitBtn.textContent = 'Processing…';

    if (isPWD) {
      pendingVehicleInfo = vehicleInfo;
      try {
        const result = await ParkingAPI.pwdRequest(
          selectedSpot.spotId, pendingMobile, selectedAction, vehicleInfo, pwdIdFrontData, pwdIdBackData
        );
        activePWDRequest = result.requestId;
        showPWDWaiting(result.expiresAt);
      } catch (err) {
        if (err.status === 409 && err.data?.spotTaken) {
          toast('That spot was just taken by someone else — pick another.', 'error', 5000);
          closeActionModal(); loadFloor(currentFloor);
        } else if (err.status === 409) {
          toast('You already have an active parking spot.', 'error');
          mvSubmitBtn.disabled    = false;
          mvSubmitBtn.textContent = '♿ Submit for Verification →';
        } else {
          toast(err.message || 'Action failed. Please try again.', 'error');
          mvSubmitBtn.disabled    = false;
          mvSubmitBtn.textContent = '♿ Submit for Verification →';
        }
      }
      return;
    }

    try {
      await executeAction(selectedSpot, pendingMobile, vehicleInfo);
    } catch (err) {
      if (err.status === 409 && err.data?.spotTaken) {
        toast('That spot was just taken by someone else — pick another.', 'error', 5000);
        closeActionModal();
        loadFloor(currentFloor);
      } else if (err.status === 409) {
        toast('You already have an active parking spot.', 'error');
        mvSubmitBtn.disabled    = false;
        mvSubmitBtn.textContent = selectedAction === 'park_now' ? '🚗 Park Now →' : '🔒 Reserve Spot →';
      } else {
        toast(err.message || 'Action failed. Please try again.', 'error');
        mvSubmitBtn.disabled    = false;
        mvSubmitBtn.textContent = selectedAction === 'park_now' ? '🚗 Park Now →' : '🔒 Reserve Spot →';
      }
    }
  });

  // ── Execute the chosen parking action ────────────────────────────────
  async function executeAction(spot, mobile, vehicleInfo = {}) {
    if (selectedAction === 'park_now') {
      const result = await ParkingAPI.parkNow(spot.spotId, mobile, vehicleInfo);
      toast(`Parked at P${String(spot.spotNum).padStart(3, '0')}! Txn: ${result.transactionId}`, 'success', 5000);
      closeActionModal();
      loadFloor(currentFloor);
    } else {
      const userId = 'user_' + Date.now();
      const result = await ParkingAPI.softLock(spot.spotId, userId, vehicleInfo, mobile);

      sessionStorage.setItem('reservation', JSON.stringify({
        spotId:       spot.spotId,
        spotNum:      spot.spotNum,
        floor:        spot.floor_number,
        row:          spot.row,
        col:          spot.col,
        features:     spot.features,
        spotType:     spot.spotType,
        vehicleInfo,
        lockId:       result.lockId,
        expiresAt:    result.expiresAt,
        userId,
        mobileNumber: mobile,
      }));

      window.location.href = 'confirm.html';
    }
  }

  // ── PWD waiting screen & polling ─────────────────────────────────────
  function showPWDWaiting(expiresAt) {
    actionStep1.style.display = 'none';
    actionStep2.style.display = 'none';
    actionStep3.style.display = 'none';
    actionStep4.style.display = '';

    const end = new Date(expiresAt).getTime();
    function tick() {
      const secs = Math.max(0, Math.round((end - Date.now()) / 1000));
      if (pwdCountdownEl) pwdCountdownEl.textContent = secs;
    }
    tick();
    if (pwdCountdownTimer) clearInterval(pwdCountdownTimer);
    pwdCountdownTimer = setInterval(tick, 1000);
    startPWDPolling();
  }

  function startPWDPolling() {
    if (pwdPollInterval) clearInterval(pwdPollInterval);
    pwdPollInterval = setInterval(async () => {
      if (!activePWDRequest) { clearInterval(pwdPollInterval); return; }
      try {
        const res = await ParkingAPI.pwdStatus(activePWDRequest);
        if (res.status === 'approved') {
          clearInterval(pwdPollInterval);
          clearInterval(pwdCountdownTimer);
          pwdPollInterval = null; pwdCountdownTimer = null;
          handlePWDApproved();
        } else if (res.status === 'declined') {
          clearInterval(pwdPollInterval);
          clearInterval(pwdCountdownTimer);
          pwdPollInterval = null; pwdCountdownTimer = null;
          handlePWDDeclined(res.reason);
        }
      } catch (err) {
        console.warn('[pwd-poll]', err.message);
      }
    }, 2000);
  }

  function handlePWDApproved() {
    const pad = String(selectedSpot?.spotNum || 0).padStart(3, '0');
    if (selectedAction === 'park_now') {
      toast(`PWD ID verified! You are now parked at P${pad}.`, 'success', 6000);
    } else {
      localStorage.setItem('ps_last_reservation', JSON.stringify({
        spotId: selectedSpot.spotId, spotNum: selectedSpot.spotNum,
        floor: selectedSpot.floor_number, mobileNumber: pendingMobile,
        vehicleInfo: pendingVehicleInfo, pwdApproved: true,
        reservedAt: new Date().toISOString(),
      }));
      document.getElementById('my-res-link').style.display = 'inline-flex';
      toast(`PWD ID verified! Spot P${pad} is reserved for you.`, 'success', 6000);
    }
    activePWDRequest   = null;
    pendingVehicleInfo = null;
    closeActionModal();
    loadFloor(currentFloor);
  }

  function handlePWDDeclined(reason) {
    if (reason === 'timeout') {
      toast('Time expired — no staff response. Please try again or contact reception.', 'error', 7000);
    } else {
      toast('PWD ID could not be verified by staff. Please contact reception.', 'error', 6000);
    }
    activePWDRequest   = null;
    pendingVehicleInfo = null;
    closeActionModal();
    loadFloor(currentFloor);
  }

  // ── Event wiring ─────────────────────────────────────────────────────
  document.getElementById('refresh-btn').addEventListener('click', () => loadFloor(currentFloor, true));

  document.querySelectorAll('.floor-mini').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.floor-mini').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentFloor = parseInt(card.dataset.floor);
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
    } catch (err) {
      console.error(err);
      toast('Failed to load floor data.', 'error');
    }
  }

  function updateFloorInfoBar(floor) {
    const wfLeft  = document.getElementById('wf-left');
    const wfRight = document.getElementById('wf-right');
    const meta    = FLOOR_LABELS[floor] || {};

    if (wfLeft) {
      if (meta.bottomLeft) {
        wfLeft.style.display = 'flex';
        wfLeft.className = `wf-indicator wf-${meta.bottomLeft.cls}`;
        wfLeft.innerHTML = `<span>${meta.bottomLeft.icon}</span><span>${meta.bottomLeft.text}</span>`;
      } else {
        wfLeft.style.display = 'none';
      }
    }

    if (wfRight) {
      if (meta.bottomRight) {
        wfRight.style.display = 'flex';
        wfRight.className = `wf-indicator wf-${meta.bottomRight.cls}`;
        wfRight.innerHTML = `<span>${meta.bottomRight.icon}</span><span>${meta.bottomRight.text}</span>`;
      } else {
        wfRight.style.display = 'none';
      }
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

    // If any spot is exiting, schedule a targeted reload just after its 30-sec grace ends
    clearTimeout(exitRefreshTimer);
    const exitingSpots = currentSpots.filter(s => s.status === 'exiting' && s.exitingAt);
    if (exitingSpots.length > 0) {
      const soonest = Math.min(...exitingSpots.map(s => new Date(s.exitingAt).getTime() + 30000));
      const delay   = Math.max(1500, soonest - Date.now() + 1500);
      exitRefreshTimer = setTimeout(() => loadFloor(currentFloor), delay);
    }

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

    // Re-apply spotlight after grid rebuild
    if (activeSpotlight) applySpotlight(activeSpotlight);
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
      const expiry = spot.reservedAt ? new Date(new Date(spot.reservedAt).getTime() + 30 * 60 * 1000) : null;
      const countdown = () => {
        if (!expiry) return '--:--';
        const s = Math.max(0, Math.round((expiry - Date.now()) / 1000));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };
      statusHtml = `
        <div style="color:var(--amber);font-weight:700;font-size:12px;">✓ RESERVED</div>
        <div style="color:var(--text-3);font-size:11px;margin-top:3px;">Expires in <span id="tt-countdown" style="font-family:var(--font-mono);color:var(--amber);">${countdown()}</span></div>
      `;
      if (tooltipTimer) clearInterval(tooltipTimer);
      tooltipTimer = setInterval(() => {
        const cd = document.getElementById('tt-countdown');
        if (cd) cd.textContent = countdown();
        else { clearInterval(tooltipTimer); tooltipTimer = null; }
      }, 1000);
    } else if (spot.status === 'exiting') {
      const exitExpiry = spot.exitingAt ? new Date(new Date(spot.exitingAt).getTime() + 30 * 1000) : null;
      const countdown = () => {
        if (!exitExpiry) return '--';
        return Math.max(0, Math.round((exitExpiry - Date.now()) / 1000)) + 's';
      };
      statusHtml = `
        <div style="color:#fbbf24;font-weight:700;font-size:12px;">⚠ EXITING</div>
        <div style="color:var(--text-3);font-size:11px;margin-top:3px;">Clears in <span id="tt-countdown" style="font-family:var(--font-mono);color:#fbbf24;">${countdown()}</span></div>
        <div style="color:var(--text-4);font-size:10px;margin-top:2px;">Safety lock active — unavailable</div>
      `;
      if (tooltipTimer) clearInterval(tooltipTimer);
      tooltipTimer = setInterval(() => {
        const cd = document.getElementById('tt-countdown');
        if (cd) cd.textContent = countdown();
        else { clearInterval(tooltipTimer); tooltipTimer = null; }
      }, 1000);
    } else if (spot.status === 'occupied') {
      const since = spot.occupiedAt ? new Date(spot.occupiedAt) : null;
      const elapsed = () => {
        if (!since) return '--:--:--';
        const total = Math.round((Date.now() - since) / 1000);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h > 0
          ? `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`
          : `${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
      };
      statusHtml = `
        <div style="color:var(--red);font-weight:700;font-size:12px;">● OCCUPIED</div>
        <div style="color:var(--text-3);font-size:11px;margin-top:3px;">Duration <span id="tt-countdown" style="font-family:var(--font-mono);color:var(--red);">${elapsed()}</span></div>
      `;
      if (tooltipTimer) clearInterval(tooltipTimer);
      tooltipTimer = setInterval(() => {
        const cd = document.getElementById('tt-countdown');
        if (cd) cd.textContent = elapsed();
        else { clearInterval(tooltipTimer); tooltipTimer = null; }
      }, 1000);
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

    if (spot.status === 'occupied') {
      openExitModal(spot);
      return;
    }
    if (spot.status === 'reserved') {
      const session = getSession();
      if (session && spot.mobileNumber === session.mobile) {
        openCheckinModal(spot);
      } else {
        toast(`Spot P${String(spot.spotNum).padStart(3, '0')} is reserved.`, 'info');
      }
      return;
    }
    if (spot.status !== 'available') {
      toast(`Spot P${String(spot.spotNum).padStart(3, '0')} is ${STATUS_LABEL[spot.status].toLowerCase()}.`, 'info');
      return;
    }

    selectedSpot = spot;
    openActionModal(spot);
  }

  // ── Spotlight helpers ─────────────────────────────────────────────────
  function getSpotLocation(spotNum) {
    for (let i = 0; i < ISLANDS_META.length; i++) {
      const isle = ISLANDS_META[i];
      const li = isle.colLeft.indexOf(spotNum);
      if (li !== -1) return { islandIdx: i, side: 'left',  rowInList: li };
      const ri = isle.colRight.indexOf(spotNum);
      if (ri !== -1) return { islandIdx: i, side: 'right', rowInList: ri };
    }
    return null;
  }

  function getSpotlightIds(category) {
    const available = currentSpots.filter(s => s.status === 'available');

    if (category === 'pwd') {
      return new Set(available.filter(s => s.spotType === 'PWD').map(s => s.spotId));
    }

    if (category === 'entrance') {
      // Entrance is at top-center between Islands C (idx 2) and D (idx 3)
      const scored = available.map(s => {
        const loc = getSpotLocation(s.spotNum);
        if (!loc) return { id: s.spotId, score: Infinity };
        return { id: s.spotId, score: Math.abs(loc.islandIdx - 2.5) * 20 + loc.rowInList };
      }).sort((a, b) => a.score - b.score);
      if (!scored.length) return new Set();
      const cutIdx  = Math.max(0, Math.ceil(scored.length * 0.35) - 1);
      const cutoff  = scored[cutIdx].score;
      return new Set(scored.filter(x => x.score <= cutoff).map(x => x.id));
    }

    if (category === 'exit') {
      // Exit is at bottom-left (Island A = idx 0, bottom rows)
      const scored = available.map(s => {
        const loc = getSpotLocation(s.spotNum);
        if (!loc) return { id: s.spotId, score: Infinity };
        return { id: s.spotId, score: loc.islandIdx * 20 + (17 - loc.rowInList) };
      }).sort((a, b) => a.score - b.score);
      if (!scored.length) return new Set();
      const cutIdx = Math.max(0, Math.ceil(scored.length * 0.35) - 1);
      const cutoff = scored[cutIdx].score;
      return new Set(scored.filter(x => x.score <= cutoff).map(x => x.id));
    }

    if (category === 'easy') {
      // Spots adjacent to a drive lane (section boundary rows) or with both column
      // neighbors also available — maximum maneuver room for new drivers
      const availNums = new Set(available.map(s => s.spotNum));
      return new Set(available.filter(s => {
        const loc = getSpotLocation(s.spotNum);
        if (!loc) return false;
        const col = loc.side === 'left'
          ? ISLANDS_META[loc.islandIdx].colLeft
          : ISLANDS_META[loc.islandIdx].colRight;
        const r = loc.rowInList;
        // Drive-lane boundaries: rows 0, 8, 9, 17 always have one open side
        if (r === 0 || r === 8 || r === 9 || r === 17) return true;
        // Interior: both above and below neighbors must also be available
        return availNums.has(col[r - 1]) && availNums.has(col[r + 1]);
      }).map(s => s.spotId));
    }

    return new Set();
  }

  function applySpotlight(category) {
    const grid = facilityGrid;

    if (!category) {
      grid.classList.remove('grid-spotlight');
      grid.querySelectorAll('.spotlight-hit').forEach(el => el.classList.remove('spotlight-hit'));
      document.querySelectorAll('.rec-filter-btn').forEach(b => b.classList.remove('active'));
      const hint = document.getElementById('spotlight-hint');
      if (hint) hint.style.display = 'none';
      activeSpotlight = null;
      return;
    }

    activeSpotlight = category;
    const ids = getSpotlightIds(category);

    grid.classList.add('grid-spotlight');
    grid.querySelectorAll('.spot-cell').forEach(el => {
      el.classList.toggle('spotlight-hit', ids.has(el.dataset.id));
    });

    const hint = document.getElementById('spotlight-hint');
    if (hint) {
      const labels = {
        entrance: 'spots near Mall Entrance highlighted',
        exit:     'spots near Parking Exit highlighted',
        pwd:      'available PWD spots highlighted',
        easy:     'easy-to-park spots highlighted',
      };
      hint.textContent  = ids.size > 0
        ? `${ids.size} ${labels[category]}`
        : 'No matching spots on this floor';
      hint.style.display = '';
    }
  }

  // ── Recommendation filter buttons ─────────────────────────────────────
  document.querySelectorAll('.rec-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat      = btn.dataset.spotlight;
      const isActive = btn.classList.contains('active');

      document.querySelectorAll('.rec-filter-btn').forEach(b => b.classList.remove('active'));

      if (isActive) {
        applySpotlight(null);  // toggle off
      } else {
        btn.classList.add('active');
        applySpotlight(cat);
      }
    });
  });

  // ── Dev console helpers ───────────────────────────────────────────────
  const DUMMY_OWNERS = ['Juan Cruz','Maria Santos','Roberto Reyes','Ana Flores','Carlos Bautista','Lisa Gomez','Marco Villanueva','Rosa Dela Cruz','Paolo Aquino','Jenny Navarro'];
  const DUMMY_PLATES = ['ABC 1234','XYZ 5678','DEF 9012','GHI 3456','JKL 7890','MNO 2345','PQR 6789','STU 0123','VWX 4567','YZA 8901'];

  async function devPatch(spotId, body) {
    const token = localStorage.getItem('staff_token');
    return fetch(`http://localhost:3000/api/staff/spots/${spotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    }).catch(e => console.warn('[dev] patch failed:', spotId, e.message));
  }

  window.__fillFloor = async function(percent = 70) {
    const token = localStorage.getItem('staff_token');
    if (!token) {
      console.warn('%c[fillFloor] ❌ No staff token found.\nOpen staff.html → log in as admin → come back here → run __fillFloor(' + percent + ') again.', 'color:red;font-weight:bold;font-size:13px');
      return;
    }

    const available = currentSpots.filter(s => s.status === 'available');
    const count     = Math.round(available.length * (percent / 100));
    const toFill    = [...available].sort(() => Math.random() - 0.5).slice(0, count);

    console.log(`%c[fillFloor] Filling ${count} of ${available.length} available spots to ~${percent}%…`, 'color:#E87B3D;font-weight:bold');

    const tasks = toFill.map(spot => {
      const owner = DUMMY_OWNERS[Math.floor(Math.random() * DUMMY_OWNERS.length)];
      const plate = DUMMY_PLATES[Math.floor(Math.random() * DUMMY_PLATES.length)];
      return devPatch(spot.spotId, { status: 'occupied', notes: `[dev] ${owner} · ${plate}` });
    });

    // Batches of 5 with a 300ms pause between batches to stay under rate limit
    for (let i = 0; i < tasks.length; i += 5) {
      await Promise.all(tasks.slice(i, i + 5));
      if (i + 5 < tasks.length) await new Promise(r => setTimeout(r, 300));
    }

    console.log('%c[fillFloor] ✓ Done! Run __clearFloor() to reset.', 'color:green;font-weight:bold');
    toast(`Dev: filled ~${percent}% of floor ${currentFloor}`, 'info', 3500);
    await loadFloor(currentFloor);
  };

  window.__clearFloor = async function() {
    const token = localStorage.getItem('staff_token');
    if (!token) {
      console.warn('%c[clearFloor] ❌ No staff token. Open staff.html → log in → come back → run __clearFloor()', 'color:red;font-weight:bold;font-size:13px');
      return;
    }

    const toFree = currentSpots.filter(s => ['occupied', 'reserved', 'soft_locked'].includes(s.status));
    console.log(`%c[clearFloor] Clearing ${toFree.length} spots on floor ${currentFloor}…`, 'color:#E87B3D;font-weight:bold');

    const tasks = toFree.map(spot => devPatch(spot.spotId, { status: 'available', notes: '[dev] cleared' }));

    // Batches of 5 with a 300ms pause between batches to stay under rate limit
    for (let i = 0; i < tasks.length; i += 5) {
      await Promise.all(tasks.slice(i, i + 5));
      if (i + 5 < tasks.length) await new Promise(r => setTimeout(r, 300));
    }

    console.log('%c[clearFloor] ✓ Done!', 'color:green;font-weight:bold');
    toast(`Dev: cleared all spots on floor ${currentFloor}`, 'info', 3500);
    await loadFloor(currentFloor);
  };
}
