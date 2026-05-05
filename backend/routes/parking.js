const express    = require('express');
const { v4: uuid } = require('uuid');
const router     = express.Router();
const ParkingSpot  = require('../models/ParkingSpot');
const Transaction  = require('../models/Transaction');
const User         = require('../models/User');

function r(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

const PRIORITY = {
  entrance:   [...r(1,36),    ...r(37,72),   ...r(73,108),  ...r(109,144), ...r(145,180), ...r(181,216)],
  exit:       [...r(181,216), ...r(145,180), ...r(109,144), ...r(73,108),  ...r(37,72),   ...r(1,36)],
  grocery:    [...r(73,108),  ...r(109,144), ...r(37,72),   ...r(145,180), ...r(1,36),    ...r(181,216)],
  disability: [1, 2, ...r(3, 216)],
};

const SOFT_LOCK_MS = 3 * 60 * 1000;

async function recordUserStrike(mobileNumber) {
  const user = await User.findOne({ mobileNumber });
  if (!user) return;
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
      { $set: { status: 'available', softLock: null }, $inc: { version: 1 } }
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

async function verifyUserSession(mobileNumber, userToken) {
  if (!mobileNumber || !userToken) return null;
  return User.findOne({ mobileNumber, sessionToken: userToken });
}

router.get('/levels/:level/spots', async (req, res) => {
  const level = parseInt(req.params.level);
  if (![1, 2, 3].includes(level)) {
    return res.status(400).json({ error: 'Level must be 1, 2, or 3' });
  }

  try {
    await releaseExpiredLocks();
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
    await releaseExpiredLocks();

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

    try { await releaseExpiredLocks(); } catch (e) { console.warn('[soft-lock] releaseExpiredLocks failed:', e.message); }

    const spot = await ParkingSpot.findOne({ spotId });
    console.log('[soft-lock] spot found:', spot?.spotId, 'status:', spot?.status);

    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    if (spot.status !== 'available') {
      return res.status(409).json({ error: 'Spot is not available', currentStatus: spot.status });
    }

    const lockId    = uuid();
    const expiresAt = new Date(Date.now() + SOFT_LOCK_MS);

    const updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version, status: 'available' },
      {
        $set: {
          status: 'soft_locked',
          softLock: { userId, lockId, expiresAt, mobileNumber: mobileNumber || null },
          vehicle: vehicleInfo || {},
        },
        $inc: { version: 1 },
      },
      { new: true }
    );
    console.log('[soft-lock] update result:', updated ? 'success' : 'null (OCC conflict)');

    if (!updated) {
      return res.status(409).json({ error: 'Concurrent reservation detected. Please refresh and try again.' });
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
        $set: { status: 'reserved', vehicle, reservedAt: new Date(), reservedBy: vehicle?.owner || 'guest', softLock: null },
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

router.post('/spots/:spotId/park-now', async (req, res) => {
  const { mobileNumber, userToken, vehicleInfo } = req.body || {};
  const { spotId } = req.params;

  if (!mobileNumber || !userToken) {
    return res.status(400).json({ error: 'mobileNumber and userToken are required' });
  }

  try {
    const user = await verifyUserSession(mobileNumber, userToken);
    if (!user) return res.status(401).json({ error: 'Invalid session. Please log in again.' });
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      return res.status(403).json({ error: 'Account is locked.', lockoutUntil: user.lockoutUntil });
    }

    try { await releaseExpiredLocks(); } catch (e) { console.warn('[park-now] releaseExpiredLocks failed:', e.message); }

    const spot = await ParkingSpot.findOne({ spotId });
    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    if (spot.status !== 'available') {
      return res.status(409).json({ error: 'Spot is not available', currentStatus: spot.status });
    }

    const updated = await ParkingSpot.findOneAndUpdate(
      { spotId, version: spot.version, status: 'available' },
      {
        $set: { status: 'occupied', occupiedAt: new Date(), vehicle: vehicleInfo || {}, softLock: null },
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ error: 'Concurrent update detected. Please try again.' });
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
        $set: { status: 'available', vehicle: null, softLock: null, reservedAt: null, reservedBy: null, occupiedAt: null },
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

module.exports = router;
