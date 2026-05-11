const express    = require('express');
const { v4: uuid } = require('uuid');
const router     = express.Router();
const ParkingSpot  = require('../models/ParkingSpot');
const Transaction  = require('../models/Transaction');
const User         = require('../models/User');
const PWDRequest   = require('../models/PWDRequest');

function r(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

const PRIORITY = {
  entrance:   [...r(1,36),    ...r(37,72),   ...r(73,108),  ...r(109,144), ...r(145,180), ...r(181,216)],
  exit:       [...r(181,216), ...r(145,180), ...r(109,144), ...r(73,108),  ...r(37,72),   ...r(1,36)],
  grocery:    [...r(73,108),  ...r(109,144), ...r(37,72),   ...r(145,180), ...r(1,36),    ...r(181,216)],
  disability: [1, 2, ...r(3, 216)],
};

const SOFT_LOCK_MS        = 3 * 60 * 1000;
const PWD_LOCK_MS         = 30 * 1000;
const RESERVED_TIMEOUT_MS = 30 * 60 * 1000;
const EXIT_GRACE_MS       = 30 * 1000;

async function recordUserStrike(mobileNumber) {
  let user = await User.findOne({ mobileNumber });
  if (!user) user = await User.create({ mobileNumber, verified: true });
  user.strikes += 1;
  if (user.strikes >= 3 && (!user.lockoutUntil || user.lockoutUntil < new Date())) {
    user.lockoutUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  await user.save();
}

async function releaseExpiredLocks() {
  const expired = await ParkingSpot.find({
    status: 'soft_locked',
    'softLock.expiresAt': { $lt: new Date() },
  });

  for (const spot of expired) {
    const mobileNumber = spot.softLock?.mobileNumber;

    await ParkingSpot.findOneAndUpdate(
      { _id: spot._id, version: spot.version },
      { $set: { status: 'available', softLock: null, mobileNumber: null }, $inc: { version: 1 } }
    );
    await Transaction.create({
      transactionId: uuid(),
      floor_number: spot.floor_number,
      spotId: spot.spotId,
      spotNum: spot.spotNum,
      type: 'expire',
      notes: 'Soft lock expired',
    });

    if (mobileNumber) {
      recordUserStrike(mobileNumber).catch(e => console.warn('[expire-strike]', e.message));
    }
  }
}

async function releaseExpiredReservations() {
  const cutoff  = new Date(Date.now() - RESERVED_TIMEOUT_MS);
  const expired = await ParkingSpot.find({ status: 'reserved', reservedAt: { $lt: cutoff } });

  for (const spot of expired) {
    const mobile = spot.mobileNumber;

    await ParkingSpot.findOneAndUpdate(
      { _id: spot._id, version: spot.version },
      {
        $set: { status: 'available', mobileNumber: null, vehicle: null, softLock: null, reservedAt: null, reservedBy: null },
        $inc: { version: 1 },
      }
    );
    await Transaction.create({
      transactionId: uuid(),
      floor_number:  spot.floor_number,
      spotId:        spot.spotId,
      spotNum:       spot.spotNum,
      type:          'expire',
      notes:         'Reserved spot auto-released after 30-minute timeout',
    });

    if (mobile) {
      recordUserStrike(mobile).catch(e => console.warn('[reserve-expire-strike]', e.message));
    }
  }
}

async function releaseExpiredExits() {
  const cutoff  = new Date(Date.now() - EXIT_GRACE_MS);
  const expired = await ParkingSpot.find({ status: 'exiting', exitingAt: { $lt: cutoff } });

  for (const spot of expired) {
    await ParkingSpot.findOneAndUpdate(
      { _id: spot._id, version: spot.version },
      {
        $set: { status: 'available', mobileNumber: null, vehicle: null, exitingAt: null, occupiedAt: null },
        $inc: { version: 1 },
      }
    );
    await Transaction.create({
      transactionId: uuid(),
      floor_number:  spot.floor_number,
      spotId:        spot.spotId,
      spotNum:       spot.spotNum,
      type:          'release',
      notes:         'Auto-released after 30-second exit grace period',
    });
  }
}

async function releaseExpired() {
  await Promise.allSettled([releaseExpiredLocks(), releaseExpiredReservations(), releaseExpiredExits()]);
}

async function verifyUserSession(mobileNumber, userToken) {
  if (!mobileNumber || !userToken) return null;
  return User.findOne({ mobileNumber, sessionToken: userToken });
}

async function hasActiveSpot(mobileNumber) {
  if (!mobileNumber) return false;
  const spot = await ParkingSpot.findOne({
    mobileNumber,
    status: { $in: ['soft_locked', 'reserved', 'occupied'] },
    // 'exiting' excluded — payment confirmed, mobile is free to rebook
  });
  return !!spot;
}

router.get('/levels/:level/spots', async (req, res) => {
  const level = parseInt(req.params.level);
  if (![1, 2, 3].includes(level)) {
    return res.status(400).json({ error: 'Level must be 1, 2, or 3' });
  }

  try {
    await releaseExpired();
    const spots = await ParkingSpot.find({ floor_number: level }).sort({ spotNum: 1 });
    res.json(spots);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch spots' });
  }
});

router.get('/recommend', async (req, res) => {
  const level    = parseInt(req.query.level) || 1;
  const criteria = req.query.criteria || 'entrance';

  if (!PRIORITY[criteria]) {
    return res.status(400).json({ error: 'Invalid criteria. Use: entrance, exit, grocery, disability' });
  }

  try {
    await releaseExpired();

    const available = await ParkingSpot.find({ floor_number: level, status: 'available' });
    const availSet  = new Set(available.map(s => s.spotNum));
    const ordered   = PRIORITY[criteria].filter(n => availSet.has(n));

    res.json({ criteria, level, recommendedOrder: ordered, availableCount: available.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

router.post('/spots/:spotId/soft-lock', async (req, res) => {
  const { userId = 'guest', vehicleInfo, mobileNumber, userToken } = req.body || {};
  const { spotId } = req.params;

  try {
    // Verify user session if credentials provided
    if (mobileNumber && userToken) {
      const user = await verifyUserSession(mobileNumber, userToken);
      if (!user) {
        return res.status(401).json({ error: 'Invalid session. Please log in again.' });
      }
      if (user.lockoutUntil && user.lockoutUntil > new Date()) {
        return res.status(403).json({ error: 'Account is locked due to repeated no-shows.', lockoutUntil: user.lockoutUntil });
      }
    }

    if (mobileNumber && await hasActiveSpot(mobileNumber)) {
      return res.status(409).json({ error: 'This mobile number already has an active parking spot.' });
    }

    try { await releaseExpired(); } catch (e) { console.warn('[soft-lock] releaseExpired failed:', e.message); }

    const spot = await ParkingSpot.findOne({ spotId });
    console.log('[soft-lock] spot found:', spot?.spotId, 'status:', spot?.status);

    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    if (spot.status !== 'available') {
      return res.status(409).json({ error: 'Spot is not available', currentStatus: spot.status });
    }

    const lockId    = uuid();
    const expiresAt = new Date(Date.now() + SOFT_LOCK_MS);

    let updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version, status: 'available' },
      {
        $set: {
          status: 'soft_locked',
          mobileNumber: mobileNumber || null,
          softLock: { userId, lockId, expiresAt, mobileNumber: mobileNumber || null },
          vehicle: vehicleInfo || {},
        },
        $inc: { version: 1 },
      },
      { new: true }
    );
    console.log('[soft-lock] update result:', updated ? 'success' : 'null (OCC conflict)');

    // OCC conflict — retry once: re-read and try again if spot is still available
    if (!updated) {
      const fresh = await ParkingSpot.findOne({ spotId });
      if (!fresh || fresh.status !== 'available') {
        return res.status(409).json({ error: 'Spot was just taken by another user.', spotTaken: true });
      }
      updated = await ParkingSpot.findOneAndUpdate(
        { spotId, version: fresh.version, status: 'available' },
        {
          $set: {
            status: 'soft_locked',
            mobileNumber: mobileNumber || null,
            softLock: { userId, lockId, expiresAt, mobileNumber: mobileNumber || null },
            vehicle: vehicleInfo || {},
          },
          $inc: { version: 1 },
        },
        { new: true }
      );
      if (!updated) {
        return res.status(409).json({ error: 'Spot was just taken by another user.', spotTaken: true });
      }
    }

    try {
      await Transaction.create({
        transactionId: uuid(),
        floor_number: spot.floor_number,
        spotId, spotNum: spot.spotNum,
        type: 'soft_lock',
        vehicle: vehicleInfo || {},
        userId: mobileNumber || userId,
      });
    } catch (txErr) {
      console.warn('[soft-lock] transaction log failed (non-fatal):', txErr.message);
    }

    res.json({ success: true, lockId, expiresAt, spotId, floor: spot.floor_number, expiresInSeconds: 180 });
  } catch (err) {
    console.error('[soft-lock] ERROR:', err);
    res.status(500).json({ error: 'Failed to soft-lock spot', detail: err.message });
  }
});

router.post('/spots/:spotId/reserve', async (req, res) => {
  const { lockId, vehicleInfo } = req.body || {};
  const { spotId } = req.params;

  if (!lockId) return res.status(400).json({ error: 'lockId is required' });

  try {
    const spot = await ParkingSpot.findOne({ spotId });
    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    if (spot.status !== 'soft_locked') {
      return res.status(409).json({ error: 'No active soft lock on this spot' });
    }
    if (spot.softLock.lockId !== lockId) {
      return res.status(403).json({ error: 'Lock ID mismatch' });
    }
    if (spot.softLock.expiresAt < new Date()) {
      return res.status(410).json({ error: 'Soft lock has expired. Please start over.' });
    }

    const vehicle = vehicleInfo || spot.vehicle;

    const updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version, 'softLock.lockId': lockId },
      {
        $set: {
          status: 'reserved',
          mobileNumber: spot.softLock?.mobileNumber || null,
          vehicle,
          reservedAt: new Date(),
          reservedBy: vehicle?.owner || 'guest',
          softLock: null,
        },
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ error: 'Conflict detected. Please retry.' });
    }

    const transactionId = uuid();
    await Transaction.create({
      transactionId,
      floor_number: spot.floor_number,
      spotId, spotNum: spot.spotNum,
      type: 'reserve',
      vehicle,
      userId: spot.softLock?.userId,
    });

    res.json({ success: true, transactionId, spotId, floor: spot.floor_number, reservedAt: updated.reservedAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm reservation' });
  }
});

router.get('/check-mobile', async (req, res) => {
  const { mobile } = req.query;
  if (!mobile) return res.status(400).json({ error: 'mobile query param required' });

  try {
    await releaseExpired();

    const [activeSpot, user] = await Promise.all([
      ParkingSpot.findOne({ mobileNumber: mobile, status: { $in: ['soft_locked', 'reserved', 'occupied'] } }),
      User.findOne({ mobileNumber: mobile }),
    ]);

    const locked = !!(user?.lockoutUntil && user.lockoutUntil > new Date());

    res.json({
      hasActiveSession: !!activeSpot,
      locked,
      lockoutUntil: user?.lockoutUntil || null,
      strikes:      user?.strikes || 0,
    });
  } catch (err) {
    console.error('[check-mobile]', err);
    res.status(500).json({ error: 'Failed to check mobile status' });
  }
});

router.post('/spots/:spotId/park-now', async (req, res) => {
  const { mobileNumber, vehicleInfo } = req.body || {};
  const { spotId } = req.params;

  if (!mobileNumber) {
    return res.status(400).json({ error: 'mobileNumber is required' });
  }

  try {
    const user = await User.findOne({ mobileNumber });
    if (user?.lockoutUntil && user.lockoutUntil > new Date()) {
      return res.status(403).json({ error: 'Account is locked.', lockoutUntil: user.lockoutUntil });
    }

    if (await hasActiveSpot(mobileNumber)) {
      return res.status(409).json({ error: 'This mobile number already has an active parking spot.' });
    }

    try { await releaseExpired(); } catch (e) { console.warn('[park-now] releaseExpired failed:', e.message); }

    const spot = await ParkingSpot.findOne({ spotId });
    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    if (spot.status !== 'available') {
      return res.status(409).json({ error: 'Spot is not available', currentStatus: spot.status });
    }

    let updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version, status: 'available' },
      {
        $set: { status: 'occupied', mobileNumber, occupiedAt: new Date(), vehicle: vehicleInfo || {}, softLock: null },
        $inc: { version: 1 },
      },
      { new: true }
    );

    // OCC conflict — retry once
    if (!updated) {
      const fresh = await ParkingSpot.findOne({ spotId });
      if (!fresh || fresh.status !== 'available') {
        return res.status(409).json({ error: 'Spot was just taken by another user.', spotTaken: true });
      }
      updated = await ParkingSpot.findOneAndUpdate(
        { spotId, version: fresh.version, status: 'available' },
        {
          $set: { status: 'occupied', mobileNumber, occupiedAt: new Date(), vehicle: vehicleInfo || {}, softLock: null },
          $inc: { version: 1 },
        },
        { new: true }
      );
      if (!updated) {
        return res.status(409).json({ error: 'Spot was just taken by another user.', spotTaken: true });
      }
    }

    const transactionId = uuid();
    await Transaction.create({
      transactionId,
      floor_number: spot.floor_number,
      spotId,
      spotNum: spot.spotNum,
      type: 'park_now',
      vehicle: vehicleInfo || {},
      userId: mobileNumber,
    });

    res.json({ success: true, transactionId, spotId, floor: spot.floor_number });
  } catch (err) {
    console.error('[park-now] ERROR:', err);
    res.status(500).json({ error: 'Failed to park now', detail: err.message });
  }
});

router.post('/spots/:spotId/occupy', async (req, res) => {
  const { spotId } = req.params;
  const { vehicleInfo } = req.body || {};

  try {
    const spot = await ParkingSpot.findOne({ spotId });
    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    if (spot.status !== 'reserved') {
      return res.status(409).json({ error: 'Spot must be reserved first', currentStatus: spot.status });
    }

    const updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version, status: 'reserved' },
      {
        $set: { status: 'occupied', occupiedAt: new Date(), vehicle: vehicleInfo || spot.vehicle },
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updated) return res.status(409).json({ error: 'Concurrent update detected. Please retry.' });

    await Transaction.create({
      transactionId: uuid(),
      floor_number:  spot.floor_number,
      spotId,
      spotNum:       spot.spotNum,
      type:          'occupy',
      vehicle:       vehicleInfo || spot.vehicle,
    });

    res.json({ success: true, spotId, floor: spot.floor_number });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark spot as occupied' });
  }
});

router.delete('/spots/:spotId/release', async (req, res) => {
  const { spotId } = req.params;

  try {
    const spot = await ParkingSpot.findOne({ spotId });
    if (!spot) return res.status(404).json({ error: 'Spot not found' });

    const prevVehicle = spot.vehicle;

    const updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version },
      {
        $set: { status: 'available', mobileNumber: null, vehicle: null, softLock: null, reservedAt: null, reservedBy: null, occupiedAt: null },
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ error: 'Conflict detected.' });
    }

    await Transaction.create({
      transactionId: uuid(),
      floor_number: spot.floor_number,
      spotId, spotNum: spot.spotNum,
      type: 'release',
      vehicle: prevVehicle,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to release spot' });
  }
});

