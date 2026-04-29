const express    = require('express');
const { v4: uuid } = require('uuid');
const router     = express.Router();
const ParkingSpot  = require('../models/ParkingSpot');
const Transaction  = require('../models/Transaction');

const PRIORITY = {
  entrance:   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  exit:       [9, 10, 5, 6, 1, 2, 11, 12, 7, 8, 3, 4],
  grocery:    [11, 12, 7, 8, 3, 4, 9, 10, 5, 6, 1, 2],
  disability: [3, 4, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12],
};

const SOFT_LOCK_MS = 3 * 60 * 1000;

async function releaseExpiredLocks() {
  const expired = await ParkingSpot.find({
    status: 'soft_locked',
    'softLock.expiresAt': { $lt: new Date() },
  });

  for (const spot of expired) {
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
  }
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
  const { userId = 'guest', vehicleInfo } = req.body || {};
  const { spotId } = req.params;

  try {
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
        $set: { status: 'soft_locked', softLock: { userId, lockId, expiresAt }, vehicle: vehicleInfo || {} },
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
        userId,
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