// POST /spots/:spotId/complete-exit  (staff: payment confirmed → 30-sec exit grace)
router.post('/spots/:spotId/complete-exit', async (req, res) => {
  const { spotId } = req.params;

  try {
    const spot = await ParkingSpot.findOne({ spotId });
    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    if (spot.status !== 'occupied') {
      return res.status(409).json({ error: 'Spot must be occupied to complete exit', currentStatus: spot.status });
    }

    const exitingAt = new Date();
    const updated   = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version, status: 'occupied' },
      {
        $set: { status: 'exiting', exitingAt, mobileNumber: null },
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updated) return res.status(409).json({ error: 'Concurrent update detected.' });

    const durationMinutes = spot.occupiedAt
      ? Math.round((exitingAt - spot.occupiedAt) / 60000)
      : null;

    await Transaction.create({
      transactionId: uuid(),
      floor_number:  spot.floor_number,
      spotId,
      spotNum:       spot.spotNum,
      type:          'complete_exit',
      vehicle:       spot.vehicle,
      userId:        spot.mobileNumber,
      durationMinutes,
    });

    res.json({ success: true, exitingAt, expiresInSeconds: 30, durationMinutes });
  } catch (err) {
    console.error('[complete-exit]', err);
    res.status(500).json({ error: 'Failed to complete exit.' });
  }
});

// POST /spots/:spotId/pwd-request — create PWD verification request + soft-lock spot for 30s
router.post('/spots/:spotId/pwd-request', async (req, res) => {
  const { mobileNumber, action = 'reserve', vehicleInfo, idFront, idBack } = req.body || {};
  const { spotId } = req.params;

  if (!mobileNumber)        return res.status(400).json({ error: 'mobileNumber is required' });
  if (!idFront || !idBack)  return res.status(400).json({ error: 'Both PWD ID photos are required' });
  if (!['reserve', 'park_now'].includes(action)) return res.status(400).json({ error: 'action must be reserve or park_now' });

  try {
    const user = await User.findOne({ mobileNumber });
    if (user?.lockoutUntil && user.lockoutUntil > new Date()) {
      return res.status(403).json({ error: 'Account is locked.', lockoutUntil: user.lockoutUntil });
    }
    if (await hasActiveSpot(mobileNumber)) {
      return res.status(409).json({ error: 'This mobile number already has an active parking spot.' });
    }

    try { await releaseExpired(); } catch (e) { console.warn('[pwd-request] releaseExpired failed:', e.message); }

    const spot = await ParkingSpot.findOne({ spotId });
    if (!spot)                      return res.status(404).json({ error: 'Spot not found' });
    if (spot.spotType !== 'PWD')    return res.status(400).json({ error: 'This spot is not a PWD spot' });
    if (spot.status !== 'available') return res.status(409).json({ error: 'Spot is not available', currentStatus: spot.status });

    const requestId = uuid();
    const lockId    = uuid();
    const expiresAt = new Date(Date.now() + PWD_LOCK_MS);

    let updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version, status: 'available' },
      {
        $set: {
          status: 'soft_locked', mobileNumber,
          softLock: { userId: mobileNumber, lockId, expiresAt, mobileNumber },
          vehicle: vehicleInfo || {},
        },
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updated) {
      const fresh = await ParkingSpot.findOne({ spotId });
      if (!fresh || fresh.status !== 'available') {
        return res.status(409).json({ error: 'Spot was just taken by another user.', spotTaken: true });
      }
      const freshExpires = new Date(Date.now() + PWD_LOCK_MS);
      updated = await ParkingSpot.findOneAndUpdate(
        { spotId, version: fresh.version, status: 'available' },
        {
          $set: {
            status: 'soft_locked', mobileNumber,
            softLock: { userId: mobileNumber, lockId, expiresAt: freshExpires, mobileNumber },
            vehicle: vehicleInfo || {},
          },
          $inc: { version: 1 },
        },
        { new: true }
      );
      if (!updated) return res.status(409).json({ error: 'Spot was just taken by another user.', spotTaken: true });
    }

    await PWDRequest.create({
      requestId, spotId,
      floor_number: spot.floor_number,
      spotNum:      spot.spotNum,
      mobileNumber, action,
      vehicleInfo: vehicleInfo || {},
      idFront, idBack,
      status: 'pending',
      lockId, userId: mobileNumber,
      expiresAt,
    });

    await Transaction.create({
      transactionId: uuid(),
      floor_number:  spot.floor_number,
      spotId, spotNum: spot.spotNum,
      type: 'soft_lock',
      vehicle: vehicleInfo || {},
      userId: mobileNumber,
      notes: 'PWD ID verification pending',
    });

    res.json({ success: true, requestId, expiresAt, expiresInSeconds: 30 });
  } catch (err) {
    console.error('[pwd-request] ERROR:', err);
    res.status(500).json({ error: 'Failed to create PWD request', detail: err.message });
  }
});

// GET /pwd-request/:requestId/status — poll approval status; auto-decline if expired
router.get('/pwd-request/:requestId/status', async (req, res) => {
  const { requestId } = req.params;
  try {
    const pwdReq = await PWDRequest.findOne({ requestId });
    if (!pwdReq) return res.status(404).json({ error: 'PWD request not found' });

    if (pwdReq.status === 'pending' && pwdReq.expiresAt < new Date()) {
      pwdReq.status = 'declined';
      await pwdReq.save();
      const spot = await ParkingSpot.findOne({ spotId: pwdReq.spotId });
      if (spot && spot.status === 'soft_locked' && spot.softLock?.lockId === pwdReq.lockId) {
        await ParkingSpot.findOneAndUpdate(
          { _id: spot._id, version: spot.version },
          { $set: { status: 'available', softLock: null, mobileNumber: null, vehicle: null }, $inc: { version: 1 } }
        );
      }
      return res.json({ status: 'declined', reason: 'timeout' });
    }

    res.json({ status: pwdReq.status, spotId: pwdReq.spotId, action: pwdReq.action });
  } catch (err) {
    console.error('[pwd-status] ERROR:', err);
    res.status(500).json({ error: 'Failed to get PWD request status' });
  }
});

module.exports = router;
